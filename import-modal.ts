// The import window: lists Comu recordings with their state in the vault,
// lets the user choose what to import and which recordings, runs the import,
// and shows the results with a reason for every failure.

import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	setIcon,
} from 'obsidian';
import {
	classifyError,
	formatDate,
	formatDuration,
	formatImportNotice,
	isUpdateAvailable,
	type runImport,
	tallyImportResults,
	type DuplicatePromptDecision,
	type ImportedIndex,
	type ImportResult,
	type Recording,
	type RecordingId,
} from 'obsidian-recording-importer-core';
import { COMU_ERROR_POLICY, type ComuClient } from './comu-client';
import { COMU_PROFILE } from './comu-profile';
import {
	isUnprocessed,
	type ImportChoice,
	type ImportService,
} from './import-service';
import type { ComuImporterSettings } from './settings';

type RowState = 'new' | 'imported' | 'update' | 'not-ready';

/** What the shared runner reports for one run. */
type ImportRunOutcome = Awaited<ReturnType<typeof runImport>>;

const STATE_LABEL: Record<RowState, string> = {
	new: 'New',
	imported: 'Imported',
	update: 'Update available',
	'not-ready': 'Not processed yet',
};

type ViewKey =
	| 'hideProcessedRecordings'
	| 'hideUpdatesRecordings'
	| 'hideIgnoredRecordings';

/**
 * How the vault's copy of `recording` compares to what Comu lists. Matched by
 * id only, the same key the writer uses: the index's date-and-duration
 * fallback could pair two different recordings of the same length.
 */
export function rowState(recording: Recording, index: ImportedIndex): RowState {
	const found = index.byId.get(
		index.canonicalId(recording.id) as RecordingId,
	);
	if (found === undefined) {
		return isUnprocessed(recording) ? 'not-ready' : 'new';
	}
	return isUpdateAvailable(recording.versionMs, found.versionMs)
		? 'update'
		: 'imported';
}

/** Why a run ended early, in words, or null when it ran to the end. */
export function stopReason(stop: ImportRunOutcome['stop']): string | null {
	switch (stop) {
		case 'auth-failed':
			return 'Stopped: Comu refused the API key. Check it in the plugin settings, then import again.';
		case 'cancelled':
			return 'Stopped: you chose Stop import.';
		case 'aborted':
			return 'Stopped: the window was closed.';
		default:
			return null;
	}
}

/** Plain-text details of a run, for the Copy details button. */
export function formatRunDetails(
	outcome: ImportRunOutcome,
	total: number,
): string {
	const lines = [
		`${COMU_PROFILE.pluginName} import`,
		`Processed ${outcome.processed} of ${total}; ended: ${outcome.stop}`,
	];
	for (const r of outcome.results) {
		if (r.kind === 'failed') {
			lines.push(
				`FAILED ${r.recording.title} (${r.recording.id}) [${r.classification.category}]: ${r.reason}`,
			);
		} else if (r.kind === 'placeholder-written') {
			lines.push(`PLACEHOLDER ${r.recording.title}: ${r.reason}`);
		} else if (r.kind === 'skipped-no-content') {
			lines.push(`NO CONTENT ${r.recording.title}`);
		} else {
			lines.push(
				`${r.writeOutcome.status.toUpperCase()} ${r.recording.title} -> ${r.writeOutcome.path}`,
			);
		}
	}
	return lines.join('\n');
}

export interface ImportModalDeps {
	readonly client: ComuClient;
	readonly imports: ImportService;
	readonly settings: () => ComuImporterSettings;
	/** Persists the filter toggles and the ignore list. */
	readonly saveSettings: () => Promise<void>;
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
	private countEl: HTMLElement | null = null;
	private importButton: ButtonComponent | null = null;
	/** The open "note already exists" question, if any. */
	private prompt: DuplicateModal | null = null;
	private countdown: number | null = null;
	private choice: ImportChoice;

	constructor(
		app: App,
		private readonly deps: ImportModalDeps,
	) {
		super(app);
		const s = deps.settings();
		this.choice = {
			summary: s.includeSummary,
			transcript: s.includeTranscript,
			audio: s.includeAudio,
		};
	}

