# Comu Importer

[![CI](https://img.shields.io/github/actions/workflow/status/ckelsoe/obsidian-comu-importer/ci.yml?branch=main&label=CI&logo=github)](https://github.com/ckelsoe/obsidian-comu-importer/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/actions/workflow/status/ckelsoe/obsidian-comu-importer/release.yml?label=Release&logo=github)](https://github.com/ckelsoe/obsidian-comu-importer/actions/workflows/release.yml) [![GitHub Downloads](https://img.shields.io/github/downloads/ckelsoe/obsidian-comu-importer/total?logo=github&label=Downloads)](https://github.com/ckelsoe/obsidian-comu-importer/releases) [![Obsidian](https://img.shields.io/badge/Obsidian-v1.13.2%2B-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md) [![License](https://img.shields.io/github/license/ckelsoe/obsidian-comu-importer)](https://github.com/ckelsoe/obsidian-comu-importer/blob/main/LICENSE) [![Latest Release](https://img.shields.io/github/v/release/ckelsoe/obsidian-comu-importer?label=Latest)](https://github.com/ckelsoe/obsidian-comu-importer/releases/latest)

Bring your [Comu](https://comu.com) recordings into Obsidian. Each recording becomes a note with the AI summary, the insights, the action items as tasks, a chapter list and the full transcript with speakers and timestamps. You can save the audio next to the note too.

The plugin uses [Comu's official developer API](https://openapi.comu.com) with an API key you create in the Comu app. It only reads: it cannot change, rename or delete anything in your Comu account.

> This is a community plugin. It is not made or endorsed by Comu.

## Contents

- [What it does](#what-it-does)
- [What it will not do](#what-it-will-not-do)
- [Requirements](#requirements)
- [Installation](#installation)
- [Connect your Comu account](#connect-your-comu-account)
- [Importing](#importing)
- [What a note looks like](#what-a-note-looks-like)
- [Settings](#settings)
- [Limits](#limits)
- [Troubleshooting](#troubleshooting)
- [Privacy](#privacy)
- [Community](#community)
- [License](#license)

## What it does

- Lists your Comu recordings in an import window, each marked **New**, **Imported**, **Update available** or **Not processed yet**.
- Checks new and changed recordings for you, so one click imports what you are missing.
- Writes one note per recording with:
  - frontmatter: `comu-id`, `comu-url`, date, start and end time, duration, speakers;
  - a link that opens the recording in Comu;
  - the **Summary** and the **Insights** Comu wrote;
  - **Action items** as Obsidian tasks (`- [ ]`), with the person each one belongs to;
  - the **Transcript**, with a clickable chapter list from Comu's outline.
- Optionally downloads the audio into a `-assets` folder next to the note and embeds it.
- Works on desktop and mobile.

## What it will not do

- **It never writes to Comu.** Comu's API is read-only, and the plugin calls only its query endpoints.
- **It never overwrites a note it did not write.** If a note with the same name exists and was not imported by this plugin, the new note is saved beside it with " 2" added to the name.
- **It keeps your own writing.** The note body the plugin writes sits between two hidden markers. Text you add above or below them stays when you import the recording again. The plugin's own frontmatter properties (`comu-id`, `date`, `speakers` and the rest) are rewritten on each import; properties you add yourself are kept.
- **It touches only its output folder.** Notes and audio go into the folder you choose and nowhere else.
- **It does not phone home.** No telemetry, no analytics. The only server it talks to is Comu's.

## Requirements

- Obsidian 1.13.2 or later.
- A Comu account with a **Premium** or **Elite** membership. Comu gives API access (Comu app → Me → Developers) to these plans, including trial and gifted memberships. The Starter plan has no API access, so the plugin cannot work with it.

## Installation

### From Community plugins

1. Open **Settings → Community plugins** and turn off Restricted mode if it is on.
2. Click **Browse** and search for **Comu Importer**.
3. Click **Install**, then **Enable**.

### Via BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. In BRAT, choose **Add beta plugin** and enter `https://github.com/ckelsoe/obsidian-comu-importer`.
3. Enable **Comu Importer** under **Settings → Community plugins**.

### Manual install

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/ckelsoe/obsidian-comu-importer/releases/latest).
2. Put them in a folder named `comu-importer` inside your vault's `.obsidian/plugins/` folder.
3. Reload Obsidian and enable **Comu Importer** under **Settings → Community plugins**.

## Connect your Comu account

1. In the **Comu app**, open **Me → Developers → API Keys** and create a key. Copy it; it starts with `kb_`.
2. In Obsidian, open **Settings → Comu Importer**.
3. Paste the key into **API key** and click **Save**.

The plugin checks the key with Comu before keeping it. The status then reads **API key saved**, with a **Test connection** button. The key is stored in Obsidian's secret storage on your device, not in the plugin's settings file, so it is not copied with your vault's settings.

To disconnect, click **Remove key**. To revoke the key everywhere, delete it in the Comu app.

## Importing

Click the microphone in the left ribbon, or run **Comu Importer: Import recordings** from the command palette.

The import window lists your recordings, newest first:

| Badge | Meaning |
|---|---|
| **New** | Not in your vault yet. Checked for you. |
| **Update available** | Comu changed the recording after you imported it. Checked for you. |
| **Imported** | Already in your vault and unchanged. |
| **Not processed yet** | Comu has no transcript or summary yet. Try again later. |

Use **Select new and updated** or **Select none**, tick the recordings you want, and click **Import**. Closing the window stops the import after the recording in progress.

When a recording was imported before, the plugin follows **When a note already exists**: ask each time, update it, or skip it. Updating rewrites the part between the markers and the plugin's own frontmatter properties.

## What a note looks like

```markdown
---
comu-id: "4d4b0c1e-0000-4000-8000-000000000001"
comu-url: "https://web.comu.com/all-files/note/4d4b0c1e-0000-4000-8000-000000000001"
date: 2026-11-03
start-time: "2026-11-03T19:57:21+00:00"
end-time: "2026-11-03T20:33:57+00:00"
duration-seconds: 2196
duration: "37m"
speakers: [Alex, Sam]
source: comu
---

# 2026-11-03 Weekly planning

[Open in Comu →](https://web.comu.com/all-files/note/4d4b0c1e-0000-4000-8000-000000000001)

## Summary
...

## Insights
...

## Action items

- [ ] Send the agenda (Sam)
- [x] Book the room

---

#### Transcript

##### Chapters
- [[#00:01 Opening|**[00:01]** Opening]]
...
```

## Settings

| Setting | What it does |
|---|---|
| API key | Your Comu API key. Checked with Comu, then kept in secret storage. |
| Output folder | Where notes are created. Default `Comu`. |
| Subfolder template | Optional folders under the output folder, from the recording's date. Tokens use [Moment formats](https://momentjs.com/docs/#/displaying/format/) in double braces: `{{YYYY}}/{{MM}}` gives `2026/11`. |
| Note name template | Optional. Default `{{YYYY}}-{{MM}}-{{DD}} {{title}}`. `{{title}}` is the recording's title. |
| When a note already exists | Ask each time, update it, or skip it. |
| Transcript layout | Under a heading, in a callout, or in a separate `Transcript.md` file (embedded or linked). |
| Download audio | Save each recording's audio in the note's `-assets` folder and embed it. |
| Show trashed recordings | Also list recordings in Comu's trash. |

## Limits

- **Daily request limit.** Comu allows 1,000 API requests per rolling 24 hours per key. Importing one recording takes about four requests, so the first import of a very large library may need to be spread over more than one day. When the limit is reached, the plugin says so; wait and import the rest later.
- **Times.** Comu does not report the time zone a recording was made in, so times are shown in your computer's zone.
- **Not imported yet:** your own notes typed in the Comu app, Comu's folders, the visual summary, and contacts.

## Troubleshooting

- **"Comu rejected the API key"**: the key was mistyped, revoked, or your plan no longer includes Developers access. Create a new key in the Comu app and save it again.
- **"Comu could not check your membership just now"**: a temporary problem on Comu's side. Try again in a few minutes.
- **A recording shows "Not processed yet"**: Comu is still transcribing or summarizing it.
- **Something else**: open the developer console (Ctrl+Shift+I, or Cmd+Option+I on a Mac); every error is logged there with its details. Please include them in an [issue](https://github.com/ckelsoe/obsidian-comu-importer/issues), with your API key removed.

## Privacy

The plugin talks only to Comu's API (`openapi-api.comu.com`) and, when **Download audio** is on, to the temporary audio link Comu returns. Your key stays on your device. Nothing is sent to the plugin's author or anyone else. See [PRIVACY.md](PRIVACY.md).

## Community

Questions, ideas, and general discussion happen on [Discord](https://discord.gg/gd6tKJDPj4). For anything that needs tracking, a [GitHub issue](https://github.com/ckelsoe/obsidian-comu-importer/issues) is still the better home.

## License

[MIT](LICENSE)
