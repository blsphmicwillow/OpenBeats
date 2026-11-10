# Plugins — library, example, and hosting roadmap

## What ships in 1.0.0

OpenBeats 1.0.0 has a **plugin library**, not a plugin host.

- **Browse and download:** **View → Plugin library…** reads the GitHub-backed
  registry in [`plugins/registry.json`](../plugins/registry.json), resolves each
  project's GitHub Release, and opens the publisher's download URL.
- **Search and filter:** filter by VST3/CLAP, inspect release notes, formats,
  platform, licence and asset size.
- **Offline fallback:** the same registry is bundled into the app, so the page
  still opens when GitHub is unavailable.
- **Proof plugin:** [`plugins/openbeats-gain`](../plugins/openbeats-gain) is a
  Rust `nice-plug` effect that exports **VST3 and CLAP** bundles. It is a real
  compiled plugin, not a mock, and can be loaded in Bitwig, REAPER, Ardour,
  Carla or another native host.
- **Community path:** submissions use the
  [plugin submission form](../.github/ISSUE_TEMPLATE/plugin-submission.yml), and
  maintainers update the registry after checking the repository, licence and
  release provenance.

The library never executes a downloaded binary. It does not silently install
anything, and “reviewed” means provenance was checked, not that the plugin was
security-audited.

## What is not included

OpenBeats **cannot load VST3, AU, CLAP or FL Studio plugins into its own mixer**
in 1.0.0. That is a native-hosting problem, not a missing file picker. The plugin
library is deliberately separate from the audio engine so it can ship without
pretending hosting exists.

## Why Web Audio cannot host native plugins

OpenBeats renders with the Web Audio API inside a Tauri WebView. Web Audio can
host `AudioWorklet` DSP written in JavaScript/WASM, but it cannot load a platform
binary (`.vst3` bundle, `.component`, `.dll`, `.so`) or run its COM/C++ ABI.
Plugins also need:

- a native message loop and per-format host interfaces (VST3 `IComponent` /
  `IEditController`, AU `AudioUnit`, CLAP `clap_plugin`);
- sample-accurate buffers in the audio callback, shared with the Web Audio graph;
- isolated scanning, because a badly behaved plugin can crash or hang the host;
- platform code signing/notarisation and, on macOS, hardened-runtime exemptions;
- editor windows embedded in the Tauri window (child HWND/NSView/X11 window).

None of that can be shipped as a React component, and it cannot be validated in
a Linux container for Windows/macOS.

## Hosting architecture (future milestone)

1. **`openbeats-host` native process** (Rust): scans plugin folders, hosts
   VST3/AU/CLAP, processes audio, and exposes an IPC protocol (shared memory for
   audio + JSON for parameters/state).
2. **Audio bridge**: replace the current Web Audio master with a Rust audio
   device (cpal), or run the plugin chain as an insert via a loopback/WASM
   fallback. The bridge must stay sample-accurate with the Web Audio scheduler.
3. **Plugin manager UI**: scan roots (`~/.vst3`, `/usr/lib/vst3`,
   `/Library/Audio/Plug-Ins/VST3`, `%COMMONPROGRAMFILES%\VST3`), show results,
   and attach a plugin to a channel or mixer insert with state save/restore in
   `.obeats`.
4. **Project state**: store plugin IDs, parameter values and opaque plugin state
   blobs; never ship the plugin binary in a project file.
5. **Safety**: out-of-process scan, watchdog, crash recovery, and a clear
   “plugin failed” state instead of taking down the session.

## Acceptance tests before hosting can ship

- Scan and load one free VST3 on Linux, Windows and macOS.
- Play a MIDI pattern through a hosted instrument at 44.1 and 48 kHz with no
  drift.
- Automate a parameter, save `.obeats`, reopen, and recover the exact state.
- Kill a plugin process mid-playback and keep the session alive.
- Verify offline bounce includes hosted plugins.
- Windows/macOS installer signing and notarisation.

## Registry and release path

The registry points at public GitHub Releases, so plugin authors do not need to
ship an OpenBeats build. `scripts/fetch-plugins.mjs` resolves the current release
metadata into `plugins/registry.lock.json` for reproducible site/CI checks, and
the app itself caches release lookups for 15 minutes. The registry is intentionally
small and reviewed; it is not an open executable marketplace.

The first release asset is
`OpenBeatsGain-0.1.0-linux-x86_64.tar.gz` under the
`openbeats-gain-v0.1.0` tag. Install the `.clap` file in `~/.clap/` or the `.vst3`
bundle in `~/.vst3/`, then rescan in a native host.
