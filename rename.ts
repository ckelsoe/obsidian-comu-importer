// Renaming an imported recording: the note and its `-assets` folder move
// together. Local only: Comu's API is read-only, so the title in Comu stays.

import {
	Modal,
	Notice,
	Setting,
	TFile,
	type App,
	type TextComponent,
} from 'obsidian';
import {
	renameRecordingNote,
	sanitizeFilename,
} from 'obsidian-recording-importer-core';
import { COMU_PROFILE } from './comu-profile';

/** Moves imported notes with their assets folder, and knows its own moves. */
export class RecordingRenamer {
	/** Above zero while the plugin itself is renaming, so the listener stays out. */
	private selfRenameDepth = 0;
	private disposed = false;
	private dialog: RenameRecordingModal | null = null;

	constructor(private readonly app: App) {}

	/** Plugin unload: close an open dialog and refuse further renames. */
	dispose(): void {
		this.disposed = true;
		this.dialog?.close();
		this.dialog = null;
	}

	get busy(): boolean {
		return this.selfRenameDepth > 0;
	}

	/** True for a Markdown note this plugin imported. */
	isComuNote(file: unknown): file is TFile {
		if (!(file instanceof TFile) || file.extension !== 'md') return false;
		const id: unknown =
			this.app.metadataCache.getFileCache(file)?.frontmatter?.[
				`${COMU_PROFILE.keyPrefix}-id`
			];
		return typeof id === 'string' && id.length > 0;
	}

	/** Move a note and its assets folder from `oldPath` to `newPath`. */
	async move(oldPath: string, newPath: string): Promise<void> {
		if (this.disposed) return;
		this.selfRenameDepth++;
		try {
			await renameRecordingNote(
				COMU_PROFILE,
				this.app.vault,
				async (from, to) => {
					const file = this.app.vault.getAbstractFileByPath(from);
					if (file === null) throw new Error(`${from} not found`);
					await this.app.fileManager.renameFile(file, to);
				},
				oldPath,
				newPath,
			);
		} finally {
			this.selfRenameDepth--;
		}
	}

	/** After the user renamed a note in Obsidian, bring its assets folder along. */
	async followUserRename(oldPath: string, newPath: string): Promise<void> {
		try {
			await this.move(oldPath, newPath);
		} catch (err) {
			console.error(
				'Comu importer: could not move the assets folder',
				err,
			);
			new Notice(
				`Comu importer: the note was renamed, but its -assets folder could not follow. ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/** Ask for a new name, then rename the note and its assets folder. */
	prompt(file: TFile, replacement: string): void {
		if (this.disposed) return;
		this.dialog?.close();
		this.dialog = new RenameRecordingModal(
			this.app,
			file.basename,
			(raw) => {
				if (this.disposed) return;
				const name = sanitizeFilename(raw, replacement);
				const parent = file.parent?.path ?? '';
				const dir = parent === '' || parent === '/' ? '' : `${parent}/`;
				const newPath = `${dir}${name}.md`;
				if (newPath === file.path) return;
				this.move(file.path, newPath)
					.then(
						() =>
							new Notice(`Comu importer: renamed to "${name}".`),
					)
					.catch((err: unknown) => {
						console.error('Comu importer: rename failed', err);
						new Notice(
							`Comu importer: rename failed. ${err instanceof Error ? err.message : String(err)}`,
						);
					});
			},
		);
		this.dialog.open();
	}
}

class RenameRecordingModal extends Modal {
	constructor(
		app: App,
		private value: string,
		private readonly onSubmit: (name: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Rename recording');
		let input: TextComponent | null = null;
		new Setting(this.contentEl)
			.setName('New name')
			.setDesc(
				'The note and its attachments folder are renamed together. The title in the app stays as it is.',
			)
			.addText((text) => {
				input = text;
				text.setValue(this.value).onChange((v) => {
					this.value = v;
				});
				text.inputEl.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter') {
						evt.preventDefault();
						this.submit();
					}
				});
			});
		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText('Rename')
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => this.close()),
			);
		(input as TextComponent | null)?.inputEl.select();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const name = this.value.trim();
		if (name.length === 0) {
			new Notice('Comu importer: enter a name.');
			return;
		}
		this.close();
		this.onSubmit(name);
	}
}
