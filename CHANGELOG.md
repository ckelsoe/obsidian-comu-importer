# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
