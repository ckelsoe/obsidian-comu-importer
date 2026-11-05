// One place that turns settings into an import: the options the shared note
// writer and runner take, the writer itself, and the run. The import window
// and automatic sync both go through here, so they write identical notes.

import type { App } from 'obsidian';
import {
	BufferedDebugLogger,
	buildImportedIndexWithColdCheck,
	managedMarkers,
	NoteWriter,
	runImport,
	type ArtifactSelection,
	type DebugLogger,
	type DuplicatePolicy,
	type DuplicatePromptCallback,
	type ImportedIndex,
	type ImportModalOptions,
	type ImportRunObserver,
	type Recording,
	type RecordingId,
} from 'obsidian-recording-importer-core';
import { AudioPipeline } from './audio-pipeline';
import {
	COMU_ERROR_POLICY,
	ComuNotProcessedError,
	type ComuClient,
} from './comu-client';
import { COMU_PROFILE } from './comu-profile';
import { foldTranscript } from './note-folds';
import type { RecordingRenamer } from './rename';
import type { ComuImporterSettings } from './settings';

/** What one import fetches and writes. */
export interface ImportChoice {
	readonly summary: boolean;
	readonly transcript: boolean;
	readonly audio: boolean;
}

function selectionFor(choice: ImportChoice): ArtifactSelection {
	return {
		includeSummary: choice.summary,
		includeTranscript: choice.transcript,
		includeAttachments: false,
		includeMindmap: false,
		includeCard: false,
		includeScreenshots: false,
		includeAudio: choice.audio,
	};
}

/** True when the choice imports nothing at all. */
export function isEmptyChoice(choice: ImportChoice): boolean {
	return !choice.summary && !choice.transcript && !choice.audio;
}

/** Thrown when a second import starts while one is running. */
class ImportBusyError extends Error {
	constructor() {
		super('Another import or sync is running. Try again when it finishes.');
		this.name = 'ImportBusyError';
	}
}

/** True when Comu has nothing to import for the recording yet. */
export function isUnprocessed(recording: Recording): boolean {
	return !recording.transcriptAvailable && !recording.summaryAvailable;
}

export class ImportService {
	readonly debugLogger: DebugLogger;
	/**
	 * Held for a whole manual import or sync, so two runs never write the same
	 * note. Take it with tryLock() before run() and release it with unlock().
	 */
	private locked = false;

	tryLock(): boolean {
		if (this.locked) return false;
		this.locked = true;
		return true;
	}

	unlock(): void {
		this.locked = false;
	}

	constructor(
		private readonly app: App,
		private readonly client: ComuClient,
		private readonly settings: () => ComuImporterSettings,
		private readonly saveSettings: () => Promise<void>,
		private readonly renamer: RecordingRenamer,
	) {
		this.debugLogger = new BufferedDebugLogger(settings().debug, {
			consoleSink: (message, payload) =>
				console.debug(`Comu importer: ${message}`, payload),
		});
	}

	/** The writer and runner options, from the current settings. */
	options(onDuplicate: DuplicatePolicy): ImportModalOptions {
		const s = this.settings();
		this.debugLogger.setEnabled(s.debug);
		return {
			profile: COMU_PROFILE,
			errorPolicy: COMU_ERROR_POLICY,
			outputFolder: s.outputFolder,
			subfolderTemplate: s.subfolderTemplate,
			noteNameTemplate: s.noteNameTemplate,
			datetimeTemplate: s.datetimeTemplate,
			fallbackTimezone: s.fallbackTimezone,
			customFrontmatter: s.customFrontmatter,
			preserveUnknownFrontmatter: s.preserveUnknownFrontmatter,
			forbiddenCharReplacement: s.forbiddenCharReplacement,
			onDuplicate,
			transcriptPlacement: s.transcriptPlacement,
			transcriptHeaderLevel: s.transcriptHeaderLevel,
			foldTranscript: s.foldTranscript,
			// Comu has no AI keyword tags, so only the user's own tags apply.
			tagMode: s.tagMode,
			customTags: s.customTags,
			aiKeywordsAsProperty: false,
			writePlaceholderForUnprocessed: s.writePlaceholderForUnprocessed,
			autoCloseSummary: s.autoCloseSummary,
			autoCloseSummarySeconds: s.autoCloseSummarySeconds,
			showTrashedRecordings: s.showTrashed,
			hideProcessedRecordings: s.hideProcessedRecordings,
			hideUpdatesRecordings: s.hideUpdatesRecordings,
			hideIgnoredRecordings: s.hideIgnoredRecordings,
			ignoredRecordingIds: s.ignoredRecordingIds,
			onViewStateChange: (patch) => {
				Object.assign(s, patch);
				this.saveSettings().catch((err: unknown) => {
					console.error(
						'Comu importer: could not save the view',
						err,
					);
				});
			},
			debugLogger: this.debugLogger,
			// A re-import whose title or folder changed moves the note and its
			// -assets folder instead of leaving the old copy behind.
			migrateExistingNote: (oldPath, newPath) =>
				this.renamer.move(oldPath, newPath),
			trashFile: (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				return file === null
					? Promise.resolve()
					: this.app.fileManager.trashFile(file);
			},
		};
	}

