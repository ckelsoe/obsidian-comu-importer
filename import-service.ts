// One place that turns settings into an import: the options the shared note
// writer and runner take, the writer itself, and the run. The import window
// and automatic sync both go through here, so they write identical notes.

import type { App } from 'obsidian';
import {
	BufferedDebugLogger,
	buildImportedIndexWithColdCheck,
	categoryAllowsReauth,
	classifyError,
	managedMarkers,
	NoteWriter,
	runImport,
	trimTrailingChars,
	type ArtifactSelection,
	type DebugLogger,
	type DuplicatePolicy,
	type DuplicatePromptCallback,
	type ImportedIndex,
	type ImportModalOptions,
	type ImportRunObserver,
	type Recording,
	type RecordingArtifacts,
	type RecordingId,
} from 'obsidian-recording-importer-core';
import { AUDIO_START_MARKER, AudioPipeline } from './audio-pipeline';
import {
	COMU_ERROR_POLICY,
	ComuNotProcessedError,
	type ComuClient,
} from './comu-client';
import { COMU_PROFILE } from './comu-profile';
import {
	contentFingerprint,
	FINGERPRINT_KEY,
	readStoredFingerprint,
} from './content-fingerprint';
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

/** One recording's content as read for an import. */
interface Fetched {
	readonly artifacts: RecordingArtifacts;
	readonly fingerprint: string;
	readonly version?: number;
	/** The choice the content was read for; reused only for the same one. */
	readonly choiceKey: string;
}

const choiceKey = (c: ImportChoice): string =>
	`${String(c.summary)}/${String(c.transcript)}/${String(c.audio)}`;

