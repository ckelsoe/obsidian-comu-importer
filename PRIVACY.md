# Privacy Policy

_Last updated: 2026-11-05_

This policy explains what the **Comu Importer** Obsidian plugin ("the plugin") does and does not do with your data. It applies to the plugin as distributed through the Obsidian Community Plugins marketplace, GitHub releases, and BRAT.

## Summary

The plugin reads your recordings from Comu's official API, with an API key you create, and writes them into your vault. It talks to no server other than Comu's. It collects nothing for the maintainer and has no telemetry.

## What the plugin does

When you open the import window, the plugin lists your Comu recordings. When you click Import, it fetches the transcript, summary, insights, outline and action items of each checked recording and writes a note into your output folder. With **Download audio** on, it also downloads the recording's audio into a `-assets` folder next to the note. It acts only when you open the import window or use a button in its settings.

It only reads from Comu. Comu's API offers no way to change your account, and the plugin calls only its query endpoints.

## Data storage

- Your Comu API key is kept in Obsidian's secret storage on your device, under the name `comu-importer-api-key`. It is never written to the plugin's settings file (`data.json`). **Remove key** deletes it from the device.
- Notes and audio files are written into your vault, on your own device.

## Network use

- `https://openapi-api.comu.com`: listing recordings and fetching their content. Every request carries your API key.
- The temporary audio link Comu returns, when **Download audio** is on. No key is sent there.

No other host is contacted. Nothing is sent to the maintainer or to Obsidian.

## Third parties

Comu (Rymind Inc.) receives the requests above and its own privacy policy applies to them. The plugin shares no data with anyone else.

## Disclaimer of liability

The plugin is provided free of charge, "AS IS", without warranty of any kind, as set out in the [MIT License](./LICENSE). To the maximum extent permitted by law, the maintainer is not liable for any loss, damage, or claim arising from use of the plugin.

## Information you choose to share

If you open a GitHub issue, discussion, or pull request, anything you paste there (file contents, screenshots, vault structure, system details) becomes **public**. The maintainer does not request this information and is not responsible for content you choose to post. Review and redact anything sensitive before submitting. To report a security vulnerability privately instead, see [SECURITY.md](./SECURITY.md).

## Changes to this policy

This policy may be updated as the plugin evolves. Material changes will be noted in [CHANGELOG.md](./CHANGELOG.md). The "last updated" date above reflects the current version.

## Contact

Questions about this policy: open an issue at [github.com/ckelsoe/obsidian-comu-importer/issues](https://github.com/ckelsoe/obsidian-comu-importer/issues). Do not use a public issue for security vulnerabilities; see [SECURITY.md](./SECURITY.md) for the private reporting channel.
