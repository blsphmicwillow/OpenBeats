# Arch Linux / AUR

## Install from this repository (works now)

```bash
git clone https://github.com/blsphmicwillow/OpenBeats.git
cd OpenBeats/packaging/arch
yay -Bi .
```

`yay -Bi` builds and installs the local `PKGBUILD`. It installs the released
AppImage into `/opt/openbeats` and installs `/usr/bin/openbeats` as a launcher
for `/opt/openbeats/AppRun`. Runtime dependencies are declared in the package;
`makepkg` will ask for missing ones.

Install one audio server before launching if you do not already have one:

```bash
# PipeWire (usual Arch desktop)
sudo pacman -S --needed pipewire-pulse
# or PulseAudio
sudo pacman -S --needed pulseaudio
```

The package declares the GStreamer base/good/bad/ugly/libav plugins because
WebKitGTK uses GStreamer for Web Audio output. Without them the transport can
start while no sound reaches the device.

## Publish to the AUR (one-time, maintainer)

The source in this directory is AUR-ready, but this workspace has no AUR SSH
key, so it is not published under `openbeats-bin` yet.

1. Add your SSH public key at <https://aur.archlinux.org/account/>.
2. Test access: `ssh -T aur@aur.archlinux.org` (it should say “Welcome”).
3. Create/update the AUR repository:

```bash
git clone ssh://aur@aur.archlinux.org/openbeats-bin.git
cd openbeats-bin
cp /path/to/OpenBeats/packaging/arch/PKGBUILD .
cp /path/to/OpenBeats/packaging/arch/.SRCINFO .
git add PKGBUILD .SRCINFO
git commit -m "openbeats-bin 1.0.3"
git push
```

After that, users install with:

```bash
yay -S openbeats-bin
```

Update `pkgver`, `sha256sums` and `.SRCINFO` together when a new release is
published. Regenerate metadata with `makepkg --printsrcinfo > .SRCINFO`.

## Verify

```bash
command -v openbeats
openbeats
# Desktop menu: OpenBeats
```

Run `openbeats` as your normal user, not with `sudo`. If an older 1.0.0
package is installed, rebuild so the package becomes 1.0.3-1:

```bash
cd OpenBeats/packaging/arch
yay -Bi .
```

Uninstall with `yay -Rns openbeats-bin`.
