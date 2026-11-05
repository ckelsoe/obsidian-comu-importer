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
