# Installing OpenBeats 1.0.0

OpenBeats is distributed as a native Tauri application. Pick the package for
your platform; all of them are attached to the
[v1.0.0 release](https://github.com/blsphmicwillow/OpenBeats/releases/tag/v1.0.0).

| Platform | File | Package manager path |
| --- | --- | --- |
| Arch Linux | AUR/local package | `cd packaging/arch && yay -Bi .` |
| Linux | `OpenBeats_1.0.0_amd64.AppImage` | none |
| Debian/Ubuntu | `OpenBeats_1.0.0_amd64.deb` | `apt` |
| Fedora/RHEL | `OpenBeats-1.0.0-1.x86_64.rpm` | `dnf` |
| Windows 10/11 | `OpenBeats_1.0.0_x64-setup.exe` / `.msi` | installer |
| macOS Apple silicon | `OpenBeats_1.0.0_aarch64.dmg` | drag to Applications |

There is no Intel-Mac DMG in 1.0.0. Build from source on Intel macOS; see
[BUILDING.md](BUILDING.md).

## Check the download (optional)

The published 1.0.0 AppImage has this SHA-256:

```text
48d98b230e29dd9859351e23c99a760df515d26117b3b6f146be74d656e20485
```

```bash
sha256sum OpenBeats_1.0.0_amd64.AppImage
```

The other assets do not ship a separate checksum file. Download them from the
release page over HTTPS rather than a mirror.

## Arch Linux

### What the package does

`packaging/arch/PKGBUILD` is a binary package named `openbeats-bin`:

- downloads the official 1.0.0 AppImage;
- verifies its SHA-256;
- extracts it to `/opt/openbeats`;
- installs a `/usr/bin/openbeats` launcher that runs `/opt/openbeats/AppRun`;
- installs the desktop entry and the 256×256 icon;
- declares the GTK, GStreamer, icon and audio dependencies.

It does **not** use FUSE at runtime, because the AppImage is already extracted.
The package declares the virtual `pulse-native-provider` dependency, satisfied by
either PipeWire's `pipewire-pulse` or `pulseaudio`.

### Option A — install from this repository now

This is the working path today. `yay` can build a local `PKGBUILD` with `-B`.

```bash
sudo pacman -S --needed base-devel git

git clone https://github.com/blsphmicwillow/OpenBeats.git
cd OpenBeats/packaging/arch

yay -Bi .
```

`yay -Bi` asks before installing missing dependencies. To install them yourself
first:

```bash
sudo pacman -S --needed \
  gtk3 gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad \
  gst-plugins-ugly gst-libav \
  libpulse alsa-lib \
  libayatana-appindicator librsvg openssl \
  xdg-utils hicolor-icon-theme
```

Then install **one** audio server:

```bash
# PipeWire (default on current Arch desktops)
sudo pacman -S --needed pipewire-pulse

# or, if you deliberately use PulseAudio
sudo pacman -S --needed pulseaudio
```

Installing `openbeats-bin` itself also pulls `pulse-native-provider`; `pacman`
will ask which of those two packages should satisfy it.

Do not install both `pipewire-pulse` and `pulseaudio`; they conflict. After
installing or switching, log out and back in so the user audio service starts.

### Option B — from the AUR

The intended package name is `openbeats-bin`:

```bash
yay -S openbeats-bin
```

As of 1.0.0 the package has **not been pushed to the AUR** (the build
environment has no AUR SSH key). Until it is, use Option A. Maintainer
publication steps are in [`packaging/arch/README.md`](../packaging/arch/README.md).

### Verify and uninstall

```bash
command -v openbeats     # /usr/bin/openbeats
openbeats
```

The app also appears as **OpenBeats** in the desktop application menu.

```bash
yay -Rns openbeats-bin
```

### Arch troubleshooting

- **The window opens but playback stays stalled.** Confirm a sink exists:
  `pactl info` and `pactl list short sinks`. Install `pipewire-pulse` (or
  `pulseaudio`) and the GStreamer plugin packages above, then restart the app.
- **No instruments, only silence.** `gst-inspect-1.0 pulsesink` should find the
  PulseAudio sink. If it does not, install `gst-plugins-good`.
- **`yay -Bi` cannot find dependencies.** Run `sudo pacman -Syu` first; a partial
  upgrade can leave the package database inconsistent.
- **“Could not find the program `openbeats`” or permission denied.** Rebuild the
  local package after pulling the launcher fix below. Do not launch the
  `OpenBeats.desktop` file from an extracted AppImage directly; it expects the
  packaged `openbeats` command. Run `openbeats` as your normal user, not root.
- **Icon is missing.** Reinstall `hicolor-icon-theme` and run
  `gtk-update-icon-cache -f /usr/share/icons/hicolor` if your desktop caches icons.

## AppImage (any x86_64 Linux)

```bash
curl -L -o OpenBeats.AppImage \
  https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.3/OpenBeats_1.0.3_amd64.AppImage
chmod +x OpenBeats.AppImage
./OpenBeats.AppImage
```

The published 1.0.3 AppImage has SHA-256
`47cea74824f4533915d2401e10ce9750030d80a030b9b670820b58447aee34a4`.
It includes `X-AppImage-Version=1.0.3`, has an executable payload and bundles no
`libfuse`. It installs and lists correctly with Shelly 3.0.6 and 3.2.1.

The AppImage bundles WebKitGTK, GTK 3, GStreamer and the audio plugins used by
Web Audio (`bundleMediaFramework`), so `gst-inspect-1.0` on the host is not
needed. This applies to AppImages produced from the current packaging config;
artifacts built before that change still rely on the host's GStreamer
installation. The host must provide:

- a working X11 or Wayland session;
- a PulseAudio-compatible server (`pipewire-pulse` or `pulseaudio`);
- FUSE 3 (`sudo pacman -S fuse3` on Arch, `libfuse2` on Ubuntu 22.04+), **or**
  launch with `--appimage-extract-and-run`.

If an older Shelly reports `InvalidExe`, update Shelly first. Then install FUSE 3
(`sudo pacman -S fuse3`) and retry, or run
`./OpenBeats.AppImage --appimage-extract-and-run` to bypass the FUSE mount.

The AppImage cannot bundle a system sound server. Every mainstream Linux desktop
ships one; on a minimal install, install `pipewire-pulse` (or `pulseaudio`).

To keep it on the desktop, move it somewhere permanent and create a menu entry;
or use the `.deb`/`.rpm` packages, which do this for you.

## Debian / Ubuntu

```bash
curl -L -O https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.0/OpenBeats_1.0.0_amd64.deb
sudo apt install ./OpenBeats_1.0.0_amd64.deb
openbeats
```

`apt install ./file.deb` (not `dpkg -i`) resolves dependencies automatically.
The package is built for Ubuntu 24.04 / glibc 2.39. Older distributions may
need the AppImage or a source build.

The package declares the GStreamer audio plugins and a PulseAudio-compatible
server. If the system has no sound server at all, install `pipewire-pulse` or
`pulseaudio`, then log out and back in.

Uninstall: `sudo apt remove open-beats`.

## Fedora / RHEL

```bash
sudo dnf install ./OpenBeats-1.0.0-1.x86_64.rpm
openbeats
```

The RPM declares the GStreamer audio plugins and a PipeWire-Pulse/PulseAudio
server; a separate multimedia package list is not required.

Uninstall: `sudo dnf remove open-beats`.

## Windows 10/11

1. Download `OpenBeats_1.0.0_x64-setup.exe` from the release page.
2. Run it and complete the installer. Administrators can deploy the `.msi`
   instead.
3. The installer carries the WebView2 offline runtime and the Visual C++
   runtime, so it does not need an internet connection or a preinstalled
   Evergreen Runtime. No extra download is offered during setup.
4. The executable is unsigned, so SmartScreen may show “Windows protected your
   PC”. Choose **More info → Run anyway** only if the file came from the release
   page above.

Audio uses the default Windows output device through Web Audio. No separate
audio driver is required.

Uninstall from **Settings → Apps → OpenBeats**.

## macOS (Apple silicon)

1. Download `OpenBeats_1.0.0_aarch64.dmg`.
2. Open the DMG and drag **OpenBeats** to **Applications**.
3. First launch: Control-click the app, choose **Open**, then confirm. Or clear
   the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/OpenBeats.app
open /Applications/OpenBeats.app
```

The build is not notarised. There is no `x64` DMG in 1.0.0; Intel users can
build from source. Audio uses CoreAudio through WebKit and needs no extra
install.

Uninstall: move `OpenBeats.app` from Applications to the Trash.

## Build from source

Use this when your distribution or architecture has no package, or when you
want to test a change.

### All platforms

- Node.js 20+ and npm 10+
- Rust stable 1.77+
- Platform build tools listed below

```bash
git clone https://github.com/blsphmicwillow/OpenBeats.git
cd OpenBeats
npm install
npm run desktop:build
```

Installers are written under
`src-tauri/target/release/bundle/`. The current platform is the only one that
can be bundled; build Windows on Windows and macOS on macOS.

### Arch build dependencies

```bash
sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3 libayatana-appindicator \
  librsvg libsoup3 openssl gstreamer gst-plugins-base gst-plugins-good \
  gst-plugins-bad gst-plugins-ugly gst-libav libpulse alsa-lib \
  pipewire-pulse   # or pulseaudio
```

### Debian/Ubuntu build dependencies

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev libssl-dev \
  build-essential curl file rpm patchelf \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev gstreamer1.0-tools \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly gstreamer1.0-libav gstreamer1.0-pulseaudio gstreamer1.0-alsa
```

### Fedora build dependencies

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
  librsvg2-devel libsoup3-devel openssl-devel @development-tools
```

Run the checks before opening a pull request:

```bash
npx tsc -b
npm run build
cd src-tauri && cargo fmt --all -- --check
```

More detail, including signing and release automation, is in
[BUILDING.md](BUILDING.md).

## Common problems

| Symptom | Fix |
| --- | --- |
| Transport turns green but the playhead does not move | Web Audio never resumed. Make sure a PipeWire-Pulse or PulseAudio server is running, restart the app, and click the window once before pressing Space. |
| AppImage says “dlopen(): error loading libfuse.so.2” | Install FUSE 2, or run `./OpenBeats.AppImage --appimage-extract-and-run`. |
| Blank white window on Linux | Install/repair Mesa/GPU drivers, then try `WEBKIT_DISABLE_COMPOSITING_MODE=1 openbeats`. |
| Blank window on Windows | Reinstall with the current installer; it embeds the WebView2 runtime. If you built the installer yourself, rebuild with the repository's `tauri.conf.json`. |
| macOS says the app is damaged | Clear quarantine with the `xattr` command above; do not disable Gatekeeper globally. |
| “App is already running” / old version opens | Close all OpenBeats windows and relaunch; packages install side-by-side with a previously extracted AppImage only if both are kept. |
| Plugins do not appear | VST3/AU/CLAP hosting is not implemented in 1.0.0. See [PLUGINS.md](PLUGINS.md). |

## Where data lives

OpenBeats stores projects, autosave snapshots and settings in the app's local
WebKit data store for your user account. Use **File → Projects…** to open or
delete songs rather than editing browser-storage files by hand. Exports go
wherever you choose in the save dialog.

## Uninstall

| Platform | Command |
| --- | --- |
| Arch | `yay -Rns openbeats-bin` |
| Debian/Ubuntu | `sudo apt remove open-beats` |
| Fedora | `sudo dnf remove open-beats` |
| AppImage | delete the file |
| Windows | Settings → Apps → OpenBeats → Uninstall |
| macOS | move `OpenBeats.app` to the Trash |
| Source build | delete the cloned directory and `src-tauri/target` |

User projects are not removed by uninstalling the application.
