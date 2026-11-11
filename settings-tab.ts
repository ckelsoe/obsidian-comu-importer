// Settings for Comu Importer, on the declarative getSettingDefinitions API
// (Obsidian 1.13+). Plain fields are `control` items Obsidian binds and saves;
// anything with buttons, a live preview or a list is a `render` row. The
// template builders follow Plaud Importer's settings (insert-token buttons,
// token reference, live preview).

import {
	App,
	Notice,
	PluginSettingTab,
	type Setting,
	type SettingDefinitionItem,
	type TextComponent,
	setIcon,
} from 'obsidian';
import {
	formatDatetime,
	isValidNoteNameTemplate,
	isValidReplacementChar,
	previewNoteFileName,
	renderCustomFrontmatterPreview,
	resolveSubfolder,
	TEMPLATE_PREVIEW_DATE,
	TEMPLATE_PREVIEW_DATETIME,
	TEMPLATE_PREVIEW_TITLE,
	type CustomFrontmatterRow,
} from 'obsidian-recording-importer-core';
import { COMU_PROFILE } from './comu-profile';
import {
	isValidTimezone,
	RIBBON_ICON_CHOICES,
	resolveRibbonIcon,
	type ComuImporterSettings,
} from './settings';
import type ComuImporterPlugin from './main';

// Community discussion for this plugin. This must stay a never-expiring
// discord.gg invite: a discord.com/channels/... deep link only resolves for
// accounts already in the server, so it cannot get anyone in, and a default
// invite expires after 7 days and would rot in a shipped release.
const DISCORD_URL = 'https://discord.gg/gd6tKJDPj4';
const REPO_URL = 'https://github.com/ckelsoe/obsidian-comu-importer';

// [button label, inserted token]. Clicking inserts the exact Moment token at
// the cursor, so a template never needs hand-typed braces.
const DATE_INSERT_TOKENS: ReadonlyArray<readonly [string, string]> = [
	['Year', '{{YYYY}}'],
	['Month #', '{{MM}}'],
	['Month name', '{{MMMM}}'],
	['Day', '{{DD}}'],
	['Weekday', '{{dddd}}'],
	['Quarter', '{{Q}}'],
	['Week', '{{WW}}'],
	['Hour', '{{HH}}'],
	['Minute', '{{mm}}'],
];
const TITLE_INSERT_TOKEN: readonly [string, string] = ['Title', '{{title}}'];
const PATH_INSERT_TOKENS: ReadonlyArray<readonly [string, string]> = [
	...DATE_INSERT_TOKENS.slice(0, 7),
	TITLE_INSERT_TOKEN,
];

// [token, meaning] reference shown under each path template.
const PATH_TOKENS: ReadonlyArray<readonly [string, string]> = [
	['{{YYYY}}', 'year, for example 2026'],
	['{{MM}}', 'month, 01 to 12'],
	['{{MMMM}}', 'month name, for example July'],
	['{{DD}}', 'day, 01 to 31'],
	['{{dddd}}', 'weekday name, for example Sunday'],
	['{{WW}}', 'ISO week number, 01 to 53'],
	['{{Q}}', 'quarter, 1 to 4'],
	['{{title}}', 'the recording title'],
];
const SUBFOLDER_EXAMPLES: ReadonlyArray<readonly [string, string]> = [
	['{{YYYY}}/{{MM}}', '2026/07 (a year folder holding month folders)'],
	['{{YYYY-MM}}', '2026-07 (one folder per month)'],
	['{{YYYY}}/W{{WW}}', '2026/W27 (by week)'],
	['{{YYYY}}/{{title}}', '2026/Team sync (a folder per recording)'],
];
const NOTE_NAME_EXAMPLES: ReadonlyArray<readonly [string, string]> = [
	['{{YYYY}}-{{MM}}-{{DD}} {{title}}', '2026-07-05 Team sync'],
	['{{title}} {{YYYY}}-{{MM}}-{{DD}}', 'Team sync 2026-07-05'],
	['{{MMM D, YYYY}} - {{title}}', 'Jul 5, 2026 - Team sync'],
];
const NOTE_NAME_PRESETS: ReadonlyArray<readonly [string, string]> = [
	['ISO', '{{YYYY}}-{{MM}}-{{DD}} {{title}}'],
	['US', '{{MM}}-{{DD}}-{{YYYY}} {{title}}'],
	['EU', '{{DD}}-{{MM}}-{{YYYY}} {{title}}'],
];
const TOKENS_HEADING =
	'Tokens (case matters; text inside {{ }} is a Moment date format, text outside is kept as written):';

