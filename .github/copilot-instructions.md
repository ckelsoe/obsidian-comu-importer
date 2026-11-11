# Copilot instructions for obsidian-comu-importer

## What this repository is

An [Obsidian](https://obsidian.md) community plugin (TypeScript, esbuild bundle) that imports Comu recordings into notes. Each note holds the summary, insights, action items as tasks, chapters and the transcript. Audio can go into a `-assets` folder next to the note.

- The shared importer logic (note writer, import runner, vault index, managed blocks, auto-sync) comes from `obsidian-recording-importer-core`, pinned to a git tag in `package.json`. This repo holds only the Comu side.
- `comu-client.ts` talks to Comu's official API through `requestUrl`. `comu-parse.ts` turns its responses into the core's recording model.
- `comu-profile.ts` exports `COMU_PROFILE`, the `ServiceProfile` with `keyPrefix: 'comu'`. Every frontmatter key and managed marker derives from it.
- `content-fingerprint.ts` stores a content hash under `comu-content-hash`. Comu moves `updateTime` when anyone only reads a recording, so the hash decides "changed".
- `main.ts` is wiring: lifecycle, commands, settings persistence. `import-service.ts`, `rename.ts` and `audio-pipeline.ts` hold the logic.
- `settings-tab.ts` uses the declarative `getSettingDefinitions()` API. `settings.ts` holds `DEFAULT_SETTINGS` and `normalizeSettings`.

## Build, lint, test

```bash
npm run build   # tsc type-check + esbuild bundle
npm run lint    # eslint (zero warnings), prettier --check, submission pre-check, marketplace type-check
npm test        # Vitest
npx tsc --noEmit
```

All must pass. `npm run knip`, `npm run type-coverage` (at least 99%) and `npm run test:mutation` (Stryker) are extra checks.

## Hard rules

- Never `eslint-disable` an `obsidianmd/*` rule. Comply instead. Any other allowed disable carries a `-- reason`.
- No `as any`. No non-null assertions (`x!`); tests use `at()` / `defined()` from `__tests__/helpers/checked.ts`. Missing types go in `types.d.ts`.
- No regex lookbehind (`(?<=`, `(?<!`). It stops the plugin loading on iOS before 16.4.
- No bare `moment` imported from `obsidian`. Use `Date`/`Intl`.
- No `!important` in `styles.css`, no inline `style` attributes, no `innerHTML`/`outerHTML` writes. Use `createDiv`/`createSpan`.
- Popout-safe DOM: `activeDocument`/`activeWindow` or the element's own document, never a captured global `document`.
- `isDesktopOnly` is false. Node built-ins only behind a desktop runtime check.
- UI strings in sentence case. No "command" in command ids or names. Settings headings never say "settings", "options", "general" or the plugin name.
- Every value read from `data.json` goes through `normalizeSettings` before use.
- Writes to an existing note use `vault.process(file, fn)`, never `read` then `modify`.
- Tests use `vi.*`, not `jest.*`. Never remove, skip or weaken a test to make CI pass.
- No em dashes in prose or comments. README is public: no CI or release internals.

## Plugin-specific pitfalls

- Never call a Comu endpoint that writes. The client is read-only by design. `POST` is used only for Comu's query endpoints.
- The API key lives in `app.secretStorage` under `API_KEY_SECRET_ID`. Never copy it into settings, `data.json`, logs or error text.
- Comu allows 1,000 requests a day per key. Background sync stops at `SYNC_REQUEST_BUDGET` (600) and imports at most `SYNC_MAX_IMPORTS` (25) per run. Do not add requests per recording without checking that budget.
- Only `RETRYABLE_STATUS` gateway errors are retried. Every call is a read, so retry is safe; keep it that way.
- Stored names never change once notes exist: `keyPrefix`, `pluginId`, `FINGERPRINT_KEY`, `API_KEY_SECRET_ID`. Renaming one orphans users' notes.
- `COMU_PROFILE` sets `protectUnownedNotes: true`. A note at the target path without a `comu-id` is the user's own: write beside it, never over it.
- Only the text between the managed markers is plugin-owned. User text outside them must survive a re-import.
- A change counts only when `contentFingerprint` differs. Do not treat `updateTime` alone as a change.
- Renaming a note moves its `-assets` folder too. Keep both moves in `RecordingRenamer`.
- A fix that belongs in shared importer logic goes into `obsidian-recording-importer-core`, not a local copy.
- The settings footer (`Version | GitHub | Discord | Report issues`) uses a flex gap; each `|` sits in one nowrap span with its link. `DISCORD_URL` stays a never-expiring `discord.gg` invite.
- Every timer in a modal or view is held in a field and cleared on close.
- Catch blocks show a Notice and log the original error with `console.error`. Never drop the caught error.
