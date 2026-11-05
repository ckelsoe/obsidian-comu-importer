import { MarkdownView, type App } from 'obsidian';
import { findTranscriptFoldLine } from 'obsidian-recording-importer-core';
import { COMU_PROFILE } from './comu-profile';

/**
 * Collapse the transcript heading of a freshly written note, so it opens on
 * the summary. Uses Obsidian's internal fold store, and the open view when the
 * note is already showing. Best effort: a failure leaves the note expanded and
 * never reaches the import.
 */
export async function foldTranscript(
	app: App,
	path: string,
	headingLevel: 2 | 3 | 4 | 5,
	cancelled: () => boolean,
): Promise<void> {
	try {
		const file = app.vault.getFileByPath(path);
		if (file === null || cancelled()) return;
		const body = await app.vault.read(file);
		// Closed, unloaded, or the note moved while it was being read.
		if (cancelled() || app.vault.getFileByPath(path) !== file) return;
		const line = findTranscriptFoldLine(COMU_PROFILE, body, headingLevel);
		if (line === null) return;
		const foldInfo = {
			folds: [{ from: line, to: line }],
			lines: body.split('\n').length,
		};
		await app.foldManager?.save(file, foldInfo);
		if (cancelled()) return;
		for (const leaf of app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path) {
				view.currentMode.applyFoldInfo?.(foldInfo);
			}
		}
	} catch (err) {
		console.warn(
			`Comu importer: could not fold the transcript in ${path}`,
			err,
		);
	}
}
