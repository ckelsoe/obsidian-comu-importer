import { Notice, Plugin } from 'obsidian';
import {
	managedMarkers,
	type ImportModalOptions,
} from 'obsidian-recording-importer-core';
import { ComuClient, COMU_ERROR_POLICY, normalizeKey } from './comu-client';
import { COMU_PROFILE } from './comu-profile';
import { ImportModal } from './import-modal';
import { ComuSettingTab } from './settings-tab';
import { normalizeSettings, type ComuImporterSettings } from './settings';

/** The fixed secret the API key is stored under. */
export const API_KEY_SECRET_ID = 'comu-importer-api-key';

export default class ComuImporterPlugin extends Plugin {
	settings: ComuImporterSettings = normalizeSettings(undefined);
	client!: ComuClient;
	/** The open import window; at most one at a time. */
	private importModal: ImportModal | null = null;
	/**
	 * Bumped by every save, Remove key and unload. A key check that started
	 * under an older value is stale and must not store its key, so the last
	 * action wins.
	 */
	private keyGeneration = 0;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.client = new ComuClient(() => this.storedKey());
		this.addSettingTab(new ComuSettingTab(this.app, this));
		this.addRibbonIcon('mic', 'Import recordings', () => {
			this.openImport();
		});
		this.addCommand({
			id: 'import-recordings',
			name: 'Import recordings',
			callback: () => {
				this.openImport();
			},
		});
	}

	onunload(): void {
		// Closing stops a running import at the next recording.
		this.importModal?.close();
		this.keyGeneration++;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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
		const s = this.settings;
		const options: ImportModalOptions = {
			profile: COMU_PROFILE,
			errorPolicy: COMU_ERROR_POLICY,
			outputFolder: s.outputFolder,
			subfolderTemplate: s.subfolderTemplate,
			noteNameTemplate: s.noteNameTemplate,
			onDuplicate: s.duplicatePolicy,
			transcriptPlacement: s.transcriptPlacement,
			// Comu has no AI keyword tags; only the user's own tags would apply.
			tagMode: 'none',
			trashFile: (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				return file === null
					? Promise.resolve()
					: this.app.fileManager.trashFile(file);
			},
		};
		const modal = new ImportModal(this.app, {
			client: this.client,
			options,
			includeAudio: s.includeAudio,
			showTrashed: s.showTrashed,
			markers: managedMarkers(COMU_PROFILE),
			onClosed: () => {
				if (this.importModal === modal) this.importModal = null;
			},
		});
		this.importModal = modal;
		modal.open();
	}
}
