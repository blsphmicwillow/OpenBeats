# Native Rust audio engine

**Status: implemented, shipped behind the desktop shell; Web Audio remains the
fallback.** The engine is a workspace crate (`src-tauri/crates/openbeats-audio`)
with its own tests, and the desktop app plays through CPAL. The React UI is
unchanged — it was never ported, and that was deliberate.

## 1.0.5 engine split (read this before trusting a comparison)

- **Runs in Rust native (CPAL):** transport and sample-accurate sequencing, the
  16 procedural voices, and the master chain **EQ → compressor → limiter**.
- **Web Audio only:** reverb, delay, drive, filter and the 10-band graphic EQ,
  plus playlist **audio clips**. Offline bounce and Fix My Mix still render with
  Web Audio, so **desktop playback and offline bounce can diverge**.
- **Tested in Rust but not wired into the CPAL callback:** mixer routing,
  automation lanes and the modular effect graph. They answer over IPC; the audio
  thread still runs the fixed EQ → compressor → limiter chain.
- **Per-clip pan** is applied per note by Rust (`clips::expand_clip` →
  `VoicePool::trigger_panned`); the Web Audio fallback uses channel pan. Clip
  gain, pitch, stretch and fades agree between the two engines.
- **Playlist audio clips have no native implementation**, so a desktop project
  that uses them is played by the WebView engine. The UI says so.

## What is native now

| Piece | Location | Verified by |
| --- | --- | --- |
| CPAL output stream, 44.1/48 kHz, f32/i16/u16 | `crates/openbeats-audio/src/engine.rs` (`device` feature) | CI build (`libasound2-dev` on Linux, WASAPI/CoreAudio elsewhere) |
| Sequencer: JSON snapshot → sample-accurate triggers, loop, mute/solo, clip gain, resume from the playhead | `src/sequencer.rs` | 8 unit tests |
| Procedural synth voices for all 16 presets, equal-power pan, ADSR, tone filter, voice stealing | `src/synth.rs` | 4 unit tests |
| 3-band EQ (RBJ biquads: 180 Hz shelf, peakable mid, 4.2 kHz shelf) | `src/dsp/eq.rs` | 3 unit tests |
| Compressor with soft knee, attack/release, makeup | `src/dsp/dynamics.rs` | 2 unit tests |
| Limiter with hard ceiling guarantee | `src/dsp/dynamics.rs` | 2 unit tests |
| Transmitter: transient/sustain split that sums back to the input | `src/dsp/transmitter.rs` | 4 unit tests |
| Audio Logger: 60 s master ring buffer + WAV recovery | `src/logger.rs` | 4 unit tests |
| Chord detection (piano roll label) + in-key chord suggestions | `src/chord.rs` | 7 unit tests |
| Clip expansion: per-clip pan, pitch, stretch, fades, pattern looping | `src/clips.rs` | 10 unit tests |
| Note names + clip normalisation (individual/group) | `src/notes.rs` | 6 unit tests |
| Mixer routing, multi-send, pre-fader sends, sidechain ducker | `src/mixer.rs` | 11 unit tests |
| Automation lanes: curves, ranges, looping, step sampling | `src/automation.rs` | 10 unit tests |
| Piano-roll tools: strum, arpeggiate, flam, scales | `src/piano_tools.rs` | 12 unit tests |
| Playlist tools: slice, chop, quantize, trim, duplicate | `src/playlist_tools.rs` | 10 unit tests |
| Modular effect graph (Patcher-style) | `src/effect_graph.rs` | 8 unit tests |
| Local natural-language command parser | `src/command.rs` | 8 unit tests |
| fundsp master graph + diagnostic sine | `src/graph.rs` (`fundsp-graph` feature) | 3 unit tests |

`cargo test -p openbeats-audio --features fundsp-graph` runs **118 tests** and is a
required CI step. The device layer is feature-gated so the maths builds and tests
on machines without an audio backend.

## How the app uses it

```
React (unchanged UI)
  │  start_playback(project_data)      src-tauri/src/audio_commands.rs
  ▼
NativeEngine (CPAL thread)  →  Sequencer → VoicePool → EQ → Comp → Limiter → Master gain
                                                    ├── Transmitter (meter)
                                                    └── AudioLogger → recover_audio_log()
```

Tauri commands: `start_playback`, `stop_playback`, `playback_state`,
`native_audio_devices`, `play_test_tone`, `recover_audio_log`, `detect_chord`,
`parse_native_command`.

The frontend calls these through `src/lib/nativeAudio.ts`. Playback uses the
native transport when `__TAURI_INTERNALS__` is present and falls back to Web
Audio in a browser tab, so the web demo keeps working. Clip gain multiplies
velocity in both paths (`Clip.gain`).

## Honest gaps

- **Instrument parity is approximate.** The Rust voices are compact procedural
  models sharing the Web Audio parameter names; they are not sample-identical to
  `src/audio/instruments.ts`. A/B null testing per preset is still TODO.
- **Effects beyond EQ/comp/limiter are Web Audio only.** Reverb, delay, drive,
  filter and the 10-band EQ have no Rust implementation yet; the native master
  chain is EQ → compressor → limiter.
- **Realtime safety.** The callback shares state through a `Mutex` it only
  `try_lock`s; a busy command thread drops a buffer rather than blocking audio.
  A lock-free ring buffer is the next step.
- **Plugin inserts are not in the CPAL callback yet.** `Process`/`RealtimeEndpoint`
  are implemented in `openbeats-plugins`; routing the endpoint into the audio
  callback is the next integration step.
- **Clip stretch is sequencer-level, not pitch-preserving.** `clips::expand_clip`
  scales note positions and lengths (FL's per-clip stretch factor applied to
  pattern clips); a phase-vocoder-style stretcher for audio clips is not built.
- **Per-clip pan is applied by the native engine only**; the Web Audio fallback
  keeps using the channel pan.
- **Transmitter detection input is the master sum**, not a selectable sidechain
  source, and hold/release are exposed through `set_detection` rather than the UI.
- **The mixer graph, automation lanes and modular effect graph are not in the
  CPAL callback yet.** They are implemented, tested and exposed over IPC, but the
  audio thread still runs the fixed EQ → compressor → limiter chain.
- **Offline bounce and Fix My Mix still use the Web Audio renderer.**
- **No device hot-plug handling yet**; a stream error is counted in
  `EngineSnapshot::stream_errors` and surfaced to the UI.

## Platform note

`plughost` 0.2.1 does not compile on Linux (its `plughost-core` platform layer has
no Linux implementation), so plugin hosting is disabled there by design — see
[PLUGINS.md](PLUGINS.md). The audio engine itself is cross-platform.

## Acceptance still to run on real hardware

30 minutes at 44.1 and 48 kHz without xruns, device unplug/replug, and a null test
of the demo song against the Web Audio reference. These need a desktop session
with an audio device and have not been run in CI.
