import type {
	DuplicatePolicy,
	TranscriptPlacement,
} from 'obsidian-recording-importer-core';
import { isTranscriptPlacement } from 'obsidian-recording-importer-core';

export interface ComuImporterSettings {
	/** Name of the Obsidian secret holding the Comu token (not the token). */
	tokenSecret: string;
	outputFolder: string;
	subfolderTemplate: string;
	noteNameTemplate: string;
	duplicatePolicy: DuplicatePolicy;
	transcriptPlacement: TranscriptPlacement;
	includeAudio: boolean;
	showTrashed: boolean;
}

export const DEFAULT_SETTINGS: ComuImporterSettings = {
	tokenSecret: 'comu-token',
	outputFolder: 'Comu',
	subfolderTemplate: '',
	noteNameTemplate: '',
	duplicatePolicy: 'prompt',
	transcriptPlacement: 'heading',
	includeAudio: false,
	showTrashed: false,
};

const DUPLICATE_POLICIES: readonly string[] = ['skip', 'overwrite', 'prompt'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read `data.json` without trusting any field to have its written type. */
export function normalizeSettings(raw: unknown): ComuImporterSettings {
	const d = DEFAULT_SETTINGS;
	if (!isRecord(raw)) return { ...d };
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
	return {
		tokenSecret: text('tokenSecret', d.tokenSecret),
		outputFolder:
			text('outputFolder', d.outputFolder).trim() || d.outputFolder,
		subfolderTemplate: text('subfolderTemplate', d.subfolderTemplate),
		noteNameTemplate: text('noteNameTemplate', d.noteNameTemplate),
		duplicatePolicy:
			typeof dup === 'string' && DUPLICATE_POLICIES.includes(dup)
				? (dup as DuplicatePolicy)
				: d.duplicatePolicy,
		transcriptPlacement: isTranscriptPlacement(placement)
			? placement
			: d.transcriptPlacement,
		includeAudio: flag('includeAudio', d.includeAudio),
		showTrashed: flag('showTrashed', d.showTrashed),
	};
}
