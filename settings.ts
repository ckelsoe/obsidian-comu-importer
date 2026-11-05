import {
	coerceIntervalMinutes,
	DEFAULT_NOTE_NAME_TEMPLATE,
	isTranscriptPlacement,
	isValidNoteNameTemplate,
	isValidReplacementChar,
	type CustomFrontmatterRow,
	type DuplicatePolicy,
	type RecordingId,
	type TagMode,
	type TranscriptPlacement,
} from 'obsidian-recording-importer-core';

/** Lucide icons offered for the ribbon button; the first is the default. */
export const RIBBON_ICON_CHOICES: ReadonlyArray<{ id: string; label: string }> =
	[
		{ id: 'mic-vocal', label: 'Vocal mic (default)' },
		{ id: 'mic', label: 'Microphone' },
		{ id: 'audio-lines', label: 'Audio waveform' },
		{ id: 'headphones', label: 'Headphones' },
		{ id: 'file-audio-2', label: 'Audio file' },
		{ id: 'podcast', label: 'Podcast' },
		{ id: 'notebook-pen', label: 'Notebook' },
		{ id: 'captions', label: 'Captions' },
		{ id: 'message-square-text', label: 'Conversation' },
	];

export interface ComuImporterSettings {
	outputFolder: string;
	subfolderTemplate: string;
	noteNameTemplate: string;
	/** Moment template for a `datetime:` property; empty writes none. */
	datetimeTemplate: string;
	/** IANA zone for times; empty uses this device's zone. */
	fallbackTimezone: string;
	customFrontmatter: CustomFrontmatterRow[];
	preserveUnknownFrontmatter: boolean;
	forbiddenCharReplacement: string;
	duplicatePolicy: DuplicatePolicy;
	transcriptPlacement: TranscriptPlacement;
	foldTranscript: boolean;
	transcriptHeaderLevel: 2 | 3 | 4 | 5;
	/** Import defaults, also the starting choice in the import window. */
	includeSummary: boolean;
	includeTranscript: boolean;
	includeAudio: boolean;
	tagMode: TagMode;
	customTags: string;
	showRibbonIcon: boolean;
	ribbonIcon: string;
	showTrashed: boolean;
	hideProcessedRecordings: boolean;
	hideUpdatesRecordings: boolean;
	hideIgnoredRecordings: boolean;
	ignoredRecordingIds: RecordingId[];
	writePlaceholderForUnprocessed: boolean;
	autoCloseSummary: boolean;
	autoCloseSummarySeconds: number;
	autoSyncEnabled: boolean;
	autoSyncIntervalMinutes: number;
	debug: boolean;
}

export const DEFAULT_SETTINGS: ComuImporterSettings = {
	outputFolder: 'Comu',
	subfolderTemplate: '{{YYYY}}/{{MM}}',
	noteNameTemplate: DEFAULT_NOTE_NAME_TEMPLATE,
	datetimeTemplate: '',
	fallbackTimezone: '',
	customFrontmatter: [],
	preserveUnknownFrontmatter: true,
	forbiddenCharReplacement: '-',
	duplicatePolicy: 'prompt',
	transcriptPlacement: 'heading',
	foldTranscript: true,
	transcriptHeaderLevel: 4,
	includeSummary: true,
	includeTranscript: true,
	includeAudio: false,
	tagMode: 'custom',
	customTags: 'comu-meeting',
	showRibbonIcon: true,
	ribbonIcon: 'mic-vocal',
	showTrashed: false,
	hideProcessedRecordings: true,
	hideUpdatesRecordings: false,
	hideIgnoredRecordings: true,
	ignoredRecordingIds: [],
	writePlaceholderForUnprocessed: true,
	autoCloseSummary: true,
	autoCloseSummarySeconds: 20,
	autoSyncEnabled: false,
	autoSyncIntervalMinutes: 60,
	debug: false,
};

const DUPLICATE_POLICIES: readonly string[] = ['skip', 'overwrite', 'prompt'];
const TAG_MODES: readonly string[] = ['none', 'custom', 'plaud', 'all'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for an IANA zone name this device knows, or empty (device zone). */
export function isValidTimezone(zone: string): boolean {
	if (zone.trim() === '') return true;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone.trim() });
		return true;
	} catch {
		return false;
	}
}

/** Pick the stored icon when it is one of the choices, else the default. */
export function resolveRibbonIcon(stored: string): string {
	return RIBBON_ICON_CHOICES.some((c) => c.id === stored)
		? stored
		: DEFAULT_SETTINGS.ribbonIcon;
}

