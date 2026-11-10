# OpenBeats

**An open-source beatmaking studio for the desktop.** Channel Rack, step sequencer, piano roll, playlist and mixer — built with a Rust/Tauri desktop shell and a React/Web Audio front end. Linux, Windows and macOS.

![OpenBeats](artifacts/final-1.1.png)

> OpenBeats is an independent project. It is *inspired by* the workflow of classic pattern-based DAWs (channel rack → patterns → playlist → mixer); it ships no code, samples, presets or assets from FL Studio or any other commercial DAW.

---

## Install OpenBeats 1.0.0

Every package is built by GitHub Actions and attached to the
[1.0.0 release](https://github.com/blsphmicwillow/OpenBeats/releases/tag/v1.0.0).
No account is required.

| Platform | Release file | Install |
| --- | --- | --- |
| Arch Linux | `openbeats-bin` (in this repo) | `cd packaging/arch && yay -Bi .` — see below |
| Linux (any) | `OpenBeats_1.0.0_amd64.AppImage` | `chmod +x`, then run it |
| Debian / Ubuntu | `OpenBeats_1.0.0_amd64.deb` | `sudo apt install ./OpenBeats_1.0.0_amd64.deb` |
| Fedora / RPM | `OpenBeats-1.0.0-1.x86_64.rpm` | `sudo dnf install ./OpenBeats-1.0.0-1.x86_64.rpm` |
| Windows 10/11 | `OpenBeats_1.0.0_x64-setup.exe` | Run the installer (or use the `.msi`) |
| macOS (Apple silicon) | `OpenBeats_1.0.0_aarch64.dmg` | Open the DMG and drag OpenBeats to Applications |
| Source | `git clone` | [docs/BUILDING.md](docs/BUILDING.md) |

There is no separate Intel-Mac DMG in 1.0.0; Intel Macs can build from source.
Full per-platform commands, dependencies and troubleshooting are in
[docs/INSTALL.md](docs/INSTALL.md).

### Arch Linux with `yay`

The AUR-ready package lives in [`packaging/arch`](packaging/arch). It installs
the official 1.0.0 AppImage under `/opt/openbeats`, creates
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
sudo pacman -S --needed pipewire-pulse   # PipeWire (recommended)
# sudo pacman -S --needed pulseaudio     # PulseAudio instead
```

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
git commit -m "openbeats-bin 1.0.0" && git push
```

### AppImage (portable Linux)

```bash
curl -L -o OpenBeats.AppImage \
  https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.0/OpenBeats_1.0.0_amd64.AppImage
chmod +x OpenBeats.AppImage
./OpenBeats.AppImage
```

If FUSE is unavailable, extract and run instead:
`./OpenBeats.AppImage --appimage-extract-and-run`.

### Debian / Ubuntu

```bash
curl -L -O https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.0/OpenBeats_1.0.0_amd64.deb
sudo apt install ./OpenBeats_1.0.0_amd64.deb
openbeats
```

The package declares WebKitGTK 4.1, the full GStreamer audio stack and a
PulseAudio-compatible sound server (`pipewire-pulse` or `pulseaudio`). You
should not need to install audio plugins by hand.

### Fedora

```bash
sudo dnf install ./OpenBeats-1.0.0-1.x86_64.rpm
openbeats
```

The RPM declares the GStreamer audio plugins and a PipeWire-Pulse/PulseAudio
server, so no separate multimedia package list is required.

### Windows

1. Download `OpenBeats_1.0.0_x64-setup.exe` (or the `.msi`) from the release.
2. Run it. Current installers embed the WebView2 offline runtime, so the app
   does not depend on a separate WebView2 download.
3. SmartScreen may warn because the build is not code-signed: **More info →
   Run anyway**.

### macOS (Apple silicon)

1. Download `OpenBeats_1.0.0_aarch64.dmg` and open it.
2. Drag **OpenBeats** into **Applications**.
3. The DMG is not notarised, so on first launch use **Control-click → Open**, or
   run `xattr -dr com.apple.quarantine /Applications/OpenBeats.app`.

### First run

1. The built-in **Tutorial** project opens automatically. Press **Space** to play.
2. `Ctrl/Cmd + K` opens the command palette — everything is reachable from there.
3. **Help → Tutorial** walks the Rack → Piano roll → Playlist → Mixer flow.
4. **File → Projects…** creates or opens songs; **File → Export** bounces a WAV,
   optionally loudness-normalised for a streaming target.

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

**Can I use VST3, AU or CLAP plugins?**
OpenBeats 1.0.0 includes a **plugin library** for browsing and downloading native
VST3/CLAP releases, but it does **not host** them in the mixer yet. Hosting needs
a native plugin host and audio bridge; the honest status and plan are in
[docs/PLUGINS.md](docs/PLUGINS.md). The first-party **OpenBeats Gain** proof
plugin and community registry are included.

**Does it need an account or the internet?**
No. Projects, samples and exports stay local. The only network request is the
optional GitHub update check, which can be disabled in **Settings → Updates**.

**Where are my songs and settings?**
In the app's local WebKit data store for your user account. **File → Projects…**
lists saved songs, and autosave snapshots are restored from the same place. Use
the Projects dialog rather than editing browser-storage files by hand; exports
are written wherever you choose.

**Is there an Intel Mac build?**
Not in 1.0.0. Build from source with the steps in
[docs/BUILDING.md](docs/BUILDING.md).

**How do I update?**
Download the latest release. The in-app banner and **Help → Check for updates…**
notify you and link to GitHub; silent self-update is not enabled because the
release is not signed with a Tauri updater key.

**Is OpenBeats really 1.0.0?**
Yes. These packaging and documentation changes did not change the application
version.

---

## Features

### Studio
- **Channel Rack** with step sequencer, per-channel instrument, mixer routing, mute/solo and 12 procedural instrument engines.
- **Piano roll** with draw, select, resize and velocity editing; scale highlighting.
- **Playlist** with pattern and audio clips, track mute/solo, loop region and a snap grid.
- **Mixer** with inserts, sends, buses and a master strip; 8 native effect types (3-band and 10-band EQ, compressor, limiter, reverb, delay, drive, filter).
- **Song / Pattern mode**, metronome, count-in, tempo and swing.
- **Bounce** to 16/24-bit WAV at 44.1 or 48 kHz, with optional mastering targets.

### Writing & mixing assistants (local DSP — no cloud, no accounts)
- **Fix My Mix** — renders the master, measures peak / loudness / crest / stereo width and seven frequency bands, then explains what is fighting for space and applies corrective EQ, compression and a limiter as ordinary effects. A/B compares the corrected chain with the original.
- **Mastering targets** — Spotify (−14 LUFS), Club (−9), SoundCloud (−13), YouTube (−14), applied on bounce with shelf EQ, glue compression and a true-peak-style ceiling.
- **Hum to Melody** — records the microphone, tracks pitch, quantises to the grid and writes notes to the piano roll.
- **Inspire Me** — four-chord progressions by key, scale and mood, with an optional root bass line.
- **Sample tagging** — estimates BPM, brightness and instrument family on import.

### Discord Rich Presence
- Toggle in **Settings → Workflow**. When enabled, Discord shows **“Making a beat..”** with the current project name.
- Rich Presence uses OpenBeats' built-in Discord application ID (`1569568675198140446`), so there is no application ID to create or paste. Switching the toggle off disconnects it.

### Projects
- **Projects** dialog (File → Projects…): open old songs, start a new one, save the current song and delete entries.
- First launch opens a saved **Tutorial** project, not a blank song; the last project is restored after that.

### Interchange with other DAWs
- **Multi-track MIDI import/export** — one track per channel, tempo and program changes, readable by FL Studio, Ableton, Logic, Cubase, Studio One, Bitwig and REAPER.
- **Ableton Live Set import** (`.als`) — gzipped XML, MIDI tracks and clips parsed locally.
- **REAPER project import and export** (`.rpp`) — text project with tracks and MIDI items.
- `.obeats` remains the lossless round-trip; WAV is the audio path. Details and fidelity limits: [docs/EXCHANGE.md](docs/EXCHANGE.md).

### Sounds and drag-and-drop
- **Drop audio files anywhere** on the studio to add sampler channels; dropping several files imports them at once.
- Drop `.mid`, `.als`, `.rpp` or `.obeats` files to open a song, with a visible drop target and a clear import report.
- Imported one-shots are auto-tagged (BPM, brightness, family) and kept in the session sample bank.

### Plugin library
- **View → Plugin library…** (or the **Plugins** button) lists community VST3/CLAP releases from the GitHub-backed registry in [`plugins/registry.json`](plugins/registry.json), with vendor-style category filtering.
- The first-party **OpenBeats Gain** proof plugin is built in [`plugins/openbeats-gain`](plugins/openbeats-gain); its release archive contains both `.clap` and `.vst3` bundles.
- Download links open the publisher's GitHub Release. There is no silent install and no fake host: **loading plugins into OpenBeats is still not implemented in 1.0.0**.
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
- Command palette, density switch, interface scale, accent override.
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
| Quantise selection | `Q` |
| Duplicate | `Ctrl/Cmd + D` |
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
npm run desktop:build# native binary + installers in src-tauri/target/release/bundle
npm run icons        # regenerate app icons from scripts/make-icons.mjs
npm run plugins:check # validate plugins/registry.json
npm run plugins:fetch # resolve GitHub Releases into plugins/registry.lock.json
```

Repository layout and data flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Theming and the colour editor: [docs/THEMING.md](docs/THEMING.md).
The glass design review (glassmorphism vs Liquid Glass): [docs/GLASS.md](docs/GLASS.md).
DAW interchange matrix: [docs/EXCHANGE.md](docs/EXCHANGE.md).
Plugin support status and roadmap: [docs/PLUGINS.md](docs/PLUGINS.md).
Native Rust/CPAL audio migration plan: [docs/RUST_AUDIO.md](docs/RUST_AUDIO.md).
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
- The Linux packages built here target Ubuntu 24.04 (glibc 2.39). CI builds on Ubuntu 22.04 for a wider glibc range; rebuild there if you need older distributions.
- The update checker **notifies** and links to the release. Silent in-app installation is prepared but needs a signed Tauri updater key pair (`TAURI_SIGNING_PRIVATE_KEY`, `plugins.updater.pubkey`) — see the build guide.
- The audio engine is still **Web Audio inside the Tauri WebView**. The Rust layer is the desktop shell, not a native audio engine; the migration plan is in [docs/RUST_AUDIO.md](docs/RUST_AUDIO.md).
- The plugin library downloads public GitHub Release assets only; it does **not** load them. Native hosting remains a separate engine milestone.
- The assistants are deterministic local DSP, not a hosted language model. Nothing is uploaded.
- Not implemented yet: stem separation, a WASM wavetable synth, mixer folders, track freeze, PDC, per-clip effects, project snapshots, dockable panels, a spectral editor and a live-performance mode. See [ROADMAP.md](ROADMAP.md).

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; `npm run build` and a manual smoke test are expected before a PR.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). The demo song and all instrument presets are original and generated procedurally.
