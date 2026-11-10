# Plugins — library, example, and hosting roadmap

## What ships in 1.0.0

OpenBeats 1.0.0 has a **plugin library**, not a plugin host.

- **Browse and download:** **View → Plugin library…** reads the GitHub-backed
  registry in [`plugins/registry.json`](../plugins/registry.json), resolves each
  project's GitHub Release, and opens the publisher's download URL.
- **Search and filter:** filter by VST3/CLAP and by vendor-style category
  (for example `Dynamics - Compressor`), inspect release notes, formats,
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

OpenBeats **cannot load VST3, AU, CLAP or reference DAW plugins into its own mixer**
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

## Platform support (verified against plughost 0.2.1)

| Platform | VST3 | CLAP | Audio Units | State |
| --- | --- | --- | --- | --- |
| Windows 10/11 | yes | yes | — | supported |
| macOS | yes | yes | yes | supported |
| Linux | — | — | — | **not supported** |

Linux is disabled rather than faked: `plughost-core` 0.2.1 does not implement its
`platform` module for Linux, so the crate does not compile there. The
`openbeats-plugins` crate therefore compiles to a stub on Linux whose hosting
calls return:

> VST3/CLAP hosting is unavailable on Linux in this build: plughost 0.2.1 does
> not implement its Linux platform layer. The plugin browser still works.

What still works on Linux: the plugin browser, categories, the bundled Gain
utility and everything else in the app. What does not: scanning for and inserting
native plugins. The Windows and macOS installers ship the `plughost-helper`
sidecar; on Linux no helper is bundled.

### Crash handling

Plugins load in a helper process, never in the app process. If a plugin crashes
or hangs, `Chain` returns `Error::Crashed` / `Error::TimedOut`, the UI is told,
and `recover_plugin_chain` rebuilds the chain in a fresh helper from the same
plugins.
