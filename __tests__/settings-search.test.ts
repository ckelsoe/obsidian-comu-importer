// Obsidian's settings search finds a setting by its name, description and
// aliases. A section drawn by hand has none of those unless it is given them,
// so every one of them except the footer must carry a name and be searchable.
// A setting that only matters while another is on is hidden until it does.

import type { App } from 'obsidian';
import type ComuImporterPlugin from '../main';
import { DEFAULT_SETTINGS, type ComuImporterSettings } from '../settings';
import { ComuSettingTab } from '../settings-tab';

interface Item {
	type?: string;
	name?: string;
	desc?: unknown;
	aliases?: unknown;
	searchable?: boolean;
	visible?: () => boolean;
	render?: unknown;
	items?: Item[];
}

function leaves(items: Item[]): Item[] {
	return items.flatMap((i) => (i.items ? leaves(i.items) : [i]));
}

function setup() {
	const settings: ComuImporterSettings = structuredClone(DEFAULT_SETTINGS);
	const plugin = {
		settings,
		saveSettings: () => Promise.resolve(),
		updateRibbonIcon: () => undefined,
		reconcileAutoSync: () => undefined,
	} as unknown as ComuImporterPlugin;
	const tab = new ComuSettingTab({} as App, plugin);
	const items = leaves(tab.getSettingDefinitions() as unknown as Item[]);
	const byName = (name: string): Item => {
		const found = items.find((i) => i.name === name);
		if (!found) throw new Error(`no setting named ${name}`);
		return found;
	};
	return { settings, tab, items, byName };
}

describe('settings search', () => {
	it('gives every hand-drawn section a name and makes it searchable, except the footer', () => {
		const { items } = setup();
		const custom = items.filter((i) => i.render !== undefined && !i.type);
		// Obsidian treats an absent `searchable` as true.
		const hidden = custom.filter((i) => i.searchable === false);
		expect(hidden.map((i) => i.name)).toEqual(['About']);
		for (const i of custom.filter((c) => c.searchable !== false)) {
			// toMatch fails on a missing name as well as an empty one.
			expect(i.name).toMatch(/\S/);
			expect(typeof i.desc).toBe('string');
			expect(Array.isArray(i.aliases)).toBe(true);
		}
	});

	it('finds the sections people look for by name', () => {
		const names = setup().items.map((i) => i.name);
		for (const n of [
			'API key',
			'Status',
			'Subfolder template',
			'Note name template',
			'Extra frontmatter',
			'Ribbon icon',
		])
			expect(names).toContain(n);
	});

	it.each([
		['My tags', 'tagMode', 'custom', 'none'],
		['Countdown', 'autoCloseSummary', true, false],
		['Interval', 'autoSyncEnabled', true, false],
		['Ribbon icon', 'showRibbonIcon', true, false],
	] as const)(
		'shows %s only while %s applies, and re-evaluates it in place on change',
		async (name, key, on, off) => {
			const { settings, tab, byName } = setup();
			const visible = byName(name).visible;
			expect(visible).toBeTypeOf('function');
			const update = vi.spyOn(tab, 'update');
			const refresh = vi.spyOn(tab, 'refreshDomState');

			await tab.setControlValue(key, off);
			expect(settings[key]).toBe(off);
			expect(visible?.()).toBe(false);
			await tab.setControlValue(key, on);
			expect(visible?.()).toBe(true);
			expect(refresh).toHaveBeenCalledTimes(2);
			// A full rebuild would drop an unsaved API key in the render row.
			expect(update).not.toHaveBeenCalled();
		},
	);

	it('does not refresh for a setting nothing depends on', async () => {
		const { tab } = setup();
		const update = vi.spyOn(tab, 'update');
		const refresh = vi.spyOn(tab, 'refreshDomState');
		await tab.setControlValue('includeAudio', true);
		expect(update).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});
});
