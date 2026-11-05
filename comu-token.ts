// Reads what a Comu token says about itself. Comu's token is a JWT with `sub`,
// `email`, `iat` and `exp` claims (seen 2026-11-04); nothing here verifies its
// signature, so these facts are for display and for rejecting obvious junk.
// Comu itself decides whether the token works (see ComuClient.testConnection).

import { normalizeToken } from './comu-client';

/** The fixed secret the plugin stores the token under. */
export const TOKEN_SECRET_ID = 'comu-importer-token';

export interface TokenInfo {
	readonly email: string | null;
	/** When the token stops working, or null if it carries no expiry. */
	readonly expiresAt: Date | null;
}

function decodeBase64Url(part: string): string | null {
	try {
		const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
		const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
		return decodeURIComponent(
			Array.from(
				atob(padded),
				(c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`,
			).join(''),
		);
	} catch {
		return null;
	}
}

/** The token's claims, or null when it is not a JWT with a subject. */
export function readToken(raw: string | null | undefined): TokenInfo | null {
	const parts = normalizeToken(raw).split('.');
	if (parts.length !== 3) return null;
	const json = decodeBase64Url(parts[1] ?? '');
	if (json === null) return null;
	let claims: unknown;
	try {
		claims = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof claims !== 'object' || claims === null) return null;
	const c = claims as Record<string, unknown>;
	if (typeof c['sub'] !== 'string' || c['sub'].length === 0) return null;
	const exp = c['exp'];
	return {
		email: typeof c['email'] === 'string' ? c['email'] : null,
		expiresAt:
			typeof exp === 'number' && Number.isFinite(exp)
				? new Date(exp * 1000)
				: null,
	};
}

/** A JWT with a subject that has not expired yet. */
export function isUsableToken(
	raw: string | null | undefined,
	now = Date.now(),
): boolean {
	const info = readToken(raw);
	return (
		info !== null &&
		(info.expiresAt === null || info.expiresAt.getTime() > now)
	);
}
