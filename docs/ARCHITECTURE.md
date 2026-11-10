# Architecture

```
┌──────────────────────────── Tauri host (Rust) ────────────────────────────┐
│  src-tauri/src/lib.rs   window, dialog + fs commands, external links      │
│  capabilities/default.json   the exact permissions the web view may use    │
└───────────────▲───────────────────────────────────────────────────────────┘
                │ invoke("save_text_file", …)
┌───────────────┴──────────────── React front end ──────────────────────────┐
│  store.ts        single Zustand store: project, transport, UI, settings    │
│  audio/engine    AudioContext, instrument voices, effects, scheduler       │
│  audio/export    offline render → WAV (optionally mastered)                │
│  lib/*           analysis, mastering, theory, tagging, updates, native     │
│  components/*    Rack, PianoRoll, Playlist, Mixer, dialogs                 │
└───────────────────────────────────────────────────────────────────────────┘
```

## Data model

`src/model/types.ts` mirrors the pattern-based workflow:

- **Channel** — one instrument (procedural preset or imported sample) with mixer routing, mute/solo and effect chain reference.
- **Pattern** — `notes: Record<channelId, Note[]>`; the step grid and piano roll are two views of the same notes.
- **Playlist** — tracks containing **clips**; a clip references a pattern or an audio file and carries start/length/offset.
- **Strip** — a mixer channel with inserts, sends, volume, pan and routing to a bus or master.
- **Project** — channels, patterns, playlist, strips, tempo, swing, settings snapshot and UI state.

Ids are stable strings; undo/redo is implemented with whole-project snapshots (`past` / `future` stacks in the store), which keeps effect and automation edits simple and reliable at this project size.

## Audio

`audio/engine.ts` owns one `AudioContext`.

- **Instruments** are synthesised: oscillator/wavetable-style voices with per-preset envelopes, tuning and noise components. No sample library is bundled.
- **Effects** are native nodes (biquads, `DynamicsCompressorNode`, convolver with generated impulse responses, delay lines, waveshaper).
- **Scheduling** uses a look-ahead loop (25 ms tick, 100 ms horizon) reading the transport position, so playback stays sample-accurate under UI load.
- **Step grid** notes are generated from per-channel steps on demand; the piano roll edits the underlying note arrays.

### Export and mastering

`renderSongToBuffer()` runs the song offline with `OfflineAudioContext`, then `renderSongToWav()` encodes PCM. If a mastering target is set, `lib/mastering.ts` applies shelf EQ, glue compression, a soft-knee limiter and loudness normalisation to the requested integrated target before encoding. The result is a standard 16/24-bit WAV.

## Analysis

`lib/analysis.ts` renders the master offline, then computes:

- peak, RMS and an approximate integrated loudness (K-weighting-inspired),
- crest factor and a stereo correlation estimate,
- a radix-2 FFT over windowed frames, folded into seven bands (sub, bass, low-mid, mid, high-mid, high, air),
- findings by comparing band balance, crest and width against calibrated targets with a ±2 dB deadband, so a healthy mix produces “nothing is fighting for space” rather than busywork EQ.

Corrections are applied as real `eq10` / `comp` / `limiter` effects on the master strip, which means they are visible, editable and undoable like any manual mix decision.

## Desktop bridge

`lib/native.ts` detects `window.__TAURI_INTERNALS__` and invokes Rust commands, falling back to browser downloads/uploads and `window.open` in the web build. Nothing in the UI branches on platform beyond this module.

## Updates

`lib/updates.ts` calls `https://api.github.com/repos/<repo>/releases/latest`, compares semver against `APP_VERSION`, and stores the result in UI state. The repository is a setting, so forks can point at their own releases. The Changelog tab renders `lib/changelog.ts`; `CHANGELOG.md` is the human-facing mirror.

## Persistence

The store autosaves to `localStorage` (debounced) and native builds also round-trip `.openbeats` JSON files through the Rust dialog commands. Settings carry the theme, interface mode, mastering target and update preferences.
