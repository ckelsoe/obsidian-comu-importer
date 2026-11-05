import type { App } from 'obsidian';
import type {
	ImportedIndex,
	ImportedRecord,
	RecordingArtifacts,
	RecordingId,
} from 'obsidian-recording-importer-core';
import type { ComuClient } from '../comu-client';
import { contentFingerprint } from '../content-fingerprint';
import { ImportService } from '../import-service';
import type { RecordingRenamer } from '../rename';
import { normalizeSettings } from '../settings';
import { parseNote } from '../comu-parse';
import { LIST_ITEM } from './fixtures';

const same: RecordingArtifacts = {
	transcript: null,
	summary: { id: 'a' as RecordingId, text: 'Same.' },
};
const edited: RecordingArtifacts = {
	transcript: null,
	summary: { id: 'b' as RecordingId, text: 'Edited.' },
};

function setup(stored: Record<string, string | undefined>) {
	const frontmatter: Record<string, Record<string, unknown>> = {};
	for (const [path, fp] of Object.entries(stored)) {
		frontmatter[path] = fp === undefined ? {} : { 'comu-content-hash': fp };
	}
	// The note text as a vault read returns it, frontmatter first.
	const text = (path: string): string => {
		const lines = Object.entries(frontmatter[path] ?? {}).map(
			([k, v]) => `${k}: ${String(v)}`,
		);
		return `---\n${lines.join('\n')}\n---\nbody`;
	};
	const app = {
		vault: {
			getFileByPath: (path: string) =>
				path in frontmatter ? { path } : null,
			read: (file: { path: string }) => Promise.resolve(text(file.path)),
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => ({
				frontmatter: frontmatter[file.path],
			}),
		},
		fileManager: {
			processFrontMatter: (
				file: { path: string },
				fn: (fm: Record<string, unknown>) => void,
			) => {
				fn(frontmatter[file.path] ?? {});
				return Promise.resolve();
			},
		},
	} as unknown as App;
	const client = {
		getArtifacts: (rid: string) =>
			rid === 'd'
				? Promise.reject(new Error('gateway'))
				: Promise.resolve(rid === 'b' ? edited : same),
		getVersionMs: () => Promise.resolve(42),
	} as unknown as ComuClient;
	const settings = normalizeSettings(undefined);
	const service = new ImportService(
		app,
		client,
		() => settings,
		() => Promise.resolve(),
		{} as RecordingRenamer,
	);
	return { service, frontmatter };
}

function index(paths: Record<string, string>): ImportedIndex {
	const byId = new Map<RecordingId, ImportedRecord>();
	for (const [rid, path] of Object.entries(paths)) {
		byId.set(rid as RecordingId, { path, versionMs: 1 });
	}
	return {
		byId,
		byInstant: new Map(),
		byDay: new Map(),
		canonicalId: (x) => x,
	};
}

const rec = (rid: string) => ({
	...parseNote(LIST_ITEM),
	id: rid as RecordingId,
});
const choice = { summary: true, transcript: true, audio: false };

const fpSame = (rid: string): string =>
	contentFingerprint(rec(rid), same, choice);

describe('checkForChanges', () => {
	it('keeps only recordings whose content changed, and refreshes the time on the rest', async () => {
		const { service, frontmatter } = setup({
			'a.md': fpSame('a'),
			'b.md': fpSame('b'),
			'c.md': undefined,
			'd.md': fpSame('d'),
		});
		const check = await service.checkForChanges(
			[rec('a'), rec('b'), rec('c'), rec('d')],
			choice,
			index({ a: 'a.md', b: 'b.md', c: 'c.md', d: 'd.md' }),
			() => false,
		);
		// a: same content. b: edited. c: an older note with no fingerprint.
		// d: could not be read; reported, and the others still checked.
		expect([...check.changed].sort()).toEqual(['b', 'c']);
		expect(check.failures.map((f) => f.recording.id)).toEqual(['d']);
		expect(frontmatter['a.md']?.['comu-version-ms']).toBe(42);
		expect(frontmatter['b.md']?.['comu-version-ms']).toBeUndefined();
	});

	it('stops when cancelled', async () => {
		const { service } = setup({ 'a.md': 'x' });
		const check = await service.checkForChanges(
			[rec('a')],
			choice,
			index({ a: 'a.md' }),
			() => true,
		);
		expect(check.changed.size).toBe(0);
	});
});
