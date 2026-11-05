import {
	bookmarkSetupHtml,
	buildBookmarklet,
	deliverToken,
	tokenFromPaste,
} from '../comu-bookmarklet';

const TOKEN = 'aaa.bbb.ccc';

function run(origin: string, stored: string | null, focused = false) {
	const opened: string[] = [];
	const asked: [string, string][] = [];
	const pending: (() => void)[] = [];
	const result = deliverToken(
		{ origin },
		{ getItem: () => stored },
		(u) => opened.push(u),
		(m, v) => asked.push([m, v]),
		(fn) => pending.push(fn),
		() => focused,
		'My vault',
	);
	for (const fn of pending) fn();
	return { result, opened, asked };
}

describe('deliverToken (the bookmark)', () => {
	it('sends the token to this vault from the stored "Bearer …" value', () => {
		const { opened, asked } = run(
			'https://web.comu.com',
			JSON.stringify(`Bearer ${TOKEN}`),
		);
		expect(opened).toEqual([
			`obsidian://comu-importer-token?vault=My%20vault&token=${TOKEN}`,
		]);
		expect(asked).toEqual([]);
	});

	it('offers the line to copy when Obsidian did not take the link', () => {
		const { opened, asked } = run('https://web.comu.com', TOKEN, true);
		expect(asked).toHaveLength(1);
		expect(asked[0]?.[1]).toBe(opened[0]);
	});

	it('refuses other sites, other ports and a signed-out page', () => {
		expect(run('https://example.com', TOKEN).result).toBe('wrong-site');
		expect(run('https://web.comu.com:8443', TOKEN).result).toBe(
			'wrong-site',
		);
		const out = run('https://web.comu.com', null);
		expect(out.result).toBe('no-token');
		expect(out.opened).toEqual([]);
	});
});

describe('buildBookmarklet', () => {
	it('is a javascript: URL that runs deliverToken for the vault', () => {
		const url = buildBookmarklet('Notes "work"');
		expect(url.startsWith('javascript:')).toBe(true);
		const code = decodeURIComponent(url.slice('javascript:'.length));
		// Yields undefined, so the browser never replaces the page with text.
		expect(code.startsWith('void (')).toBe(true);
		expect(code).toContain('https://web.comu.com');
		expect(code.endsWith(',"Notes \\"work\\"")')).toBe(true);
	});
});

describe('tokenFromPaste', () => {
	it('takes the token from the bookmark fallback line for this vault only', () => {
		const line = `obsidian://comu-importer-token?vault=v&token=${encodeURIComponent(TOKEN)}`;
		expect(tokenFromPaste(` ${line} `, 'v')).toBe(TOKEN);
		// A line made for another vault is refused, like the link handler does.
		expect(tokenFromPaste(line, 'other')).toBe('');
		expect(
			tokenFromPaste(`obsidian://open?vault=v&token=${TOKEN}`, 'v'),
		).toBe('');
	});

	it('passes anything else through for the token check', () => {
		expect(tokenFromPaste(`  "Bearer ${TOKEN}" `, 'v')).toBe(
			`"Bearer ${TOKEN}"`,
		);
	});
});

describe('bookmarkSetupHtml', () => {
	it('escapes the vault name and the bookmark', () => {
		const html = bookmarkSetupHtml('<b>"x"</b>');
		expect(html).not.toContain('<b>"x"</b>');
		expect(html).toContain('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
		expect(html).toMatch(/href="javascript:[^"]+"/);
	});
});
