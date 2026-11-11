# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Settings search now finds the connection status row, and finds the template, time zone, frontmatter, API key and ribbon icon rows by more words (for example "filename", "timezone" or "properties").
- Settings that only matter while another is on are hidden until they do: My tags while Tags is set to my tags, Countdown while results close automatically, Interval while automatic sync is on, and Ribbon icon while the ribbon icon is shown.

## [0.1.1] - 2026-11-05

### Fixed

- Recordings that were only viewed in Comu no longer show as Update available or get re-imported by sync. Comu moves a recording's change time when it is viewed, so each note now records a fingerprint of its content (`comu-content-hash`), and a recording counts as changed only when its content differs. A note imported before this release has no fingerprint, so the next time Comu marks its recording changed it is checked, counts as changed and is re-imported once (by sync, or from the import window under your duplicate-handling choice).

## [0.1.0] - 2026-11-05

### Added

- Import window listing Comu recordings, with New, Imported, Update available and Not processed yet badges; new and changed recordings are checked for you.
- Notes with frontmatter, a link back to Comu, the summary, insights, action items as tasks, a chapter list and the transcript with speakers and timestamps.
- Optional audio download into the note's `-assets` folder.
- Connects with an API key from Comu's official developer API, checked before it is saved and kept in Obsidian's secret storage.
- Import window: choose what to import, hide imported, updated or ignored recordings, ignore a recording, select new and updated in one click, and a results view with every failure's reason and Copy details.
- Placeholder notes for recordings Comu has not processed yet.
- Template builder for the subfolder and note name: insert-token buttons, token reference, live preview, and ISO, US and EU presets.
- Datetime property, time zone, extra frontmatter, keeping hand-added properties, and the replacement character.
- Transcript layout, folding and heading level; your own tags.
- Automatic sync on an interval, and a command to sync now.
- Rename an imported recording: the note and its -assets folder move together.
- Ribbon button you can hide or give a different icon; debug logging.
- A note with the same name that this plugin did not write is never overwritten.
