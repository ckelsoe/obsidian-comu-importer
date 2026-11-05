import { DEFAULT_SETTINGS, normalizeSettings } from '../settings';
import { audioExtension } from '../audio-pipeline';

describe('normalizeSettings', () => {
	it('returns defaults for missing or broken data', () => {
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
	});

	it('keeps valid values and drops wrongly typed ones', () => {
		const s = normalizeSettings({
			outputFolder: 'Meetings',
			duplicatePolicy: 'skip',
			transcriptPlacement: 'callout',
			includeAudio: 'yes',
			showTrashed: true,
		});
		expect(s.outputFolder).toBe('Meetings');
		expect(s.duplicatePolicy).toBe('skip');
		expect(s.transcriptPlacement).toBe('callout');
		expect(s.includeAudio).toBe(false);
		expect(s.showTrashed).toBe(true);
	});

	it('rejects unknown enum values and a blank folder', () => {
		const s = normalizeSettings({
			outputFolder: '  ',
			duplicatePolicy: 'delete',
			transcriptPlacement: 'side',
		});
		expect(s.outputFolder).toBe('Comu');
		expect(s.duplicatePolicy).toBe('prompt');
		expect(s.transcriptPlacement).toBe('heading');
	});
});

describe('audioExtension', () => {
	it('reads the extension from the URL path, ignoring the query', () => {
		expect(audioExtension('https://cdn.test/a/b.MP3?sig=x.y')).toBe('mp3');
		expect(audioExtension('https://cdn.test/a/b')).toBe('m4a');
		expect(audioExtension('not a url')).toBe('m4a');
	});
});

describe('normalizeSettings, output and import options', () => {
	it('keeps valid values', () => {
		const s = normalizeSettings({
			noteNameTemplate: '{{title}} {{YYYY}}',
			fallbackTimezone: 'America/New_York',
			forbiddenCharReplacement: '_',
			transcriptHeaderLevel: 3,
			tagMode: 'none',
			ribbonIcon: 'headphones',
			autoSyncIntervalMinutes: 180,
			autoCloseSummarySeconds: 10,
			customFrontmatter: [
				{ key: 'status', value: 'new', preserve: true },
			],
			ignoredRecordingIds: ['a', 'b'],
		});
		expect(s.noteNameTemplate).toBe('{{title}} {{YYYY}}');
		expect(s.fallbackTimezone).toBe('America/New_York');
		expect(s.forbiddenCharReplacement).toBe('_');
		expect(s.transcriptHeaderLevel).toBe(3);
		expect(s.tagMode).toBe('none');
		expect(s.ribbonIcon).toBe('headphones');
		expect(s.autoSyncIntervalMinutes).toBe(180);
		expect(s.autoCloseSummarySeconds).toBe(10);
		expect(s.customFrontmatter).toEqual([
			{ key: 'status', value: 'new', preserve: true },
		]);
		expect(s.ignoredRecordingIds).toEqual(['a', 'b']);
	});

	it('replaces values that would break an import with the defaults', () => {
		const s = normalizeSettings({
			noteNameTemplate: '{{title}}/x',
			fallbackTimezone: 'Mars/Olympus',
			forbiddenCharReplacement: '/',
			transcriptHeaderLevel: 9,
			tagMode: 'everything',
			ribbonIcon: 'not-an-icon',
			autoCloseSummarySeconds: 0,
			customFrontmatter: [{ value: 'no key' }, 'junk'],
			ignoredRecordingIds: ['a', 3, ''],
		});
		expect(s.noteNameTemplate).toBe(DEFAULT_SETTINGS.noteNameTemplate);
		expect(s.fallbackTimezone).toBe('');
		expect(s.forbiddenCharReplacement).toBe('-');
		expect(s.transcriptHeaderLevel).toBe(4);
		expect(s.tagMode).toBe(DEFAULT_SETTINGS.tagMode);
		expect(s.ribbonIcon).toBe(DEFAULT_SETTINGS.ribbonIcon);
		expect(s.autoCloseSummarySeconds).toBe(20);
		expect(s.customFrontmatter).toEqual([]);
		expect(s.ignoredRecordingIds).toEqual(['a']);
	});

	it('never shares the default lists between loads', () => {
		const a = normalizeSettings(undefined);
		a.ignoredRecordingIds.push('x' as never);
		expect(normalizeSettings(undefined).ignoredRecordingIds).toEqual([]);
	});
});
