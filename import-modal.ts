// The import window: lists Comu recordings, marks the ones already in the
// vault, and imports the checked ones through the shared import runner.

import { App, ButtonComponent, Modal, Notice, Setting } from 'obsidian';
import {
	NoteWriter,
	buildImportedIndex,
	classifyError,
	filterVisibleRecordings,
	formatDate,
	formatDuration,
	formatImportNotice,
	isUpdateAvailable,
	runImport,
	tallyImportResults,
	type DuplicatePromptDecision,
	type ImportModalOptions,
	type ImportedIndex,
	type ManagedMarkers,
	type Recording,
	type RecordingId,
} from 'obsidian-recording-importer-core';
import type { ComuClient } from './comu-client';
import { COMU_PROFILE } from './comu-profile';
import { AudioPipeline } from './audio-pipeline';

type RowState = 'new' | 'imported' | 'update' | 'not-ready';

const STATE_LABEL: Record<RowState, string> = {
	new: 'New',
	imported: 'Imported',
	update: 'Update available',
	'not-ready': 'Not processed yet',
};

/**
 * How the vault's copy of `recording` compares to what Comu lists. Matched by
 * id only, the same key the writer uses: the index's date-and-duration
 * fallback could pair two different recordings of the same length.
 */
export function rowState(recording: Recording, index: ImportedIndex): RowState {
	if (!recording.transcriptAvailable && !recording.summaryAvailable) {
		return 'not-ready';
	}
	const found = index.byId.get(
		index.canonicalId(recording.id) as RecordingId,
	);
	if (found === undefined) return 'new';
	return isUpdateAvailable(recording.versionMs, found.versionMs)
		? 'update'
		: 'imported';
}

export interface ImportModalDeps {
	readonly client: ComuClient;
	readonly options: ImportModalOptions;
	readonly includeAudio: boolean;
	readonly showTrashed: boolean;
	readonly markers: ManagedMarkers;
	/** Called once the window is closed and no import is still running. */
	readonly onClosed: () => void;
}

export class ImportModal extends Modal {
	private recordings: readonly Recording[] = [];
	private readonly checked = new Set<string>();
	private index: ImportedIndex | null = null;
	private running = false;
	private closed = false;
	private listEl: HTMLElement | null = null;
	private importButton: ButtonComponent | null = null;
	/** The open "note already exists" question, if any. */
	private prompt: DuplicateModal | null = null;

	constructor(
		app: App,
		private readonly deps: ImportModalDeps,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Import recordings');
		this.contentEl.addClass('comu-importer-modal');
		this.contentEl.createEl('p', { text: 'Loading recordings…' });
		void this.load();
	}

	onClose(): void {
		this.closed = true;
		// An open question must not outlive the window and approve a write.
		this.prompt?.decide('cancel');
		this.contentEl.empty();
		// A running import stops at the next recording and reports when done.
		if (!this.running) this.deps.onClosed();
	}

	private async load(): Promise<void> {
		try {
			const all = await this.deps.client.listAll();
			if (this.closed) return;
			this.recordings = filterVisibleRecordings(
				all,
				this.deps.showTrashed,
			);
			this.rebuildIndex();
			for (const r of this.recordings) {
				const state = this.stateOf(r);
				if (state === 'new' || state === 'update')
					this.checked.add(r.id);
			}
			this.render();
		} catch (err) {
			if (this.closed) return;
			console.error('Comu importer: could not list recordings', err);
			this.contentEl.empty();
			const { message } = classifyError(
				err,
				this.deps.options.errorPolicy,
			);
			this.contentEl.createEl('p', {
				cls: 'comu-importer-error',
				text: message,
			});
		}
	}

	private rebuildIndex(): void {
		this.index = buildImportedIndex(
			COMU_PROFILE,
			this.app,
			this.deps.options.outputFolder,
		);
	}

