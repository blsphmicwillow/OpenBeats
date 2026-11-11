# OpenBeats plugin host — Linux reverse engineering (1.0.7)

Status: **Linux CLAP scan/load/process implemented; mixer insert and installer
validation still pending.**

> **Implementation update (11 November 2026):** the Linux-only
> `openbeats-clap-helper` crate now uses `clack-host 0.2` to scan, load, activate
> and process `OpenBeatsGain.clap`, and `PluginBrowser.tsx` calls the typed
> `scan_plugins_linux` / `load_plugin_linux` commands. `tauri.linux.conf.json`
> bundles the sidecar and the Linux CI job stages it. The historical audit below
> describes **1.0.6**, when none of that existed; its statements about “no Linux
> host” are preserved as evidence, not as the current branch state. Mixer insert
> routing is still blocked (see section 3 and the companion audit).

Source audited: `release/1.0.6` at `855699d` (OpenBeats 1.0.6), plus the
`plughost-core 0.2.1` and `clack-host 0.2.0` crate sources.

This document answers the four questions directly, records the evidence, and
gives a realistic path to Linux plugin compatibility. It deliberately does not
pretend that removing a compile-time `cfg` is enough.

The companion wiring audit is [AUDIT_WIRING_1.0.7.md](AUDIT_WIRING_1.0.7.md).
It records the 75 Rust commands, 68 frontend invocations, the 12 registered
commands with no caller, and the exact per-strip mixer blocker.

## 1. Short answers

| Question | Answer |
| --- | --- |
| How is `plugins/registry.json` wired in? | It is a frontend-only download catalogue. React fetches the JSON, resolves GitHub Releases, and opens asset URLs in the browser. It never enters the Rust backend and never loads a plugin. |
| What does the Windows/macOS host look like? | `openbeats-plugins/src/host.rs` uses `plughost 0.2.1` to spawn `plughost-helper` for scanning and chains. The helper is bundled only by `tauri.windows.conf.json` and `tauri.macos.conf.json`. The Rust commands are registered, but no React code calls them. |
| Why was Linux disabled in 1.0.6? | It was a **compile-time dependency and module gate**, not a runtime capability check. `plughost` is only a dependency on non-Linux targets; Linux compiles `unsupported.rs`; the Linux helper exits with code 78; no Linux `externalBin` existed. `plughost-core 0.2.1` has no Linux platform implementation. |
| What enabled it in 1.0.7? | A new Linux host implementation, the CLAP-first out-of-process `openbeats-clap-helper` built on `clack-host`, plus IPC, Tauri bundle/CI changes, and UI scan/load. VST3 support can follow. A one-line `cfg` patch cannot work. |

## 2. Evidence from 1.0.6

| File | Finding |
| --- | --- |
| `src-tauri/crates/openbeats-plugins/Cargo.toml` | `plughost = "=0.2.1"` is under `[target.'cfg(not(target_os = "linux"))'.dependencies]`. Linux never sees the crate. |
| `src-tauri/crates/openbeats-plugins/src/lib.rs` | `#[cfg(not(target_os = "linux"))] mod host;` and `#[cfg(target_os = "linux")] mod unsupported;`. There is no runtime `cfg!` branch in the hosting path. |
| `src-tauri/crates/openbeats-plugins/src/unsupported.rs` | Every hosting call returns: “VST3/CLAP hosting is unavailable on Linux in this build: plughost 0.2.1 does not implement its Linux platform layer.” |
| `src-tauri/plughost-helper/src/main.rs` | On Linux `main` prints the same reason and calls `std::process::exit(78)`. |
| `.github/workflows/release.yml` | At 1.0.6, “Stage plugin host helper” ran only when `matrix.platform != 'ubuntu-22.04'`. The 1.0.7 branch adds a Linux CLAP staging step. |
| `src-tauri/tauri.windows.conf.json`, `tauri.macos.conf.json` | Each adds `"externalBin": ["binaries/plughost-helper"]`; these are unchanged. |
| `src-tauri/tauri.conf.json` | At 1.0.6 there was no base `externalBin` and no `tauri.linux.conf.json`. The 1.0.7 branch adds the Linux config. |
| `src-tauri/src/lib.rs` | Registers `scan_plugins`, `load_plugin_chain`, `unload_plugin_chain`, `recover_plugin_chain`, `plugin_host_support`. Registration is not reachability. |
| `src-tauri/src/plugin_commands.rs` | Wraps `PluginHost` in `PluginState`; commands are backend-only. |
| `src/components/PluginBrowser.tsx` | Reads the registry and calls `openExternal` for downloads. It has no `invokeNative('scan_plugins')` or chain command. Its subtitle still says 1.0.0. |
| `src/lib/pluginRegistry.ts` | Fetches `plugins/registry.json`, resolves GitHub Releases, caches for 15 minutes. No Tauri import. |
| `docs/PLUGINS.md` | Already documents that `plughost-core 0.2.1` has no Linux platform layer; version text was stale at 1.0.0. |
| `plugins/registry.json` | The first-party OpenBeats Gain entry is a real Linux VST3/CLAP archive; the library only downloads it. |

