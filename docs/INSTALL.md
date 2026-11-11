# Installing OpenBeats 1.0.7

OpenBeats is a native desktop app for Linux, Windows and macOS. Every installer
on this page is built and tested by GitHub Actions and attached to the
[v1.0.7 release](https://github.com/blsphmicwillow/OpenBeats/releases/tag/v1.0.7).

| Platform | Release file | Install |
| --- | --- | --- |
| Arch Linux | `openbeats-bin` (local package) | `cd packaging/arch && yay -Bi .` |
| Linux (any x86_64) | `OpenBeats_1.0.7_amd64.AppImage` | `chmod +x`, then run |
| Debian / Ubuntu | `OpenBeats_1.0.7_amd64.deb` | `sudo apt install ./OpenBeats_1.0.7_amd64.deb` |
| Fedora / RHEL | `OpenBeats-1.0.7-1.x86_64.rpm` | `sudo dnf install ./OpenBeats-1.0.7-1.x86_64.rpm` |
| Windows 10/11 | `OpenBeats_1.0.7_x64-setup.exe` or `.msi` | Run the installer |
| macOS (Apple silicon) | `OpenBeats_1.0.7_aarch64.dmg` | Open the DMG, drag to Applications |
| Source | `git clone` | [Build from source](#build-from-source) |

There is no Intel-Mac installer in 1.0.7; Intel Macs can build from source.
The desktop app plays through the native Rust/CPAL engine, with the Web Audio
engine retained for the browser build and for features that are still Web Audio
only. No account or internet connection is required.

## Verify downloads

Every release includes `SHA256SUMS.txt`. Download it next to the installer and
check the file before running it.

Linux and macOS:

```bash
curl -L -O https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.7/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

Windows PowerShell:

```powershell
Get-FileHash .\OpenBeats_1.0.7_x64-setup.exe -Algorithm SHA256
```

Compare the printed hash with the matching line in `SHA256SUMS.txt`. Download
assets from the release page over HTTPS rather than a mirror.

## Arch Linux

The package lives in [`packaging/arch`](../packaging/arch) and is named
`openbeats-bin`. It installs the official 1.0.7 AppImage under `/opt/openbeats`,
creates `/usr/bin/openbeats`, and installs the desktop entry and icon.

### Install from this repository

```bash
sudo pacman -S --needed base-devel git

git clone https://github.com/blsphmicwillow/OpenBeats.git
cd OpenBeats/packaging/arch

yay -Bi .
```

`yay -Bi` builds and installs the local `PKGBUILD` and offers to install missing
dependencies. To install them yourself first:

```bash
sudo pacman -S --needed gtk3 gstreamer gst-plugins-base gst-plugins-good \
  gst-plugins-bad gst-plugins-ugly gst-libav libpulse alsa-lib \
  libayatana-appindicator librsvg openssl xdg-utils hicolor-icon-theme

# Choose the audio server you actually use:
sudo pacman -S --needed pipewire-pulse   # PipeWire (recommended)
# sudo pacman -S --needed pulseaudio     # PulseAudio instead
```

The package declares `pulse-native-provider`, so `pacman` requires either
`pipewire-pulse` or `pulseaudio`. Do not install both; they conflict. Log out
and back in after switching audio servers.

### AUR status

`yay -S openbeats-bin` works only after the package is published to the AUR.
It is **not published yet**. Use the local build above; the maintainer steps are
in [`packaging/arch/README.md`](../packaging/arch/README.md).

### Verify and uninstall

```bash
command -v openbeats
openbeats
yay -Rns openbeats-bin
```

## AppImage (portable Linux)

```bash
curl -L -o OpenBeats.AppImage \
  https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.7/OpenBeats_1.0.7_amd64.AppImage
chmod +x OpenBeats.AppImage
./OpenBeats.AppImage
```

The AppImage bundles WebKitGTK, GTK 3, GStreamer and the audio plugins Web Audio
needs. The host must provide:

- a working X11 or Wayland session;
- a PulseAudio-compatible server (`pipewire-pulse` or `pulseaudio`);
- FUSE 3 (`sudo pacman -S fuse3` on Arch, `libfuse2` on Ubuntu 22.04+), **or**
  launch with `--appimage-extract-and-run`.

If a file manager or older Shelly reports `InvalidExe`, update the frontend and
install FUSE 3, or bypass the mount:

```bash
./OpenBeats.AppImage --appimage-extract-and-run
```

## Debian / Ubuntu

```bash
curl -L -O https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.7/OpenBeats_1.0.7_amd64.deb
sudo apt install ./OpenBeats_1.0.7_amd64.deb
openbeats
```

Use `apt install ./file.deb` rather than `dpkg -i` so dependencies resolve.
CI builds this package on Ubuntu 22.04 (glibc 2.35), so it runs on 22.04 and
newer. A locally built package follows the host's glibc and may not start on
older distributions.

The package declares WebKitGTK 4.1, the GStreamer audio stack and a
PulseAudio-compatible server. Uninstall with `sudo apt remove open-beats`.

## Fedora / RHEL

```bash
sudo dnf install ./OpenBeats-1.0.7-1.x86_64.rpm
openbeats
```

The RPM declares the GStreamer audio plugins and a PipeWire-Pulse/PulseAudio
server, so no separate multimedia package list is required. Uninstall with
`sudo dnf remove open-beats`.

## Windows 10/11

1. Download `OpenBeats_1.0.7_x64-setup.exe` (or the `.msi`) from the release.
2. Run the installer. Administrators can deploy the `.msi` instead.
3. The installer uses the WebView2 download bootstrapper. If WebView2 is
   missing, setup downloads the Evergreen Runtime once; allow network access on
   the first install.
4. SmartScreen may warn because the build is not code-signed: **More info →
   Run anyway**, but only for a file downloaded from the release page.

Desktop playback uses the native Rust/CPAL engine and the default Windows output
device; the browser build falls back to Web Audio. No extra audio driver is
required. Uninstall from **Settings → Apps → OpenBeats**.

## macOS (Apple silicon)

1. Download `OpenBeats_1.0.7_aarch64.dmg`.
2. Open the DMG and drag **OpenBeats** to **Applications**.
3. The build is not notarised. On first launch, Control-click the app, choose
   **Open**, then confirm. Alternatively clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/OpenBeats.app
open /Applications/OpenBeats.app
```

`OpenBeats.app.zip` contains the same app bundle. Desktop playback uses the
native Rust/CPAL engine (CoreAudio); no extra audio install is needed. There is
no Intel-Mac DMG in 1.0.7. Uninstall by moving the app to the Trash.

## Build from source

Use this when your distribution or architecture has no package, or when you want
to test a change. Full platform notes are in [BUILDING.md](BUILDING.md).

Requirements: Node.js 20+, npm 10+, Rust stable 1.77+, and the Tauri system
packages for your OS.

```bash
git clone https://github.com/blsphmicwillow/OpenBeats.git
cd OpenBeats
npm install
npm run desktop:build
```

Installers are written under `target/release/bundle/`. Only the current platform
can be bundled: build Windows on Windows and macOS on macOS.

### Linux build dependencies

Arch:

```bash
sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3 libayatana-appindicator \
  librsvg libsoup3 openssl gstreamer gst-plugins-base gst-plugins-good \
  gst-plugins-bad gst-plugins-ugly gst-libav libpulse alsa-lib \
  pipewire-pulse   # or pulseaudio
```

Debian/Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev libssl-dev \
  build-essential curl file rpm patchelf \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev gstreamer1.0-tools \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly gstreamer1.0-libav gstreamer1.0-pulseaudio gstreamer1.0-alsa
```

Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
  librsvg2-devel libsoup3-devel openssl-devel @development-tools
```

Run the checks before opening a pull request:

```bash
npm run typecheck
npm run build
npm run docs:check
cd src-tauri && cargo fmt --all -- --check
```

## Common problems

| Symptom | Fix |
| --- | --- |
| Transport turns green but the playhead does not move | Web Audio never resumed. Make sure a PipeWire-Pulse or PulseAudio server is running, restart the app, and click the window once before pressing Space. |
| AppImage says `dlopen(): error loading libfuse.so.2` | Install FUSE 3, or run `./OpenBeats.AppImage --appimage-extract-and-run`. |
| Blank white window on Linux | Install/repair Mesa/GPU drivers, then try `WEBKIT_DISABLE_COMPOSITING_MODE=1 openbeats`. |
| Blank window on Windows | Reinstall with the current installer so the WebView2 bootstrapper can run, and allow network access during setup. |
| macOS says the app is damaged | Clear quarantine with the `xattr` command above; do not disable Gatekeeper globally. |
| App is already running / an old version opens | Close every OpenBeats window and relaunch. Remove an old extracted AppImage if you installed both forms. |
| Plugins do not appear in a mixer strip | Plugin hosting exists out of process on Windows/macOS, but inserts are not routed into the audio callback in 1.0.7. See [PLUGINS.md](PLUGINS.md). |
| No sound on Linux | Confirm `pactl info` lists a sink and that `pipewire-pulse` or `pulseaudio` is running; the AppImage cannot bundle the system sound server. |

## Where data lives

Projects, autosave snapshots and settings live in the app's local WebKit data
store for your user account. Use **File → Projects…** to open or delete songs
rather than editing browser-storage files by hand. Exports go wherever you
choose in the save dialog.

## Uninstall

| Platform | Command |
| --- | --- |
| Arch | `yay -Rns openbeats-bin` |
| Debian/Ubuntu | `sudo apt remove open-beats` |
| Fedora | `sudo dnf remove open-beats` |
| AppImage | delete the file |
| Windows | Settings → Apps → OpenBeats → Uninstall |
| macOS | move `OpenBeats.app` to the Trash |
| Source build | delete the cloned directory and `target/` |

Uninstalling does not delete your projects.