	/**
	 * The vault index for the output folder, or null while Obsidian is still
	 * reading the notes (an index built then would miss existing notes and
	 * import duplicates). Placeholder notes are left out, so a recording Comu
	 * has processed since then is offered again; the writer replaces the
	 * placeholder, even when the policy is skip.
	 */
	index(): ImportedIndex | null {
		const s = this.settings();
		const state = buildImportedIndexWithColdCheck(
			COMU_PROFILE,
			this.app,
			s.outputFolder,
		);
		if (state.isCold) return null;
		const index = state.index;
		const placeholderKey = `${COMU_PROFILE.keyPrefix}-placeholder`;
		for (const [id, record] of [...index.byId]) {
			const file = this.app.vault.getFileByPath(record.path);
			const fm: unknown =
				file === null
					? null
					: this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (
				typeof fm === 'object' &&
				fm !== null &&
				(fm as Record<string, unknown>)[placeholderKey] === true
			) {
				index.byId.delete(id);
			}
		}
		return index;
	}

	/**
	 * Import `recordings`. Recordings Comu has not processed yet get a
	 * placeholder note when the setting allows it, and are skipped otherwise.
	 */
	run(args: {
		readonly recordings: readonly Recording[];
		readonly choice: ImportChoice;
		readonly onDuplicate: DuplicatePolicy;
		readonly prompt?: DuplicatePromptCallback;
		readonly index: () => ImportedIndex | null;
		readonly observer?: ImportRunObserver;
		readonly cancelled: () => boolean;
	}): ReturnType<typeof runImport> {
		if (!this.locked) return Promise.reject(new ImportBusyError());
		if (isEmptyChoice(args.choice)) {
			return Promise.reject(
				new Error(
					'Nothing to import: summary, transcript and audio are all off.',
				),
			);
		}
		return this.runLocked(args);
	}

	private runLocked(
		args: Parameters<ImportService['run']>[0],
	): ReturnType<typeof runImport> {
		const options = this.options(args.onDuplicate);
		const writer = new NoteWriter(this.app.vault, {
			...options,
			promptOnDuplicate: args.prompt,
			existingPathForRecordingId: (id) => {
				const index = args.index();
				return (
					index?.byId.get(index.canonicalId(id) as RecordingId)
						?.path ?? null
				);
			},
		});
		const unprocessed = new Set(
			args.recordings.filter(isUnprocessed).map((r) => r.id),
		);
		// Comu moves a recording's updateTime when its content is read, so the
		// marker a note stores is the one read after the content. The shared
		// runner copies the recording after fetchArtifacts resolves, so a getter
		// lets the fresher value reach the note.
		const fresh = new Map<string, number>();
		const withFreshVersion = (r: Recording): Recording =>
			Object.defineProperty({ ...r }, 'versionMs', {
				enumerable: true,
				get: () => fresh.get(r.id) ?? r.versionMs,
			});
		const placeholders = options.writePlaceholderForUnprocessed !== false;
		// Let unprocessed recordings reach the fetch, which reports them as
		// unprocessed so the runner writes their placeholder.
		const recordings = placeholders
			? args.recordings.map((r) =>
					isUnprocessed(r)
						? { ...r, contentAvailabilityUnknown: true }
						: withFreshVersion(r),
				)
			: args.recordings.map(withFreshVersion);
		const s = this.settings();
		return runImport({
			recordings,
			selection: selectionFor(args.choice),
			writer,
			attachments: new AudioPipeline(
				this.app,
				managedMarkers(COMU_PROFILE),
				args.cancelled,
			),
			options,
			fetchArtifacts: async (id) => {
				if (unprocessed.has(id)) throw new ComuNotProcessedError();
				const artifacts = await this.client.getArtifacts(id);
				const version = await this.client.getVersionMs(id);
				if (version !== undefined) fresh.set(id, version);
				return artifacts;
			},
			fetchAudioUrl: (id) => this.client.getAudioUrl(id),
			applyFold: s.foldTranscript
				? (path) =>
						foldTranscript(
							this.app,
							path,
							s.transcriptHeaderLevel,
							args.cancelled,
						)
				: undefined,
			observer: {
				...args.observer,
				// Stop at the next recording once closed or unloaded.
				shouldAbort: () =>
					args.cancelled() ||
					(args.observer?.shouldAbort?.() ?? false),
			},
		});
	}
}
