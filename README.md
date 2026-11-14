# OpenBeats

**An open-source beatmaking studio for the desktop.** Channel Rack, step sequencer, piano roll, playlist and mixer, built with a Rust/Tauri desktop shell, a native Rust/CPAL audio engine and a React/Web Audio front end. Linux, Windows and macOS.

[![Latest release](https://img.shields.io/github/v/release/blsphmicwillow/OpenBeats?label=release&color=ffa31a)](https://github.com/blsphmicwillow/OpenBeats/releases/latest)
[![Release build](https://github.com/blsphmicwillow/OpenBeats/actions/workflows/release.yml/badge.svg?branch=v1.0.9)](https://github.com/blsphmicwillow/OpenBeats/actions/workflows/release.yml)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-linux%20%7C%20windows%20%7C%20macOS-lightgrey)](#install-openbeats-108)

![OpenBeats studio](docs/screenshots/studio-default.png)

> OpenBeats is an independent project. It is *inspired by* the workflow of classic pattern-based DAWs (channel rack → patterns → playlist → mixer); it ships no code, samples, presets or assets from any commercial DAW.

## Who builds this

OpenBeats is designed, built and maintained by **[blsphmicwillow](https://github.com/blsphmicwillow)** and **[lizard (@lizardman124)](https://github.com/lizardman124)**, a small independent project with no company behind it.

The code is **AI-assisted**. Large parts are written with AI coding tools working under my direction, then reviewed, tested and debugged by me. Nothing ships because a generated suggestion looked plausible:

- **Reviewed.** Every change gets a line-by-line review of the diff before it lands, plus an independent review pass that hunts for regressions, real-time-safety violations in the audio callback, and claims the tests cannot back up.
- **Tested.** CI typechecks and builds the web app and compiles the native and desktop crates on Linux and Windows. The Rust audio engine has 291 unit tests and the front end has 80. Audio changes are also checked against real devices by testers.
- **Debugged.** 1.0.9 exists because an Arch + PipeWire + Bluetooth A2DP user sent logs that proved a stall-and-reopen loop; the fix is traced in the changelog, and the hardware report , not the test suite , is treated as the final word.
- **Released by CI.** Linux, Windows and macOS installers are built from the tag, and a release is published only when all three jobs pass.

“AI-assisted” describes the tools. The direction, the review, the testing and the responsibility for what ships are mine, bugs included.

## Screenshots

Eleven built-in themes, Classic and Modern chrome, and an editable **My theme** with a colour wheel, HEX and RGB fields:

![Theme and customisation](docs/screenshots/customisation.png)

---

## Audio I/O and workflow highlights

- **Audio Settings tab** lists every input and output device CPAL reports, saves the output/input choice and per-device levels across restarts, and rebuilds the stream when you choose one.
- **Saved audio setup**: the output, low-latency, cue and monitor choices are restored before the startup chime or first playback.
- **Native auditioning**: Browser samples, channel-rack test notes and the metronome play through a dedicated CPAL preview voice that bypasses the sequencer, so they sound even while the transport is stopped.
- **Community sample packs**: import an OpenBeats manifest pack, an FL-style category folder, a generic one-shot zip or a flat dump; samples are categorised, shown in the Packs and Samples tabs, and summarised in an import report. Zips are bounded against traversal, symlinks, oversized entries and compression bombs. [Supported layouts and limits](docs/IMPORT_PACKS.md).
- **Export that just saves**: native WAV, 24-bit WAV and FLAC encoding plus a bundled MP3 encoder, all behind the native save dialog; OGG and M4A use ffmpeg when installed.
- **A playhead you can move**: drag the playhead to seek native playback in real time, and the playlist and piano roll follow it while playing.
- **Friendly device names** by default, including PipeWire/PulseAudio descriptions for Bluetooth/BlueZ, HDMI/DisplayPort and USB endpoints, with an opt-in Dev Mode that shows the raw backend strings.
- **Linux silence fixed properly**: the picker prefers the PipeWire/PulseAudio bridge, because ALSA's `default` device can route to a null sink; F32/F64/I8/I16/I32/U8/U16 formats are handled, unsupported I24/U24 defaults fall back to a supported format, and the opened device, rate and latency are logged.
- **Hot-swap and low latency**: a failed device falls back safely, then the selected Bluetooth/USB output is restored when it returns; stalled callbacks reopen the stream and native playback resumes at the last step. Low-latency mode uses the smallest buffer the device offers with a live latency readout.
- **Master on outputs 1/2, cue on 3/4** for four-channel interfaces, with an independent cue level.
- **True-peak master limiter** with 4× oversampled inter-sample detection, plus Mid/Side inserts, a sidechain dynamic EQ and a `rustfft` spectrum analyser.
- **Smart Humanize** (groove templates, deterministic), **Auto Gain Staging** to -6 dBFS, a rule-based **Melody Generator**, a held-note **Note Arpeggiator**, **Project Health Check**, **Tap Tempo** and **session recovery** every 30 seconds.

---

## Install OpenBeats 1.0.9

Every package is built by GitHub Actions and attached to the
[1.0.9 release](https://github.com/blsphmicwillow/OpenBeats/releases/tag/v1.0.9).
No account is required.

| Platform | Release file | Install |
| --- | --- | --- |
| Arch Linux | `openbeats-bin` (in this repo) | `cd packaging/arch && yay -Bi .` , see below |
| Linux (any) | `OpenBeats_1.0.9_amd64.AppImage` | `chmod +x`, then run it |
| Debian / Ubuntu | `OpenBeats_1.0.9_amd64.deb` | `sudo apt install ./OpenBeats_1.0.9_amd64.deb` |
| Fedora / RPM | `OpenBeats-1.0.9-1.x86_64.rpm` | `sudo dnf install ./OpenBeats-1.0.9-1.x86_64.rpm` |
| Windows 10/11 | `OpenBeats_1.0.9_x64-setup.exe` | Run the installer (or use the `.msi`) |
| macOS (Apple silicon) | `OpenBeats_1.0.9_aarch64.dmg` | Open the DMG and drag OpenBeats to Applications |
| Source | `git clone` | [docs/BUILDING.md](docs/BUILDING.md) |

There is no separate Intel-Mac DMG in 1.0.9; Intel Macs can build from source.
Full per-platform commands, dependencies and troubleshooting are in
[docs/INSTALL.md](docs/INSTALL.md). Release history: [CHANGELOG.md](CHANGELOG.md).

### Arch Linux with `yay`

The AUR-ready package lives in [`packaging/arch`](packaging/arch). It installs
the official 1.0.9 AppImage under `/opt/openbeats`, creates
`/usr/bin/openbeats`, and declares the GTK, GStreamer and PulseAudio runtime it needs.

**Install from this repository now** (works without the AUR):

```bash
sudo pacman -S --needed base-devel git

git clone https://github.com/blsphmicwillow/OpenBeats.git
cd OpenBeats/packaging/arch

yay -Bi .
```

`yay -Bi` builds and installs the local `PKGBUILD`; it offers to install any
missing dependency. To install the dependencies yourself first:

```bash
sudo pacman -S --needed gtk3 gstreamer gst-plugins-base gst-plugins-good \
  gst-plugins-bad gst-plugins-ugly gst-libav libpulse alsa-lib \
  libayatana-appindicator librsvg openssl xdg-utils hicolor-icon-theme

# Choose the audio server you actually use:
sudo pacman -S --needed pipewire-pulse pipewire-alsa   # PipeWire (recommended)
# sudo pacman -S --needed pulseaudio pulseaudio-alsa   # PulseAudio instead
```

`pipewire-alsa` (or `pulseaudio-alsa`) is a **hard requirement**, not a
nice-to-have. The native engine speaks ALSA through CPAL, and that bridge is what
provides the `pipewire`/`pulse` ALSA PCM which reaches the sound server. With a
sound server installed but no bridge, ALSA's `default` PCM resolves to a null
sink or a raw device PipeWire already owns, and the app opens a stream that
produces no sound. Verify with `aplay -L | grep -iE 'pipewire|pulse'`: an empty
result means the bridge is missing.

The package declares `pulse-native-provider`, so `pacman` requires either
`pipewire-pulse` or `pulseaudio`. The AUR package name is `openbeats-bin`. It is
**not published on the AUR yet** (no AUR maintainer key is available in this
build environment), so
`yay -S openbeats-bin` will work only after the maintainer pushes it once:

```bash
ssh -T aur@aur.archlinux.org   # must greet you; needs an AUR SSH key
git clone ssh://aur@aur.archlinux.org/openbeats-bin.git
cp packaging/arch/PKGBUILD packaging/arch/.SRCINFO openbeats-bin/
cd openbeats-bin && git add PKGBUILD .SRCINFO
git commit -m "openbeats-bin 1.0.9" && git push
```

### AppImage (portable Linux)

```bash
curl -L -o OpenBeats.AppImage \
  https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.9/OpenBeats_1.0.9_amd64.AppImage
chmod +x OpenBeats.AppImage
./OpenBeats.AppImage
```

If FUSE is unavailable, extract and run instead:
`./OpenBeats.AppImage --appimage-extract-and-run`.

Shelly 3.0.6 and 3.2.1 install this image directly. If an older Shelly reports
`InvalidExe`, update Shelly first, then install FUSE 3 (`sudo pacman -S fuse3`)
and retry; `--appimage-extract-and-run` also bypasses the FUSE mount.

### Debian / Ubuntu

```bash
curl -L -O https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.9/OpenBeats_1.0.9_amd64.deb
sudo apt install ./OpenBeats_1.0.9_amd64.deb
openbeats
```

The package declares WebKitGTK 4.1, the full GStreamer audio stack and a
PulseAudio-compatible sound server (`pipewire-pulse` or `pulseaudio`). You
should not need to install audio plugins by hand.

### Fedora

```bash
sudo dnf install ./OpenBeats-1.0.9-1.x86_64.rpm
openbeats
```

The RPM declares the GStreamer audio plugins and a PipeWire-Pulse/PulseAudio
server, so no separate multimedia package list is required.

### Windows

1. Download `OpenBeats_1.0.9_x64-setup.exe` (or the `.msi`) from the release.
2. Run it. Current installers use the WebView2 download bootstrapper: if
   WebView2 is missing, setup downloads it once, so allow network access on the
   first install.
3. SmartScreen may warn because the build is not code-signed: **More info →
   Run anyway**.

### macOS (Apple silicon)

1. Download `OpenBeats_1.0.9_aarch64.dmg` and open it.
2. Drag **OpenBeats** into **Applications**.
3. The DMG is not notarised, so on first launch use **Control-click → Open**, or
   run `xattr -dr com.apple.quarantine /Applications/OpenBeats.app`.

### First run

1. The built-in **Tutorial** project opens automatically. Press **Space** to play.
2. `Ctrl/Cmd + K` opens the command palette , everything is reachable from there.
3. **Help → Tutorial** walks the Rack → Piano roll → Playlist → Mixer flow.
4. **File → Projects…** creates or opens songs; **File → Export** bounces a WAV,
   optionally loudness-normalised for a streaming target.
5. **Help → Learn** walks through every module and a complete first-song path.

---

## FAQ

**Does `yay -S openbeats-bin` work today?**
Not until the package is published to the AUR. The exact same `PKGBUILD` is in
this repository and installs now with `cd packaging/arch && yay -Bi .`.

**No sound on Arch?**
The package declares the GStreamer plugins and requires `pipewire-pulse` or
`pulseaudio`. If you are on an older install, reinstall the package so pacman
pulls the current dependency set, then log out and back in.

**The AppImage does not start.**
Install FUSE 2 (`sudo pacman -S fuse2` on Arch, `libfuse2` on Ubuntu 22.04+) or
run `./OpenBeats.AppImage --appimage-extract-and-run`. The Arch package avoids
FUSE entirely by extracting the AppImage at build time.

**Do I need WebKitGTK or GStreamer installed on Arch?**
The package installs the system GStreamer plugins that WebKit loads for audio,
plus icon and desktop integration. The AppImage bundles WebKitGTK 4.1, GTK 3
and the GStreamer runtime itself; the one thing an AppImage cannot provide is
the system audio server, so PipeWire-Pulse or PulseAudio must be running.

**It runs but I hear nothing. What do I check first?**
Settings → Audio → **Test tone** plays a short tone through the selected device and
ends in a verdict: *healthy* (callbacks and signal), *stalled* (the stream opened
but never called back) or *silent* (it ran but produced no signal). The **Stream
health** row under it shows the buffer, worst callback interval, deadline misses,
stall reopens and the host · device → sink triple. **Copy diagnostics** puts all of
that plus the version on the clipboard, and `scripts/linux-audio-probe.sh` prints
the same facts, including the PipeWire sink inputs, from a terminal. On Linux the
ALSA bridge is still required: `pipewire-alsa`, or `libasound2-plugins` on Debian
and Ubuntu , without it CPAL opens a null device.

**Should I turn Low latency on?**
On Bluetooth and on PipeWire it can hurt. Low latency asks for a very small
buffer (often 256 frames or less), which forces a tiny shared quantum; a Bluetooth
A2DP link that cannot sustain it stops calling back, and the app then either
raises the buffer once on its own or, after three attempts in 30 seconds, stops
and tells you. Leave it off for Bluetooth, turn it on for a wired interface or a
USB DAC.

**Can I use VST3, AU or CLAP plugins?**
Hosting is available on Windows/macOS (out-of-process). On Linux, 1.0.9 adds a
CLAP-only sidecar: **View → Plugin library…** scans `~/.clap`, `/usr/lib/clap`,
`/usr/local/lib/clap` and `$CLAP_PATH`, and **Load** returns READY from a real
`clack-host` instance. No platform routes a plugin into the mixer yet: inserts
are not wired into the CPAL callback, so a loaded plugin cannot sit on a strip
or affect audio. Windows/macOS keep the existing `plughost-helper` path, which
is also not UI-wired or routed into the callback. The first-party
**OpenBeats Gain** proof plugin is included. The honest status is in
[docs/PLUGINS.md](docs/PLUGINS.md).

**Does it need an account or the internet?**
No. Projects, samples and exports stay local. The only network request is the
optional GitHub update check, which can be disabled in **Settings → Updates**.

**Where are my songs and settings?**
In the app's local WebKit data store for your user account. **File → Projects…**
lists saved songs, and autosave snapshots are restored from the same place. Use
the Projects dialog rather than editing browser-storage files by hand; exports
are written wherever you choose.

**Is there an Intel Mac build?**
Not in 1.0.9. Build from source with the steps in
[docs/BUILDING.md](docs/BUILDING.md).

**How do I update?**
Download the latest release. The in-app banner and **Help → Check for updates…**
notify you and link to GitHub; silent self-update is not enabled because the
release is not signed with a Tauri updater key.

**Is OpenBeats really 1.0.9?**
Yes. 1.0.9 puts all fourteen mixer insert types in the native Rust/CPAL
callback, executes per-strip routes and sends there, adds an **Effects** browser
tab to the mixer, and fixes the Linux master-volume bridge so the knob reaches
the native output. It also persists output/input, low-latency, cue and monitor
choices and labels Bluetooth/BlueZ, HDMI/DisplayPort and USB Linux endpoints.
The arrangement markers, clip fade handles, selected-clip
inspector, one-click crossfades and **mixer volume/pan automation lanes** from
1.0.6 remain. Playlist **audio clips**, per-clip effects and pan automation
remain **Web Audio only in the editor**; native CPAL accepts volume lanes and
the React bridge now sends them for mixer strips.
The version is bumped in the app, Tauri bundle and all Rust crates.

---

## Features

### Studio
- **Channel Rack** with step sequencer, per-channel instrument, mixer routing, mute/solo and 29 built-in instrument voices, including ten original engines added in 1.0.6 (Anvil, Prism, Sundial, Cordwood, Vector Nine, Acid Well, Dice, Dust Devil, Chatter, Hammer Felt) available in both the Rust/CPAL and Web Audio engines. **Add ▸ Linked** creates a channel together with its own playlist track and mixer strip, sharing one name and colour and routed automatically; **Relink** moves an existing channel to a fresh track and strip while carrying its inserts, sends, gain, pan and group.
- **Piano roll** with draw, select, resize and velocity editing; scale highlighting.
- **Playlist** with pattern clips, **audio clips** and **named markers**. Drop a WAV/MP3/OGG/FLAC on a lane for an LOD waveform, gain/pan/fades and loop-aware playback. Add markers with F6, drag or rename them, jump with Alt+Left/Alt+Right, and loop from a marker to the next one. Selected clips expose gain, pan and fade controls, with visible fade handles and a one-click crossfade to the next overlapping clip. Copy, cut and paste clips at the playhead with Ctrl/Cmd+C/X/V, and nudge them with Shift+Arrow keys. Shift/Cmd-click selects several clips; the batch inspector then edits gain and fades and quantises every selected start to the snap grid in one undo step. Track mute/solo, the loop region and the snap grid are unchanged.
  - **Playlist audio clips: Web Audio only in 1.0.9; native Rust playback pending.**
  - Media bytes are cached in the WebView (IndexedDB) with a SHA-256 integrity hash; native app-data persistence is planned for 1.1.
- **Mixer** with inserts, sends, buses and a master strip; 14 built-in effect types (3-band and 10-band EQ, compressor, limiter, reverb, delay, drive, filter, chorus, phaser, bitcrusher, tremolo, auto pan, ring modulator). The insert rack has **Chain** and **Effects** tabs: browse every effect by category and add it to the selected strip, or edit the loaded chain. All fourteen have native DSP in the CPAL callback. **Web Audio volume/pan automation lanes** have linear, hold and smooth segments and tempo-synced fade-in, tremolo and ducking presets that render into offline bounces. Save a strip's insert chain from the **Chains** menu and recall it on any other strip.
- **Song / Pattern mode**, metronome, count-in, tempo and swing.
- **Bounce** to 16/24-bit WAV at 44.1 or 48 kHz, with optional mastering targets.

### Native audio engine (Rust)
- **CPAL output** on the desktop: a sample-accurate sequencer, all 29 procedural synth voices, and a master chain of 3-band EQ, compressor and limiter run in Rust instead of the WebView. The browser build keeps the Web Audio fallback.
- **Transmitter** transient/sustain split with hold and release detection.
- **Audio Logger** keeps the last 60 seconds of master output and writes it to WAV on demand.
- **Chord detection**, in-key chord suggestions, **Chord Stamp**, and user key labels.
- **Per-clip gain, pan, pitch, stretch and fades**, note names, clip normalisation, and **automation lanes** that can drive any engine parameter.
- **Mixer routing in Rust**: free routing, multiple and pre-fader sends, mute/solo and cycle refusal execute in the callback; sidechain ducking remains offline.
- **Editing tools** in Rust: strum, arpeggiate, flam, twelve scales, clip slice/chop/quantize/trim/duplicate, and a modular effect graph.
- **VST3/CLAP hosting** on Windows and macOS through an out-of-process host with crash recovery. On Linux a separate CLAP-only sidecar scans and loads plugins; neither platform routes an insert into the audio callback yet.

### Engine split (which engine executes what)
- **Rust native (CPAL):** the transport and sequencer, all 29 procedural voices (including Anvil, Prism, Sundial, Cordwood, Vector Nine, Acid Well, Dice, Dust Devil, Chatter and Hammer Felt), and the master chain **EQ → compressor → limiter**. The transmitter meter and audio logger also run natively.
- **Web Audio only:** **playlist audio clips**, per-clip audio effects (not yet modeled), and pan automation. All fourteen mixer-strip insert types are implemented in Rust: gain, 3-band and 10-band EQ, compressor, limiter, reverb, delay, drive, filter, chorus, phaser, bitcrusher, tremolo, auto pan and ring modulator. The React bridge sends every supported strip insert and volume lane. Offline bounce and Fix My Mix still render with Web Audio, so **desktop playback and a bounce can diverge** , they are not the same signal path yet.
- **Native per-strip progress:** the CPAL callback renders one voice pool per channel, applies each channel's gain automation and native insert chain, executes the mixer graph's routes and sends, then runs the unchanged master EQ → compressor → limiter. All fourteen insert kinds process audio on a strip; every native effect is covered by a finite/changed-output test, and a -6 dB gain insert plus routing/send isolation are covered separately. The React snapshot sends every strip insert, volume lanes and the mixer graph. Sidechain ducking, the modular effect graph, per-audio-clip effects and plugin inserts are still offline-only.
- **Per-clip pan** is applied per note by the Rust engine; the Web Audio fallback keeps using channel pan. The two engines agree on clip gain, pitch, stretch and fades, but their instrument voices are close rather than sample-identical.

### Writing & mixing assistants (local DSP , no cloud, no accounts)
- **Fix My Mix** , renders the master, measures peak / loudness / crest / stereo width and seven frequency bands, then explains what is fighting for space and applies corrective EQ, compression and a limiter as ordinary effects. A/B compares the corrected chain with the original.
- **Mastering targets** , Spotify (−14 LUFS), Club (−9), SoundCloud (−13), YouTube (−14), applied on bounce with shelf EQ, glue compression and a true-peak-style ceiling.
- **Hum to Melody** , records the microphone, tracks pitch, quantises to the grid and writes notes to the piano roll.
- **Inspire Me** , four-chord progressions by key, scale and mood, with an optional root bass line.
- **Sample tagging** , estimates BPM, brightness and instrument family on import.

### Discord Rich Presence
- Toggle in **Settings → Workflow**. When enabled, Discord shows **“Making a beat..”** with the current project name.
- Rich Presence uses OpenBeats' built-in Discord application ID (`1569568675198140446`), so there is no application ID to create or paste. Switching the toggle off disconnects it.

### Projects
- **Projects** dialog (File → Projects…): open old songs, start a new one, save the current song and delete entries.
- First launch opens a saved **Tutorial** project, not a blank song; the last project is restored after that.

### Interchange with other DAWs
- **Multi-track MIDI import/export** , one track per channel, tempo and program changes, readable by other DAWs including Ableton, Logic, Cubase, Studio One, Bitwig and REAPER.
- **Ableton Live Set import** (`.als`) , gzipped XML, MIDI tracks and clips parsed locally.
- **REAPER project import and export** (`.rpp`) , text project with tracks and MIDI items.
- `.obeats` remains the lossless round-trip; WAV is the audio path. Details and fidelity limits: [docs/EXCHANGE.md](docs/EXCHANGE.md).

### Sounds and drag-and-drop
- **Drop audio files anywhere** on the studio to add sampler channels; dropping several files imports them at once.
- Drop `.mid`, `.als`, `.rpp` or `.obeats` files to open a song, with a visible drop target and a clear import report.
- Imported one-shots are auto-tagged (BPM, brightness, family) and kept in the session sample bank.
- **Import Pack** accepts a folder or `.zip`, recognises OpenBeats manifests and FL-style `Kicks/`/`Snares/` folders, and reports every skipped or corrupt file. FL `.fxp`/`.fst`/`.flp` files are metadata-only; that limitation is spelled out in [docs/IMPORT_PACKS.md](docs/IMPORT_PACKS.md).

### Plugin library
- **View → Plugin library…** (or the **Plugins** button) lists community VST3/CLAP releases from the GitHub-backed registry in [`plugins/registry.json`](plugins/registry.json), with vendor-style category filtering.
- Original instruments and effects include **Glass Keys** (bright inharmonic bell), **Velvet Choir** (additive formant pad) and **FM Bass** (two-operator sine bass), all available in both engines, plus Web Audio **Chorus**, **Phaser**, **Bitcrusher**, **Tremolo**, **Auto Pan** and **Ring Mod** inserts. The first-party **OpenBeats Gain** proof plugin is built in [`plugins/openbeats-gain`](plugins/openbeats-gain); its release archive contains both `.clap` and `.vst3` bundles.
- Download links open the publisher's GitHub Release. There is no silent install. Linux 1.0.9 can scan and load CLAP plugins in a helper process, but the loaded plugin is not inserted into the mixer yet; Windows/macOS keep the existing `plughost-helper` path. The source-verified investigation is in [the 1.0.7 report](docs/PLUGIN_HOST_REVERSE_ENGINEERING_1.0.7.md).
- Community submissions go through [the plugin submission form](.github/ISSUE_TEMPLATE/plugin-submission.yml); `npm run plugins:check` validates the registry.

### Desktop integration
- Native save/open dialogs and “reveal in folder”.
- **Autosave** on a 2/5/10/15/30/60-minute timer (or Never), a final snapshot on window close, automatic restore after a crash, and **Save now** in Settings → Workflow.
- **Update checker** against this repository's GitHub Releases, with an in-app banner, **Help → Check for updates…**, and a **Changelog** tab.
- Native window chrome, resize handling and platform-aware shortcuts.

### Interface
- **Classic** and **Modern** interface modes over the same theme tokens.
- Startup splash with a short, synthesized ding; the chime can be switched off in **Settings → Workflow**.
- Built-in themes, including **Glass (dark)** and **Liquid Glass (light)** glassmorphism styles.
- **My theme** editor: colour wheel, HEX field and RGB sliders for every token; import/export theme JSON.
- **OpenBeats Learn** from **Help ▸ Learn**: a lazy-loaded, offline walkthrough of every module (rack, piano roll, playlist, mixer, browser, bounce) plus a first-song path. Per-module progress is stored on the device; there are no accounts or network calls.
- Command palette, density switch, interface scale, accent override.
- **Named workspace layouts** in **Settings → Appearance**: save panel widths, browser visibility, the active view and collapsed mixer groups, then recall them with one click. Saved layouts also appear in the **View** menu.
- **Accessibility**: screen-reader labels and states, keyboard-operable knobs and faders, ARIA live hints, a skip link, reduced motion, reduce transparency, high contrast, visible focus rings, scaling and hint toggles.
- **Updates** tab: opt out of automatic launch checks entirely, or check manually at any time.
- Optional *Studio 2006* throwback theme.

---

## Keyboard

| Action | Shortcut |
| --- | --- |
| Play / stop | `Space` |
| Command palette | `Ctrl/Cmd + K` |
| Save | `Ctrl/Cmd + S` |
| Export WAV | `Ctrl/Cmd + E` |
| New / Open | `Ctrl/Cmd + N` / `Ctrl/Cmd + O` |
| Undo / redo | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` |
| Toggle Song/Pattern | `L` |
| Metronome | `C` |
| Add arrangement marker | `F6` |
| Previous / next marker | `Alt+Left` / `Alt+Right` |
| Quantise selection | `Q` |
| Duplicate | `Ctrl/Cmd + D` |
| Copy / cut / paste clip | `Ctrl/Cmd + C` / `X` / `V` |
| Nudge clip | `Shift + Arrow keys` |
| Delete | `Delete` |

The full map is in **Help → Shortcuts**.

---

## Development

Requirements: **Node 20+**, **Rust 1.77+**, and on Linux the Tauri system packages. Full per-OS instructions: [docs/BUILDING.md](docs/BUILDING.md).

```bash
npm install
npm run dev          # browser build at http://localhost:3000
npm run desktop      # Tauri window with hot reload
npm run build        # type-check + production bundle
npm run desktop:build # native binary + installers in target/release/bundle
npm run icons        # regenerate app icons from scripts/make-icons.mjs
npm run plugins:check # validate plugins/registry.json
npm run plugins:fetch # resolve GitHub Releases into plugins/registry.lock.json
npm run docs:check   # verify README/INSTALL versions and relative links
```

Repository layout and data flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Theming and the colour editor: [docs/THEMING.md](docs/THEMING.md).
The glass design review (glassmorphism vs Liquid Glass): [docs/GLASS.md](docs/GLASS.md).
DAW interchange matrix: [docs/EXCHANGE.md](docs/EXCHANGE.md).
Plugin support status and roadmap: [docs/PLUGINS.md](docs/PLUGINS.md).
Native Rust/CPAL audio engine: [docs/RUST_AUDIO.md](docs/RUST_AUDIO.md).
Feature parity reference: [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md).
Studio architecture and remaining gaps: [docs/STUDIO_ARCHITECTURE.md](docs/STUDIO_ARCHITECTURE.md).
Release/signing process: [docs/BUILDING.md](docs/BUILDING.md#releases).

### Project layout

```
src/
  audio/        Web Audio engine, scheduler, instruments, export, mastering
  components/   Rack, piano roll, playlist, mixer, dialogs, palette, changelog
  lib/          analysis, mastering, theory, tagging, updates, native bridge
  model/        project types and demo song
src-tauri/      Rust shell, capabilities, icons, bundler config
plugins/        registry, submission guide and OpenBeats Gain example
  openbeats-gain/  Rust VST3 + CLAP proof plugin
docs/           build, architecture and theming guides
scripts/        icon generation and plugin validation/fetching
```

---

## Status and limitations

- Installers are produced by CI. Building them requires the platform SDKs (Xcode on macOS, MSVC on Windows); cross-building installers is not supported.
- CI builds the Linux packages on Ubuntu 22.04 (glibc 2.35), so they run on 22.04 and newer. A local build follows the host's glibc and may not start on older distributions.
- The update checker **notifies** and links to the release. Silent in-app installation is prepared but needs a signed Tauri updater key pair (`TAURI_SIGNING_PRIVATE_KEY`, `plugins.updater.pubkey`) , see the build guide.
- The desktop build plays through the **native Rust engine**; the browser build uses Web Audio. The two are not sample-identical yet. Per-strip inserts, volume automation, mixer routing and sends are wired into the native callback; sidechain, the modular graph, pan automation and plugin inserts are still not.
- **VST3/CLAP hosting** runs out of process on Windows and macOS. Linux has a separate CLAP-only sidecar that scans and loads plugins. On every platform, **plugin inserts** are still not routed into the CPAL callback, so loading a plugin does not yet change playback.
- The assistants are deterministic local DSP, not a hosted language model. Nothing is uploaded.
- Not implemented yet: stem separation, a WASM wavetable synth, mixer folders, track freeze, PDC, per-clip effects, project snapshots, dockable panels, a spectral editor and a live-performance mode. See [ROADMAP.md](ROADMAP.md).

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; `npm run build` and a manual smoke test are expected before a PR.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). The demo song and all instrument presets are original and generated procedurally.

## Troubleshooting

If OpenBeats runs but you hear nothing on Linux, Settings → Audio → **Copy diagnostics** produces a paste-ready readout, and `scripts/linux-audio-probe.sh` collects the server side (`pactl`, `aplay -L`, `pw-top`, and the libraries the AppImage ships) into one text file. Both are read-only.
