import { Notice, Plugin } from 'obsidian';
import {
	classifyError,
	INITIAL_AUTO_SYNC_STATE,
	nextAutoSyncState,
	runAutoSyncTick,
	tickOutcomeForCategory,
	type AutoSyncState,
	type RecordingId,
	type Recording,
} from 'obsidian-recording-importer-core';
import {
	ComuAuthError,
	ComuClient,
	COMU_ERROR_POLICY,
	normalizeKey,
} from './comu-client';
import { ImportModal } from './import-modal';
import { ImportService, isEmptyChoice, isUnprocessed } from './import-service';
import { RecordingRenamer } from './rename';
import { ComuSettingTab } from './settings-tab';
import {
	normalizeSettings,
	resolveRibbonIcon,
	type ComuImporterSettings,
} from './settings';

/** The fixed secret the API key is stored under. */
export const API_KEY_SECRET_ID = 'comu-importer-api-key';

/** Most recordings one automatic sync imports (about 5 requests each). */
const SYNC_MAX_IMPORTS = 25;
/**
 * Automatic sync stops once this session has used this many of Comu's 1,000
 * daily requests, so imports you start yourself keep room to run.
 */
const SYNC_REQUEST_BUDGET = 600;

export default class ComuImporterPlugin extends Plugin {
	settings: ComuImporterSettings = normalizeSettings(undefined);
	client!: ComuClient;
	imports!: ImportService;
	renamer!: RecordingRenamer;
	/** The open import window; at most one at a time. */
	private importModal: ImportModal | null = null;
	/**
	 * Bumped by every save, Remove key and unload. A key check that started
	 * under an older value is stale and must not store its key, so the last
	 * action wins.
	 */
	private keyGeneration = 0;
	private ribbonEl: HTMLElement | null = null;
	private ribbonIconId: string | null = null;
	private syncTimer: number | null = null;
	private syncState: AutoSyncState = INITIAL_AUTO_SYNC_STATE;
	private unloaded = false;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.client = new ComuClient(() => this.storedKey());
		this.renamer = new RecordingRenamer(this.app);
		this.imports = new ImportService(
			this.app,
			this.client,
			() => this.settings,
			() => this.saveSettings(),
			this.renamer,
		);
		this.addSettingTab(new ComuSettingTab(this.app, this));
		this.updateRibbonIcon();
		this.addCommand({
			id: 'import-recordings',
			name: 'Import recordings',
			callback: () => {
				this.openImport();
			},
		});
		this.addCommand({
			id: 'sync-now',
			name: 'Sync new and changed recordings now',
			callback: () => {
				void this.syncNow(true);
			},
		});
		this.addCommand({
			id: 'rename-recording',
			name: 'Rename recording',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (this.renamer.busy || !this.renamer.isComuNote(file)) {
					return false;
				}
				if (!checking) {
					this.renamer.prompt(
						file,
						this.settings.forbiddenCharReplacement,
					);
				}
				return true;
			},
		});
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (this.renamer.busy || !this.renamer.isComuNote(file)) return;
				menu.addItem((item) =>
					item
						.setTitle('Rename imported recording')
						.setIcon('pencil')
						.onClick(() =>
							this.renamer.prompt(
								file,
								this.settings.forbiddenCharReplacement,
							),
						),
				);
			}),
		);
		// A note renamed in Obsidian takes its -assets folder along.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (this.renamer.busy || !this.renamer.isComuNote(file)) return;
				void this.renamer.followUserRename(oldPath, file.path);
			}),
		);
		this.app.workspace.onLayoutReady(() => {
			this.reconcileAutoSync();
		});
	}

	onunload(): void {
		this.unloaded = true;
		// Closing stops a running import at the next recording.
		this.importModal?.close();
		this.keyGeneration++;
		this.stopAutoSync();
		this.renamer.dispose();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Add, replace or remove the ribbon button to match the settings. */
	updateRibbonIcon(): void {
		const wanted = this.settings.showRibbonIcon
			? resolveRibbonIcon(this.settings.ribbonIcon)
			: null;
		if (wanted === this.ribbonIconId) return;
		this.ribbonEl?.remove();
		this.ribbonEl = null;
		this.ribbonIconId = wanted;
		if (wanted !== null) {
			this.ribbonEl = this.addRibbonIcon(
				wanted,
				'Comu importer: import recordings',
				() => {
					this.openImport();
				},
			);
		}
	}

	// ----- Automatic sync ----------------------------------------------------

	/** Start, restart or stop the sync timer to match the settings. */
	reconcileAutoSync(): void {
		this.stopAutoSync();
		// A pause for a refused key stays until saveKey accepts a working one.
		if (this.unloaded || !this.settings.autoSyncEnabled) return;
		this.syncTimer = window.setInterval(() => {
			void this.syncNow(false);
		}, this.settings.autoSyncIntervalMinutes * 60_000);
	}

	private stopAutoSync(): void {
		if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
		this.syncTimer = null;
	}

	/**
	 * Import new and changed recordings without asking. `byUser` reports the
	 * result in a notice; a background run speaks only when it imported
	 * something or the key stopped working.
	 */
	private async syncNow(byUser: boolean): Promise<void> {
		if (this.unloaded) return;
		const say = (message: string): void => {
			if (byUser) new Notice(`Comu importer: ${message}`);
		};
		if (!this.hasKey()) {
			say('add your API key in the plugin settings first.');
			return;
		}
		if (!byUser && this.syncState.paused) return;
		const s = this.settings;
		const choice = {
			summary: s.includeSummary,
			transcript: s.includeTranscript,
			audio: s.includeAudio,
		};
		if (isEmptyChoice(choice)) {
			say('nothing to sync: turn on something under What to import.');
			return;
		}
		if (this.client.requestsLastDay() >= SYNC_REQUEST_BUDGET) {
			say(
				'sync is resting: this device has used most of the daily request allowance Comu gives each key. It resumes as requests age out of the last 24 hours.',
			);
			return;
		}
		// One import or sync at a time; a busy run means try again next tick.
		if (!this.imports.tryLock()) {
			say('an import is running. Try again when it finishes.');
			return;
		}
		try {
			// Obsidian is still reading the notes: an index now would miss
			// existing ones and import duplicates. The next tick tries again.
			const index = this.imports.index();
			if (index === null) {
				say(
					'Obsidian is still loading the vault. Try again in a moment.',
				);
				return;
			}
			const failures: string[] = [];
			const result = await runAutoSyncTick({
				// Comu lists by date, not by last change, so one tick reads the
				// whole list as a single page; nothing is missed below a page break.
				listPage: async (skip) => {
					if (skip > 0) return [];
					const all = await this.client.listAll(false);
					if (this.unloaded) return [];
					// Unprocessed recordings wait for a later tick.
					return all.map((r): Recording =>
						isUnprocessed(r) ? { ...r, waitPull: true } : r,
					);
				},
				buildIndex: () => index,
				importCandidates: async (newRecs, changedRecs) => {
					const count = async (
						recordings: readonly Recording[],
						policy: 'skip' | 'overwrite',
					): Promise<number> => {
						if (recordings.length === 0 || this.unloaded) return 0;
						const outcome = await this.imports.run({
							recordings,
							choice,
							onDuplicate: policy,
							index: () => this.imports.index(),
							cancelled: () => this.unloaded,
						});
						if (outcome.stop === 'auth-failed') {
							throw new ComuAuthError(
								'Comu refused the API key during sync. Check it in the plugin settings.',
							);
						}
						for (const r of outcome.results) {
							if (r.kind === 'failed') {
								failures.push(
									`${r.recording.title}: ${r.reason}`,
								);
							}
						}
						return outcome.results.filter(
							(r) =>
								(r.kind === 'written' &&
									r.writeOutcome.status !== 'skipped') ||
								r.kind === 'placeholder-written',
						).length;
					};
					// Comu's change time also moves when a recording is only
					// viewed; update just the ones whose content changed.
					const check = await this.imports.checkForChanges(
						changedRecs,
						choice,
						index,
						() => this.unloaded,
					);
					for (const f of check.failures) {
						failures.push(`${f.recording.title}: ${f.reason}`);
					}
					return {
						imported: await count(newRecs, 'skip'),
						updated: await count(
							changedRecs.filter((r) => check.changed.has(r.id)),
							'overwrite',
						),
					};
				},
				pageSize: Number.MAX_SAFE_INTEGER,
				maxImportsPerTick: SYNC_MAX_IMPORTS,
				maxPagesPerTick: 1,
				// Ignored recordings, and notes you moved out of the output
				// folder, are left alone.
				ignoredIds: new Set([
					...s.ignoredRecordingIds,
					...[...this.imports.movedElsewhere()].map(
						(id) => id as RecordingId,
					),
				]),
				log: (message, payload) =>
					this.imports.debugLogger.log({
						kind: 'note',
						message,
						payload,
					}),
			});
			const done = result.imported + result.updated;
			// Every attempt failed: count it as a failed run, not a quiet success.
			this.syncState = nextAutoSyncState(
				this.syncState,
				failures.length > 0 && done === 0 ? 'transient' : 'ok',
			);
			if (failures.length > 0) {
				console.error('Comu importer: sync failures', failures);
				new Notice(
					`Comu importer: sync imported ${result.imported} new and updated ${result.updated}; ${failures.length} failed. First: ${failures[0] ?? ''}`,
				);
			} else if (byUser || done > 0) {
				new Notice(
					`Comu importer: sync imported ${result.imported} new and updated ${result.updated}.`,
				);
			}
		} catch (err) {
			console.error('Comu importer: sync failed', err);
			const classification = classifyError(err, COMU_ERROR_POLICY);
			this.syncState = nextAutoSyncState(
				this.syncState,
				tickOutcomeForCategory(classification.category),
			);
			if (byUser || this.syncState.paused) {
				new Notice(
					`Comu importer: sync stopped. ${classification.message}`,
				);
			}
		} finally {
			this.imports.unlock();
		}
	}

	private storedKey(): string {
		return this.app.secretStorage.getSecret(API_KEY_SECRET_ID) ?? '';
	}

	hasKey(): boolean {
		return normalizeKey(this.storedKey()).length > 0;
	}

	/**
	 * Check `raw` with Comu, then store it. Returns true when stored. The old
	 * key is kept if the new one fails, so a bad paste never disconnects you.
	 */
	async saveKey(raw: string): Promise<boolean> {
		const generation = ++this.keyGeneration;
		const key = normalizeKey(raw);
		if (key.length === 0 || /\s/.test(key)) {
			new Notice('Comu importer: paste your API key first.');
			return false;
		}
		try {
			await new ComuClient(() => key).testConnection();
		} catch (err) {
			console.error('Comu importer: the API key was rejected', err);
			new Notice(
				`Comu importer: ${err instanceof Error ? err.message : String(err)}`,
			);
			return false;
		}
		// Removed or unloaded while Comu was checking: drop this key.
		if (generation !== this.keyGeneration) return false;
		this.app.secretStorage.setSecret(API_KEY_SECRET_ID, key);
		this.syncState = INITIAL_AUTO_SYNC_STATE;
		new Notice('Comu importer: API key saved. You are connected.');
		return true;
	}

	removeKey(): void {
		this.keyGeneration++;
		this.app.secretStorage.setSecret(API_KEY_SECRET_ID, '');
		new Notice('Comu importer: API key removed from this device.');
	}

	private openImport(): void {
		if (this.importModal !== null) return;
		const modal = new ImportModal(this.app, {
			client: this.client,
			imports: this.imports,
			settings: () => this.settings,
			saveSettings: () => this.saveSettings(),
			onClosed: () => {
				if (this.importModal === modal) this.importModal = null;
			},
		});
		this.importModal = modal;
		modal.open();
	}
}
