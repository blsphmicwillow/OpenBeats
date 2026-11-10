# FL Studio and Ableton request audit

Research date: 2026-11-10. Sources: Image-Line's FL Studio 2026 release notes and forum,
the FL Studio 2026 Reddit AMA, Ableton's Live 12 release notes and the official feature
wishlist thread.

## What users ask for

### FL Studio

- Project portability and cloud backup of projects, Project Bones/Data and loop packages.
- Key and chord detection in the Piano Roll / Chord Panel.
- Dynamic mixer tracks (add/remove to fit the project, up to 500).
- Loop Starter-style idea generation in the Channel Rack.
- Faster sound browsing and preset discovery (FLEX browser).
- Optional/toggleable quality-of-life changes rather than forced behaviour.

### Ableton Live

- A macro/command bar that runs several actions from one button.
- Rounded clip corners and clearer section boundaries.
- Move/copy whole song sections by markers and drag-and-drop.
- Device A/B for instant comparison of mixing choices.
- Bounce Groups / paste bounced audio.
- Stem separation and browser/library improvements.

## Status in OpenBeats 1.0.0

| Request | Status |
| --- | --- |
| Project portability | `.obeats` file + Projects library (Tutorial, old projects, save/delete) |
| Key detection | **Added**: project-wide major/minor estimate in the piano roll |
| Chord detection | Partly: generated progressions are named; live chord recognition not implemented |
| Dynamic mixer tracks | Already supported: add/remove strips and free routing |
| Loop/idea starter | Inspire Me chord progressions; no loop generator |
| Faster browsing | Pack/sample browser with search and tags |
| Toggleable QOL | Settings tabs; hints, meters, motion, transparency and autosave can be changed |
| Command macros | Command palette; no user-defined macro buttons |
| Rounded clips | **Added** |
| Section move/copy | Clips can be moved/copied; no song-section marker model |
| Device A/B | Fix My Mix A/B for the master chain |
| Bounce Groups | Not implemented |
| Stem separation | Not implemented (requires an ML model and native processing) |

## Deliberately not added

Stem separation, cloud project backup and an AI assistant require hosted models or
accounts and would break the local-first design. They are not claimed as features.
Plugin hosting remains out of scope; see [PLUGINS.md](PLUGINS.md).
