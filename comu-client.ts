// Client for Comu's official developer API (https://openapi.comu.com). It is
// read-only by design: Comu offers no create, update or delete endpoints, and
// this client calls only the documented query endpoints. Every request carries
// the user's API key (`kb_...`) as a Bearer token.

import { requestUrl, type RequestUrlParam } from 'obsidian';
import type {
	AdditionalSummary,
	Chapter,
	ErrorClassification,
	Recording,
	RecordingArtifacts,
	RecordingId,
	ServiceErrorPolicy,
	Summary,
	Transcript,
} from 'obsidian-recording-importer-core';
import {
	ComuParseError,
	extraSections,
	formatActionItems,
	parseAudioUrl,
	parseNotePage,
	parseOutline,
	parseSummary,
	parseTranscript,
	type NotePage,
} from './comu-parse';

export const COMU_API_BASE = 'https://openapi-api.comu.com/api/kirby';

/** The API key is missing, rejected or revoked. */
export class ComuAuthError extends Error {
	constructor(
		message: string,
		readonly missing = false,
	) {
		super(message);
		this.name = 'ComuAuthError';
	}
}

/** Comu answered with an HTTP error or `success: false`. */
export class ComuApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = 'ComuApiError';
	}
}

/** Comu's code for a missing or invalid credential (sent with HTTP 401). */
const CODE_BAD_TOKEN = 20400;
/** Comu could not check the account's membership just now; try again later. */
const CODE_ENTITLEMENT_UNAVAILABLE = 87602;

/** The key as pasted: surrounding space, quotes or a `Bearer ` prefix removed. */
export function normalizeKey(raw: string | null | undefined): string {
	let key = (raw ?? '').trim();
	if (key.startsWith('"') && key.endsWith('"') && key.length >= 2) {
		key = key.slice(1, -1).trim();
	}
	return key.replace(/^bearer\s+/i, '');
}

type Requester = (request: RequestUrlParam) => Promise<{
	status: number;
	json: unknown;
}>;

function messageOf(body: unknown): string {
	if (typeof body !== 'object' || body === null) return '';
	const b = body as Record<string, unknown>;
	const m = b['msg'] ?? b['message'];
	return typeof m === 'string' ? m : '';
}

/**
 * Check Comu's `{code, success, msg, data}` envelope and return `data`. A
 * response with `success: true` but `data: null` is what a malformed token gets
 * back, so it counts as an auth failure on the calls that always return data.
 */
export function unwrapEnvelope(
	status: number,
	body: unknown,
	requireData: boolean,
): unknown {
	const code =
		typeof body === 'object' && body !== null
			? (body as Record<string, unknown>)['code']
			: undefined;
	if (status === 401 || status === 403 || code === CODE_BAD_TOKEN) {
		throw new ComuAuthError(
			'Comu rejected the API key. Check it in the plugin settings; a revoked key, or a membership without Developers access, is refused.',
		);
	}
	if (status < 200 || status >= 300) {
		throw new ComuApiError(
			`Comu returned HTTP ${status}${messageOf(body) ? `: ${messageOf(body)}` : ''}`,
			status,
		);
	}
	if (typeof body !== 'object' || body === null) {
		throw new ComuParseError('Comu returned a response that is not JSON');
	}
	const b = body as Record<string, unknown>;
	if (code === CODE_ENTITLEMENT_UNAVAILABLE) {
		throw new ComuApiError(
			'Comu could not check your membership just now. Try again in a few minutes.',
			503,
		);
	}
	if (b['success'] !== true) {
		throw new ComuApiError(
			`Comu reported an error${messageOf(body) ? `: ${messageOf(body)}` : ''} (code ${String(code)})`,
			status,
		);
	}
	const data = b['data'];
	if (requireData && (data === null || data === undefined)) {
		throw new ComuAuthError(
			'Comu returned no data for this API key. Check the key in the plugin settings.',
		);
	}
	return data;
}

export class ComuClient {
	constructor(
		private readonly getKey: () => string,
		private readonly request: Requester = (r) => requestUrl(r),
	) {}

