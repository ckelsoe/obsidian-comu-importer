import type { App } from 'obsidian';
import { ComuClient } from '../comu-client';
import { ImportService, isEmptyChoice } from '../import-service';
import type { RecordingRenamer } from '../rename';
import { normalizeSettings } from '../settings';

function service(): ImportService {
	const settings = normalizeSettings(undefined);
	return new ImportService(
		{} as App,
		new ComuClient(() => ''),
		() => settings,
		() => Promise.resolve(),
		{} as RecordingRenamer,
	);
}

const run = (s: ImportService, audio = true) =>
	s.run({
		recordings: [],
		choice: { summary: false, transcript: false, audio },
		onDuplicate: 'skip',
		index: () => null,
		cancelled: () => false,
	});

describe('ImportService', () => {
	it('lets one import or sync hold the lock at a time', () => {
		const s = service();
		expect(s.tryLock()).toBe(true);
		expect(s.tryLock()).toBe(false);
		s.unlock();
		expect(s.tryLock()).toBe(true);
	});

	it('refuses to run without the lock', async () => {
		await expect(run(service())).rejects.toThrow(/Another import/);
	});

	it('refuses a run that would import nothing, so no note is emptied', async () => {
		const s = service();
		s.tryLock();
		await expect(run(s, false)).rejects.toThrow(/Nothing to import/);
		expect(
			isEmptyChoice({ summary: false, transcript: false, audio: false }),
		).toBe(true);
		expect(
			isEmptyChoice({ summary: false, transcript: true, audio: false }),
		).toBe(false);
	});
});
