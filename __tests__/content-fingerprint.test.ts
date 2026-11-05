import type {
	RecordingArtifacts,
	RecordingId,
} from 'obsidian-recording-importer-core';
import {
	contentFingerprint as fingerprintOf,
	readStoredFingerprint,
} from '../content-fingerprint';
import { parseNote } from '../comu-parse';
import { LIST_ITEM } from './fixtures';

const recording = parseNote(LIST_ITEM);
const all = { summary: true, transcript: true, audio: false };
const contentFingerprint = (a: RecordingArtifacts): string =>
	fingerprintOf(recording, a, all);

const id = 'n1' as RecordingId;
const base: RecordingArtifacts = {
	transcript: {
		id,
		rawText: 'Hi.',
		segments: [
			{ startSeconds: 0, endSeconds: 1, speaker: 'Alex', text: 'Hi.' },
		],
	},
	summary: { id, text: 'A call.' },
	chapters: [{ title: 'Opening', startSeconds: 0, endSeconds: 60 }],
	additionalSummaries: [
		{ heading: 'Insights', text: '### Key points' },
		{ heading: 'Action items', text: '- [ ] Send it (Sam)' },
	],
};

describe('contentFingerprint', () => {
	it('is the same for the same content', () => {
		expect(contentFingerprint(base)).toBe(
			contentFingerprint(
				JSON.parse(JSON.stringify(base)) as RecordingArtifacts,
			),
		);
		expect(contentFingerprint(base)).toMatch(/^[0-9a-f]{16}$/);
	});

	it('changes when any part a note shows changes', () => {
		const fp = contentFingerprint(base);
		const variants: RecordingArtifacts[] = [
			{ ...base, summary: { id, text: 'A longer call.' } },
			{
				...base,
				transcript: {
					id,
					rawText: 'Hi.',
					segments: [
						{
							startSeconds: 0,
							endSeconds: 1,
							speaker: 'Alexandra',
							text: 'Hi.',
						},
					],
				},
			},
			{
				...base,
				chapters: [{ title: 'Intro', startSeconds: 0, endSeconds: 60 }],
			},
			{
				...base,
				additionalSummaries: [
					{ heading: 'Insights', text: '### Key points' },
					{ heading: 'Action items', text: '- [x] Send it (Sam)' },
				],
			},
			{
				...base,
				additionalSummaries: [
					{ heading: 'Insights', text: '### Key points' },
				],
			},
		];
		for (const v of variants) expect(contentFingerprint(v)).not.toBe(fp);
	});
});

describe('contentFingerprint, beyond the content', () => {
	it('changes with the title, start or length, and with the import choice', () => {
		const fp = fingerprintOf(recording, base, all);
		expect(
			fingerprintOf({ ...recording, title: 'Renamed' }, base, all),
		).not.toBe(fp);
		expect(
			fingerprintOf({ ...recording, createdAt: new Date(0) }, base, all),
		).not.toBe(fp);
		expect(
			fingerprintOf({ ...recording, durationSeconds: 1 }, base, all),
		).not.toBe(fp);
		expect(
			fingerprintOf(recording, base, { ...all, audio: true }),
		).not.toBe(fp);
	});

	it("ignores Comu's change time, which moves on a mere view", () => {
		expect(fingerprintOf({ ...recording, versionMs: 1 }, base, all)).toBe(
			fingerprintOf({ ...recording, versionMs: 2 }, base, all),
		);
	});
});

describe('readStoredFingerprint', () => {
	it('reads the fingerprint from the frontmatter only', () => {
		expect(
			readStoredFingerprint(
				'---\ncomu-id: x\ncomu-content-hash: 0123456789abcdef\n---\nbody',
			),
		).toBe('0123456789abcdef');
		expect(
			readStoredFingerprint(
				'---\ncomu-content-hash: "0123456789abcdef"\n---\n',
			),
		).toBe('0123456789abcdef');
		expect(
			readStoredFingerprint(
				'---\ncomu-id: x\n---\ncomu-content-hash: 0123456789abcdef',
			),
		).toBeUndefined();
		expect(readStoredFingerprint('no frontmatter')).toBeUndefined();
		// Single quotes, as some frontmatter editors write them.
		expect(
			readStoredFingerprint(
				"---\ncomu-content-hash: '0123456789abcdef'\n---\n",
			),
		).toBe('0123456789abcdef');
	});
});
