// In-app Comu sign-in (desktop only).
//
// Opens Comu's web app in its own Electron window, on a partition of its own
// per vault, so the user signs in on Comu's real page. The plugin never sees
// the password: once signed in, the web app stores its token in
// `localStorage.authorization`, and the plugin reads it from there. Same
// approach as Plaud Importer's sign-in window (plaud-login.ts), whose comments
// explain why a separate window and not an embedded <webview>.

import { Platform, type App } from 'obsidian';
import { normalizeToken } from './comu-client';
import { isUsableToken } from './comu-token';

const LOGIN_URL = 'https://web.comu.com/login';
const COMU_ORIGIN = 'https://web.comu.com';
const POLL_INTERVAL_MS = 1000;

/**
 * Runs in the sign-in window each poll, as `PROBE_JS`. Reads the token only on
 * Comu's own https origin, so a redirect elsewhere never has its storage read.
 * It is serialized with toString(), so it must reference nothing outside its
 * own body (hence the host literal here).
 */
export function probe(
	loc: { origin: string; href: string },
	storage: { getItem(key: string): string | null },
): string {
	try {
		const onComu = loc.origin === 'https://web.comu.com';
		return JSON.stringify({
			href: loc.href,
			raw: onComu ? storage.getItem('authorization') : null,
		});
	} catch (e) {
		return JSON.stringify({ error: String(e) });
	}
}

const PROBE_JS = `(${probe.toString()})(location, localStorage)`;

/** True for a page on Comu's web app over https. */
export function isComuOrigin(href: unknown): boolean {
	if (typeof href !== 'string') return false;
	try {
		return new URL(href).origin === COMU_ORIGIN;
	} catch {
		return false;
	}
}

/**
 * The token from one probe result, or null. The portal stores it JSON-quoted;
 * an expired or malformed value left in storage is ignored.
 */
export function tokenFromProbe(raw: unknown, now = Date.now()): string | null {
	if (typeof raw !== 'string') return null;
	let probe: unknown;
	try {
		probe = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof probe !== 'object' || probe === null) return null;
	const p = probe as Record<string, unknown>;
	if (!isComuOrigin(p['href']) || typeof p['raw'] !== 'string') return null;
	const token = normalizeToken(p['raw']);
	return isUsableToken(token, now) ? token : null;
}

interface SessionLike {
	clearStorageData?(): Promise<void>;
}
interface WebContentsLike {
	executeJavaScript(code: string): Promise<unknown>;
	listenerCount?(eventName: string): number;
	removeAllListeners?(eventName: string): unknown;
	setWindowOpenHandler?(
		handler: (details: { url: string }) => { action: 'deny' | 'allow' },
	): void;
}
interface BrowserWindowLike {
	webContents: WebContentsLike;
	on(event: string, listener: () => void): void;
	loadURL(url: string): Promise<void>;
	close(): void;
	isDestroyed(): boolean;
}
interface ElectronRemoteLike {
	session?: { fromPartition(partition: string): SessionLike };
	BrowserWindow?: new (options: {
		width?: number;
		height?: number;
		title?: string;
		autoHideMenuBar?: boolean;
		webPreferences?: { partition?: string };
	}) => BrowserWindowLike;
	createFunctionWithReturnValue?<T>(this: void, value: T): () => T;
}

function electronRemote(): ElectronRemoteLike | null {
	const req = (window as { require?: (id: string) => unknown }).require;
	if (typeof req !== 'function') return null;
	try {
		const electron = req('electron') as { remote?: ElectronRemoteLike };
		return electron.remote ?? null;
	} catch {
		return null;
	}
}

/** Whether this device can open the sign-in window. */
export function canOpenSignIn(): boolean {
	return (
		Platform.isDesktopApp && electronRemote()?.BrowserWindow !== undefined
	);
}

/** One sign-in partition per vault, so vaults keep separate Comu sessions. */
function partitionFor(app: App): string {
	const id = /^[A-Za-z0-9]+$/.test(app.appId ?? '') ? app.appId : 'default';
	return `persist:comu-importer-${id}`;
}

/** A sign-in in progress. `cancel()` closes the window and resolves null. */
export interface SignIn {
	readonly result: Promise<string | null>;
	cancel(): void;
}

/**
 * Open the sign-in window. Resolves with the token once the user has signed
 * in, or null when they close the window or it cannot open.
 */
export function openSignIn(app: App): SignIn {
	let resolveResult: (token: string | null) => void = () => undefined;
	const result = new Promise<string | null>((resolve) => {
		resolveResult = resolve;
	});
	let win: BrowserWindowLike | null = null;
	let timer: number | null = null;
	let settled = false;

	const settle = (token: string | null): void => {
		if (settled) return;
		settled = true;
		if (timer !== null) window.clearInterval(timer);
		timer = null;
		try {
			if (win !== null && !win.isDestroyed()) win.close();
		} catch {
			// Already closing.
		}
		resolveResult(token);
	};

	const remote = electronRemote();
	const BrowserWindow = remote?.BrowserWindow;
	if (!Platform.isDesktopApp || BrowserWindow === undefined) {
		settle(null);
		return { result, cancel: () => settle(null) };
	}
	try {
		win = new BrowserWindow({
			width: 520,
			height: 760,
			title: 'Comu sign-in',
			autoHideMenuBar: true,
			webPreferences: { partition: partitionFor(app) },
		});
	} catch (err) {
		console.error('Comu importer: could not open the sign-in window', err);
		settle(null);
		return { result, cancel: () => settle(null) };
	}
	const contents = win.webContents;
	// Obsidian sends navigation away from its own pages to the system browser.
	// Remove that guard from this window only, or Comu's login redirects open
	// browser tabs. Fail closed if it cannot be removed.
	try {
		contents.removeAllListeners?.('will-navigate');
		if ((contents.listenerCount?.('will-navigate') ?? 0) !== 0) {
			throw new Error('navigation guard still attached');
		}
	} catch (err) {
		console.error('Comu importer: sign-in window cannot navigate', err);
		settle(null);
		return { result, cancel: () => settle(null) };
	}
	// Deny popups. The deny must reach Electron synchronously, which a plain
	// renderer callback cannot do across the remote bridge.
	try {
		const sync = remote?.createFunctionWithReturnValue;
		contents.setWindowOpenHandler?.(
			typeof sync === 'function'
				? sync({ action: 'deny' as const })
				: () => ({ action: 'deny' }),
		);
	} catch (err) {
		console.error('Comu importer: could not block popups', err);
	}
	win.on('closed', () => {
		win = null;
		settle(null);
	});
	win.loadURL(LOGIN_URL).catch((err: unknown) => {
		console.error('Comu importer: could not load the sign-in page', err);
	});

	const poll = async (): Promise<void> => {
		if (settled || win === null) return;
		let raw: unknown = null;
		try {
			raw = await win.webContents.executeJavaScript(PROBE_JS);
		} catch {
			// Page mid-navigation; try again next tick.
		}
		if (settled) return;
		const token = tokenFromProbe(raw);
		if (token !== null) settle(token);
	};
	timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
	void poll();
	return { result, cancel: () => settle(null) };
}

/** Forget the sign-in window's Comu session (used by Sign out). */
export async function clearSignInSession(app: App): Promise<void> {
	const session = electronRemote()?.session?.fromPartition(partitionFor(app));
	await session?.clearStorageData?.();
}
