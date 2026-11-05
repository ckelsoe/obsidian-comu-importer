// Browser sign-in for accounts whose Google or Apple login will not run in the
// in-app window. The user signs in to Comu in their own browser and clicks a
// bookmark, which reads the token from the page and hands it to Obsidian
// through an obsidian:// link. Same flow as Plaud Importer's bookmarklet.

/** obsidian:// action the bookmark opens; registered in main.ts. */
export const TOKEN_LINK_ACTION = 'comu-importer-token';

/**
 * The bookmark's body. Runs on the user's web.comu.com tab, so it is
 * serialized with toString() and must use nothing outside its parameters.
 * Returns what it did, for tests.
 */
export function deliverToken(
	loc: { origin: string },
	storage: { getItem(key: string): string | null },
	open: (url: string) => void,
	ask: (message: string, value: string) => void,
	later: (fn: () => void, ms: number) => unknown,
	focused: () => boolean,
	vault: string,
): string {
	try {
		if (loc.origin !== 'https://web.comu.com') {
			ask(
				'Open this on your web.comu.com tab after signing in, then click the bookmark again.',
				'',
			);
			return 'wrong-site';
		}
		let raw = storage.getItem('authorization') ?? '';
		try {
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed === 'string') raw = parsed;
		} catch {
			// Stored without JSON quotes.
		}
		const token = raw.trim().replace(/^bearer\s+/i, '');
		if (token.split('.').length !== 3) {
			ask(
				'No Comu sign-in found on this page. Sign in, then click the bookmark again.',
				'',
			);
			return 'no-token';
		}
		const url = `obsidian://comu-importer-token?vault=${encodeURIComponent(vault)}&token=${encodeURIComponent(token)}`;
		open(url);
		// Still focused a moment later: Obsidian did not take the link.
		later(() => {
			if (focused()) {
				ask(
					'If Obsidian did not open, copy this whole line, then click Paste from clipboard in the plugin settings:',
					url,
				);
			}
		}, 1500);
		return url;
	} catch (e) {
		ask(`Could not read the Comu sign-in: ${String(e)}`, '');
		return 'error';
	}
}

/** The `javascript:` bookmark for one vault. */
export function buildBookmarklet(vault: string): string {
	// `void`: a javascript: URL that yields a string replaces the page with it,
	// which would show the token link on screen.
	const code = `void (${deliverToken.toString()})(location,localStorage,function(u){location.replace(u)},function(m,v){prompt(m,v)},setTimeout,function(){return document.hasFocus()},${JSON.stringify(vault)})`;
	return `javascript:${encodeURIComponent(code)}`;
}

/**
 * The token from pasted text: a bare token, the portal's stored value, or the
 * whole obsidian:// line the bookmark shows when Obsidian did not open. That
 * line counts only when it was made for `vault`, as the link handler requires.
 */
export function tokenFromPaste(text: string, vault: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith('obsidian:')) return trimmed;
	try {
		const url = new URL(trimmed);
		if (
			url.hostname !== TOKEN_LINK_ACTION ||
			url.searchParams.get('vault') !== vault
		) {
			return '';
		}
		return url.searchParams.get('token') ?? '';
	} catch {
		return '';
	}
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** The one-time page with the bookmark to drag onto the bookmarks bar. */
export function bookmarkSetupHtml(vault: string): string {
	return [
		'<!doctype html>',
		'<html lang="en"><head><meta charset="utf-8">',
		'<title>Comu Importer bookmark setup</title>',
		'<style>',
		'body{font-family:system-ui,sans-serif;max-width:620px;margin:48px auto;padding:0 24px;line-height:1.55;color:#1a1a1a}',
		'h1{font-size:1.35rem}',
		'.bm{display:inline-block;padding:12px 22px;background:#5b46f2;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:1.05rem;cursor:grab}',
		'.note{color:#555;font-size:0.95rem}',
		'</style></head><body>',
		'<h1>Comu Importer: one-time setup</h1>',
		"<p><strong>Drag this button up onto your browser's bookmarks bar:</strong></p>",
		`<p><a class="bm" href="${escapeHtml(buildBookmarklet(vault))}">Comu → Obsidian</a></p>`,
		'<p class="note">Bookmarks bar hidden? Press Ctrl+Shift+B (Cmd+Shift+B on Mac) to show it, then drag the button onto it.</p>',
		`<p class="note">This bookmark signs in your <strong>${escapeHtml(vault)}</strong> vault. Set it up again from another vault to make a bookmark for that one.</p>`,
		'<hr><p>Each time you need to sign in:</p>',
		'<ol>',
		'<li>Sign in at <a href="https://web.comu.com">web.comu.com</a> in this browser, with Apple, Google or email.</li>',
		'<li>On that tab, click the bookmark. Obsidian opens and saves your sign-in.</li>',
		'</ol>',
		'<p class="note">If Obsidian does not open, the bookmark shows a line of text. Copy all of it, switch to Obsidian, and click Paste from clipboard in the plugin settings.</p>',
		'</body></html>',
	].join('');
}
