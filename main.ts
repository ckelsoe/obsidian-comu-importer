import { Plugin } from 'obsidian';
import {
	managedMarkers,
	type ImportModalOptions,
} from 'obsidian-recording-importer-core';
import { ComuClient, COMU_ERROR_POLICY } from './comu-client';
import { COMU_PROFILE } from './comu-profile';
import { ImportModal } from './import-modal';
import { ComuSettingTab } from './settings-tab';
import { normalizeSettings, type ComuImporterSettings } from './settings';

export default class ComuImporterPlugin extends Plugin {
	settings: ComuImporterSettings = normalizeSettings(undefined);
	client!: ComuClient;
	/** The open import window; at most one at a time. */
	private importModal: ImportModal | null = null;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.client = new ComuClient(
			() =>
				this.app.secretStorage.getSecret(this.settings.tokenSecret) ??
				'',
		);
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
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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