	private async call(
		method: 'GET' | 'POST',
		path: string,
		body: unknown,
		requireData: boolean,
	): Promise<unknown> {
		const key = normalizeKey(this.getKey());
		if (key.length === 0) {
			throw new ComuAuthError(
				'No Comu API key. Add one in the plugin settings.',
				true,
			);
		}
		const response = await this.request({
			url: `${COMU_API_BASE}${path}`,
			method,
			headers: {
				authorization: `Bearer ${key}`,
				...(body !== undefined
					? { 'content-type': 'application/json' }
					: {}),
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			throw: false,
		});
		let json: unknown;
		try {
			json = response.json;
		} catch {
			json = undefined;
		}
		return unwrapEnvelope(response.status, json, requireData);
	}

	private get(path: string, requireData = true): Promise<unknown> {
		return this.call('GET', path, undefined, requireData);
	}

	/** Confirms the key works. Resolves to nothing; throws on failure. */
	async testConnection(): Promise<void> {
		await this.listPage(1, 1, false);
	}

	async listPage(
		page: number,
		pageSize: number,
		trash: boolean,
	): Promise<NotePage> {
		const data = await this.call(
			'POST',
			'/v1/note/paging',
			{ page, pageSize, trash },
			true,
		);
		const result = parseNotePage(data);
		// The trash filter decides; items may not carry a flag of their own.
		return trash
			? {
					...result,
					recordings: result.recordings.map((r) => ({
						...r,
						isTrashed: true,
					})),
				}
			: result;
	}

	/** Every recording (and, when asked, the trash), as Comu lists them. */
	async listAll(
		includeTrashed: boolean,
		pageSize = 50,
	): Promise<Recording[]> {
		const all = await this.listEvery(false, pageSize);
		if (!includeTrashed) return all;
		// Newest first across both lists, so trash sits in date order.
		return [...all, ...(await this.listEvery(true, pageSize))].sort(
			(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
		);
	}

	private async listEvery(
		trash: boolean,
		pageSize: number,
	): Promise<Recording[]> {
		const all: Recording[] = [];
		for (let page = 1; ; page++) {
			const result = await this.listPage(page, pageSize, trash);
			all.push(...result.recordings);
			if (
				result.recordings.length < pageSize ||
				all.length >= result.total
			) {
				return all;
			}
		}
	}

	/** A temporary link to the recording's audio, or null when Comu has none. */
	async getAudioUrl(id: RecordingId): Promise<string | null> {
		const data = await this.call(
			'POST',
			'/v1/note/paging',
			{ page: 1, pageSize: 1, noteId: id, needGenTempAudioUrl: true },
			true,
		);
		return parseAudioUrl(data);
	}

	async getTranscript(id: RecordingId): Promise<Transcript | null> {
		return parseTranscript(
			id,
			await this.get(
				`/v1/note/queryTranscribeResult?noteId=${encodeURIComponent(id)}`,
				false,
			),
		);
	}

	async getArtifacts(id: RecordingId): Promise<RecordingArtifacts> {
		const q = `noteId=${encodeURIComponent(id)}`;
		const [transcript, summaryData, outlineData, todoData] =
			await Promise.all([
				this.getTranscript(id),
				this.get(`/v1/note/querySummary?${q}`, false),
				// A failed extra fails the whole recording on purpose: writing the
				// note without it would drop chapters or tasks an earlier import
				// saved, and mark the note current so it is not retried.
				this.get(`/v1/note/queryOutlines?${q}`, false),
				this.call(
					'POST',
					'/v1/todo/list/queryByNote',
					{ noteId: id },
					false,
				),
			]);
		const parsed = parseSummary(summaryData);
		const summary: Summary | null =
			parsed.summary !== null ? { id, text: parsed.summary } : null;
		const chapters: Chapter[] = parseOutline(outlineData);
		const extras: AdditionalSummary[] = extraSections(
			parsed.insights,
			formatActionItems(todoData),
		);
		return {
			transcript,
			summary,
			...(chapters.length > 0 ? { chapters } : {}),
			...(extras.length > 0 ? { additionalSummaries: extras } : {}),
		};
	}
}

/** Maps the client's errors onto the shared import categories. */
export const COMU_ERROR_POLICY: ServiceErrorPolicy = {
	pluginName: 'Comu Importer',
	classify(err: unknown): ErrorClassification | null {
		if (err instanceof ComuAuthError) {
			return {
				category: err.missing ? 'not-configured' : 'token-rejected',
				message: err.message,
				canRetry: false,
			};
		}
		if (err instanceof ComuApiError) {
			if (err.status === 429) {
				return {
					category: 'rate-limited',
					message:
						'Comu is limiting requests. Wait a minute and try again.',
					canRetry: true,
				};
			}
			return {
				category: err.status >= 500 ? 'server-error' : 'api-error',
				message: err.message,
				canRetry: err.status >= 500,
			};
		}
		if (err instanceof ComuParseError) {
			return {
				category: 'parse-error',
				message: `Comu sent data this plugin does not understand: ${err.message}`,
				canRetry: false,
			};
		}
		return null;
	},
	// The import list already skips recordings Comu has not processed, so no
	// error means "not processed yet".
	isUnprocessed: () => false,
};