	private stateOf(recording: Recording): RowState {
		return this.index === null ? 'new' : rowState(recording, this.index);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		if (this.recordings.length === 0) {
			contentEl.createEl('p', { text: 'No recordings found.' });
			return;
		}
		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Select new and updated').onClick(() => {
					this.checked.clear();
					for (const r of this.recordings) {
						const s = this.stateOf(r);
						if (s === 'new' || s === 'update')
							this.checked.add(r.id);
					}
					this.renderList();
				}),
			)
			.addButton((b) =>
				b.setButtonText('Select none').onClick(() => {
					this.checked.clear();
					this.renderList();
				}),
			);
		this.listEl = contentEl.createDiv({ cls: 'comu-importer-list' });
		this.renderList();
		new Setting(contentEl).addButton((b) => {
			this.importButton = b;
			b.setCta().onClick(() => {
				void this.importChecked();
			});
			this.updateImportButton();
		});
	}

	private renderList(): void {
		const list = this.listEl;
		if (list === null) return;
		list.empty();
		for (const recording of this.recordings) {
			const state = this.stateOf(recording);
			const row = list.createEl('label', { cls: 'comu-importer-row' });
			const box = row.createEl('input', { type: 'checkbox' });
			box.checked = this.checked.has(recording.id);
			box.disabled = state === 'not-ready' || this.running;
			box.addEventListener('change', () => {
				if (box.checked) this.checked.add(recording.id);
				else this.checked.delete(recording.id);
				this.updateImportButton();
			});
			const text = row.createDiv({ cls: 'comu-importer-row-text' });
			text.createDiv({
				cls: 'comu-importer-row-title',
				text: recording.title,
			});
			text.createDiv({
				cls: 'comu-importer-row-meta',
				text: `${formatDate(recording.createdAt)} · ${formatDuration(recording.durationSeconds)}${recording.isTrashed ? ' · in trash' : ''}`,
			});
			row.createSpan({
				cls: `comu-importer-badge comu-importer-badge-${state}`,
				text: STATE_LABEL[state],
			});
		}
		this.updateImportButton();
	}

	private updateImportButton(): void {
		const button = this.importButton;
		if (button === null || this.running) return;
		const n = this.checked.size;
		button.setButtonText(
			n === 1 ? 'Import 1 recording' : `Import ${n} recordings`,
		);
		button.setDisabled(n === 0);
	}

	private async askDuplicate(
		title: string,
	): Promise<DuplicatePromptDecision> {
		return new Promise((resolve) => {
			const prompt = new DuplicateModal(this.app, title, (d) => {
				if (this.prompt === prompt) this.prompt = null;
				resolve(d);
			});
			this.prompt = prompt;
			prompt.open();
		});
	}

	private async importChecked(): Promise<void> {
		if (this.running) return;
		const selected = this.recordings.filter((r) => this.checked.has(r.id));
		if (selected.length === 0) return;
		this.running = true;
		this.importButton?.setDisabled(true);
		this.renderList();
		try {
			const { options } = this.deps;
			const writer = new NoteWriter(this.app.vault, {
				...options,
				promptOnDuplicate:
					options.onDuplicate === 'prompt'
						? (ctx) =>
								this.closed
									? Promise.resolve<DuplicatePromptDecision>(
											'cancel',
										)
									: this.askDuplicate(ctx.recordingTitle)
						: undefined,
				existingPathForRecordingId: (id) =>
					this.index?.byId.get(
						this.index.canonicalId(id) as RecordingId,
					)?.path ?? null,
			});
			const outcome = await runImport({
				recordings: selected,
				selection: {
					includeSummary: true,
					includeTranscript: true,
					includeAttachments: false,
					includeMindmap: false,
					includeCard: false,
					includeScreenshots: false,
					includeAudio: this.deps.includeAudio,
				},
				writer,
				attachments: new AudioPipeline(
					this.app,
					this.deps.markers,
					() => this.closed,
				),
				options,
				fetchArtifacts: (id) => this.deps.client.getArtifacts(id),
				fetchAudioUrl: (id) => this.deps.client.getAudioUrl(id),
				observer: {
					onRecordingStart: (i, total) => {
						this.importButton?.setButtonText(
							`Importing ${i} of ${total}…`,
						);
					},
					onRecordingWritten: () => {
						this.rebuildIndex();
					},
					shouldAbort: () => this.closed,
				},
			});
			const tally = tallyImportResults(outcome.results);
			new Notice(formatImportNotice(COMU_PROFILE, tally));
			for (const failure of tally.failures) {
				if (failure.kind === 'failed') {
					console.error(
						`Comu importer: ${failure.recording.title}: ${failure.reason}`,
						failure.cause,
					);
				}
			}
			if (tally.failed > 0) {
				new Notice(
					`Comu importer: ${tally.failed} failed. See the developer console for details.`,
				);
			}
		} catch (err) {
			console.error('Comu importer: import failed', err);
			new Notice(
				`Comu importer: ${classifyError(err, this.deps.options.errorPolicy).message}`,
			);
		} finally {
			this.running = false;
			if (this.closed) {
				this.deps.onClosed();
			} else {
				this.rebuildIndex();
				this.checked.clear();
				this.renderList();
			}
		}
	}
}

class DuplicateModal extends Modal {
	private decided = false;

	constructor(
		app: App,
		private readonly title: string,
		private readonly resolve: (d: DuplicatePromptDecision) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Note already exists');
		this.contentEl.createEl('p', {
			text: `A note for "${this.title}" already exists. Update it?`,
		});
		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText('Update')
					.setCta()
					.onClick(() => this.decide('overwrite')),
			)
			.addButton((b) =>
				b.setButtonText('Skip').onClick(() => this.decide('skip')),
			)
			.addButton((b) =>
				b
					.setButtonText('Stop import')
					.onClick(() => this.decide('cancel')),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		// Closing with Escape skips this note rather than stopping the batch.
		if (!this.decided) this.resolve('skip');
	}

	decide(d: DuplicatePromptDecision): void {
		if (this.decided) return;
		this.decided = true;
		this.resolve(d);
		this.close();
	}
}