	private get settings(): ComuImporterSettings {
		return this.deps.settings();
	}

	onOpen(): void {
		this.setTitle('Import recordings');
		this.modalEl.addClass('comu-importer-modal');
		this.contentEl.createEl('p', { text: 'Loading recordings…' });
		void this.load();
	}

	onClose(): void {
		this.closed = true;
		this.stopCountdown();
		// An open question must not outlive the window and approve a write.
		this.prompt?.decide('cancel');
		this.contentEl.empty();
		// A running import stops at the next recording and reports when done.
		if (!this.running) this.deps.onClosed();
	}

	private async load(): Promise<void> {
		try {
			const all = await this.deps.client.listAll(
				this.settings.showTrashed,
			);
			if (this.closed) return;
			this.recordings = all;
			this.rebuildIndex();
			this.selectNewAndUpdated();
			this.render();
		} catch (err) {
			if (this.closed) return;
			console.error('Comu importer: could not list recordings', err);
			this.contentEl.empty();
			const { message } = classifyError(err, COMU_ERROR_POLICY);
			this.contentEl.createEl('p', {
				cls: 'comu-importer-error',
				text: message,
			});
		}
	}

	private rebuildIndex(): void {
		// Null while Obsidian is still reading the vault; rows then show as New.
		this.index = this.deps.imports.index();
	}

	private stateOf(recording: Recording): RowState {
		return this.index === null ? 'new' : rowState(recording, this.index);
	}

	private isIgnored(recording: Recording): boolean {
		return this.settings.ignoredRecordingIds.includes(recording.id);
	}

	private canCheck(recording: Recording): boolean {
		return (
			this.stateOf(recording) !== 'not-ready' ||
			this.settings.writePlaceholderForUnprocessed
		);
	}

	private selectNewAndUpdated(): void {
		this.checked.clear();
		for (const r of this.visible()) {
			const state = this.stateOf(r);
			if (state === 'new' || state === 'update') this.checked.add(r.id);
		}
	}

	/** The rows the filters let through. */
	private visible(): Recording[] {
		const s = this.settings;
		return this.recordings.filter((r) => {
			if (s.hideIgnoredRecordings && this.isIgnored(r)) return false;
			const state = this.stateOf(r);
			if (state === 'imported' && s.hideProcessedRecordings) return false;
			if (state === 'update' && s.hideUpdatesRecordings) return false;
			return true;
		});
	}

