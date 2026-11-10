#!/usr/bin/env bash
# Build OpenBeats Gain and assemble the platform-native VST3/CLAP bundles.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
version="0.1.0"
name="OpenBeatsGain"
dist="$here/dist"

cd "$repo"
cargo build --release --manifest-path "$here/Cargo.toml"

rm -rf "$dist"
mkdir -p "$dist"

case "$(uname -s)" in
  Linux*)
    cp "$here/target/release/libopenbeats_gain.so" "$dist/$name.clap"
    mkdir -p "$dist/$name.vst3/Contents/x86_64-linux"
    cp "$here/target/release/libopenbeats_gain.so" "$dist/$name.vst3/Contents/x86_64-linux/$name.so"
    archive="$here/$name-$version-linux-x86_64.tar.gz"
    ;;
  Darwin*)
    mkdir -p "$dist/$name.clap/Contents/MacOS" "$dist/$name.vst3/Contents/MacOS"
    cp "$here/target/release/libopenbeats_gain.dylib" "$dist/$name.clap/Contents/MacOS/$name"
    cp "$here/target/release/libopenbeats_gain.dylib" "$dist/$name.vst3/Contents/MacOS/$name"
    archive="$here/$name-$version-macos-universal.tar.gz"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    cp "$here/target/release/openbeats_gain.dll" "$dist/$name.clap"
    mkdir -p "$dist/$name.vst3/Contents/x86_64-win"
    cp "$here/target/release/openbeats_gain.dll" "$dist/$name.vst3/Contents/x86_64-win/$name.vst3"
    archive="$here/$name-$version-windows-x86_64.zip"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac

cat > "$dist/INSTALL.txt" <<'EOF'
OpenBeats Gain 0.1.0 — VST3 + CLAP
===================================

Linux
  CLAP: copy OpenBeatsGain.clap to ~/.clap/
  VST3: copy OpenBeatsGain.vst3 to ~/.vst3/

macOS
  Copy OpenBeatsGain.clap and OpenBeatsGain.vst3 to
  ~/Library/Audio/Plug-Ins/CLAP/ and ~/Library/Audio/Plug-Ins/VST3/.

Windows
  Copy OpenBeatsGain.clap to %COMMONPROGRAMFILES%\CLAP\
  and OpenBeatsGain.vst3 to %COMMONPROGRAMFILES%\VST3\.

This is a standalone plugin. OpenBeats 1.0.0 can browse and download plugins,
but does not host them yet. Load it in a VST3 or CLAP host to hear it.
EOF

if [[ "$archive" == *.zip ]]; then
  (cd "$dist" && zip -qr "$archive" .)
else
  tar -czf "$archive" -C "$dist" .
fi

echo "Bundled plugin: $dist"
echo "Release archive: $archive"
