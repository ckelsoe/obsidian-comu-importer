// The attachment slice the shared import runner needs. Comu notes carry no
// embedded images, so only audio is downloaded: into `<note>-assets/`, with an
// `## Audio` section added to the managed block, above the transcript.

import { requestUrl, type App } from 'obsidian';
import {
	transformManagedBody,
	type AttachmentAsset,
	type AttachmentPipeline,
	type ManagedMarkers,
} from 'obsidian-recording-importer-core';

/** Extension from the signed URL's path, or `m4a` when it has none. */
export function audioExtension(url: string): string {
	try {
		const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
		return match?.[1]?.toLowerCase() ?? 'm4a';
	} catch {
		return 'm4a';
	}
}

// The audio section sits between its own markers so a re-import finds and
// replaces exactly what this plugin wrote, never a section the user or Comu
// happens to call "Audio".
const AUDIO_START = '<!-- comu:audio:start -->';
const AUDIO_END = '<!-- comu:audio:end -->';

/**
 * Put the audio section in the managed body: replace the one between the
 * audio markers, else insert it before the transcript divider (`---`), else
 * append it.
 */
export function insertAudioSection(body: string, embedPath: string): string {
	const section = `${AUDIO_START}\n## Audio\n\n![[${embedPath}]]\n${AUDIO_END}`;
	const start = body.indexOf(AUDIO_START);
	const end = start < 0 ? -1 : body.indexOf(AUDIO_END, start);
	if (start >= 0 && end >= 0) {
		return (
			body.slice(0, start) + section + body.slice(end + AUDIO_END.length)
		);
	}
	const lines = body.split('\n');
	const divider = lines.indexOf('---');
	if (divider >= 0) {
		lines.splice(divider, 0, section, '');
		return lines.join('\n');
	}
	return `${body.trimEnd()}\n\n${section}\n`;
}

export class AudioPipeline implements AttachmentPipeline {
	constructor(
		private readonly app: App,
		private readonly markers: ManagedMarkers,
		/** True once the import was closed; no file is written after that. */
		private readonly cancelled: () => boolean,
	) {}

	extractAttachmentAssetsFromSummaryMarkdown(): readonly AttachmentAsset[] {
		return [];
	}

	mergeAttachmentAssets(
		base: readonly AttachmentAsset[],
		extra: readonly AttachmentAsset[],
	): readonly AttachmentAsset[] {
		return [...base, ...extra];
	}

	importAttachmentsForNote(): Promise<void> {
		return Promise.resolve();
	}

	async importAudioForNote(
		notePath: string,
		audioUrl: string,
		recordingId: string,
	): Promise<number | null> {
		const note = this.app.vault.getFileByPath(notePath);
		if (note === null || this.cancelled()) return null;
		const folder = notePath.replace(/\.md$/i, '-assets');
		const audioPath = `${folder}/${recordingId}.${audioExtension(audioUrl)}`;
		try {
			// Signed URL: it carries its own signature, so no token is sent.
			const response = await requestUrl({
				url: audioUrl,
				method: 'GET',
				throw: false,
			});
			if (response.status < 200 || response.status >= 300) {
				console.error(
					`Comu importer: audio download failed with HTTP ${response.status}`,
				);
				return null;
			}
			const bytes = response.arrayBuffer;
			// Last stop before writing. Once the folder, file and embed are under
			// way they finish together, so a close never leaves an orphaned file.
			if (this.cancelled()) return null;
			if (this.app.vault.getFolderByPath(folder) === null) {
				await this.app.vault
					.createFolder(folder)
					.catch((err: unknown) => {
						// A folder created between the check and here is fine.
						if (!/already exists/i.test(String(err))) throw err;
					});
			}
			const existing = this.app.vault.getFileByPath(audioPath);
			if (existing !== null) {
				await this.app.vault.modifyBinary(existing, bytes);
			} else {
				await this.app.vault.createBinary(audioPath, bytes);
			}
			await this.app.vault.process(note, (content) =>
				transformManagedBody(this.markers, content, (body) =>
					insertAudioSection(body, audioPath),
				),
			);
			return bytes.byteLength;
		} catch (err) {
			// Audio is best effort: the note itself is already written.
			console.error('Comu importer: could not save audio', err);
			return null;
		}
	}
}
