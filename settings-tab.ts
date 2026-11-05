import {
	App,
	Notice,
	PluginSettingTab,
	type Setting,
	type TextComponent,
	type SettingDefinitionItem,
} from 'obsidian';
import { isValidNoteNameTemplate } from 'obsidian-recording-importer-core';
import type { ComuImporterSettings } from './settings';
import type ComuImporterPlugin from './main';

// Community discussion for this plugin. This must stay a never-expiring
// discord.gg invite: a discord.com/channels/... deep link only resolves for
// accounts already in the server, so it cannot get anyone in, and a default
// invite expires after 7 days and would rot in a shipped release.
const DISCORD_URL = 'https://discord.gg/gd6tKJDPj4';
const REPO_URL = 'https://github.com/ckelsoe/obsidian-comu-importer';

export class ComuSettingTab extends PluginSettingTab {
	plugin: ComuImporterPlugin;

	constructor(app: App, plugin: ComuImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Connection',
				items: [
					{
						name: 'API key',
						desc: 'Create one in the mobile app under Me, Developers, API keys (needs a Premium or Elite membership). Paste it here and click Save. It is checked first and kept in secret storage, not in the plugin settings file.',
						render: (setting: Setting) => {
							this.renderKey(setting);
						},
					},
					{
						name: 'Status',
						searchable: false,
						render: (setting: Setting) => {
							this.renderStatus(setting);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Notes',
				items: [
					{
						name: 'Output folder',
						desc: 'Folder where imported notes are created.',
						control: {
							type: 'folder',
							key: 'outputFolder',
							validate: (v: string) =>
								v.trim().length === 0
									? 'Enter a folder.'
									: undefined,
						},
					},
					{
						name: 'Subfolder template',
						desc: 'Optional, for example {{YYYY}}/{{MM}}. Leave empty for one flat folder.',
						control: { type: 'text', key: 'subfolderTemplate' },
					},
					{
						name: 'Note name template',
						desc: 'Optional, for example {{YYYY}}-{{MM}}-{{DD}} {{title}}. Leave empty for the default.',
						control: {
							type: 'text',
							key: 'noteNameTemplate',
							validate: (v: string) =>
								v.trim().length > 0 &&
								!isValidNoteNameTemplate(v)
									? 'This template does not make a valid file name.'
									: undefined,
						},
					},
					{
						name: 'When a note already exists',
						desc: 'What to do when a recording was imported before.',
						control: {
							type: 'dropdown',
							key: 'duplicatePolicy',
							options: {
								prompt: 'Ask each time',
								overwrite: 'Update it',
								skip: 'Skip it',
							},
						},
					},
					{
						name: 'Transcript layout',
						desc: 'Where the transcript goes.',
						control: {
							type: 'dropdown',
							key: 'transcriptPlacement',
							options: {
								heading: 'Under a heading',
								callout: 'In a callout',
								'file-embed': 'Separate file, embedded',
								'file-link': 'Separate file, linked',
							},
						},
					},
					{
						name: 'Download audio',
						desc: "Save each recording's audio next to its note.",
						control: { type: 'toggle', key: 'includeAudio' },
					},
					{
						name: 'Show trashed recordings',
						desc: 'List recordings that are in the trash.',
						control: { type: 'toggle', key: 'showTrashed' },
					},
				],
			},
			{
				name: 'About',
				searchable: false,
				render: (setting: Setting) => {
					this.renderFooter(setting);
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof ComuImporterSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] =
			value;
		await this.plugin.saveSettings();
	}

	/** Bumped by each render; a callback from an older one must not touch the tab. */
	private renderId = 0;

	private renderKey(setting: Setting): void {
		const renderId = ++this.renderId;
		let input: TextComponent | null = null;
		setting
			.addText((text) => {
				input = text;
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				text.setPlaceholder(
					this.plugin.hasKey()
						? 'Saved; paste a new key to replace it'
						: 'kb_…',
				);
			})
			.addButton((b) =>
				b
					.setButtonText('Save')
					.setCta()
					.onClick(() => {
						const value = input?.getValue() ?? '';
						void this.guarded(
							'saving the API key',
							() => this.plugin.saveKey(value),
							renderId,
						);
					}),
			);
	}

	private renderStatus(setting: Setting): void {
		if (!this.plugin.hasKey()) {
			setting.setDesc('Not connected. Add your API key above.');
			return;
		}
		setting.setDesc('API key saved.');
		setting
			.addButton((b) =>
				b.setButtonText('Test connection').onClick(() => {
					void this.testConnection();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText('Remove key')
					.setDestructive()
					.onClick(() => {
						void this.guarded('removing the API key', () => {
							this.plugin.removeKey();
							return Promise.resolve();
						});
					}),
			);
	}

	/**
	 * Run a button's action: any failure becomes a Notice plus the error in
	 * the console, and the tab refreshes only while it is still on screen.
	 */
	private async guarded(
		what: string,
		action: () => Promise<boolean | void>,
		renderId = this.renderId,
	): Promise<void> {
		try {
			const changed = await action();
			// Settings closed or redrawn meanwhile: leave the current view alone.
			if (
				changed !== false &&
				renderId === this.renderId &&
				this.containerEl.isConnected
			) {
				this.update();
			}
		} catch (err) {
			console.error(`Comu importer: ${what} failed`, err);
			new Notice(
				`Comu importer: ${what} failed. See the developer console.`,
			);
		}
	}

	private async testConnection(): Promise<void> {
		try {
			await this.plugin.client.testConnection();
			new Notice('Comu importer: connected.');
		} catch (err) {
			console.error('Comu importer: connection test failed', err);
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Comu importer: ${message}`);
		}
	}

	private renderFooter(setting: Setting): void {
		const el = setting.settingEl;
		el.empty();
		el.addClass('comu-importer-settings-footer');
		// One inner flex container; separators are the gap, not text whitespace.
		const inner = el.createDiv({ cls: 'comu-importer-footer-inner' });
		const manifestVersion = this.plugin.manifest.version || '0.0.0';
		inner.createSpan({ text: `Version ${manifestVersion}` });
		// Separator and its link are one nowrap item, so a wrap never strands a "|".
		const link = (text: string, url: string): void => {
			const item = inner.createSpan({ cls: 'comu-importer-footer-link' });
			item.createSpan({
				cls: 'comu-importer-footer-separator',
				text: '|',
			});
			item.createEl('a', {
				text,
				href: url,
				attr: { target: '_blank', rel: 'noopener' },
			});
		};
		link('GitHub', REPO_URL);
		link('Discord', DISCORD_URL);
		link('Report issues', `${REPO_URL}/issues`);
	}
}