// Descriptions held in consts where they quote IANA names or the product name,
// so the sentence-case check leaves those spellings alone.
const TIMEZONE_DESC =
	'Comu does not report the time zone a recording was made in. Times are written in this zone: an IANA name such as America/New_York or UTC. Leave it empty to use this device.';
const TIMEZONE_PLACEHOLDER = 'America/New_York';
const TIMEZONE_INVALID =
	'Comu importer: that is not a time zone name this device knows (for example America/New_York or UTC). Keeping the previous value.';
const CUSTOM_FRONTMATTER_DESC =
	'Adds your own properties to each note. A value can be plain text or use the template tokens ({{title}}, {{YYYY}} and the rest, plus {{duration}}). Turn on preserve for a property you edit by hand, so a re-import keeps your value. Names the plugin uses itself (comu-id, date, source and the rest) are left to the plugin.';
const TAG_MODE_DESC =
	'Which tags go in the tags property. Comu has no AI keyword tags, so the choice is your own tags or none.';
const AUTO_SYNC_DESC =
	'Imports new and changed recordings in the background on a schedule, without asking. A changed recording is re-imported: the part of its note between the markers is replaced, and the text around it is kept. Comu allows 1,000 requests a day per key. A recording takes about 5 (6 with audio), and each sync lists your recordings 100 at a time. Sync pauses once this device has used 600 in a day, leaving the rest for imports you start.';

// Parents of settings shown only while they apply: a change redraws the tab.
const PARENT_KEYS: readonly string[] = [
	'tagMode',
	'autoCloseSummary',
	'autoSyncEnabled',
	'showRibbonIcon',
];

const NUMERIC_KEYS: readonly string[] = [
	'transcriptHeaderLevel',
	'autoSyncIntervalMinutes',
];

export class ComuSettingTab extends PluginSettingTab {
	plugin: ComuImporterPlugin;
	/** Bumped by each render; a callback from an older one must not touch the tab. */
	private renderId = 0;
	/** Previews to redraw when the replacement character changes. */
	private readonly previewRefreshers = new Set<() => void>();

