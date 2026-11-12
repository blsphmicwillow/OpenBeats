# Building OpenBeats

OpenBeats is a Tauri 2 application: a Rust host process (`src-tauri/`) that owns the window, dialogs and filesystem access, and a React + Web Audio front end (`src/`) that Tauri embeds at compile time. The Rust process is the desktop shell, not an audio engine; see [RUST_AUDIO.md](RUST_AUDIO.md) for the native-engine migration.

## Prerequisites

### All platforms
- Node.js 20 or newer, npm 10+
- Rust stable 1.77+ (`rustup default stable`)
- The Tauri CLI comes from `devDependencies`; no global install needed.

### Linux (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libsoup-3.0-dev libssl-dev build-essential curl file rpm patchelf \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev gstreamer1.0-tools \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly gstreamer1.0-libav gstreamer1.0-pulseaudio gstreamer1.0-alsa
```
`libwebkit2gtk-4.1-dev` is required for 24.04/24.10; older distributions ship 4.0 and need a newer base image.

### Arch Linux
```bash
sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3 libayatana-appindicator \
  librsvg libsoup3 openssl gstreamer gst-plugins-base gst-plugins-good \
  gst-plugins-bad gst-plugins-ugly gst-libav libpulse alsa-lib
```

To install the released 1.0.0 build rather than compile it, use the package in
[`packaging/arch`](../packaging/arch) (`cd packaging/arch && yay -Bi .`). The complete
end-user guide is [INSTALL.md](INSTALL.md).

### Windows
- Visual Studio Build Tools with the **Desktop development with C++** workload (MSVC + Windows SDK).
- WebView2 runtime (preinstalled on Windows 11; the installer can download it when missing).

### macOS
- Xcode command line tools (`xcode-select --install`). Universal builds need both `aarch64-apple-darwin` and `x86_64-apple-darwin` targets.

## Install and run

```bash
npm install
npm run dev            # browser, no native shell (useful for UI work)
npm run desktop        # native window with Vite hot reload
npm run build          # tsc -b + vite production bundle
```

`npm run dev` serves `http://localhost:3000`. Native-only commands (`save_text_file`, `open_text_file`, `reveal_path`) fall back to browser downloads/uploads, so UI work does not require Rust.

## Building installers

```bash
npm run desktop:build
```

This runs `tauri build`, which produces a release binary and platform bundles:

| Platform | Output (`src-tauri/target/release/bundle/`) |
| --- | --- |
| Linux | `deb/*.deb`, `appimage/*.AppImage` |
| Windows | `msi/*.msi`, `nsis/*-setup.exe` |
| macOS | `dmg/*.dmg`, `macos/*.app` |

Only the current platform can be bundled. Build Linux on Linux, Windows on Windows and macOS on macOS — that is what CI does.

### Installer audio runtime

The Linux AppImage sets `bundle.linux.appimage.bundleMediaFramework`, so Tauri
includes GStreamer and the installed base/good/bad/ugly/libav plugins in the
AppImage. The build machine must have those plugins installed; the CI workflow
installs them before bundling. The AppImage still uses the host's PipeWire-Pulse
or PulseAudio server.

The `.deb` and `.rpm` packages declare GStreamer, the audio plugins and a
PulseAudio-compatible server. Windows installers use the WebView2 download
bootstrapper and bundle the VC runtime; macOS uses the system WebKit/CoreAudio
stack. The bootstrapper downloads WebView2 during installation if the machine
does not already have it, so the installer stays small and needs network access
on first install.

To verify a Linux bundle locally:

```bash
appimage=$(find src-tauri/target/release/bundle/appimage -name '*.AppImage' -print -quit)
"$appimage" --appimage-extract
find squashfs-root -name 'libgstpulseaudio.so' -o -name 'libgstalsa.so'
```

### Versioning

The version must stay in sync across:
- `package.json` and `package-lock.json` (`npm version` updates both)
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` and each `src-tauri/crates/*/Cargo.toml`
- `src/lib/version.ts`
- both `Cargo.lock` files

Bump them together and add a `CHANGELOG.md` entry (the app's Changelog tab reads `src/lib/changelog.ts`, which should mirror it).

## Releases (GitHub Actions)

`.github/workflows/release.yml` runs on pushes to `main`, `v*` tags and manual dispatches:

1. **build** matrix on `ubuntu-22.04`, `windows-latest`, `macos-latest`.
2. Each job installs Node and Rust, installs the Linux system packages only on Ubuntu, runs `npm ci`, `npm run desktop:build -- --bundles …`, and uploads that platform's installers as workflow artifacts.
3. A single **release** job waits for all three builds. On a `v*` tag it downloads every artifact and attaches the `.deb`, `.rpm`, `.AppImage`, `.msi`, NSIS `.exe`, `.dmg` and zipped `.app` to the GitHub Release with `softprops/action-gh-release`.

Manual run: **Actions → Release → Run workflow**. Every build also keeps its installers as downloadable workflow artifacts, so you can test a package without creating a tag. Tagging `v1.0.9` is enough to create or update the matching release.

#### Platform notes

- **macOS**: unsigned builds work but Gatekeeper shows the unidentified-developer warning. For signed and notarized builds, add `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password) and `APPLE_TEAM_ID` under **Settings → Secrets and variables → Actions**. The workflow passes them to Tauri when present.
- **Windows**: the WebView2 download bootstrapper is configured in `src-tauri/tauri.conf.json`; the NSIS/MSI installers fetch the runtime if it is missing. An Authenticode certificate is optional and only affects SmartScreen warnings.
- **Linux**: the workflow installs the same GTK, WebKitGTK, GStreamer and ALSA development packages listed above before bundling.

Only the host platform can be bundled. A Linux runner cannot produce Windows or macOS installers; that is why the matrix uses native runners.

### Update signing (optional, for silent updates)

The app currently detects a newer release and links to it. To enable in-app download and install:

```bash
npm run tauri signer generate -- -w ~/.tauri/openbeats.key
```

1. Put the **public** key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
2. Set `plugins.updater.endpoints` to
   `https://github.com/blsphmicwillow/OpenBeats/releases/latest/download/latest.json`.
3. Add repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Set `bundle.createUpdaterArtifacts: true` in `src-tauri/tauri.conf.json` and extend the release workflow to upload the generated `latest.json`.

Never commit the private key.

### Code signing

- **macOS**: set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`. Unsigned builds trigger Gatekeeper warnings.
- **Windows**: an Authenticode certificate avoids SmartScreen warnings. Configure `bundle.windows.certificateThumbprint` or a Tauri `signCommand` and provide the certificate through repository secrets; the checked-in workflow does not sign Windows binaries by default.

## Plugin example

The first-party proof plugin is a separate Rust crate and does not depend on the
Tauri app build:

```bash
cd plugins/openbeats-gain
./build.sh
```

Requirements: Rust 1.88+ and a C toolchain. The script builds both export targets
and writes `OpenBeatsGain.clap` plus `OpenBeatsGain.vst3/Contents/<platform>/`.
On Linux it also creates `OpenBeatsGain-0.1.0-linux-x86_64.tar.gz`.

Validate the plugin library entries with `npm run plugins:check`. See
[PLUGINS.md](PLUGINS.md) for the registry and the native-hosting boundary.

## Verifying a build

```bash
npx tsc -b                 # type check
npm run build              # production bundle
cd src-tauri && cargo fmt --all -- --check
npm run desktop:build      # native bundle
```

Then launch the installed app and check: audio starts, the demo song plays, save/open round-trips a project, the Changelog tab opens, and Settings → Appearance applies a theme.
