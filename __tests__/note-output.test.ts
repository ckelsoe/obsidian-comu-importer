// The note a Comu recording becomes, end to end through the shared writer.
// The snapshot is the stored format: frontmatter keys and markers must not
// change once users have notes.
import { NoteWriter, type RecordingId } from 'obsidian-recording-importer-core';
import { ComuClient } from '../comu-client';
import { COMU_PROFILE } from '../comu-profile';
import { parseNote } from '../comu-parse';
import { insertAudioSection } from '../audio-pipeline';
import { makeFakeVault } from './helpers/fake-vault';
import { asyncResult } from './helpers/async-result';
import { defined } from './helpers/checked';
import { COMU_API_BASE } from '../comu-client';
import {
	LIST_ITEM,
	NOTE_ID,
	OUTLINE_DATA,
	SUMMARY_DATA,
	TODO_DATA,
	TRANSCRIPT_DATA,
	ok,
} from './fixtures';

const BY_PATH: Record<string, unknown> = {
	'/v1/note/queryTranscribeResult': TRANSCRIPT_DATA,
	'/v1/note/querySummary': SUMMARY_DATA,
	'/v1/note/queryOutlines': OUTLINE_DATA,
	'/v1/todo/list/queryByNote': TODO_DATA,
};

async function renderNote(existing?: string): Promise<string> {
	const client = new ComuClient(
		() => 't',
		(req) =>
			asyncResult(() => ({
				status: 200,
				json: ok(
					BY_PATH[
						req.url.slice(COMU_API_BASE.length).split('?')[0] ?? ''
					],
				),
			})),
	);
	const recording = parseNote(LIST_ITEM);
	const a = await client.getArtifacts(NOTE_ID as RecordingId);
	const vault = makeFakeVault();
	if (existing !== undefined) {
		vault.files.set('Comu/2026-11-03 Weekly planning.md', existing);
	}
	const writer = new NoteWriter(vault, {
		profile: COMU_PROFILE,
		outputFolder: 'Comu',
		onDuplicate: 'overwrite',
		fallbackTimezone: 'UTC',
	});
	const outcome = await writer.writeNote(
		recording,
		a.transcript,
		a.summary,
		a.chapters,
		{
			includeTranscript: true,
			includeSummary: true,
			additionalSummaries: a.additionalSummaries,
		},
	);
	if (existing !== undefined) {
		expect(vault.files.get('Comu/2026-11-03 Weekly planning.md')).toBe(
			existing,
		);
		expect(outcome.path).toBe('Comu/2026-11-03 Weekly planning 2.md');
	}
	return defined(vault.files.get(outcome.path));
}

describe('Comu note output', () => {
	it('matches the stored format', async () => {
		expect(await renderNote()).toMatchSnapshot();
	});

	it('never overwrites a note of the same name that it did not write', async () => {
		const note = await renderNote('# My own planning notes\n');
		expect(note).toContain('comu-id:');
	});

	it('carries the Comu id, change marker and link', async () => {
		const note = await renderNote();
		expect(note).toContain(`comu-id: "${NOTE_ID}"`);
		expect(note).toContain(
			`https://web.comu.com/all-files/note/${NOTE_ID}`,
		);
		expect(note).toContain('## Insights\n\n### Key points');
		expect(note).toContain('## Summary\n\n### Overview of the call');
		expect(note).toContain('- [ ] Send the agenda (Sam)');
		expect(note).not.toMatch(/plaud/i);
	});

	it('puts the audio section above the transcript divider', () => {
		const body = insertAudioSection(
			'## Summary\n\ntext\n\n---\n\n#### Transcript',
			'a/x.m4a',
		);
		expect(body).toBe(
			'## Summary\n\ntext\n\n<!-- comu:audio:start -->\n## Audio\n\n![[a/x.m4a]]\n<!-- comu:audio:end -->\n\n---\n\n#### Transcript',
		);
		// Re-import replaces the section instead of adding a second one.
		const again = insertAudioSection(body, 'a/y.m4a');
		expect(again.match(/## Audio/g)).toHaveLength(1);
		expect(again).toContain('![[a/y.m4a]]');
	});

	it('leaves a section the user or Comu called Audio alone', () => {
		const body = '## Audio\n\nmy notes\n\n---\n\nT';
		const out = insertAudioSection(body, 'a/x.m4a');
		expect(out).toContain('## Audio\n\nmy notes');
		expect(out.match(/## Audio/g)).toHaveLength(2);
	});
});
