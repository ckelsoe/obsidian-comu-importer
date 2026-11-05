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
- Settings: output folder, subfolder and note name templates, duplicate handling, transcript layout, trashed recordings.
- A note with the same name that this plugin did not write is never overwritten.