	private saveView(): void {
		this.deps.saveSettings().catch((err: unknown) => {
			console.error('Comu importer: could not save the filters', err);
			new Notice(
				'Comu importer: could not save the filters or ignore list; they reset when Obsidian restarts.',
			);
		});
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		if (this.recordings.length === 0) {
			contentEl.createEl('p', { text: 'No recordings found.' });
			return;
		}
		this.renderChoice(contentEl);
		this.renderFilters(contentEl);
		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Select new and updated').onClick(() => {
					this.selectNewAndUpdated();
					this.renderList();
				}),
			)
			.addButton((b) =>
				b.setButtonText('Select all').onClick(() => {
					for (const r of this.visible()) {
						if (this.canCheck(r)) this.checked.add(r.id);
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
		this.countEl = contentEl.createDiv({ cls: 'comu-importer-count' });
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

	private renderChoice(parent: HTMLElement): void {
		const row = parent.createDiv({ cls: 'comu-importer-choice' });
		row.createSpan({ text: 'Import:' });
		const toggle = (label: string, key: keyof ImportChoice): void => {
			const item = row.createEl('label');
			const box = item.createEl('input', { type: 'checkbox' });
			box.checked = this.choice[key];
			box.addEventListener('change', () => {
				this.choice = { ...this.choice, [key]: box.checked };
				this.updateImportButton();
			});
			item.createSpan({ text: label });
		};
		toggle('Summary, insights, action items', 'summary');
		toggle('Transcript', 'transcript');
		toggle('Audio', 'audio');
	}

	private renderFilters(parent: HTMLElement): void {
		const row = parent.createDiv({ cls: 'comu-importer-filters' });
		row.createSpan({ text: 'Hide:' });
		const filter = (label: string, key: ViewKey): void => {
			const item = row.createEl('label');
			const box = item.createEl('input', { type: 'checkbox' });
			box.checked = this.settings[key];
			box.addEventListener('change', () => {
				this.settings[key] = box.checked;
				this.saveView();
				this.renderList();
			});
			item.createSpan({ text: label });
		};
		filter('Imported', 'hideProcessedRecordings');
		filter('Updates', 'hideUpdatesRecordings');
		filter('Ignored', 'hideIgnoredRecordings');
	}

	private renderList(): void {
		const list = this.listEl;
		if (list === null) return;
		list.empty();
		const visible = this.visible();
		const hidden = this.recordings.length - visible.length;
		this.countEl?.setText(
			hidden > 0
				? `${visible.length} shown, ${hidden} hidden by the filters above.`
				: `${visible.length} recordings.`,
		);
		if (visible.length === 0) {
			list.createEl('p', {
				cls: 'comu-importer-empty',
				text: 'Nothing to show. Everything is imported, or the filters above hide it.',
			});
		}
		for (const recording of visible) {
			this.renderRow(list, recording);
		}
		this.updateImportButton();
	}

	private renderRow(list: HTMLElement, recording: Recording): void {
		const state = this.stateOf(recording);
		const ignored = this.isIgnored(recording);
		const row = list.createDiv({ cls: 'comu-importer-row' });
		if (ignored) row.addClass('is-ignored');
		const label = row.createEl('label', { cls: 'comu-importer-row-main' });
		const box = label.createEl('input', { type: 'checkbox' });
		box.checked = this.checked.has(recording.id);
		box.disabled = this.running || !this.canCheck(recording);
		box.addEventListener('change', () => {
			if (box.checked) this.checked.add(recording.id);
			else this.checked.delete(recording.id);
			this.updateImportButton();
		});
		const text = label.createDiv({ cls: 'comu-importer-row-text' });
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
			text: ignored ? 'Ignored' : STATE_LABEL[state],
		});
		const ignore = row.createEl('button', {
			cls: 'clickable-icon comu-importer-ignore',
			attr: {
				type: 'button',
				'aria-label': ignored
					? 'Stop ignoring this recording'
					: 'Ignore this recording (automatic sync skips it too)',
			},
		});
		setIcon(ignore, ignored ? 'eye' : 'eye-off');
		ignore.disabled = this.running;
		ignore.addEventListener('click', () => {
			const ids = this.settings.ignoredRecordingIds;
			this.settings.ignoredRecordingIds = ignored
				? ids.filter((id) => id !== recording.id)
				: [...ids, recording.id];
			if (!ignored) this.checked.delete(recording.id);
			this.saveView();
			this.renderList();
		});
	}

	private updateImportButton(): void {
		const button = this.importButton;
		if (button === null || this.running) return;
		const visible = new Set<string>(this.visible().map((r) => r.id));
		const n = [...this.checked].filter((id) => visible.has(id)).length;
		const nothing =
			!this.choice.summary &&
			!this.choice.transcript &&
			!this.choice.audio;
		button.setButtonText(
			n === 1 ? 'Import 1 recording' : `Import ${n} recordings`,
		);
		button.setDisabled(n === 0 || nothing);
	}

	private askDuplicate(title: string): Promise<DuplicatePromptDecision> {
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
		const selected = this.visible().filter((r) => this.checked.has(r.id));
		if (selected.length === 0) return;
		if (this.index === null) {
			new Notice(
				'Comu importer: Obsidian is still loading the vault. Try again in a moment.',
			);
			this.rebuildIndex();
			this.renderList();
			return;
		}
		if (!this.deps.imports.tryLock()) {
			new Notice(
				'Comu importer: a sync is running. Try again when it finishes.',
			);
			return;
		}
		this.running = true;
		this.importButton?.setDisabled(true);
		this.renderList();
		let outcome: ImportRunOutcome | null = null;
		let failure: unknown = null;
		try {
			const policy = this.settings.duplicatePolicy;
			outcome = await this.deps.imports.run({
				recordings: selected,
				choice: this.choice,
				onDuplicate: policy,
				prompt:
					policy === 'prompt'
						? (ctx) =>
								this.closed
									? Promise.resolve<DuplicatePromptDecision>(
											'cancel',
										)
									: this.askDuplicate(ctx.recordingTitle)
						: undefined,
				index: () => this.index,
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
				cancelled: () => this.closed,
			});
		} catch (err) {
			failure = err;
			console.error('Comu importer: import failed', err);
		} finally {
			this.running = false;
			this.deps.imports.unlock();
		}
		if (this.closed) {
			if (outcome !== null) {
				new Notice(
					formatImportNotice(
						COMU_PROFILE,
						tallyImportResults(outcome.results),
					),
				);
			}
			this.deps.onClosed();
			return;
		}
		this.rebuildIndex();
		this.checked.clear();
		if (outcome === null) {
			const { message } = classifyError(failure, COMU_ERROR_POLICY);
			new Notice(`Comu importer: ${message}`);
			this.render();
			return;
		}
		this.renderResults(outcome, selected.length);
	}

	private renderResults(outcome: ImportRunOutcome, total: number): void {
		const tally = tallyImportResults(outcome.results);
		new Notice(formatImportNotice(COMU_PROFILE, tally));
		const { contentEl } = this;
		contentEl.empty();
		const parts = [
			`${tally.created} new`,
			`${tally.overwritten} updated`,
			`${tally.skipped} skipped`,
		];
		if (tally.placeholdersWritten > 0) {
			parts.push(`${tally.placeholdersWritten} placeholders`);
		}
		if (tally.failed > 0) parts.push(`${tally.failed} failed`);
		contentEl.createEl('p', {
			cls: 'comu-importer-results-summary',
			text: `${parts.join(', ')}.`,
		});
		const stop = stopReason(outcome.stop);
		if (stop !== null) {
			contentEl.createEl('p', {
				cls: 'comu-importer-error',
				text: `${stop} ${outcome.processed} of ${total} were processed.`,
			});
		}
		const failures = outcome.results.filter(
			(r): r is Extract<ImportResult, { kind: 'failed' }> =>
				r.kind === 'failed',
		);
		if (failures.length > 0) {
			contentEl.createEl('h4', { text: 'Failed' });
			const list = contentEl.createEl('ul', {
				cls: 'comu-importer-failures',
			});
			for (const f of failures) {
				const li = list.createEl('li');
				li.createEl('strong', { text: f.recording.title });
				li.createSpan({ text: `: ${f.reason}` });
			}
		}
		const placeholders = outcome.results.filter(
			(r) => r.kind === 'placeholder-written',
		);
		if (placeholders.length > 0) {
			contentEl.createEl('h4', { text: 'Placeholders written' });
			const list = contentEl.createEl('ul');
			for (const p of placeholders) {
				list.createEl('li', {
					text: `${p.recording.title}: not processed by Comu yet`,
				});
			}
		}
		const buttons = new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Copy details').onClick(() => {
					navigator.clipboard
						.writeText(formatRunDetails(outcome, total))
						.then(
							() => new Notice('Comu importer: details copied.'),
						)
						.catch((err: unknown) => {
							console.error('Comu importer: could not copy', err);
							new Notice(
								'Comu importer: could not copy the details.',
							);
						});
				}),
			)
			.addButton((b) =>
				b.setButtonText('Back to the list').onClick(() => {
					this.stopCountdown();
					this.selectNewAndUpdated();
					this.render();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText('Close')
					.setCta()
					.onClick(() => {
						this.close();
					}),
			);
		if (
			failures.length === 0 &&
			stop === null &&
			this.settings.autoCloseSummary
		) {
			this.startCountdown(buttons, this.settings.autoCloseSummarySeconds);
		}
	}

	private startCountdown(row: Setting, seconds: number): void {
		let left = seconds;
		const tick = (): void => {
			row.setDesc(`Closing in ${left} s.`);
			if (left <= 0) {
				this.stopCountdown();
				this.close();
				return;
			}
			left--;
		};
		tick();
		this.countdown = window.setInterval(tick, 1000);
	}

	private stopCountdown(): void {
		if (this.countdown !== null) window.clearInterval(this.countdown);
		this.countdown = null;
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