`plughost-core 0.2.1` source contains no `cfg(target_os = "linux")` and no
Linux platform module. Its shared-memory/doorbell/clock modules implement macOS
and Windows paths only. That is the hard blocker, not a UI toggle.

## 3. Current data flow

```text
plugins/registry.json
        │  fetch (frontend)
        ▼
pluginRegistry.ts ──► PluginBrowser.tsx ──► browser download
        │
        └── no Tauri invoke

Tauri frontend (React)
        │  no invoke('scan_plugins') / load_plugin_chain
        ▼
plugin_commands.rs ──► PluginState
        │
        ├── Windows/macOS: host.rs ──► plughost ──► plughost-helper
        └── Linux: unsupported.rs ──► error string
```

Even on Windows/macOS, the host backend is not wired into the mixer or the
React UI. The README is explicit that inserts are not routed into the CPAL
audio callback. Linux compatibility is therefore two problems:

1. **Platform hosting**: there is no Linux `plughost` platform layer or helper.
2. **Product integration**: scan/load results are not exposed in the UI or the
   audio graph on any platform.

## 4. Ghidra setup (Linux)

Ghidra is optional for this repository because the source is available, but it
is the right tool for a stripped release binary or a build without symbols.

### 4.1 JDK

Check the release notes for the exact supported JDK. Recent Ghidra releases
require JDK 21 or 25; do not use an older JDK.

```bash
# Arch
sudo pacman -S jdk21-openjdk

# Debian / Ubuntu
sudo apt install openjdk-21-jdk

# Fedora
sudo dnf install java-21-openjdk-devel
```

If the release requires JDK 25, install `jdk25-openjdk` / `openjdk-25-jdk`
instead. Confirm with `java -version` and make sure `JAVA_HOME` points at it.

### 4.2 Official Ghidra release

Download the **official multi-platform release** from
<https://github.com/NationalSecurityAgency/ghidra/releases>. The asset is named
`ghidra_<version>_PUBLIC_<date>.zip`. Do **not** download the “Source Code”
zip. Check the release advisory/security notes before use.

```bash
mkdir -p ~/tools
cd ~/Downloads
sha256sum ghidra_*_PUBLIC_*.zip        # compare with the release checksum
unzip ghidra_*_PUBLIC_*.zip -d ~/tools/ghidra
cd ~/tools/ghidra
./ghidraRun
```

If `ghidraRun` cannot find Java, set `JAVA_HOME` to the JDK installation.

### 4.3 Sway / Wayland window issues

If the Ghidra window is blank or misplaced under Sway/Wayland, edit
`~/tools/ghidra/support/launch.properties` and uncomment:

```properties
ENVVARS_LINUX=_JAVA_AWT_WM_NONREPARENTING=1
```

Then relaunch `./ghidraRun`. This is the documented AWT non-reparenting
workaround; it does not change the binary being analyzed.

### 4.4 Headless project creation

```bash
~/tools/ghidra/support/analyzeHeadless \
  ~/ghidra-projects OpenBeats106 \
  -import /path/to/openbeats-linux-binary \
  -overwrite
```

