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
	ComuNotProcessedError,
	normalizeKey,
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

describe('normalizeKey', () => {
	it('trims quotes, space and a Bearer prefix from a pasted key', () => {
		expect(normalizeKey('"kb_abc"')).toBe('kb_abc');
		expect(normalizeKey('  Bearer kb_abc ')).toBe('kb_abc');
		expect(normalizeKey(null)).toBe('');
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

	it('reports a temporary membership-check failure as retryable', () => {
		expect(() =>
			unwrapEnvelope(
				200,
				{ code: 87602, success: false, data: null },
				true,
			),
		).toThrow(/membership/);
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

	it('sends the key as a Bearer token, never doubling the prefix', async () => {
		const server = fakeServer(() => ({
			status: 200,
			json: ok({ data: [], total: 0 }),
		}));
		await new ComuClient(() => '"kb_tok"', server.request).testConnection();
		// A key pasted with its scheme is not sent as "Bearer Bearer ...".
		await new ComuClient(
			() => 'Bearer kb_tok',
			server.request,
		).testConnection();
		for (const call of server.calls) {
			expect(call.headers).toEqual({
				authorization: 'Bearer kb_tok',
				'content-type': 'application/json',
			});
		}
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
		const all = await new ComuClient(() => 't', server.request).listAll(
			false,
			2,
		);
		expect(all.map((r) => r.id)).toEqual([NOTE_ID, 'b', 'c']);
		expect(server.calls).toHaveLength(2);
		expect(
			server.calls.every((c) => c.url.endsWith('/v1/note/paging')),
		).toBe(true);
	});

	it('adds the trash only when asked, marked as trashed', async () => {
		const server = fakeServer((req) => {
			const { trash } = JSON.parse(req.body as string) as {
				trash: boolean;
			};
			const items = trash
				? [
						{
							...LIST_ITEM,
							noteId: 'gone',
							startTime: '2026-11-04T08:00:00Z',
						},
					]
				: [LIST_ITEM];
			return { status: 200, json: ok({ data: items, total: 1 }) };
		});
		const client = new ComuClient(() => 't', server.request);
		expect((await client.listAll(false)).map((r) => r.id)).toEqual([
			NOTE_ID,
		]);
		const withTrash = await client.listAll(true);
		// Newest first across both lists: the newer trashed note comes first.
		expect(withTrash.map((r) => [r.id, r.isTrashed])).toEqual([
			['gone', true],
			[NOTE_ID, false],
		]);
	});

	it('asks the list for a temporary audio link for one note', async () => {
		const server = fakeServer(() => ({
			status: 200,
			json: ok({
				data: [{ ...LIST_ITEM, audioUrl: 'https://a.test/x.m4a' }],
				total: 1,
			}),
		}));
		expect(
			await new ComuClient(() => 't', server.request).getAudioUrl(id),
		).toBe('https://a.test/x.m4a');
		expect(JSON.parse(server.calls[0]?.body as string)).toEqual({
			page: 1,
			pageSize: 1,
			noteId: NOTE_ID,
			needGenTempAudioUrl: true,
		});
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

	it('calls only documented read endpoints on the official host', async () => {
		const server = fakeServer((req) => {
			const p = path(req);
			if (p === '/v1/note/paging')
				return {
					status: 200,
					json: ok({ data: [LIST_ITEM], total: 1 }),
				};
			return { status: 200, json: ok({}) };
		});
		const client = new ComuClient(() => 't', server.request);
		await client.testConnection();
		await client.listAll(true);
		await client.getArtifacts(id);
		await client.getAudioUrl(id);
		const paths = server.calls.map(path);
		expect(paths.some((p) => p.includes('update'))).toBe(false);
		expect(
			server.calls.every((c) =>
				c.url.startsWith('https://openapi-api.comu.com/api/kirby/v1/'),
			),
		).toBe(true);
		const posts = server.calls.filter((c) => c.method === 'POST').map(path);
		expect(new Set(posts)).toEqual(
			new Set(['/v1/note/paging', '/v1/todo/list/queryByNote']),
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

describe('missing permissions (HTTP 403)', () => {
	it('is not treated as a bad key, so a batch is not stopped as signed out', () => {
		let thrown: unknown;
		try {
			unwrapEnvelope(403, { code: 403, success: false }, true);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(ComuApiError);
		expect(classifyError(thrown, COMU_ERROR_POLICY).category).toBe(
			'api-error',
		);
	});

	it('fails the recording, with the reason, when the key cannot read action items', async () => {
		const server = fakeServer((req) => {
			const p = path(req);
			if (p === '/v1/todo/list/queryByNote')
				return { status: 403, json: {} };
			if (p === '/v1/note/querySummary')
				return { status: 200, json: ok(SUMMARY_DATA) };
			if (p === '/v1/note/queryOutlines')
				return { status: 200, json: ok(OUTLINE_DATA) };
			return { status: 200, json: ok(TRANSCRIPT_DATA) };
		});
		// Importing without them would delete the action items a note already has.
		await expect(
			new ComuClient(() => 't', server.request).getArtifacts(id),
		).rejects.toThrow(/action items/);
	});
});

describe('unprocessed recordings', () => {
	it('are reported as unprocessed, so the runner writes a placeholder', () => {
		const err = new ComuNotProcessedError();
		expect(COMU_ERROR_POLICY.isUnprocessed(err)).toBe(true);
		expect(COMU_ERROR_POLICY.isUnprocessed(new Error('x'))).toBe(false);
	});
});

describe('gateway errors', () => {
	const noWait = () => Promise.resolve();

	it('retries a 502, 503 or 504 up to twice', async () => {
		const statuses = [502, 504, 200];
		const server = fakeServer(() => {
			const status = statuses.shift() ?? 200;
			return {
				status,
				json: status === 200 ? ok({ data: [], total: 0 }) : {},
			};
		});
		await new ComuClient(
			() => 't',
			server.request,
			noWait,
		).testConnection();
		expect(server.calls).toHaveLength(3);
	});

	it('gives up after three attempts with the gateway error', async () => {
		const server = fakeServer(() => ({ status: 502, json: {} }));
		await expect(
			new ComuClient(() => 't', server.request, noWait).testConnection(),
		).rejects.toThrow(/502/);
		expect(server.calls).toHaveLength(3);
	});

	it('does not retry other errors', async () => {
		const server = fakeServer(() => ({ status: 500, json: {} }));
		await expect(
			new ComuClient(() => 't', server.request, noWait).testConnection(),
		).rejects.toThrow(/500/);
		expect(server.calls).toHaveLength(1);
	});

	it('fetches a recording one request at a time', async () => {
		let inFlight = 0;
		let most = 0;
		const request = async (req: { url: string }) => {
			inFlight++;
			most = Math.max(most, inFlight);
			await Promise.resolve();
			inFlight--;
			const p = req.url.slice(COMU_API_BASE.length).split('?')[0] ?? '';
			const data: Record<string, unknown> = {
				'/v1/note/queryTranscribeResult': TRANSCRIPT_DATA,
				'/v1/note/querySummary': SUMMARY_DATA,
				'/v1/note/queryOutlines': OUTLINE_DATA,
				'/v1/todo/list/queryByNote': TODO_DATA,
			};
			return { status: 200, json: ok(data[p]) };
		};
		await new ComuClient(() => 't', request).getArtifacts(id);
		expect(most).toBe(1);
	});
});

describe('getVersionMs', () => {
	it("reads the recording's current change time from the list", async () => {
		const server = fakeServer(() => ({
			status: 200,
			json: ok({
				data: [{ ...LIST_ITEM, updateTime: '2026-11-05T16:00:00Z' }],
				total: 1,
			}),
		}));
		expect(
			await new ComuClient(() => 't', server.request).getVersionMs(id),
		).toBe(Date.parse('2026-11-05T16:00:00Z'));
		expect(JSON.parse(server.calls[0]?.body as string)).toMatchObject({
			noteId: NOTE_ID,
		});
	});

	it('returns undefined when the list does not hold that recording', async () => {
		const server = fakeServer(() => ({
			status: 200,
			json: ok({ data: [], total: 0 }),
		}));
		expect(
			await new ComuClient(() => 't', server.request).getVersionMs(id),
		).toBeUndefined();
	});
});
