import {
	App,
	Notice,
	PluginSettingTab,
	type Setting,
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
						name: 'Token',
						desc: 'Pick or create a secret holding your token. To get it, sign in at web.comu.com, open the developer console and run: localStorage.authorization',
						control: { type: 'secret', key: 'tokenSecret' },
					},
					{
						name: 'Test connection',
						desc: 'Check that the token works.',
						action: () => {
							void this.testConnection();
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
