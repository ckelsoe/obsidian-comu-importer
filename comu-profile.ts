import type { ServiceProfile } from 'obsidian-recording-importer-core';

const COMU_WEB_URL = 'https://web.comu.com';

/**
 * Stored names for Comu notes. Every frontmatter key, marker and tag derives
 * from `keyPrefix`, so these must never change once notes exist.
 */
export const COMU_PROFILE: ServiceProfile = {
	keyPrefix: 'comu',
	pluginId: 'comu-importer',
	// Comu note ids are UUIDs; case is the only spelling difference.
	canonicalId: (id) => id.toLowerCase(),
	serviceName: 'Comu',
	pluginName: 'Comu Importer',
	recordingUrl: (id) =>
		`${COMU_WEB_URL}/all-files/note/${encodeURIComponent(id)}`,
	placeholderCallout: [
		'> [!warning] Not imported: Comu has no transcript or summary',
		'> Comu has no transcript or summary for this recording yet. It may still be',
		'> processing. Open it in Comu to check, then re-run the import; this',
		'> placeholder is replaced automatically.',
		'>',
	],
	markDataType: 'comu-mark',
	// Comu has no id-less legacy notes: a note without `comu-id` is the user's.
	protectUnownedNotes: true,
	// Comu's summaries and insights open with real section headings.
	keepLeadingSummaryHeading: true,
};
