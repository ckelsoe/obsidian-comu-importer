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
import { canOpenSignIn } from './comu-login';
import { tokenFromPaste } from './comu-bookmarklet';

// Community discussion for this plugin. This must stay a never-expiring
// discord.gg invite: a discord.com/channels/... deep link only resolves for
// accounts already in the server, so it cannot get anyone in, and a default
// invite expires after 7 days and would rot in a shipped release.
const DISCORD_URL = 'https://discord.gg/gd6tKJDPj4';
const REPO_URL = 'https://github.com/ckelsoe/obsidian-comu-importer';

// The browser flow, for Google and Apple accounts whose sign-in will not run
// in the app's window.
const BROWSER_DESC =
	'For Apple or Google sign-in. Click Set up bookmark once and drag the button it shows onto your bookmarks bar. Then sign in at web.comu.com in your browser and click the bookmark: Obsidian opens and saves the sign-in.';
const PASTE_DESC =
	'If the bookmark could not open Obsidian, copy the line it shows and click the button. A token copied by hand works too.';

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
						name: 'Status',
						searchable: false,
						render: (setting: Setting) => {
							this.renderStatus(setting);
						},
					},
					{
						name: 'Sign in',
						desc: 'Opens the sign-in page in its own window. Sign in with your email and password; the window closes by itself when it is done.',
						visible: () => canOpenSignIn(),
						render: (setting: Setting) => {
							setting.addButton((b) =>
								b
									.setButtonText('Sign in')
									.setCta()
									.onClick(() => {
										void this.signIn();
									}),
							);
						},
					},
					{
						name: 'Sign in with your browser',
						desc: BROWSER_DESC,
						render: (setting: Setting) => {
							setting
								.addButton((b) =>
									b
										.setButtonText('Open web.comu.com')
										.onClick(() => {
											window.open(
												'https://web.comu.com',
												'_blank',
											);
										}),
								)
								.addButton((b) =>
									b
										.setButtonText('Set up bookmark')
										.onClick(() => {
											void this.guarded(
												'bookmark setup',
												() =>
													this.plugin.openBookmarkSetup(),
											);
										}),
								);
						},
					},
					{
						name: 'Paste token',
						desc: PASTE_DESC,
						render: (setting: Setting) => {
							setting.addButton((b) =>
								b
									.setButtonText('Paste from clipboard')
									.onClick(() => {
										void this.pasteToken();
									}),
							);
						},
					},
					{
						name: 'Sign out',
						desc: 'Remove the stored token from this device.',
						visible: () => this.plugin.tokenInfo() !== null,
						render: (setting: Setting) => {
							setting.addButton((b) =>
								b
									.setButtonText('Sign out')
									.setDestructive()
									.onClick(() => {
										void this.signOut();
									}),
							);
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

	private renderStatus(setting: Setting): void {
		const info = this.plugin.tokenInfo();
		if (info === null) {
			setting.setDesc('Not signed in.');
			return;
		}
		const who = info.email ?? 'your account';
		const until =
			info.expiresAt === null
				? ''
				: info.expiresAt.getTime() <= Date.now()
					? ' The token has expired; sign in again.'
					: ` The token is valid until ${info.expiresAt.toLocaleDateString()}.`;
		setting.setDesc(`Signed in as ${who}.${until}`);
		setting.addButton((b) =>
			b.setButtonText('Test connection').onClick(() => {
				void this.testConnection();
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
	): Promise<void> {
		try {
			const changed = await action();
			if (changed !== false && this.containerEl.isConnected)
				this.update();
		} catch (err) {
			console.error(`Comu importer: ${what} failed`, err);
			new Notice(
				`Comu importer: ${what} failed. See the developer console.`,
			);
		}
	}

	private signIn(): Promise<void> {
		return this.guarded('sign-in', () => this.plugin.runSignIn());
	}

	private pasteToken(): Promise<void> {
		return this.guarded('pasting the token', async () => {
			const text = await navigator.clipboard.readText();
			return this.plugin.saveToken(
				tokenFromPaste(text, this.app.vault.getName()),
			);
		});
	}

	private signOut(): Promise<void> {
		return this.guarded('sign-out', () => this.plugin.signOut());
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