function normalizeRows(raw: unknown): CustomFrontmatterRow[] {
	if (!Array.isArray(raw)) return [];
	const rows: CustomFrontmatterRow[] = [];
	for (const row of raw) {
		if (!isRecord(row)) continue;
		const key = row['key'];
		const value = row['value'];
		if (typeof key !== 'string') continue;
		rows.push({
			key,
			value: typeof value === 'string' ? value : '',
			preserve: row['preserve'] === true,
		});
	}
	return rows;
}

/** Read `data.json` without trusting any field to have its written type. */
export function normalizeSettings(raw: unknown): ComuImporterSettings {
	const d = DEFAULT_SETTINGS;
	if (!isRecord(raw)) {
		return { ...d, customFrontmatter: [], ignoredRecordingIds: [] };
	}
	const text = (key: string, fallback: string): string => {
		const v = raw[key];
		return typeof v === 'string' ? v : fallback;
	};
	const flag = (key: string, fallback: boolean): boolean => {
		const v = raw[key];
		return typeof v === 'boolean' ? v : fallback;
	};
	const dup = raw['duplicatePolicy'];
	const placement = raw['transcriptPlacement'];
	const tagMode = raw['tagMode'];
	const level = raw['transcriptHeaderLevel'];
	const seconds = raw['autoCloseSummarySeconds'];
	const noteName = text('noteNameTemplate', d.noteNameTemplate);
	const replacement = text(
		'forbiddenCharReplacement',
		d.forbiddenCharReplacement,
	);
	const zone = text('fallbackTimezone', d.fallbackTimezone);
	const ignored = raw['ignoredRecordingIds'];
	return {
		outputFolder:
			text('outputFolder', d.outputFolder).trim() || d.outputFolder,
		subfolderTemplate: text('subfolderTemplate', d.subfolderTemplate),
		noteNameTemplate:
			noteName.trim() !== '' && isValidNoteNameTemplate(noteName)
				? noteName
				: d.noteNameTemplate,
		datetimeTemplate: text('datetimeTemplate', d.datetimeTemplate),
		fallbackTimezone: isValidTimezone(zone) ? zone.trim() : '',
		customFrontmatter: normalizeRows(raw['customFrontmatter']),
		preserveUnknownFrontmatter: flag(
			'preserveUnknownFrontmatter',
			d.preserveUnknownFrontmatter,
		),
		forbiddenCharReplacement: isValidReplacementChar(replacement)
			? replacement
			: d.forbiddenCharReplacement,
		duplicatePolicy:
			typeof dup === 'string' && DUPLICATE_POLICIES.includes(dup)
				? (dup as DuplicatePolicy)
				: d.duplicatePolicy,
		transcriptPlacement: isTranscriptPlacement(placement)
			? placement
			: d.transcriptPlacement,
		foldTranscript: flag('foldTranscript', d.foldTranscript),
		transcriptHeaderLevel:
			level === 2 || level === 3 || level === 4 || level === 5
				? level
				: d.transcriptHeaderLevel,
		includeSummary: flag('includeSummary', d.includeSummary),
		includeTranscript: flag('includeTranscript', d.includeTranscript),
		includeAudio: flag('includeAudio', d.includeAudio),
		tagMode:
			typeof tagMode === 'string' && TAG_MODES.includes(tagMode)
				? (tagMode as TagMode)
				: d.tagMode,
		customTags: text('customTags', d.customTags),
		showRibbonIcon: flag('showRibbonIcon', d.showRibbonIcon),
		ribbonIcon: resolveRibbonIcon(text('ribbonIcon', d.ribbonIcon)),
		showTrashed: flag('showTrashed', d.showTrashed),
		hideProcessedRecordings: flag(
			'hideProcessedRecordings',
			d.hideProcessedRecordings,
		),
		hideUpdatesRecordings: flag(
			'hideUpdatesRecordings',
			d.hideUpdatesRecordings,
		),
		hideIgnoredRecordings: flag(
			'hideIgnoredRecordings',
			d.hideIgnoredRecordings,
		),
		ignoredRecordingIds: Array.isArray(ignored)
			? ignored.filter(
					(id): id is RecordingId =>
						typeof id === 'string' && id.length > 0,
				)
			: [],
		writePlaceholderForUnprocessed: flag(
			'writePlaceholderForUnprocessed',
			d.writePlaceholderForUnprocessed,
		),
		autoCloseSummary: flag('autoCloseSummary', d.autoCloseSummary),
		autoCloseSummarySeconds:
			typeof seconds === 'number' &&
			Number.isFinite(seconds) &&
			seconds >= 3 &&
			seconds <= 120
				? Math.round(seconds)
				: d.autoCloseSummarySeconds,
		autoSyncEnabled: flag('autoSyncEnabled', d.autoSyncEnabled),
		autoSyncIntervalMinutes: coerceIntervalMinutes(
			raw['autoSyncIntervalMinutes'],
		),
		debug: flag('debug', d.debug),
	};
}
