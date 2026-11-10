# Plugin support — status and roadmap

**Status in 1.0.0: not implemented.** OpenBeats cannot load VST3, AU, CLAP or FL Studio
plugins. This is a native-hosting problem, not a missing file picker, and the release does not pretend otherwise.

## Why Web Audio cannot do it

OpenBeats renders with the Web Audio API inside a Tauri WebView. Web Audio can host
`AudioWorklet` DSP written in JavaScript/WASM, but it cannot load a platform binary
(`.vst3` bundle, `.component`, `.dll`, `.so`) or run its COM/C++ ABI. Plugins also need:

- a native message loop and per-format host interfaces (VST3 `IComponent` / `IEditController`,
  AU `AudioUnit`, CLAP `clap_plugin`);
- sample-accurate buffers in the audio callback, shared with the Web Audio graph;
- isolated scanning, because a badly behaved plugin can crash or hang the host;
- platform code signing/notarisation and, on macOS, hardened-runtime exemptions;
- editor windows embedded in the Tauri window (child HWND/NSView/X11 window).

None of that can be shipped as a React component, and it cannot be validated in a Linux
container for Windows/macOS.

## Architecture that would work

1. **`openbeats-host` native process** (Rust): scans plugin folders, hosts VST3/AU/CLAP,
   processes audio, and exposes an IPC protocol (shared memory for audio + JSON for
   parameters/state).
2. **Audio bridge**: replace the current Web Audio master with a Rust audio device
   (cpal), or run the plugin chain as an insert via a loopback/WASM fallback. The bridge
   must stay sample-accurate with the Web Audio scheduler.
3. **Plugin manager UI**: scan roots (`~/.vst3`, `/usr/lib/vst3`,
   `/Library/Audio/Plug-Ins/VST3`, `%COMMONPROGRAMFILES%\VST3`), show results, and attach
   a plugin to a channel or mixer insert with state save/restore in `.obeats`.
4. **Project state**: store plugin IDs, parameter values and opaque plugin state blobs;
   never ship the plugin binary in a project file.
5. **Safety**: out-of-process scan, watchdog, crash recovery, and a clear “plugin failed”
   state instead of taking down the session.

## Acceptance tests before it can ship

- Scan and load one free VST3 on Linux, Windows and macOS.
- Play a MIDI pattern through a hosted instrument at 44.1 and 48 kHz with no drift.
- Automate a parameter, save `.obeats`, reopen, and recover the exact state.
- Kill a plugin process mid-playback and keep the session alive.
- Verify offline bounce includes hosted plugins.
- Windows/macOS installer signing and notarisation.

## What 1.0.0 gives you instead

- Multi-track **MIDI** import/export for FL Studio, Ableton, Logic, Cubase, Studio One,
  Bitwig and REAPER.
- **Ableton `.als` import** and **REAPER `.rpp` import/export**.
- **Drag-and-drop audio** into sampler channels, with auto-tagging.
- Native instruments, effects and the full mixer stay fully functional.

The DAW interchange matrix is in [EXCHANGE.md](EXCHANGE.md).