For a GUI: **File → Import File**, accept the analysis prompts, then use
**Search → For Strings** and **Window → Functions**.

### 4.5 GhidRust expectation

GhidRust is paused and only partially usable. Do not expect a clean Rust
decompilation. Ghidra’s built-in Rust identification and demangling have
improved, but a stripped Tauri release will still be mostly symbols, strings,
imports and cross-references. Treat decompiled Rust as a map, not source.

## 5. Binary static analysis plan

### 5.1 Get the Linux binary

From the published AppImage (use the current release asset):

```bash
chmod +x OpenBeats_1.0.6_amd64.AppImage
./OpenBeats_1.0.6_amd64.AppImage --appimage-extract
find squashfs-root -maxdepth 5 -type f -perm -111 | sort
```

The main executable is usually under `squashfs-root/usr/bin/`. If the AppImage
is unavailable, build a debug binary on a Linux host with the Tauri
dependencies; debug symbols make source mapping much easier.

### 5.2 First-pass strings

```bash
BIN=squashfs-root/usr/bin/OpenBeats   # adjust to the actual name
file "$BIN"
strings -a -n 6 "$BIN" > /tmp/openbeats.strings

rg -i 'plughost|plugin host|vst3|clap|scan_plugins|load_plugin_chain|plugin_host_support|recover_plugin_chain' /tmp/openbeats.strings
rg -i 'unavailable on Linux|not supported on this platform|plugin helper is missing' /tmp/openbeats.strings
rg -i '__TAURI_INTERNALS__|tauri|invoke' /tmp/openbeats.strings | head -40
rg -i 'dlopen|libloading|Command::new|spawn' /tmp/openbeats.strings | head -40
```

What to look for:

| String / symbol | Meaning |
| --- | --- |
| `VST3/CLAP hosting is unavailable on Linux` | Confirms the Linux stub is compiled in. |
| `plughost-helper` | The Windows/macOS sidecar name; absence on Linux is expected. |
| `scan_plugins`, `load_plugin_chain` | Tauri command names may survive in panic/debug strings or the invoke table. Macro-generated names can be absent. |
| `__TAURI_INTERNALS__` | Frontend bridge symbol; the JS bundle is embedded separately. |
| `dlopen`, `libloading` | A real Linux host would load `.so`/`.clap`; the stub should not. |
| `not supported on this platform` | A runtime check would appear here; the current gate is compile-time. |

### 5.3 Find the frontend bundle

Tauri embeds the built React assets. Search the AppImage tree for JS:

```bash
find squashfs-root -type f \( -name '*.js' -o -name '*.html' \) | head
rg -a 'scan_plugins|load_plugin_chain|plugin_host_support|Plugin library' squashfs-root | head -40
```

A hit for `Plugin library` but not `scan_plugins` confirms the UI is
registry-only. A hit for `scan_plugins` means the frontend can reach the host
and the gap is backend/platform only.

### 5.4 Ghidra workflow

1. Import the binary; let auto-analysis finish.
2. **Search → For Strings**, filter for the table above.
3. Open the string’s cross-references. The Linux stub error should lead to a
   small function that returns a constant error and never calls `dlopen`.
4. Search for `plughost-helper`; xrefs should be limited to Windows/macOS-only
   code or absent in the Linux binary.
5. Check imports for `dlopen`, `dlsym`, `pthread_create`, X11/Wayland symbols.
   A host would need at least dynamic loading and a realtime path.
6. Compare with the source-verified call graph. If the binary disagrees, trust
   the binary for what shipped and the source for intent.

### 5.5 What binary analysis cannot prove

A stripped binary cannot tell you whether a missing feature was disabled for
licensing, stability, or schedule reasons. It can prove the code path and
dependency shape; it cannot prove product intent. The source and release notes
are the authoritative record for this project.

## 6. Source review plan

Run these before and after any patch:

```bash
# Every platform gate that touches plugins
git grep -n 'cfg(target_os' -- src-tauri

# Confirm the Linux dependency graph has no plughost
cargo tree -p openbeats-plugins --target x86_64-unknown-linux-gnu

# Compile the stub and the helper on Linux
cargo check -p openbeats-plugins
cargo check -p openbeats-plughost-helper

# Find every command and every caller
git grep -n 'scan_plugins\|load_plugin_chain\|plugin_host_support' -- src src-tauri
```