/** What a change check found. */
export interface ChangeCheck {
	/** Recordings whose content really changed. */
	readonly changed: Set<string>;
	/** Recordings that could not be checked, with the reason. */
	readonly failures: readonly { recording: Recording; reason: string }[];
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
	 * Recording ids of imported notes you moved outside the output folder.
	 * They count as imported: the window shows them so, and sync neither
	 * re-creates them in the output folder nor moves them back.
	 */
	movedElsewhere(): Set<string> {
		const root = trimTrailingChars(this.settings().outputFolder, '/');
		const key = `${COMU_PROFILE.keyPrefix}-id`;
		const ids = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path.startsWith(`${root}/`)) continue;
			const id: unknown =
				this.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
			if (typeof id === 'string' && id.length > 0) {
				ids.add(COMU_PROFILE.canonicalId(id));
			}
		}
		return ids;
	}

	/**
	 * Content read by the last checkForChanges for recordings that did change,
	 * kept so the import that follows does not read it a second time. Cleared
	 * by the next check and at the end of every import, and used only for the
	 * same choice and an unchanged Comu change time.
	 */
	private readonly prefetched = new Map<string, Fetched>();

	/** Drop content read by a check that no import will use. */
	discardPrefetched(): void {
		this.prefetched.clear();
	}

	/** Read one recording's selected parts, its fingerprint and fresh marker. */
	private async fetchForImport(
		recording: Recording,
		choice: ImportChoice,
	): Promise<Fetched> {
		const artifacts = await this.client.getArtifacts(recording.id, {
			summary: choice.summary,
			transcript: choice.transcript,
		});
		// Reading the summary can move updateTime, so read the marker after it.
		const version = await this.client.getVersionMs(recording.id);
		return {
			artifacts,
			fingerprint: contentFingerprint(recording, artifacts, choice),
			choiceKey: choiceKey(choice),
			...(version !== undefined ? { version } : {}),
		};
	}

	/** The fingerprint a note stores, read from the file, or undefined. */
	private async storedFingerprint(path: string): Promise<string | undefined> {
		const file = this.app.vault.getFileByPath(path);
		if (file === null) return undefined;
		return readStoredFingerprint(await this.app.vault.read(file));
	}

	/**
	 * Comu's change time moves when a recording is merely viewed, so for each
	 * recording whose time is newer than its note's, read the content and
	 * compare fingerprints. Unchanged ones get the fresh time written to their
	 * note's frontmatter, and nothing else. Returns the ids that really
	 * changed; their content is kept for the import that follows. A note with
	 * no stored fingerprint (written before fingerprints) counts as changed.
	 * Hold the lock while calling this.
	 */
	async checkForChanges(
		candidates: readonly Recording[],
		choice: ImportChoice,
		index: ImportedIndex,
		cancelled: () => boolean,
		onProgress?: (done: number, total: number) => void,
	): Promise<ChangeCheck> {
		this.prefetched.clear();
		const changed = new Set<string>();
		const failures: { recording: Recording; reason: string }[] = [];
		const versionKey = `${COMU_PROFILE.keyPrefix}-version-ms`;
		let done = 0;
		for (const recording of candidates) {
			if (cancelled()) break;
			onProgress?.(done++, candidates.length);
			const record = index.byId.get(
				index.canonicalId(recording.id) as RecordingId,
			);
			if (record === undefined) continue;
			try {
				const fetched = await this.fetchForImport(recording, choice);
				if (cancelled()) break;
				const stored = await this.storedFingerprint(record.path);
				if (cancelled()) break;
				if (fetched.fingerprint !== stored) {
					changed.add(recording.id);
					this.prefetched.set(recording.id, fetched);
					continue;
				}
				const file = this.app.vault.getFileByPath(record.path);
				const version = fetched.version;
				if (file !== null && version !== undefined) {
					await this.app.fileManager.processFrontMatter(
						file,
						(fm: Record<string, unknown>) => {
							fm[versionKey] = version;
						},
					);
				}
			} catch (err) {
				// A refused key stops everything; anything else costs only
				// this recording, which keeps its badge and is tried again later.
				const classification = classifyError(err, COMU_ERROR_POLICY);
				if (categoryAllowsReauth(classification.category)) throw err;
				console.error(
					`Comu importer: could not check ${recording.title} for changes`,
					err,
				);
				failures.push({ recording, reason: classification.message });
			}
		}
		onProgress?.(done, candidates.length);
		return { changed, failures };
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

	private async runLocked(
		args: Parameters<ImportService['run']>[0],
	): ReturnType<typeof runImport> {
		const options = this.options(args.onDuplicate);
		const fingerprints = new Map<string, string>();
		const app = this.app;
		// Store the fingerprint as part of each note's write, so a note and its
		// fingerprint never disagree, whatever happens later in the batch.
		class FingerprintingWriter extends NoteWriter {
			override async writeNote(
				...params: Parameters<NoteWriter['writeNote']>
			): ReturnType<NoteWriter['writeNote']> {
				const outcome = await super.writeNote(...params);
				const fingerprint = fingerprints.get(params[0].id);
				const file =
					outcome.status === 'skipped'
						? null
						: app.vault.getFileByPath(outcome.path);
				if (fingerprint !== undefined && file !== null) {
					try {
						await app.fileManager.processFrontMatter(
							file,
							(fm: Record<string, unknown>) => {
								fm[FINGERPRINT_KEY] = fingerprint;
							},
						);
					} catch (err) {
						// Without it the note is re-checked as changed later:
						// a re-import, never lost content.
						console.error(
							`Comu importer: could not record the content fingerprint for ${outcome.path}`,
							err,
						);
					}
				}
				return outcome;
			}
		}
		const writer = new FingerprintingWriter(this.app.vault, {
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
		const byId = new Map<string, Recording>(
			args.recordings.map((r) => [r.id, r]),
		);
		const outcome = await runImport({
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
				const recording = byId.get(id);
				if (recording === undefined) {
					throw new Error(`Recording ${id} is not in this import.`);
				}
				const cached = this.prefetched.get(id);
				this.prefetched.delete(id);
				// Reuse content the change check just read, but only for the
				// same choice and while Comu reports the same change time.
				const fetched =
					cached !== undefined &&
					cached.choiceKey === choiceKey(args.choice) &&
					cached.version !== undefined &&
					cached.version === (await this.client.getVersionMs(id))
						? cached
						: await this.fetchForImport(recording, args.choice);
				if (fetched.version !== undefined)
					fresh.set(id, fetched.version);
				fingerprints.set(id, fetched.fingerprint);
				return fetched.artifacts;
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
		// Content read for a check but not imported is not kept for later.
		this.prefetched.clear();
		// A note whose audio did not arrive must stay eligible for a retry:
		// without its fingerprint it counts as changed at the next check.
		if (args.choice.audio) {
			for (const result of outcome.results) {
				if (args.cancelled()) break;
				if (
					result.kind !== 'written' ||
					result.writeOutcome.status === 'skipped'
				) {
					continue;
				}
				const file = this.app.vault.getFileByPath(
					result.writeOutcome.path,
				);
				if (file === null) continue;
				const text = await this.app.vault.read(file);
				if (args.cancelled() || text.includes(AUDIO_START_MARKER))
					continue;
				await this.app.fileManager.processFrontMatter(
					file,
					(fm: Record<string, unknown>) => {
						delete fm[FINGERPRINT_KEY];
					},
				);
			}
		}
		return outcome;
	}
}
