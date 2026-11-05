import {
	ComuParseError,
	extraSections,
	formatActionItems,
	parseAudioUrl,
	parseNote,
	parseNotePage,
	parseOutline,
	parseSummary,
	parseTranscript,
	stripSpeakerLinks,
} from '../comu-parse';
import { at } from './helpers/checked';
import {
	LIST_ITEM,
	NOTE_ID,
	OUTLINE_DATA,
	SUMMARY_DATA,
	TODO_DATA,
	TRANSCRIPT_DATA,
} from './fixtures';
import type { RecordingId } from 'obsidian-recording-importer-core';

const id = NOTE_ID as RecordingId;

describe('parseNote', () => {
	it('maps a list item onto the recording model', () => {
		const r = parseNote(LIST_ITEM);
		expect(r.id).toBe(NOTE_ID);
		expect(r.title).toBe('Weekly planning');
		expect(r.createdAt.toISOString()).toBe('2026-11-03T19:57:21.000Z');
		expect(r.endsAt.getTime() - r.createdAt.getTime()).toBe(2196 * 1000);
		expect(r.transcriptAvailable).toBe(true);
		expect(r.summaryAvailable).toBe(true);
		expect(r.isTrashed).toBe(false);
		expect(r.versionMs).toBe(Date.parse('2026-11-05T15:10:25Z'));
		expect(r.folderId).toBeUndefined();
	});

	it('marks unfinished processing as unavailable', () => {
		const r = parseNote({
			...LIST_ITEM,
			summaryStatus: 1,
			transcribeStatus: 0,
		});
		expect(r.transcriptAvailable).toBe(false);
		expect(r.summaryAvailable).toBe(false);
	});

	it('falls back to createTime and a default title', () => {
		const r = parseNote({
			...LIST_ITEM,
			startTime: undefined,
			title: '  ',
		});
		expect(r.createdAt.toISOString()).toBe('2026-11-03T20:34:17.000Z');
		expect(r.title).toBe('Untitled recording');
	});

	it('throws on a note without an id', () => {
		expect(() => parseNote({ ...LIST_ITEM, noteId: '' })).toThrow(
			ComuParseError,
		);
		expect(() => parseNote(null)).toThrow(ComuParseError);
	});
});

describe('parseNotePage', () => {
	it('reads items and total', () => {
		const page = parseNotePage({ data: [LIST_ITEM], total: 7, page: 1 });
		expect(page.total).toBe(7);
		expect(page.recordings).toHaveLength(1);
	});

	it('throws when the data array is missing', () => {
		expect(() => parseNotePage({ total: 1 })).toThrow(ComuParseError);
	});
});

describe('parseAudioUrl', () => {
	it('accepts only https URLs', () => {
		expect(
			parseAudioUrl({ audioUrl: 'https://cdn.example/a.m4a?sig=1' }),
		).toBe('https://cdn.example/a.m4a?sig=1');
		expect(
			parseAudioUrl({ audioUrl: 'http://cdn.example/a.m4a' }),
		).toBeNull();
		expect(parseAudioUrl({ audioUrl: null })).toBeNull();
	});
});

describe('parseTranscript', () => {
	it('converts milliseconds to seconds and drops blank lines', () => {
		const t = parseTranscript(id, TRANSCRIPT_DATA);
		expect(t?.segments).toHaveLength(2);
		const first = at(t?.segments ?? [], 0);
		expect(first).toEqual({
			startSeconds: 1.66,
			endSeconds: 3.18,
			text: 'Good morning.',
			speaker: 'Alex',
		});
		expect(t?.rawText).toBe('Good morning.\nMorning, let us start.');
	});

	it('returns null for an empty transcript', () => {
		expect(parseTranscript(id, { asrResultVO: [] })).toBeNull();
		expect(parseTranscript(id, null)).toBeNull();
	});
});

describe('stripSpeakerLinks', () => {
	it('keeps the name and drops the speaker link', () => {
		expect(
			stripSpeakerLinks(
				'ask [Alex](speaker:abc-1) and [Sam](speaker:2).',
			),
		).toBe('ask Alex and Sam.');
	});

	it('leaves other links and malformed ones alone', () => {
		const text =
			'[site](https://x.test) and ](speaker:1) and [a\nb](speaker:2)';
		expect(stripSpeakerLinks(text)).toBe(text);
	});
});

describe('parseSummary', () => {
	it('reads summary and insights, with speaker links stripped', () => {
		const s = parseSummary(SUMMARY_DATA);
		expect(s.summary).toContain('### Overview');
		expect(s.insights).toContain('  - Alex leads');
		expect(s.insights).not.toContain('speaker:');
	});

	it('returns nulls when Comu has none', () => {
		expect(
			parseSummary({ noteSummaryDetailVO: { summaryContent: '' } }),
		).toEqual({
			summary: null,
			insights: null,
		});
	});
});

describe('parseOutline', () => {
	it('maps outline items to chapters in seconds', () => {
		expect(parseOutline(OUTLINE_DATA)).toEqual([
			{ title: 'Opening', startSeconds: 1.66, endSeconds: 107.61 },
			{ title: 'Planning', startSeconds: 107.61, endSeconds: 2196 },
		]);
	});

	it('skips items without a title or start', () => {
		expect(
			parseOutline({ outlines: [{ content: 'x' }, { startTime: 1 }] }),
		).toEqual([]);
	});
});

describe('formatActionItems', () => {
	it('renders open and done tasks with owners', () => {
		expect(formatActionItems(TODO_DATA)).toBe(
			'- [ ] Send the agenda (Sam)\n- [x] Book the room',
		);
	});

	it('returns null when there are none', () => {
		expect(formatActionItems([])).toBeNull();
		expect(formatActionItems(null)).toBeNull();
	});
});

describe('extraSections', () => {
	it('orders insights before action items and skips empty ones', () => {
		expect(extraSections('I', 'A').map((s) => s.heading)).toEqual([
			'Insights',
			'Action items',
		]);
		expect(extraSections(null, null)).toEqual([]);
	});
});
