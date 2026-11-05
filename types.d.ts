// Local type augmentations for the Obsidian API.
// Add type declarations here when the Obsidian types are missing or need extension.
// NEVER use `as any` to work around missing types. Add a proper declaration here instead.

import 'obsidian';

declare global {
	// Obsidian installs createEl / createDiv / createSpan on every window, but
	// obsidian.d.ts declares them only as globals and on Node, never as members
	// of the DOM Window interface. eslint-plugin-obsidianmd 0.4.x's
	// prefer-create-el rule asks you to replace `doc.createElement(...)` with
	// `doc.win.createEl(...)` or `activeWindow.createDiv()`; without these
	// declarations that form resolves as `any` and cascades into no-unsafe-*
	// errors. Keep this block if the plugin builds detached elements.
	interface Window {
		createEl<K extends keyof HTMLElementTagNameMap>(
			tag: K,
			o?: DomElementInfo | string,
			callback?: (el: HTMLElementTagNameMap[K]) => void,
		): HTMLElementTagNameMap[K];
		createDiv(
			o?: DomElementInfo | string,
			callback?: (el: HTMLDivElement) => void,
		): HTMLDivElement;
		createSpan(
			o?: DomElementInfo | string,
			callback?: (el: HTMLSpanElement) => void,
		): HTMLSpanElement;
	}
}

declare module 'obsidian' {
	interface PluginManifest {
		version: string;
	}

	/**
	 * Obsidian's internal per-file fold store (undocumented; same shape Plaud
	 * Importer types). Used to open an imported note with its transcript
	 * collapsed. Optional, and checked at the call site.
	 */
	interface FoldPosition {
		from: number;
		to: number;
	}
	interface FoldInfo {
		folds: FoldPosition[];
		lines: number;
	}
	interface FoldManager {
		save(file: import('obsidian').TFile, foldInfo: FoldInfo): Promise<void>;
	}
	interface App {
		foldManager?: FoldManager;
	}
	interface MarkdownSubView {
		applyFoldInfo?(foldInfo: FoldInfo): void;
	}
}
