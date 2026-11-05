// Read-only client for Comu's private web API. Every call sends only the
// `authorization` header the web portal uses. The client never calls
// `updateNote`: the portal uses it to mark notes read, and this plugin makes no
// write to the Comu account.

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

export const COMU_API_BASE = 'https://api.comu.com/api/kirby';

/** The token is missing, rejected or expired. */
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

/** Comu's code for a missing or invalid token (sent with HTTP 401). */
const CODE_BAD_TOKEN = 20400;

/**
 * The web portal stores the token JSON-quoted (`"eyJ..."`). Accept a pasted
 * value either way, and an optional `Bearer ` prefix.
 */
export function normalizeToken(raw: string | null | undefined): string {
	let token = (raw ?? '').trim();
	if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
		token = token.slice(1, -1).trim();
	}
	return token.replace(/^bearer\s+/i, '');
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
			'Comu rejected the token. Paste a fresh token in the plugin settings.',
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
	if (b['success'] !== true) {
		throw new ComuApiError(
			`Comu reported an error${messageOf(body) ? `: ${messageOf(body)}` : ''} (code ${String(code)})`,
			status,
		);
	}
	const data = b['data'];
	if (requireData && (data === null || data === undefined)) {
		throw new ComuAuthError(
			'Comu returned no data. The token may be pasted incorrectly; paste it again in the plugin settings.',
		);
	}
	return data;
}

export class ComuClient {
	constructor(
		private readonly getToken: () => string,
		private readonly request: Requester = (r) => requestUrl(r),
	) {}

	private async call(
		method: 'GET' | 'POST',
		path: string,
		body: unknown,
		requireData: boolean,
	): Promise<unknown> {
		const token = normalizeToken(this.getToken());
		if (token.length === 0) {
			throw new ComuAuthError(
				'No Comu token. Add one in the plugin settings.',
				true,
			);
		}
		const response = await this.request({
			url: `${COMU_API_BASE}${path}`,
			method,
			headers: {
				authorization: token,
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

	/** Confirms the token works. Resolves to nothing; throws on failure. */
	async testConnection(): Promise<void> {
		await this.get('/v1/user/queryInfo');
	}

	async listPage(page: number, pageSize: number): Promise<NotePage> {
		const data = await this.call(
			'POST',
			'/v2/note/paging',
			{ page, pageSize, viewType: 'ALL' },
			true,
		);
		return parseNotePage(data);
	}

	/** Every recording, newest first as Comu lists them. */
	async listAll(pageSize = 50): Promise<Recording[]> {
		const all: Recording[] = [];
		for (let page = 1; ; page++) {
			const result = await this.listPage(page, pageSize);
			all.push(...result.recordings);
			if (
				result.recordings.length < pageSize ||
				all.length >= result.total
			) {
				return all;
			}
		}
	}

	async getAudioUrl(id: RecordingId): Promise<string | null> {
		return parseAudioUrl(
			await this.get(
				`/v2/note/noteDetail?noteId=${encodeURIComponent(id)}`,
			),
		);
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
