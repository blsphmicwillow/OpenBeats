# Feature parity (2026 changelog)

Source: `https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/WhatsNew.htm`
(and the 2026 release notes), read on 2026-11-10 and cross-referenced against
`src-tauri/crates/openbeats-audio` and `src-tauri/crates/openbeats-plugins`.

Everything below runs **locally and offline**. There is no cloud, account or
network dependency in the audio path.

## Implemented natively

| FL feature (changelog wording) | Rust implementation | IPC command | Tests |
| --- | --- | --- | --- |
| **Transmitter** — splits a signal into transient and sustain streams, each with its own level/effects, optional hold/release detection | `dsp/transmitter.rs` — fast/slow envelope split, threshold, sensitivity, per-part gain, `hold` + `release`; parts always sum back to the input | meter via `playback_state().transient`; params in the engine chain | 6 |
| **Audio Logger** — last 60 s of master output recoverable | `logger.rs` — stereo ring buffer + WAV writer | `recover_audio_log(seconds)` | 4 |
| **Chord detection panel** (piano roll / toolbar) | `chord.rs` — triads, sevenths, inversions, bass detection | `detect_chord(pitches)` | 6 |
| **Chord panel suggestions in key** | `chord::suggest_progression(root, minor)` — diatonic I–vii° triads | `chord_suggestions(root, minor)` | 1 |
| **Audio clip gain controls / Normalize** | `notes::normalize_gains(peaks, as_group)` — individually or relative to the loudest clip | `normalise_clip_gains(peaks, as_group)` | 3 |
| **Per-clip data: gain** (`Clip.gain`, 21305) | `sequencer::PlaybackNote.gain` → `Trigger.gain` → voice gain | via `start_playback` | 3 |
| **Per-clip panning** (21713, 21305) | `clips::PlaybackClip.pan` → `Trigger.pan` → `VoicePool::trigger_panned` (equal-power) | via `start_playback` | 4 |
| **Per-clip pitch** (18471) | `clips::expand_clip` transposes each note, clamped to MIDI 0–127 | via `start_playback` | 3 |
| **Per-clip stretch / reset stretch** (18471, 21726) | `clips::expand_clip` scales note positions and lengths by the time multiplier and loops the pattern | via `start_playback` | 5 |
| **Clip fades in/out** | `clips::fade_gain_at` / `clip_gain_at`, applied per note, on top of clip gain | via `start_playback` | 3 |
| **Rename / customise piano-roll notes** (17648) | `notes::note_name` / `display_name` | `pitch_names(pitches)` | 4 |
| **Per-clip drum/pattern looping inside a long clip** | `clips::expand_clip` repeats the pattern for the clip length | via `start_playback` | 1 |

`cargo test -p openbeats-audio --features fundsp-graph` → **65 passing tests**.

## Wiring

* **Native path (desktop):** the React store calls `start_playback` with a
  snapshot. In song mode the snapshot carries `clips` + `patterns`, so Rust does
  the clip expansion; in pattern mode it carries flat `notes`.
* **Browser/web demo:** `src/audio/sequencer.ts` mirrors the same semantics
  (`clipGainAt`, `clipFadeGain`, pitch, stretch) so the Web Audio fallback keeps
  sounding the same. Per-clip pan is native-only, because the Web Audio voice API
  takes a channel pan rather than a per-note pan.
* **UI:** clip pan, pitch, stretch and fade controls are in the playlist clip
  context menu. No UI was rewritten.

## Deliberately not implemented

These are on the same page but are not audio/DSP work, or cannot be local:

| FL feature | Why not |
| --- | --- |
| Gopher (AI assistant), cloud project backup | Requires cloud services; OpenBeats 1.0.0 is fully local by design. |
| FLEX sample packs, Loop Starter, stem separation | Content libraries / model-based source separation, not a DSP primitive. |
| Edison audio editor, Slicex, DirectWave samplers | Full separate applications; out of scope for the 1.0.0 engine. |
| Realtime pitch-preserving time-stretch (Elastique-style) | `clips::expand_clip` scales note timing (a sequencer stretch, not a phase-vocoder). A sample-accurate stretcher is a separate project. |
| Transmitter sidechain input from another mixer track | Needs per-track routing in the engine; the detection input is currently the master sum. |
| Audio recording, performance mode, MIDI scripting | Not part of the playback engine milestone. |
| Plugin browser management extras (scan speed, categories) | Covered by `openbeats-plugins`; see [PLUGINS.md](PLUGINS.md). |

## Verifying locally

```bash
cd src-tauri
cargo test -p openbeats-audio --features fundsp-graph
```

The device layer needs `libasound2-dev` on Linux (or WASAPI/CoreAudio), so the
full app build is exercised in CI; see [RUST_AUDIO.md](RUST_AUDIO.md).