	constructor(app: App, plugin: ComuImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		this.previewRefreshers.clear();
		return [
			{
				type: 'group',
				heading: 'Connection',
				items: [
					{
						name: 'API key',
						desc: 'Create one in the mobile app under Me, Developers, API keys (needs a Premium or Elite membership). Paste it here and click Save. It is checked first and kept in secret storage, not in the plugin settings file.',
						aliases: ['token', 'connect', 'sign in', 'secret'],
						render: (setting: Setting) => {
							this.renderKey(setting);
						},
					},
					{
						name: 'Status',
						desc: 'Whether an API key is saved, with buttons to test the connection or remove the key.',
						aliases: [
							'test connection',
							'remove key',
							'disconnect',
						],
						render: (setting: Setting) => {
							this.renderStatus(setting);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Output',
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
						desc: "Optional. Files each note into folders built from the recording's date. A forward slash starts a new folder level. Leave empty to keep every note in the output folder.",
						aliases: ['folder', 'path', 'year', 'month', 'date'],
						render: (setting: Setting) => {
							this.renderSubfolder(setting);
						},
					},
					{
						name: 'Note name template',
						desc: "Each note's name, from the recording's date and title.",
						aliases: ['file name', 'filename', 'title', 'format'],
						render: (setting: Setting) => {
							this.renderNoteName(setting);
						},
					},
					{
						name: 'Datetime property',
						desc: 'Optional. Adds a datetime property in any format. The date property stays YYYY-MM-DD. Leave empty to write none.',
						aliases: ['date format', 'time', 'frontmatter'],
						render: (setting: Setting) => {
							this.renderDatetime(setting);
						},
					},
					{
						name: 'Time zone',
						desc: TIMEZONE_DESC,
						aliases: ['timezone', 'tz', 'utc'],
						render: (setting: Setting) => {
							this.renderTimezone(setting);
						},
					},
					{
						name: 'Extra frontmatter',
						desc: CUSTOM_FRONTMATTER_DESC,
						aliases: ['properties', 'property', 'yaml', 'metadata'],
						render: (setting: Setting) => {
							this.renderCustomFrontmatter(setting);
						},
					},
					{
						name: 'Keep properties you add',
						desc: 'On a re-import, keep frontmatter properties you or another tool added that the plugin does not manage.',
						control: {
							type: 'toggle',
							key: 'preserveUnknownFrontmatter',
						},
					},
					{
						name: 'Replacement character',
						desc: 'Replaces a character a file or folder name cannot contain, such as a slash in a title. One character; the default is a dash.',
						control: {
							type: 'text',
							key: 'forbiddenCharReplacement',
							validate: (v: string) =>
								isValidReplacementChar(v)
									? undefined
									: 'Enter one character that a file name may contain.',
						},
					},
					{
						name: 'When a note already exists',
						desc: 'For imports you start. Update replaces the part between the markers and keeps your text around it. Automatic sync never asks: it updates changed recordings and skips the rest.',
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
				],
			},
			{
				type: 'group',
				heading: 'What to import',
				items: [
					{
						name: 'Summary, insights and action items',
						desc: 'The starting choice in the import window, and what automatic sync imports.',
						control: { type: 'toggle', key: 'includeSummary' },
					},
					{
						name: 'Transcript',
						desc: 'With its chapter list.',
						control: { type: 'toggle', key: 'includeTranscript' },
					},
					{
						name: 'Audio',
						desc: "Saves the recording's audio in the note's -assets folder. Audio files are large.",
						control: { type: 'toggle', key: 'includeAudio' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Transcript',
				items: [
					{
						name: 'Transcript layout',
						desc: 'Where the transcript goes.',
						control: {
							type: 'dropdown',
							key: 'transcriptPlacement',
							options: {
								heading: 'In the note, under a heading',
								callout: 'In the note, in a collapsed callout',
								'file-embed':
									'Separate file, embedded in the note',
								'file-link':
									'Separate file, linked from the note',
							},
						},
					},
					{
						name: 'Fold the transcript',
						desc: 'Collapse the transcript heading when a note is written, so the summary is what you see first.',
						control: { type: 'toggle', key: 'foldTranscript' },
					},
					{
						name: 'Transcript heading level',
						desc: 'Chapter headings sit one level below.',
						control: {
							type: 'dropdown',
							key: 'transcriptHeaderLevel',
							options: {
								'2': 'H2',
								'3': 'H3',
								'4': 'H4',
								'5': 'H5',
							},
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Tags',
				items: [
					{
						name: 'Tags',
						desc: TAG_MODE_DESC,
						control: {
							type: 'dropdown',
							key: 'tagMode',
							options: {
								custom: 'My tags below',
								none: 'No tags',
							},
						},
					},
					{
						name: 'My tags',
						desc: 'Comma-separated, for example comu-meeting, work.',
						visible: () =>
							this.plugin.settings.tagMode === 'custom',
						control: { type: 'text', key: 'customTags' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Import window',
				items: [
					{
						name: 'Placeholder for unprocessed recordings',
						desc: 'When a checked recording has no transcript or summary yet, write a short note with a link to it. A later import replaces the placeholder.',
						control: {
							type: 'toggle',
							key: 'writePlaceholderForUnprocessed',
						},
					},
					{
						name: 'Close the results automatically',
						desc: 'After an import with no failures, close the results after a countdown.',
						control: { type: 'toggle', key: 'autoCloseSummary' },
					},
					{
						name: 'Countdown',
						desc: 'Seconds before the results close.',
						visible: () => this.plugin.settings.autoCloseSummary,
						control: {
							type: 'slider',
							key: 'autoCloseSummarySeconds',
							min: 3,
							max: 120,
							step: 1,
						},
					},
					{
						name: 'Show trashed recordings',
						desc: 'Also list recordings in the trash.',
						control: { type: 'toggle', key: 'showTrashed' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Automatic sync',
				items: [
					{
						name: 'Sync automatically',
						desc: AUTO_SYNC_DESC,
						control: { type: 'toggle', key: 'autoSyncEnabled' },
					},
					{
						name: 'Interval',
						desc: 'Time between syncs.',
						visible: () => this.plugin.settings.autoSyncEnabled,
						control: {
							type: 'dropdown',
							key: 'autoSyncIntervalMinutes',
							options: {
								'30': 'Every 30 minutes',
								'60': 'Every hour',
								'180': 'Every 3 hours',
								'360': 'Every 6 hours',
								'720': 'Every 12 hours',
								'1440': 'Once a day',
							},
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Appearance',
				items: [
					{
						name: 'Show ribbon icon',
						desc: 'A button in the left ribbon that opens the import window.',
						control: { type: 'toggle', key: 'showRibbonIcon' },
					},
					{
						name: 'Ribbon icon',
						desc: 'Pick one that tells it apart from other importers.',
						aliases: ['icon'],
						visible: () => this.plugin.settings.showRibbonIcon,
						render: (setting: Setting) => {
							this.renderRibbonIcon(setting);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Troubleshooting',
				items: [
					{
						name: 'Debug logging',
						desc: 'Log each step of an import to the developer console. Your API key is never logged.',
						control: { type: 'toggle', key: 'debug' },
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
		const value: unknown =
			this.plugin.settings[key as keyof ComuImporterSettings];
		// Dropdowns hold strings; these settings are numbers.
		return NUMERIC_KEYS.includes(key) ? String(value) : value;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const next = NUMERIC_KEYS.includes(key) ? Number(value) : value;
		(this.plugin.settings as unknown as Record<string, unknown>)[key] =
			next;
		await this.plugin.saveSettings();
		if (key === 'forbiddenCharReplacement') {
			for (const refresh of [...this.previewRefreshers]) refresh();
		}
		if (key === 'showRibbonIcon') this.plugin.updateRibbonIcon();
		if (key === 'autoSyncEnabled' || key === 'autoSyncIntervalMinutes') {
			this.plugin.reconcileAutoSync();
		}
		// Re-evaluate `visible` in place. update() would rebuild the tab and drop
		// text typed into a render row (the API key) but not saved yet.
		if (PARENT_KEYS.includes(key)) this.refreshDomState();
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
	}

	// ----- Template builders -------------------------------------------------

	/** Insert `token` at the field's cursor, replacing any selection. */
	private insertAtCursor(field: TextComponent, token: string): void {
		const input = field.inputEl;
		const value = input.value;
		const start = input.selectionStart ?? value.length;
		const end = input.selectionEnd ?? value.length;
		field.setValue(value.slice(0, start) + token + value.slice(end));
		const caret = start + token.length;
		input.focus();
		input.setSelectionRange(caret, caret);
	}

	/** The token reference and examples, in the row's description. */
	private addReference(
		setting: Setting,
		examples: ReadonlyArray<readonly [string, string]>,
	): void {
		const doc = setting.descEl.createDiv({
			cls: 'comu-importer-template-doc',
		});
		doc.createDiv({ text: TOKENS_HEADING });
		const tokens = doc.createEl('ul');
		for (const [token, meaning] of PATH_TOKENS) {
			const li = tokens.createEl('li');
			li.createEl('code', { text: token });
			li.createSpan({ text: ` ${meaning}` });
		}
		doc.createDiv({ text: 'Examples:' });
		const list = doc.createEl('ul');
		for (const [template, result] of examples) {
			const li = list.createEl('li');
			li.createEl('code', { text: template });
			li.createSpan({ text: ` → ${result}` });
		}
	}

	/**
	 * Insert-token buttons, the text field and a live preview below it. `apply`
	 * stores a value (it may refuse one); `preview` describes a value.
	 */
	private templateRow(
		setting: Setting,
		options: {
			readonly tokens: ReadonlyArray<readonly [string, string]>;
			readonly value: string;
			readonly placeholder: string;
			readonly apply: (value: string) => Promise<void>;
			readonly preview: (value: string) => string;
		},
	): void {
		setting.settingEl.addClass('comu-importer-stacked-row');
		let field: TextComponent | null = null;
		let current = options.value;
		const previewEl = createDiv({ cls: 'comu-importer-template-preview' });
		const refresh = (): void => {
			if (!previewEl.isConnected) {
				this.previewRefreshers.delete(refresh);
				return;
			}
			previewEl.setText(options.preview(current));
		};
		this.previewRefreshers.add(refresh);
		const update = (value: string): void => {
			current = value;
			refresh();
			options.apply(value).catch((err: unknown) => {
				console.error('Comu importer: could not save the setting', err);
				new Notice('Comu importer: could not save the setting.');
			});
		};
		for (const [label, token] of options.tokens) {
			setting.addButton((button) => {
				button
					.setButtonText(label)
					.setTooltip(`Insert ${token}`)
					.onClick(() => {
						if (field === null) return;
						this.insertAtCursor(field, token);
						update(field.getValue());
					});
				// Keep focus in the field so the cursor position survives the click.
				button.buttonEl.addEventListener('mousedown', (event) =>
					event.preventDefault(),
				);
			});
		}
		setting.addText((text) => {
			field = text;
			text.setPlaceholder(options.placeholder)
				.setValue(options.value)
				.onChange(update);
		});
		// The preview sits below the field.
		setting.controlEl.appendChild(previewEl);
		previewEl.setText(options.preview(current));
	}

	private renderSubfolder(setting: Setting): void {
		this.addReference(setting, SUBFOLDER_EXAMPLES);
		this.templateRow(setting, {
			tokens: PATH_INSERT_TOKENS,
			value: this.plugin.settings.subfolderTemplate,
			placeholder: '{{YYYY}}/{{MM}}',
			apply: async (value) => {
				this.plugin.settings.subfolderTemplate = value;
				await this.save();
			},
			preview: (template) => {
				const root = this.plugin.settings.outputFolder;
				if (template.trim() === '') {
					return `Preview: every note directly in ${root}`;
				}
				try {
					const folder = resolveSubfolder(
						template,
						TEMPLATE_PREVIEW_DATE,
						TEMPLATE_PREVIEW_TITLE,
						this.plugin.settings.forbiddenCharReplacement,
					);
					return `Preview folder: ${root}/${folder}`;
				} catch (err) {
					return `Preview (not usable): ${err instanceof Error ? err.message : String(err)}`;
				}
			},
		});
	}

	private renderNoteName(setting: Setting): void {
		this.addReference(setting, NOTE_NAME_EXAMPLES);
		this.templateRow(setting, {
			tokens: PATH_INSERT_TOKENS,
			value: this.plugin.settings.noteNameTemplate,
			placeholder: '{{YYYY}}-{{MM}}-{{DD}} {{title}}',
			apply: async (value) => {
				// An invalid name is shown in the preview and not stored.
				if (value.trim() === '' || !isValidNoteNameTemplate(value)) {
					return;
				}
				this.plugin.settings.noteNameTemplate = value;
				await this.save();
			},
			preview: (template) =>
				template.trim() === '' || !isValidNoteNameTemplate(template)
					? 'Not saved: this does not make a valid note name (it is empty, or puts a / : [ ] * ? < > | or " in the name).'
					: `Preview: ${previewNoteFileName(template, this.plugin.settings.forbiddenCharReplacement)}.md`,
		});
		for (const [label, template] of NOTE_NAME_PRESETS) {
			setting.addButton((button) =>
				button
					.setButtonText(label)
					.setTooltip(`Use ${template}`)
					.onClick(() => {
						this.plugin.settings.noteNameTemplate = template;
						void this.guarded('saving the note name', async () => {
							await this.save();
						});
					}),
			);
		}
	}

	private renderDatetime(setting: Setting): void {
		this.templateRow(setting, {
			tokens: DATE_INSERT_TOKENS,
			value: this.plugin.settings.datetimeTemplate,
			placeholder: '{{YYYY-MM-DD HH:mm}}',
			apply: async (value) => {
				this.plugin.settings.datetimeTemplate = value;
				await this.save();
			},
			preview: (template) =>
				template.trim() === ''
					? 'Preview: no datetime property'
					: `Preview: datetime: ${formatDatetime(template, TEMPLATE_PREVIEW_DATETIME)}`,
		});
	}

	private renderTimezone(setting: Setting): void {
		setting.addText((text) => {
			text.setPlaceholder(TIMEZONE_PLACEHOLDER).setValue(
				this.plugin.settings.fallbackTimezone,
			);
			// Checked when the field loses focus, so half-typed names are not refused.
			text.inputEl.addEventListener('blur', () => {
				const value = text.getValue().trim();
				if (!isValidTimezone(value)) {
					new Notice(TIMEZONE_INVALID);
					text.setValue(this.plugin.settings.fallbackTimezone);
					return;
				}
				this.plugin.settings.fallbackTimezone = value;
				void this.guarded('saving the time zone', () => this.save());
			});
		});
	}

	private renderCustomFrontmatter(setting: Setting): void {
		setting.settingEl.addClass('comu-importer-stacked-row');
		const rows = this.plugin.settings.customFrontmatter;
		const box = createDiv({ cls: 'comu-importer-frontmatter-rows' });
		const previewEl = createDiv({ cls: 'comu-importer-template-preview' });
		const drawPreview = (): void => {
			const lines = renderCustomFrontmatterPreview(COMU_PROFILE, rows);
			previewEl.setText(
				lines.length === 0
					? 'Preview: no extra properties'
					: `Preview:\n${lines.join('\n')}`,
			);
		};
		const store = (): void => {
			drawPreview();
			void this.guarded('saving extra frontmatter', () => this.save());
		};
		const draw = (): void => {
			box.empty();
			rows.forEach((row, index) => {
				const line = box.createDiv({
					cls: 'comu-importer-frontmatter-row',
				});
				const key = line.createEl('input', {
					attr: { type: 'text', 'aria-label': 'Property name' },
				});
				key.placeholder = 'Name';
				key.value = row.key;
				const value = line.createEl('input', {
					attr: { type: 'text', 'aria-label': 'Property value' },
				});
				value.placeholder = 'Value';
				value.value = row.value;
				const keep = line.createEl('label', {
					cls: 'comu-importer-frontmatter-keep',
				});
				const preserve = keep.createEl('input', {
					attr: { type: 'checkbox' },
				});
				preserve.checked = row.preserve;
				keep.createSpan({ text: 'Preserve' });
				const remove = line.createEl('button', {
					attr: { type: 'button', 'aria-label': 'Remove property' },
				});
				setIcon(remove, 'trash-2');
				const replace = (): void => {
					const next: CustomFrontmatterRow = {
						key: key.value,
						value: value.value,
						preserve: preserve.checked,
					};
					rows[index] = next;
					store();
				};
				key.addEventListener('change', replace);
				value.addEventListener('change', replace);
				preserve.addEventListener('change', replace);
				remove.addEventListener('click', () => {
					rows.splice(index, 1);
					draw();
					store();
				});
			});
		};
		setting.addButton((button) =>
			button.setButtonText('Add property').onClick(() => {
				rows.push({ key: '', value: '', preserve: false });
				draw();
			}),
		);
		setting.controlEl.appendChild(box);
		setting.controlEl.appendChild(previewEl);
		draw();
		drawPreview();
	}

	private renderRibbonIcon(setting: Setting): void {
		const preview = setting.controlEl.createSpan({
			cls: 'comu-importer-ribbon-preview',
		});
		setIcon(preview, resolveRibbonIcon(this.plugin.settings.ribbonIcon));
		setting.addDropdown((dropdown) => {
			for (const choice of RIBBON_ICON_CHOICES) {
				dropdown.addOption(choice.id, choice.label);
			}
			dropdown
				.setValue(resolveRibbonIcon(this.plugin.settings.ribbonIcon))
				.onChange((value) => {
					this.plugin.settings.ribbonIcon = resolveRibbonIcon(value);
					preview.empty();
					setIcon(preview, this.plugin.settings.ribbonIcon);
					this.plugin.updateRibbonIcon();
					void this.guarded('saving the ribbon icon', () =>
						this.save(),
					);
				});
		});
	}

	// ----- Connection --------------------------------------------------------

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
	 * Run an action: any failure becomes a Notice plus the error in the
	 * console. A truthy or empty result redraws the tab, but only while it is
	 * on screen and still the render the action started from.
	 */
	private async guarded(
		what: string,
		action: () => Promise<boolean | void>,
		renderId = this.renderId,
	): Promise<void> {
		try {
			const changed = await action();
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