Inspect, in order:

1. `src-tauri/crates/openbeats-plugins/Cargo.toml` — target-specific dependency.
2. `src-tauri/crates/openbeats-plugins/src/lib.rs` — module split.
3. `src-tauri/crates/openbeats-plugins/src/host.rs` — the real `PluginHost`
   API that a Linux implementation must match.
4. `src-tauri/crates/openbeats-plugins/src/unsupported.rs` — the exact stub and
   error contract.
5. `src-tauri/plughost-helper/src/main.rs` — Linux exit path.
6. `src-tauri/src/plugin_commands.rs` — Tauri command surface.
7. `src-tauri/src/lib.rs` — registration and helper path.
8. `src/components/PluginBrowser.tsx` — no host calls.
9. `src-tauri/tauri.*.conf.json` and `.github/workflows/release.yml` — bundling.
10. `docs/PLUGINS.md` and `plugins/registry.json` — product claims vs reality.

## 7. Linux enablement path

### Option A — CLAP-first helper (recommended)

CLAP is the best first target on Linux:

- open, documented C ABI with a Rust host crate that builds on Linux;
- the first-party OpenBeats Gain plugin is already a real `.clap` and `.vst3`;
- no COM, no Apple frameworks, no VST3 SDK GUI dependency for headless
  processing;
- CLAP’s host API covers audio ports, parameters, state and restart callbacks.

Proposed shape:

```text
OpenBeats app (Linux)
  └── openbeats-plugins/src/host_linux.rs
        └── spawn openbeats-clap-helper (new sidecar)
              ├── scan ~/.clap, /usr/lib/clap, /usr/local/lib/clap, $CLAP_PATH
              ├── clack-host 0.2: PluginEntry → PluginFactory → PluginInstance
              └── process stereo f32 blocks, report parameters/state
```

Implementation steps:

1. **New helper crate** `src-tauri/crates/openbeats-clap-helper` with
   `clack-host = "0.2"` and `serde`/`serde_json`. Implement `HostHandlers`
   (`Shared`, `MainThread`, `AudioProcessor`) for log, timer, parameter and
   thread-check callbacks. Start headless: no editor window.
2. **Scan** every `*.clap` file under the standard roots. Load the entry,
   enumerate `PluginDescriptor`s, and return name/vendor/version/kind/id,
   matching `PluginCandidate`.
3. **Open a chain** by descriptor id. Activate at the project sample rate and
   block size. Keep one helper per chain; scan helpers are short-lived.
4. **IPC**: JSON lines over stdio for control; for realtime audio, a shared
   memory ring (or a documented block RPC first). Do not put JSON on the audio
   callback.
5. **Linux `PluginHost`**: implement the same methods as `host.rs`
   (`scan`, `open_chain`, `process_block`, `recover`, `unload`). Compile the
   Windows/macOS `host.rs` unchanged behind its existing gate.
6. **Bundle**: add `src-tauri/tauri.linux.conf.json` with
   `"externalBin": ["binaries/openbeats-clap-helper"]`; stage it in the Linux
   CI job. Keep the Windows/macOS `plughost-helper` binary untouched.
7. **UI**: add an “Installed” tab to `PluginBrowser` that calls
   `scan_plugins`; show hostable CLAP effects. Add an insert slot to the mixer
   that calls `load_plugin_chain`.
8. **Audio path**: route the insert through the CPAL callback (or an offline
   bounce first). The current native master chain is fixed
   EQ → compressor → limiter; a plugin insert needs an explicit slot before or
   after it.
9. **State**: store plugin id, format, parameters and opaque state in
   `.obeats`; never store the plugin binary.

Minimum honest 1.0.7 milestone: **CLAP scan + load + offline stereo processing
of OpenBeats Gain, with a UI scan list and a documented “not yet in the mixer”
state.** That is testable and does not claim full hosting. Mixer inserts and
VST3 are a later milestone.

### Option B — VST3 after CLAP

