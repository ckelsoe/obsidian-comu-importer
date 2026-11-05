import { isUsableToken, readToken } from '../comu-token';
import { isComuOrigin, probe as runProbe, tokenFromProbe } from '../comu-login';

const b64url = (s: string): string => Buffer.from(s).toString('base64url');

/** An unsigned JWT with the claims Comu's token carries. */
function jwt(claims: Record<string, unknown>): string {
	return `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(claims))}.sig`;
}

const NOW = Date.parse('2026-11-05T12:00:00Z');
const LIVE = jwt({
	sub: 'u1',
	email: 'me@example.com',
	exp: NOW / 1000 + 3600,
});
const EXPIRED = jwt({ sub: 'u1', exp: NOW / 1000 - 1 });

describe('readToken', () => {
	it('reads email and expiry, also from the quoted portal value', () => {
		for (const raw of [LIVE, `"${LIVE}"`, `Bearer ${LIVE}`]) {
			expect(readToken(raw)).toEqual({
				email: 'me@example.com',
				expiresAt: new Date(NOW + 3600 * 1000),
			});
		}
	});

	it('rejects values that are not a JWT with a subject', () => {
		expect(readToken('')).toBeNull();
		expect(readToken('abc.def')).toBeNull();
		expect(readToken('a.!!!.c')).toBeNull();
		expect(readToken(jwt({ email: 'x' }))).toBeNull();
	});
});

describe('isUsableToken', () => {
	it('accepts a live token and rejects an expired one', () => {
		expect(isUsableToken(LIVE, NOW)).toBe(true);
		expect(isUsableToken(EXPIRED, NOW)).toBe(false);
	});
});

describe('sign-in capture', () => {
	const probe = (href: string, raw: string | null) =>
		JSON.stringify({ href, raw });

	it('takes the token only from the https Comu web app', () => {
		expect(isComuOrigin('https://web.comu.com/all-files')).toBe(true);
		expect(isComuOrigin('http://web.comu.com/')).toBe(false);
		expect(isComuOrigin('https://web.comu.com.evil.test/')).toBe(false);
		expect(isComuOrigin('https://web.comu.com:8443/')).toBe(false);
		expect(isComuOrigin(undefined)).toBe(false);
	});

	it('returns the unquoted token once the user is signed in', () => {
		expect(
			tokenFromProbe(
				probe('https://web.comu.com/', JSON.stringify(LIVE)),
				NOW,
			),
		).toBe(LIVE);
	});

	it('keeps waiting while signed out, on another origin, or with an expired token', () => {
		expect(
			tokenFromProbe(probe('https://web.comu.com/login', null), NOW),
		).toBeNull();
		expect(
			tokenFromProbe(probe('https://accounts.google.com/', LIVE), NOW),
		).toBeNull();
		expect(
			tokenFromProbe(probe('https://web.comu.com/', EXPIRED), NOW),
		).toBeNull();
		expect(tokenFromProbe('not json', NOW)).toBeNull();
	});

	it('the in-page probe reads storage only on the Comu origin', () => {
		const run = (href: string, stored: string | null): unknown => {
			const url = new URL(href);
			let reads = 0;
			const out = runProbe(
				{ origin: url.origin, href },
				{
					getItem: () => {
						reads++;
						return stored;
					},
				},
			);
			return { out: JSON.parse(out) as unknown, reads };
		};
		expect(run('https://web.comu.com/x', '"t"')).toEqual({
			out: { href: 'https://web.comu.com/x', raw: '"t"' },
			reads: 1,
		});
		for (const href of [
			'https://other.test/',
			'https://web.comu.com:8443/',
		]) {
			expect(run(href, '"t"')).toEqual({
				out: { href, raw: null },
				reads: 0,
			});
		}
	});
});
