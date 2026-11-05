import type {
	ImportedIndex,
	ImportedRecord,
	RecordingId,
} from 'obsidian-recording-importer-core';
import { formatRunDetails, rowState, stopReason } from '../import-modal';
import { parseNote } from '../comu-parse';
import { LIST_ITEM, NOTE_ID } from './fixtures';

function indexWith(record?: ImportedRecord): ImportedIndex {
	const byId = new Map<RecordingId, ImportedRecord>();
	if (record) byId.set(NOTE_ID as RecordingId, record);
	return {
		byId,
		byInstant: new Map(),
		byDay: new Map(),
		canonicalId: (id) => id,
	};
}

describe('rowState', () => {
	const recording = parseNote(LIST_ITEM);
	const listed = Date.parse(LIST_ITEM.updateTime);

	it('is new when no note exists', () => {
		expect(rowState(recording, indexWith())).toBe('new');
	});

	it('is imported when the note has the listed version', () => {
		expect(
			rowState(recording, indexWith({ path: 'a.md', versionMs: listed })),
		).toBe('imported');
	});

	it('offers an update when Comu changed the recording since import', () => {
		expect(
			rowState(
				recording,
				indexWith({ path: 'a.md', versionMs: listed - 1000 }),
			),
		).toBe('update');
	});

	it('ignores the date-and-duration fallback, which can pair different recordings', () => {
		// Fallback maps that answer every key: any lookup there would match.
		class AnyKey extends Map<string, ImportedRecord | null> {
			override get(): ImportedRecord {
				return { path: 'other.md', versionMs: listed };
			}
		}
		const index: ImportedIndex = {
			...indexWith(),
			byInstant: new AnyKey(),
			byDay: new AnyKey(),
		};
		expect(rowState(recording, index)).toBe('new');
	});

	it('counts a note moved out of the output folder as imported', () => {
		expect(rowState(recording, indexWith(), new Set([NOTE_ID]))).toBe(
			'imported',
		);
	});

	it('is not ready while Comu is still processing', () => {
		const pending = parseNote({
			...LIST_ITEM,
			transcribeStatus: 1,
			summaryStatus: 1,
		});
		expect(rowState(pending, indexWith())).toBe('not-ready');
	});
});

describe('results view helpers', () => {
	const recording = parseNote(LIST_ITEM);

	it('explains every early stop and stays quiet on a full run', () => {
		expect(stopReason('auth-failed')).toMatch(/API key/);
		expect(stopReason('cancelled')).toMatch(/Stop import/);
		expect(stopReason('aborted')).toMatch(/closed/);
		expect(stopReason('completed')).toBeNull();
	});

	it('lists each recording with its outcome in the copied details', () => {
		const text = formatRunDetails(
			{
				stop: 'completed',
				processed: 2,
				results: [
					{
						kind: 'written',
						recording,
						writeOutcome: { status: 'created', path: 'Comu/a.md' },
					},
					{
						kind: 'failed',
						recording,
						reason: 'Comu returned HTTP 500',
						classification: {
							category: 'server-error',
							message: 'Comu returned HTTP 500',
							canRetry: true,
						},
						cause: new Error('x'),
					},
				],
			},
			2,
		);
		expect(text).toContain('Processed 2 of 2; ended: completed');
		expect(text).toContain('CREATED Weekly planning -> Comu/a.md');
		expect(text).toContain('FAILED Weekly planning');
		expect(text).toContain('[server-error]: Comu returned HTTP 500');
	});
});
