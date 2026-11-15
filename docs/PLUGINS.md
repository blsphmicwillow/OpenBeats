# Plugins — library, example, and hosting roadmap

> **1.0.9 status:** the source-verified Linux investigation is in
> [PLUGIN_HOST_REVERSE_ENGINEERING_1.0.7.md](PLUGIN_HOST_REVERSE_ENGINEERING_1.0.7.md).
> It records the exact compile-time gate and a CLAP-first implementation path.

## What ships in 1.0.6

OpenBeats 1.0.6 has a **plugin library**, not a plugin host.

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

## Native hosting status

Linux can load a CLAP effect on each channel strip for live CPAL playback. Each
instance runs in a supervised helper, and the callback communicates through
preallocated bounded queues; a stopped helper falls back to delayed dry audio.
Other strips are delayed to match the hosted path. This is an experimental first
milestone, not full plugin support.

CLAP state blobs and host-visible parameter values are captured into `.obeats`
project files and restored before playback. The Mixer provides a generic
parameter editor, and parameter changes are sent to the helper through a
bounded lock-free queue rather than a callback control path. Linux exports also
render mixer strips through their CLAP inserts before routing; a load or
processing failure aborts the export instead of silently bypassing the insert.
These paths remain experimental. Parameter automation is not implemented.
VST3 and AU are not hosted on Linux. Windows/macOS plugin helper support is not
routed into the mixer.

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

## Hosting architecture and remaining milestones

1. **CLAP live insert (implemented experimentally):** the Linux sidecar loads
   the plugin before playback; the callback uses a lock-free bounded SPSC bridge
   and never makes helper protocol calls. A watchdog kills a helper that exits
   or stops making progress. Plugin latency is queried and compensated.
2. **Offline rendering (experimental):** render strips in routing order and
   process each CLAP insert in the isolated helper before strip faders, sends
   and routing. Plugin latency is aligned with the other strip paths.
3. **Parameter controls and native editor (implemented experimentally):** edit
   host-visible CLAP parameters from the Mixer and persist values with the
   project. The Mixer can open and close a supported floating CLAP GUI in the
   supervised helper while playback is active. Embedded editors and parameter
   automation remain out of scope.
4. **Additional formats/platforms:** evaluate Linux VST3 and integrate the
   existing Windows/macOS helpers into their audio paths.

## Linux hosting verification

The Linux PR workflow builds OpenBeats Gain and the helper, then runs:

- helper protocol tests for load, parameter changes, state restore and offline
  audio, plus native X11 GUI create/show/hide under Xvfb;
- a separate local compatibility smoke opened and closed the Dragonfly Room
  Reverb CLAP editor under Xvfb; it is not a CI package dependency;
- engine tests for live mixer processing, callback allocation, non-zero
  latency alignment, and dry fallback after a hung helper;
- a CPAL smoke run against the PulseAudio null sink, exercising an inserted
  plugin, a live parameter change, project-state capture/JSON reload, and
  playback after reopening.

The Mixer parameter editor can open a plugin's native floating CLAP GUI while
the insert is active in playback. The GUI is created in the supervised helper,
not the CPAL callback. The helper also services CLAP host timers for editors
that require periodic callbacks. Plugins without a supported X11 or Wayland GUI
return an explicit error. A floating X11 editor is made transient to the
OpenBeats window when the active desktop exposes an X11 window handle. CI
exercises the host lifecycle with a minimal X11 fixture; embedded editors and
parameter automation remain out of scope.

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
| Windows 10/11 | yes | yes | — | helper exists; mixer routing not implemented |
| macOS | yes | yes | yes | helper exists; mixer routing not implemented |
| Linux | — | live and offline effects (experimental) | — | state and parameter-value round-trip; generic and floating native editors available; automation incomplete |

Linux does **not** use `plughost`: `plughost-core` 0.2.1 has no Linux platform
module, so the Rust `openbeats-plugins` crate still compiles to its historical
stub there. The 1.0.9 branch adds a separate, Linux-only
`openbeats-clap-helper` built on `clack-host 0.2`. It scans `~/.clap`,
`/usr/lib/clap`, `/usr/local/lib/clap` and `$CLAP_PATH`, loads an entry, and
processes stereo f32 blocks on a dedicated thread. Tauri commands
`scan_plugins_linux` and `load_plugin_linux` are called by the plugin browser;
`tauri.linux.conf.json` bundles the sidecar, and the Linux CI job stages it.

Linux CLAP inserts are now routed through the CPAL mixer runtime. VST3 on Linux
is still out of scope for this helper. The Windows/macOS `plughost-helper` is
unchanged and is not connected to those platforms' mixer callbacks.

Build the Linux sidecar on Linux and stage it where Tauri expects it:

```bash
cargo build -p openbeats-clap-helper --target x86_64-unknown-linux-gnu
cp target/x86_64-unknown-linux-gnu/debug/openbeats-clap-helper \
  src-tauri/binaries/openbeats-clap-helper-x86_64-unknown-linux-gnu
```

The helper is spawned by Rust with piped stdin/stdout for control and audio
blocks. The CPAL callback only reads/writes bounded in-memory queues; it never
waits on the helper. No `shell:` permission is exposed to the webview, so the
frontend cannot execute arbitrary programs.

### Crash handling

Linux CLAP instances load in a helper process, never in the app process. If the
helper crashes or stops making progress, the watchdog terminates it, the strip
reports “plugin stopped,” and playback continues through latency-matched dry
audio. Starting playback again creates a fresh helper. The separate
`plughost-helper` chain commands still apply to Windows/macOS hosting; that path
is not yet connected to their mixer callbacks.
