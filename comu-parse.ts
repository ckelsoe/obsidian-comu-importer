// Maps Comu's private web API (api.comu.com/api/kirby) onto the shared
// recording model. Pure functions, no network: every field is read with a type
// guard, because the API is undocumented and can change without notice.
// Response shapes recorded 2026-11-05 from the web portal.

import type {
	AdditionalSummary,
	Chapter,
	Recording,
	RecordingId,
	Transcript,
	TranscriptSegment,
} from 'obsidian-recording-importer-core';

/** Comu's status code for a finished transcript or summary. */
const STATUS_DONE = 2;

export class ComuParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ComuParseError';
	}
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(obj: Json, key: string): string | undefined {
	const v = obj[key];
	return typeof v === 'string' ? v : undefined;
}

function num(obj: Json, key: string): number | undefined {
	const v = obj[key];
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function records(value: unknown): Json[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toRecordingId(value: string): RecordingId {
	return value as RecordingId;
}

function parseTime(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

/** One list or detail item as a Recording. Throws on a missing id. */
export function parseNote(item: unknown): Recording {
	if (!isRecord(item)) throw new ComuParseError('Note is not an object');
	const id = str(item, 'noteId');
	if (id === undefined || id.length === 0) {
		throw new ComuParseError('Note has no noteId');
	}
	const startMs =
		parseTime(str(item, 'startTime')) ??
		parseTime(str(item, 'createTime')) ??
		0;
	const durationSeconds = Math.max(0, num(item, 'duration') ?? 0);
	const updatedMs = parseTime(str(item, 'updateTime'));
	const dir = item['dir'];
	return {
		id: toRecordingId(id),
		title: str(item, 'title')?.trim() || 'Untitled recording',
		createdAt: new Date(startMs),
		endsAt: new Date(startMs + durationSeconds * 1000),
		durationSeconds,
		// Comu reports no per-recording time zone; the writer falls back to the
		// configured or device zone.
		captureOffsetMinutes: null,
		transcriptAvailable: num(item, 'transcribeStatus') === STATUS_DONE,
		summaryAvailable: num(item, 'summaryStatus') === STATUS_DONE,
		isTrashed: item['trash'] === true,
		...(updatedMs !== undefined ? { versionMs: updatedMs } : {}),
		...(typeof dir === 'string' && dir.length > 0 ? { folderId: dir } : {}),
	};
}

export interface NotePage {
	readonly recordings: readonly Recording[];
	readonly total: number;
}

/** `data` of `POST /v2/note/paging`. */
export function parseNotePage(data: unknown): NotePage {
	if (!isRecord(data)) throw new ComuParseError('Note list is not an object');
	const items = data['data'];
	if (!Array.isArray(items)) {
		throw new ComuParseError('Note list has no data array');
	}
	return {
		recordings: items.map(parseNote),
		total: num(data, 'total') ?? items.length,
	};
}

/** `data` of `GET /v2/note/noteDetail`: the signed audio URL, if any. */
export function parseAudioUrl(data: unknown): string | null {
	if (!isRecord(data)) return null;
	const url = str(data, 'audioUrl');
	return url !== undefined && /^https:\/\//i.test(url) ? url : null;
}

/** `data` of `GET /v1/note/queryTranscribeResult`. Null when it has no lines. */
export function parseTranscript(
	id: RecordingId,
	data: unknown,
): Transcript | null {
	if (!isRecord(data)) return null;
	const segments: TranscriptSegment[] = [];
	for (const row of records(data['asrResultVO'])) {
		const text = str(row, 'content')?.trim() ?? '';
		if (text.length === 0) continue;
		const startMs = num(row, 'startMs') ?? num(row, 'startTimeMs') ?? 0;
		const endMs = num(row, 'endMs') ?? num(row, 'endTimeMs') ?? startMs;
		const speaker = str(row, 'speakerName')?.trim();
		segments.push({
			startSeconds: startMs / 1000,
			endSeconds: endMs / 1000,
			text,
			...(speaker ? { speaker } : {}),
		});
	}
	if (segments.length === 0) return null;
	return {
		id,
		segments,
		rawText: segments.map((s) => s.text).join('\n'),
	};
}

/**
 * Comu links speakers inside its Markdown as `[Name](speaker:<uuid>)`. That
 * scheme means nothing in Obsidian, so keep the name and drop the link.
 */
export function stripSpeakerLinks(markdown: string): string {
	const marker = '](speaker:';
	let out = '';
	let from = 0;
	for (;;) {
		const mid = markdown.indexOf(marker, from);
		if (mid < 0) break;
		const open = markdown.lastIndexOf('[', mid);
		const close = markdown.indexOf(')', mid);
		const name = open >= from ? markdown.slice(open + 1, mid) : '';
		if (close < 0 || open < from || /[\]\n]/.test(name)) {
			// Not a well-formed speaker link: keep the text as it is.
			out += markdown.slice(from, mid + marker.length);
			from = mid + marker.length;
			continue;
		}
		out += markdown.slice(from, open) + name;
		from = close + 1;
	}
	return out + markdown.slice(from);
}

export interface ComuSummary {
	readonly summary: string | null;
	readonly insights: string | null;
}

/** `data` of `GET /v1/note/querySummary`. */
export function parseSummary(data: unknown): ComuSummary {
	if (!isRecord(data)) return { summary: null, insights: null };
	const detail = data['noteSummaryDetailVO'];
	const insight = data['noteInsightDetailVO'];
	const text = (obj: unknown, key: string): string | null => {
		if (!isRecord(obj)) return null;
		const v = str(obj, key)?.trim();
		return v ? stripSpeakerLinks(v) : null;
	};
	return {
		summary: text(detail, 'summaryContent'),
		insights: text(insight, 'insightContent'),
	};
}

/** `data` of `GET /v1/note/queryOutlines`, as chapters in seconds. */
export function parseOutline(data: unknown): Chapter[] {
	if (!isRecord(data)) return [];
	const chapters: Chapter[] = [];
	for (const row of records(data['outlines'])) {
		const title = str(row, 'content')?.trim();
		const start = num(row, 'startTime');
		if (!title || start === undefined) continue;
		const end = num(row, 'endTime');
		chapters.push({
			title,
			startSeconds: start / 1000,
			...(end !== undefined && end >= start
				? { endSeconds: end / 1000 }
				: {}),
		});
	}
	return chapters;
}

/**
 * `data` of `POST /v1/todo/list/queryByNote`, as a Markdown task list. Open
 * items (`actionStatus` 0) are `- [ ]`, anything else `- [x]`. Null when the
 * note has no action items.
 */
export function formatActionItems(data: unknown): string | null {
	const lines: string[] = [];
	for (const row of records(data)) {
		const text = (str(row, 'actionContent') ?? str(row, 'actionItem'))
			?.replace(/\s+/g, ' ')
			.trim();
		if (!text) continue;
		const owners = records(row['ownerList'])
			.map((o) => str(o, 'stakeholderName')?.trim())
			.filter((n): n is string => !!n);
		const box = (num(row, 'actionStatus') ?? 0) === 0 ? '[ ]' : '[x]';
		const owner = owners.length > 0 ? ` (${owners.join(', ')})` : '';
		lines.push(`- ${box} ${stripSpeakerLinks(text)}${owner}`);
	}
	return lines.length > 0 ? lines.join('\n') : null;
}

/** The sections after the main summary, in note order. */
export function extraSections(
	insights: string | null,
	actionItems: string | null,
): AdditionalSummary[] {
	const out: AdditionalSummary[] = [];
	if (insights) out.push({ heading: 'Insights', text: insights });
	if (actionItems) out.push({ heading: 'Action items', text: actionItems });
	return out;
}
