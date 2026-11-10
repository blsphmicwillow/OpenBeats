# OpenBeats Gain

A deliberately small native audio effect that proves the OpenBeats plugin
distribution path: one Rust source tree exports **VST3** and **CLAP** bundles,
and the app can discover the GitHub Release that carries them.

It applies a smoothed ±30 dB gain with a stereo and mono layout. There is no
custom editor; every DAW/CLAP host gets its native parameter UI.

## Build

Requirements: Rust 1.88+ and a C toolchain. `nice-plug` 0.4.2 is pinned in
`Cargo.toml`.

```bash
cd plugins/openbeats-gain
./build.sh
```

Outputs (Linux):

```text
dist/OpenBeatsGain.clap
dist/OpenBeatsGain.vst3/Contents/x86_64-linux/OpenBeatsGain.so
OpenBeatsGain-0.1.0-linux-x86_64.tar.gz
```

Install for the current user:

```bash
mkdir -p ~/.clap ~/.vst3
cp dist/OpenBeatsGain.clap ~/.clap/
cp -R dist/OpenBeatsGain.vst3 ~/.vst3/
```

Then rescan plugins in Bitwig, REAPER, Ardour, Carla or another VST3/CLAP host.

## Verify the binary

```bash
nm -D --defined-only target/release/libopenbeats_gain.so | grep -E 'clap_entry|GetPluginFactory'
```

Both symbols must be present. The crate has no GUI dependency and no host
process; it is intentionally a plugin, not an OpenBeats-hosted plugin.

## Scope

This validates compilation, both export ABIs and release packaging. OpenBeats
1.0.0 still does **not** load plugins into its own mixer; that requires the
native host/audio bridge described in [`docs/PLUGINS.md`](../../docs/PLUGINS.md).
The plugin library page is a download/registry surface, not a fake host.