VST3 needs a Linux host with `IComponent`/`IEditController`, a message loop and
X11 editor embedding. Rust crates such as `vst3-sys`/`vst3` can provide
bindings; the VST3 SDK and a stable editor host add substantial work. JUCE or
Carla are useful references or external hosts, but a subprocess dependency
changes packaging and licensing. DISTRHO is a plugin framework, not a general
VST3 host; it is not a drop-in solution.

### Option C — add a Linux platform layer to `plughost`

`plughost-core` is MIT/Apache-2.0 and could theoretically gain Linux shared
memory, doorbell, clock and helper support. That means maintaining a fork of a
pinned crate, matching its IPC and crash-recovery semantics, and still adding
UI/mixer integration. It is not the minimal path unless upstream accepts the
work.

### Option D — remove a runtime check

There is no runtime check to remove. The Linux stub is selected at compile
time and the dependency is absent. Deleting the `#[cfg(target_os = "linux")]`
module split without a host would either fail to compile or produce a binary
that cannot load plugins. A “one-line patch” is not a solution.

## 8. Testing and acceptance criteria

Before a Linux host can be called fully working:

- [x] Scan finds `OpenBeatsGain.clap` from `~/.clap` (sidecar acceptance probe).
- [x] Load the Gain CLAP, process a known 48 kHz stereo buffer, and verify the
      output RMS (sidecar acceptance probe). 44.1 kHz is not yet exercised.
- [x] The plugin browser lists scanned plugins and calls `load_plugin_linux`;
      this is typechecked and built, not launched in a desktop webview here.
- [ ] `cargo test -p openbeats-plugins` on Linux covers the new host. The new
      helper is a separate crate; it has an external acceptance probe, not
      `cargo test` coverage yet.
- [ ] A crashing/hanging plugin kills only the helper; the app reports it and
      can recover.
- [ ] One insert is routed into a mixer strip and the audio callback.
- [ ] Offline bounce includes the insert; realtime playback is sample-accurate.
- [ ] Save/reopen restores plugin id, parameters and state.
- [ ] Windows/macOS `plughost` runtime tests still pass; their configs and
      helper are unchanged in this branch.
- [ ] Linux `.deb`, `.rpm` and `.AppImage` contain the new helper and launch it.

## 9. Risks and honesty

- **No clean Rust decompilation.** GhidRust is paused; a stripped Tauri binary
  yields strings, imports and call shapes, not source. Source review is more
  reliable for this repository.
- **The binary may differ from source.** Release builds can omit debug strings
  or apply platform-specific cfg. Verify the shipped artifact separately.
- **A new host may be required.** `plughost` has no Linux platform layer. A
  Linux host is a new implementation, not a flag.
- **The existing host is not product-integrated.** Even Windows/macOS users do
  not get a mixer insert today: the commands are registered but not called by
  the frontend, and inserts are not routed into CPAL.
- **Realtime safety.** CLAP callbacks must not allocate or lock on the audio
  thread; the helper IPC and watchdog need careful design.
- **Licensing.** OpenBeats is GPL-3.0-or-later. Reverse engineering for
  interoperability is generally permitted, but redistributing modified code or
  bundling plugins requires complying with the GPL and each plugin's license.
  Do not bundle proprietary plugins or bypass their licensing.
- **Platform APIs.** CLAP is portable; VST3 editor hosting is not. “Linux
  compatible” may mean CLAP-only for the first release.
- **No 1.0.7 release is implied by this document.** The version is a planning
  label until the code and CI exist.

## 10. Next action

Steps 1–4 are complete on this branch: the helper is the probe and the sidecar,
and it passed the `OpenBeatsGain.clap` scan/load/process acceptance test. The
remaining blocker is the mixer bus, not CLAP loading:

1. Add per-strip stereo buses to `VoicePool` and `PlaybackProject`.
2. Route those buses through `MixerGraph`, with measured insert and automation
   tests.
3. Only then add the plugin insert slot and call the Windows/macOS host path.
4. Do not bump the app to 1.0.7 or publish installers until the mixer bus, the
   desktop compile and the Linux installer launch are green.

This gives a real answer to “does Linux hosting work?” without shipping a
button that cannot load a plugin.
