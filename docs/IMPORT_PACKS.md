# Importing sample packs

OpenBeats imports a **folder** or a **`.zip`** of samples and preset metadata. The
importer never executes code from a pack. It scans on a worker thread, validates
every archive path before writing, and reports exactly what was imported or
skipped.

Use **File → Import pack folder…**, **File → Import pack .zip…**, the Browser's
**Packs → Import pack / ZIP** buttons, or drop a `.zip` onto the studio window in
the desktop app.

## Layouts it recognises

Detection runs from the most specific layout to the least:

1. **OpenBeats native** — a `manifest.json` whose `format` is `openbeats-pack`.
2. **FL-style category folders** — a pack whose folders include names such as
   `Kicks/`, `Snares/`, `Hats/`, `Claps/`, `Cymbals/`, `Percs/`, `Toms/`,
   `Rims/`, `FX/`, `Bass/`, `Leads/`, `Pads/`, `Plucks/`, `Keys/`, `Vocals/` or
   `Loops/`. Both `PackName/Kicks/*.wav` and `Kicks/*.wav` work.
3. **Generic one-shot zip** — audio files without category folders. Samples are
   tagged from their names and appear under **Unsorted** when no family matches.
4. **Flat sample dump** — a folder OpenBeats cannot classify. It still imports,
   with a warning in the report.

Audio formats: `.wav`, `.aiff`/`.aif`, `.flac`, `.ogg` and `.mp3`. WAV, AIFF,
FLAC, OGG and MP3 files get a cheap header check; a corrupt or mislabeled file is
listed as skipped instead of crashing the importer.

### OpenBeats `manifest.json`

```json
{
  "format": "openbeats-pack",
  "version": 1,
  "name": "My Kit",
  "author": "You",
  "license": "CC-BY-4.0",
  "samples": [
    { "path": "Kicks/808.wav", "name": "808", "category": "Kicks" },
    "Snares/clap.wav"
  ],
  "presets": [
    {
      "name": "Warm Keys",
      "plugin": "OpenBeats",
      "notes": "Soft keys with a short release",
      "params": { "preset": "keys", "tone": 0.4 }
    }
  ]
}
```

Manifest paths are relative and may not contain `..`. Missing samples and invalid
entries are reported, and the rest of the pack still imports.

## FL Studio content

OpenBeats reads FL-related metadata without hosting FL's plugins:

- **`.fxp`** (VST2 preset) — reads the plugin 4-character ID, preset name and
  parameter count when present. FXP files do **not** store parameter names, so
  this is a metadata row only. OpenBeats does not host VST2.
- **`.fst`** (FL native preset) — reads the header and printable strings into
  the preset notes. It is labelled **FL native — preview only, not executable
  here**. The sound is not loaded.
- **`.flp`** (FL project) — offered as a **read-only pattern reference**. The
  report lists printable channel/pattern names it can infer. The project is not
  played or converted; use `File → Export → MIDI` in FL Studio for a musical
  transfer.

Sample folders import normally regardless of preset support. Preset metadata is
shown in the import report and kept in the pack index; it does not create a
working plugin instance.

## What the report means

After an import, the report shows:

- imported samples and their inferred categories,
- playable OpenBeats presets from a native manifest,
- preview-only FL/VST2 preset metadata,
- skipped or invalid files, with the per-file reason,
- warnings and a **Show log** view with one line per file.

Nothing is silently ignored: unsupported extensions in a zip, oversized samples
and corrupt headers all appear in the skipped list.

## Limits and safety

| Limit | Value |
| --- | --- |
| Zip archive | 500 MB |
| One sample | 50 MB |
| Total import (default) | 2 GB |
| Entries in a zip | 10,000 |
| Archive expansion ratio | 100× |
| Folder nesting | 8 levels |

Zips are checked against their central directory first, then extracted into a
private staging folder inside the app data directory. Path traversal, absolute
paths, backslash paths, symlink entries, duplicate paths and compression bombs
are rejected. Executables and other unsupported files are skipped. Only after a
successful scan is the staging folder moved into `Packs/` and indexed.

Folder imports are read in place; OpenBeats does not copy or modify the source
folder. Non-UTF-8 filenames are displayed lossily but still imported.

## Removing a pack

The **×** button on a pack removes it from the library.

- Packs extracted from a zip are recorded in `.openbeats-import.json`; uninstall
  deletes only the files listed there and only inside `Packs/`.
- A folder you selected in place is never deleted. Uninstall removes its index
  entry and leaves the source folder untouched.

Pack imports and removals run off the UI thread. The app's release profile uses
unwinding so an unexpected importer panic becomes a readable error instead of
terminating the whole application.
