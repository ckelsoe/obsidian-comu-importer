// Comu's updateTime is not a change marker: reading a recording's summary for
// the first time moves it (seen 2026-11-05, whoever reads, the plugin or the
// Comu app). So a note also stores a fingerprint of the content it was built
// from, and a recording counts as changed only when that content differs.

import type {
	Recording,
	RecordingArtifacts,
} from 'obsidian-recording-importer-core';

/** Frontmatter key holding the fingerprint. A stored name: never rename. */
export const FINGERPRINT_KEY = 'comu-content-hash';

/**
 * Two 32-bit FNV-1a hashes with different seeds, as 16 hex digits. Not
 * cryptographic: it only has to tell one version of a recording from another.
 */
function hash64(text: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193 ^ 0x5bd1e995;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193);
		b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
	}
	const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
	return hex(a) + hex(b);
}

/** What an import was asked to include; part of the fingerprint. */
export interface FingerprintChoice {
	readonly summary: boolean;
	readonly transcript: boolean;
	readonly audio: boolean;
}

/**
 * Fingerprint of everything a note is written from: the recording's title,
 * start and length, the parts chosen under What to import, and their content
 * (summary, insights, action items, chapters, transcript with speakers and
 * times). Any change to these changes it. Comu's change time is left out on
 * purpose: it moves when a recording is only viewed.
 */
export function contentFingerprint(
	recording: Recording,
	artifacts: RecordingArtifacts,
	choice: FingerprintChoice,
): string {
	const canonical = JSON.stringify({
		title: recording.title,
		start: recording.createdAt.getTime(),
		duration: recording.durationSeconds,
		choice: [choice.summary, choice.transcript, choice.audio],
		summary: artifacts.summary?.text ?? null,
		extra: (artifacts.additionalSummaries ?? []).map((s) => [
			s.heading,
			s.text,
		]),
		chapters: (artifacts.chapters ?? []).map((c) => [
			c.title,
			c.startSeconds,
			c.endSeconds ?? null,
		]),
		transcript: (artifacts.transcript?.segments ?? []).map((s) => [
			s.startSeconds,
			s.endSeconds,
			s.speaker ?? null,
			s.text,
		]),
	});
	return hash64(canonical);
}

/**
 * The fingerprint stored in a note's text, read from the file itself rather
 * than Obsidian's metadata cache, which can lag behind a write just made.
 */
export function readStoredFingerprint(noteText: string): string | undefined {
	if (!noteText.startsWith('---')) return undefined;
	const end = noteText.indexOf('\n---', 3);
	if (end < 0) return undefined;
	for (const line of noteText.slice(3, end).split('\n')) {
		const match = /^comu-content-hash:\s*"?([0-9a-f]{16})"?\s*$/.exec(line);
		if (match) return match[1];
	}
	return undefined;
}
