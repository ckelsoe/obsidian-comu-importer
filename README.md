# Comu Importer

Import your [Comu](https://comu.com) recordings into notes: the AI summary, insights, action items as tasks, the chapter outline and the full transcript with speakers and timestamps. Optionally save the audio too.

> [!warning] Unofficial
> This plugin is not made or endorsed by Comu. Comu has no public API, so the plugin reads your recordings through the same private API the Comu web app uses. Comu can change that API at any time, which would stop the plugin working until it is updated.

## Setup

Open the plugin's settings and sign in one of these ways:

- **Sign in** (desktop, email and password): opens Comu's sign-in page in its own window. The window closes by itself once you are signed in.
- **Sign in with your browser** (Apple or Google): click **Set up bookmark** once and drag the button it shows onto your bookmarks bar. Then sign in at [web.comu.com](https://web.comu.com) in your browser and click the bookmark on that tab. Obsidian opens and saves the sign-in.
- **Paste token**: if the bookmark could not open Obsidian, it shows a line of text; copy it and click **Paste from clipboard**.

The plugin checks the token with Comu before saving it, and keeps it in Obsidian's secret storage under the name `comu-importer-token`, never in the plugin's settings file. Comu tokens last about five months; the settings show when yours expires. **Sign out** removes it.

## Importing

Click the microphone in the ribbon, or run **Comu Importer: Import recordings** from the command palette. The import window lists your recordings:

- **New**: not in your vault yet.
- **Imported**: already imported and unchanged.
- **Update available**: Comu changed the recording since you imported it.
- **Not processed yet**: Comu has no transcript or summary yet. Try again later.

New and updated recordings are checked for you. Click **Import**.

## What a note contains

- Frontmatter: `comu-id`, `comu-url`, date, start and end time, duration, speakers.
- A link back to the recording in Comu.
- **Summary**, the insights section and **Action items** as a task list (`- [ ]`, with owners).
- The transcript, with a clickable chapter list from Comu's outline.
- **Audio**, when **Download audio** is on, saved in a `-assets` folder next to the note.

Everything the plugin writes sits between two hidden markers. Text you add above or below them is kept when you import the recording again.

## Settings

| Setting | What it does |
|---|---|
| Output folder | Where notes are created. |
| Subfolder template | Optional, for example `{{YYYY}}/{{MM}}`. |
| Note name template | Optional, for example `{{YYYY}}-{{MM}}-{{DD}} {{title}}`. |
| When a note already exists | Ask each time, update it, or skip it. |
| Transcript layout | Under a heading, in a callout, or in a separate file. |
| Download audio | Save each recording's audio next to its note. |
| Show trashed recordings | List recordings that are in Comu's trash. |

## Privacy

The plugin talks only to Comu (`api.comu.com`, and the audio host Comu links to). It only reads: it never changes, renames or deletes anything in your Comu account, and it never marks recordings as read. See [PRIVACY.md](PRIVACY.md).

## Community

Questions, ideas, and general discussion happen on [Discord](https://discord.gg/gd6tKJDPj4). For anything that needs tracking, a [GitHub issue](https://github.com/ckelsoe/obsidian-comu-importer/issues) is still the better home.
