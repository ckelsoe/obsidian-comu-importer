import type { RequestUrlParam } from 'obsidian';
import {
	classifyError,
	type RecordingId,
} from 'obsidian-recording-importer-core';
import {
	COMU_API_BASE,
	COMU_ERROR_POLICY,
	ComuApiError,
	ComuAuthError,
	ComuClient,
	normalizeToken,
	unwrapEnvelope,
} from '../comu-client';
import { ComuParseError } from '../comu-parse';
import { asyncResult } from './helpers/async-result';
import {
	LIST_ITEM,
	NOTE_ID,
	OUTLINE_DATA,
	SUMMARY_DATA,
	TODO_DATA,
	TRANSCRIPT_DATA,
	ok,
} from './fixtures';

type Route = (req: RequestUrlParam) => { status: number; json: unknown };

function fakeServer(route: Route) {
	const calls: RequestUrlParam[] = [];
	const request = (req: RequestUrlParam) =>
		asyncResult(() => {
			calls.push(req);
			return route(req);
		});
	return { calls, request };
}

const path = (req: RequestUrlParam): string =>
	req.url.slice(COMU_API_BASE.length).split('?')[0] ?? '';

const id = NOTE_ID as RecordingId;

describe('normalizeToken', () => {
	it('unwraps the JSON-quoted value the portal stores', () => {
		expect(normalizeToken('"eyJabc"')).toBe('eyJabc');
		expect(normalizeToken('  Bearer eyJabc ')).toBe('eyJabc');
		expect(normalizeToken(null)).toBe('');
	});
});

describe('unwrapEnvelope', () => {
	it('returns data on success', () => {
		expect(unwrapEnvelope(200, ok({ a: 1 }), true)).toEqual({ a: 1 });
	});

	it('treats 401 and code 20400 as an auth failure', () => {
		const body = {
			code: 20400,
			success: false,
			message: 'Missing authorization token',
			data: null,
		};
		expect(() => unwrapEnvelope(401, body, true)).toThrow(ComuAuthError);
		expect(() => unwrapEnvelope(200, body, true)).toThrow(ComuAuthError);
	});

	it('treats success with null data as an auth failure when data is required', () => {
		expect(() => unwrapEnvelope(200, ok(null), true)).toThrow(
			ComuAuthError,
		);
		expect(unwrapEnvelope(200, ok(null), false)).toBeNull();
	});

	it('reports HTTP and envelope errors', () => {
		expect(() => unwrapEnvelope(500, {}, true)).toThrow(ComuApiError);
		expect(() =>
			unwrapEnvelope(200, { success: false, code: 5 }, true),
		).toThrow(ComuApiError);
		expect(() => unwrapEnvelope(200, undefined, true)).toThrow(
			ComuParseError,
		);
	});
});

describe('ComuClient', () => {
	it('fails before any request when there is no token', async () => {
		const server = fakeServer(() => ({ status: 200, json: ok({}) }));
		const client = new ComuClient(() => '', server.request);
		await expect(client.testConnection()).rejects.toMatchObject({
			missing: true,
		});
		expect(server.calls).toHaveLength(0);
	});

	it('sends only the unwrapped token as the authorization header', async () => {
		const server = fakeServer(() => ({ status: 200, json: ok({}) }));
		await new ComuClient(() => '"tok"', server.request).testConnection();
		// The portal's stored form already carries the scheme; it is not doubled.
		await new ComuClient(
			() => 'Bearer tok',
			server.request,
		).testConnection();
		expect(server.calls[1]?.headers).toEqual({
			authorization: 'Bearer tok',
		});
		expect(server.calls[0]?.headers).toEqual({
			authorization: 'Bearer tok',
		});
	});

	it('pages until it has every recording', async () => {
		const server = fakeServer((req) => {
			const { page } = JSON.parse(req.body as string) as { page: number };
			const items =
				page === 1
					? [LIST_ITEM, { ...LIST_ITEM, noteId: 'b' }]
					: [{ ...LIST_ITEM, noteId: 'c' }];
			return { status: 200, json: ok({ data: items, total: 3 }) };
		});
		const all = await new ComuClient(() => 't', server.request).listAll(2);
		expect(all.map((r) => r.id)).toEqual([NOTE_ID, 'b', 'c']);
		expect(server.calls).toHaveLength(2);
	});

	it('assembles artifacts from the four endpoints', async () => {
		const server = fakeServer((req) => {
			const data: Record<string, unknown> = {
				'/v1/note/queryTranscribeResult': TRANSCRIPT_DATA,
				'/v1/note/querySummary': SUMMARY_DATA,
				'/v1/note/queryOutlines': OUTLINE_DATA,
				'/v1/todo/list/queryByNote': TODO_DATA,
			};
			return { status: 200, json: ok(data[path(req)]) };
		});
		const a = await new ComuClient(() => 't', server.request).getArtifacts(
			id,
		);
		expect(a.transcript?.segments).toHaveLength(2);
		expect(a.summary?.text).toContain('A short planning call.');
		expect(a.chapters).toHaveLength(2);
		expect(a.additionalSummaries?.map((s) => s.heading)).toEqual([
			'Insights',
			'Action items',
		]);
	});

	it('fails the recording when an extra fails, so nothing saved is dropped', async () => {
		const server = fakeServer((req) => {
			const p = path(req);
			if (p === '/v1/todo/list/queryByNote')
				return { status: 500, json: {} };
			if (p === '/v1/note/querySummary')
				return { status: 200, json: ok(SUMMARY_DATA) };
			if (p === '/v1/note/queryOutlines')
				return { status: 200, json: ok(OUTLINE_DATA) };
			return { status: 200, json: ok(TRANSCRIPT_DATA) };
		});
		await expect(
			new ComuClient(() => 't', server.request).getArtifacts(id),
		).rejects.toBeInstanceOf(ComuApiError);
	});

	it('never writes to the Comu account', async () => {
		const server = fakeServer((req) => {
			const p = path(req);
			if (p === '/v2/note/paging')
				return {
					status: 200,
					json: ok({ data: [LIST_ITEM], total: 1 }),
				};
			if (p === '/v2/note/noteDetail')
				return {
					status: 200,
					json: ok({ audioUrl: 'https://a.test/x.m4a' }),
				};
			return { status: 200, json: ok({}) };
		});
		const client = new ComuClient(() => 't', server.request);
		await client.testConnection();
		await client.listAll();
		await client.getArtifacts(id);
		await client.getAudioUrl(id);
		const paths = server.calls.map(path);
		expect(paths.some((p) => p.includes('update'))).toBe(false);
		const posts = server.calls.filter((c) => c.method === 'POST').map(path);
		expect(new Set(posts)).toEqual(
			new Set(['/v2/note/paging', '/v1/todo/list/queryByNote']),
		);
	});
});

describe('COMU_ERROR_POLICY', () => {
	it('maps client errors onto shared categories', () => {
		const cat = (e: unknown) =>
			classifyError(e, COMU_ERROR_POLICY).category;
		expect(cat(new ComuAuthError('x', true))).toBe('not-configured');
		expect(cat(new ComuAuthError('x'))).toBe('token-rejected');
		expect(cat(new ComuApiError('x', 429))).toBe('rate-limited');
		expect(cat(new ComuApiError('x', 503))).toBe('server-error');
		expect(cat(new ComuApiError('x', 400))).toBe('api-error');
		expect(cat(new ComuParseError('x'))).toBe('parse-error');
	});
});
