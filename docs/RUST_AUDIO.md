# Native Rust audio migration

**Status: planned, not shipped.** OpenBeats 1.0.0 renders with Web Audio inside the Tauri
WebView. The desktop binary is native Rust, but the audio engine is not. This document is
the concrete migration plan; it is intentionally not presented as a completed port.

## Why it was not done in this build

- The Linux build environment has no `libasound2-dev`, and `sudo` is disabled, so a CPAL
  backend cannot compile here. A native engine must build on CI for Linux, Windows and
  macOS, not just in one container.
- Web Audio currently provides instruments, effects, scheduling, meters, offline bounce
  and the analyser used by Fix My Mix. Replacing it is a staged port, not a dependency swap.
- A native engine that only plays a test tone would not be a DAW engine, so 1.0.0 does not
  pretend to have one.

## Target architecture

```
React UI (Tauri WebView)
        │  commands / parameter events
        ▼
Rust audio service (cpal + lock-free ring buffers)
  ├── transport clock + scheduler
  ├── instruments and sampler
  ├── mixer graph, effects, sends
  ├── plugin host (VST3/AU/CLAP) — separate process
  └── offline renderer for WAV/Fix My Mix
```

## Phases

1. **Device layer** — add `cpal`, enumerate output devices, expose `native_audio_devices`
   and a safe test tone. Install `libasound2-dev` in Linux CI; use CoreAudio/WASAPI on
   macOS/Windows. Acceptance: a tone plays on all three platforms and devices are listed.
2. **Transport + clock** — move `nextStep`/`nextTime` scheduling into Rust with a monotonic
   clock and sample-accurate event timestamps. Keep the Web Audio scheduler behind a
   feature flag until parity.
3. **Instruments** — port the twelve procedural voices and the sampler; stream metering
   back to the UI at ~30 Hz. Acceptance: A/B the demo song against the Web Audio render.
4. **Mixer + effects** — port the eight effect types, sends, buses and master chain.
   Acceptance: null-test each insert and the master at 48 kHz.
5. **Offline bounce** — render faster than real time to WAV; move Fix My Mix analysis to
   Rust FFT or a shared Rust/WASM FFT. Acceptance: measured LUFS/peak within 0.1 of the
   current renderer.
6. **Plugins** — see [PLUGINS.md](PLUGINS.md); host in a separate process, never in the
   UI process.

## Acceptance tests

- 30-minute playback at 44.1 and 48 kHz with no drift or xruns.
- Device unplug/replug recovers without losing the transport position.
- Demo song null-tests against the Web Audio reference.
- Offline bounce matches real-time output sample-for-sample.
- CPU stays below 20% on the demo song at 128-sample buffers.
- Linux, Windows and macOS CI all build and launch.

## What ships in 1.0.0

Web Audio remains the engine, with all studio features working. The native shell, binary
and installers are real; the Rust audio service is the next major engineering phase.
