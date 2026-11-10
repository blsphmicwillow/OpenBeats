# Working with other DAWs

OpenBeats exchanges **musical data**, not plugin graphs. What travels: track names, notes, note lengths, velocities, tempo and (where the format supports it) MIDI programs. What does not: devices, automation, audio clips, routing and plugin state. Every DAW's project format is proprietary; MIDI is the only format all of them read reliably.

## Matrix

| DAW | Into OpenBeats | Out of OpenBeats | Notes |
| --- | --- | --- | --- |
| **FL Studio** | MIDI | MIDI | FLP is a binary event stream with plugin data; export MIDI from FL (`File → Export → MIDI`) and import it here. |
| **Ableton Live** | `.als` (10–12), MIDI | MIDI | `.als` is gzipped XML — tracks, clips, notes and tempo are read. Live imports SMF type 1 as separate tracks. |
| **REAPER** | `.rpp`, MIDI | `.rpp`, MIDI | RPP is plain text; tracks and MIDI items round-trip. |
| **Logic Pro** | MIDI | MIDI | Logic imports SMF type 1. |
| **Cubase / Nuendo** | MIDI | MIDI | Use *File → Import → MIDI File*. |
| **Studio One** | MIDI | MIDI | Drag the `.mid` onto the arrangement. |
| **Bitwig Studio** | MIDI | MIDI | Imports one track per MIDI track. |
| **Pro Tools** | MIDI | MIDI | MIDI import creates instrument tracks. |

## How the conversion works

`src/lib/daw/`:

- `types.ts` — neutral `ExchangeSong`, a flat list of tracks with notes in 16th-note steps.
- `midi.ts` — Standard MIDI File type 1 writer/parser (96 PPQ, tempo meta, track names, program changes, running status, format 0 channel splitting).
- `als.ts` — gunzips the Live Set via `DecompressionStream`, parses `MasterTrack/Tempo/Manual`, `Tracks/MidiTrack`, `MidiClip`, `KeyTrack/MidiKey` and `MidiNoteEvent`.
- `rpp.ts` — tokenises REAPER's indented chunk text, reads `TEMPO`, `TRACK`, `NAME`, `ITEM/POSITION`, `SOURCE MIDI` and `E` events (960 PPQ).
- `project.ts` — converts the project to an exchange song (arrangement clips first, current pattern as fallback) and rebuilds an imported song as channels, one pattern per channel, playlist clips and mixer strips.

### Import

1. `File → Import / export song…` (or the command palette).
2. The extension selects the parser: `.mid/.midi/.smf`, `.als`, `.rpp`; `.obeats/.json` opens natively.
3. Each imported track becomes a channel with a preset guessed from its name and General MIDI program, a pattern holding its notes at absolute positions, a playlist clip and a mixer strip.
4. Tempo is clamped to 20–300 BPM; notes are clamped to MIDI 0–127.

### Export

- **MIDI** writes one `MTrk` per channel with notes flattened to the arrangement timeline. If a channel has no clips, its current-pattern notes are written instead.
- **REAPER** writes a text project with one track and one MIDI item per channel.
- **OpenBeats `.obeats`** is the only lossless round-trip (mixer, effects, theme, settings).
- **WAV** is the audio path when devices matter.

## Fidelity limits

- No FLP, ALS or RPP **writing** except RPP: reproducing another DAW's full project schema without that DAW to validate against would produce files that silently fail to open. MIDI and RPP are safe to generate.
- Ableton import reads MIDI tracks only. Audio tracks, warping, devices and automation are counted and reported as skipped.
- FL Studio `.flp` is a proprietary binary (header `FLhd`, `FLdt` event stream with length-prefixed plugin blobs). Parsing it is possible but version-fragile; MIDI is the supported path.
- Drum racks, sampler mappings and plugin presets are not translated. Imported drum tracks use OpenBeats' synthesised kits.
- Tempo changes inside a song are not imported: the first tempo becomes the project tempo.

## Testing

The writers and parsers are pure functions. In development builds they are exposed as `window.openbeatsDaw`:

```js
const song = openbeatsDaw.exchangeFromProject(openbeats.getState().project);
const midi = openbeatsDaw.writeMidi(song);
const back = openbeatsDaw.parseMidi(midi);       // same tracks/notes
```

A round-trip test checks track count, note count, pitch/start/length and tempo. The exchange dialog is exercised by importing a generated MIDI file and confirming the new project's channels and clips.
