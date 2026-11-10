# Changelog

The same entries are bundled into the app and shown in the **Changelog** tab, so the notes ship with the build.
Keep this file and `src/lib/changelog.ts` in sync, and bump `APP_VERSION` in `src/lib/version.ts`.

## 1.0.1 — 2026-11-10

**Exporters, sample packs, input tools, a rebuilt tour and smoother timeline editing.**

Linux, Windows and macOS installers are built by CI from the `v1.0.1` tag and attached to that GitHub release.
1.0.0 stays available from its own tag.

### Export engine

- Native WAV (16/24-bit) writing and a pure-Rust FLAC encoder (`flacenc`), with MP3/OGG/M4A transcoding through
  `ffmpeg` when it is installed. Encoding runs on a blocking thread behind the desktop export command, which opens a
  native save dialog. The Bounce button keeps rendering WAV directly.
- Sample preview runs on its own stream, so auditioning never interrupts project playback and a second click replaces
  the first preview.

### Packs, samples and preview

- Pack import from a folder or a `.zip`, recursive scanning, name/folder auto-tagging (kick, snare, hat, 808, bass, …)
  and a JSON pack index that the Browser reloads on every launch.
- Symphonia decoding for wav/mp3/ogg/flac/m4a previews on every platform.

### Input, monitoring and tuning

- A CPAL input stream with an optional monitor path, a mono take recorder that writes 16-bit WAV, and a
  normalised-autocorrelation tuner with note and cents display.
- **Dev Mode** in Settings ▸ Audio shows raw device strings, host APIs, channel counts and sample rates.

### Startup, updates and feedback

- A native splash window that the main window closes when it mounts, and the startup chime played through the CPAL
  engine from a bundled WAV asset.
- GitHub release checks parse tag, notes, assets and platform download links in Rust; preview and production releases
  are compared numerically.
- Help ▸ Suggestions & Fixes posts a validated report with OS and version metadata.

### Timeline and editing

- Edge auto-scroll while dragging: the playlist scrolls for clips, the loop bar and the playhead, and the piano roll
  scrolls in both directions for note moves and resizes. The dragged item stays under the pointer and the edge glows.
- Drags are coalesced into one project commit per animation frame, which removes the lag behind the pointer.
- Visible grab and resize handles, loop and playhead readouts, and grabbing cursors for every drag.

### Guided tour

- The tour is rebuilt around this app: transport, browser and packs, rack, steps, playlist, piano roll, mixer, bounce
  and files, audio and input, plugins, help and feedback. Thirteen stops, each highlighting its own target, with the
  replay entry points in Help and Settings.

### Composition and DSP modules

- Chord progression generator with pop/jazz/lo-fi/trap/house/cinematic/blues recipes.
- Velocity curve maths (linear, exponential, logarithmic, S-curve, compress).
- Spectral freeze/blur (rustfft) and a seeded granular engine, all covered by unit tests.

### Tests

- 239 unit tests in the audio crate, including WAV/FLAC headers, decode round-trips, tuner pitch, progression
  diatonicism, velocity curves, spectral freeze, granular grains, release JSON parsing, webhook payloads and pack
  scanning.

## 1.0.0 — 2026-11-10

**The first public OpenBeats release: a native studio, DAW interchange, autosave and accessibility.**

This is the first official release. Everything below shipped in this build; there was no earlier public version.

### Native audio engine (Rust)

- The desktop build plays through a native CPAL engine in Rust instead of Web Audio: a sample-accurate sequencer, 16 procedural synth voices, a 3-band EQ, compressor and limiter on the master chain. The web demo keeps the Web Audio fallback.
- **Transmitter**: transient/sustain split with hold and release detection; the two parts always sum back to the input.
- **Audio Logger**: the last 60 seconds of master output are kept in memory and can be written to a WAV file at any time.
- **Chord detection** in the piano roll, plus local in-key chord suggestions.
- **Clip gain, pan, pitch, stretch and fades** are applied by the native engine, with matching behaviour in the Web Audio fallback (pan is native-only).
- **Note names** and **clip normalisation** (individually or as a selection) are computed in Rust.
- **VST3/CLAP hosting** on Windows and macOS through an out-of-process plugin host with crash recovery. Not available on Linux, where the plugin browser still works.
- Local natural-language commands, all offline. No accounts, no cloud.

### Audio I/O and the Linux silent-audio fix

- **Audio tab device control**: every input and output CPAL reports is listed, and picking an output rebuilds the stream on that device via `select_audio_device`.
- **Linux silence fixed at the source**: playback looked fine (the step counter moved) while nothing was audible because ALSA's `default` PCM can be a null sink under PipeWire. The device picker now prefers the PipeWire/PulseAudio bridge on Linux, handles F32, F64, I16, I32 and U16 output formats, and logs the device, rate, channel count and estimated latency it actually opened.
- **Device hot-swap**: a stream error pauses playback, counts the error and reopens the system default, so unplugging headphones no longer ends audio for the session. The UI sees the swap count and the new device name.
- **Low-latency mode**: one toggle reopens the stream with the device's smallest buffer and shows the estimated latency in milliseconds.
- **Cue routing**: master is written to outputs 1/2 and the cue bus to 3/4 on interfaces with four or more channels, with its own level control.
- The audio callback prints its frame count and peak once a second, so a silent device can be diagnosed from a terminal.

### Mixing and DSP additions

- **True-peak limiter** with 4× oversampled inter-sample detection, now used as the stereo master limiter instead of the sample-peak limiter.
- **Mid/Side insert processor** with mid/side gain controls and buffer processing.
- **Dynamic EQ** whose band gain is driven by a sidechain input.
- **Spectral analyser** backed by `rustfft`, exposed to the UI as per-band magnitudes.

### Smart workflow and composition

- **Smart Humanize** applies a groove template (Straight, Laid back, Pushed, Shuffle) to timing and velocity. It is deterministic: the same notes and groove always give the same result, so it can be undone and repeated exactly.
- **Auto Gain Staging** computes per-source fader gains that leave -6 dBFS of headroom, ignoring silent sources.
- **Melody Generator** is a local rule-based composer: it starts on a chord tone, moves mostly by step, resolves leaps, arches the contour and ends on a chord tone, and the same seed reproduces the same melody.
- **Note Arpeggiator** is a held-note state machine in Rust with up/down/up-down/as-played orders, octave expansion and a gate length, rendered to a pattern on request.
- **Project Health Check** reports clipping, unused channels, missing samples, unloaded channels and high-CPU plugins.
- **Tap Tempo** derives BPM from tap times using the median interval, so a missed tap does not derail it.
- **Session recovery**: a background Rust thread writes a hidden `.recovery` snapshot at most every 30 seconds, atomically via a temporary file, and the Audio tab can restore or clear it.
- **Theme engine**: JSON theme files are validated in Rust (colours only, no injected declarations) and returned as `--variable` pairs for the UI.

### Mixing, automation and editing tools

- **Mixer routing** in Rust: free routing to any track, multiple sends, pre-fader sends, mute/solo and a sidechain ducker, with routing cycles refused instead of producing feedback.
- **Automation lanes** that drive any engine parameter: linear, hold, ease-in/out and S-curve segments, min/max re-ranging, looping and bipolar ranges.
- **Piano-roll tools**: strum (direction, tension, velocity), arpeggiate (up/down/up-down, rate, octaves), flam, plus twelve scales for highlighting and note snapping.
- **Playlist tools**: slice, chop, quantize clip starts, trim, duplicate and consolidate.
- **Modular effect graph** (Patcher-style): gain, low-pass, high-pass and drive nodes with summed fan-in, topological evaluation and cycle rejection.

### Studio

- Channel rack with step sequencer, per-channel knobs, audition previews and live meters.
- Playlist with pattern clips, a piano roll with velocity lane, and a routing mixer with buses, sends and eight native effects.
- Offline WAV bounce, mastering targets, **Fix My Mix** analysis with A/B, **Hum to Melody** and **Inspire Me**.
- Guided first-run tour and an in-app manual.

### Projects

- First launch opens a saved **Tutorial** project instead of a blank song.
- **Projects** dialog lists saved songs, opens old ones, starts new projects, saves the current song and deletes entries.
- The last project is restored on launch; the Tutorial project is built in and cannot be deleted.

### Desktop

- Tauri 2 shell (`src-tauri/`) with Linux (deb + AppImage), Windows (msi + nsis) and macOS (dmg) installers.
- Native project, song and sample file dialogs, plus reveal-in-folder, with browser fallbacks.
- Animated startup splash with a short, warm synthesized chime; the chime can be switched off in **Settings → Workflow**.
- Update banner and GitHub Releases check, plus **Help → Check for updates…**. Automatic launch checks have a real opt-out: when disabled, no request is made. The checker and Tauri endpoint now point at the actual `blsphmicwillow/OpenBeats` repository, and saved settings are migrated away from the old placeholder path.
- `.github/workflows/release.yml` builds all three platforms on every push to `main`; a `v*` tag publishes the release.
- **Arch Linux package** (`openbeats-bin`): the 1.0.0 AppImage extracts to `/opt/openbeats`, a `/usr/bin/openbeats` launcher is installed, and GTK, GStreamer, audio-server and icon dependencies are declared. Package revision 2 fixes the launcher path and makes the extracted tree readable by normal users. Install locally with `cd packaging/arch && yay -Bi .`; AUR publication steps are documented.
- **Installer audio runtime:** Linux AppImage builds now bundle GStreamer and the base/good/bad/ugly/libav audio plugins; `.deb` and `.rpm` packages declare the full GStreamer and PulseAudio/PipeWire dependency set. Windows installers embed the WebView2 offline runtime and bundle the VC runtime. CI extracts the AppImage and fails if the audio plugins are missing.
- **[docs/INSTALL.md](docs/INSTALL.md)** now covers Arch/AUR, AppImage, deb, RPM, Windows, macOS and source builds, with a README download matrix and FAQ.
- **Plugin library** (View → Plugin library…): a searchable browser with VST3/CLAP and vendor-style category filters (for example `Dynamics - Compressor`), backed by [`plugins/registry.json`](plugins/registry.json) and live GitHub Release metadata, with an offline bundled fallback and download links.
- **OpenBeats Gain** proof plugin in [`plugins/openbeats-gain`](plugins/openbeats-gain): a Rust `nice-plug` audio effect exporting both VST3 and CLAP, with a Linux release bundle and build script. OpenBeats 1.0.0 browses and downloads plugins; it still does not host them in the mixer.
- Community plugin submission template and registry validator (`npm run plugins:check`).

### Interchange

- **MIDI import/export** (SMF type 1) with one track per channel, tempo, programs and running-status parsing — works with
  reference DAW, Ableton, Logic, Cubase, Studio One, Bitwig and REAPER.
- **Ableton Live Set (`.als`) import**: gunzips the XML and rebuilds MIDI tracks, clips and notes as channels, patterns and
  playlist clips.
- **REAPER (`.rpp`) import and export**: tempo, tracks, MIDI items and note events round-trip as plain text.
- **Import / export song** dialog with a per-format matrix and honest fidelity notes; native binary save/open dialogs for MIDI.

### Sounds

- **Drag audio files anywhere** into the studio to create sampler channels; dropping several files imports them in one go.
- Dropping `.mid`, `.als`, `.rpp` or `.obeats` opens the song, with a visible drop target and clear feedback.
- One-shot import auto-tags tempo, brightness and instrument family, and keeps a session sample bank.

### Audio reliability

- Transport now refuses to turn green when the system blocks Web Audio; it reports the suspended context instead of showing a frozen playhead.
- Every audio start resumes WebKitGTK's pipeline with a bounded wait and a silent-buffer unlock, and the first Spacebar or pointer gesture unlocks audio.
- Linux packages now declare the GStreamer base/good/PulseAudio plugins that WebKitGTK needs for Web Audio output.

### Autosave

- Crash-safe local snapshots on a selectable timer: **2, 5, 10, 15, 30 or 60 minutes, or Never**.
- A final snapshot is written when the window closes, and the latest snapshot is restored automatically after a crash.
- **Save now** in Settings and the exact last-autosave time are always visible.

### Accessibility

- Screen-reader names and states for transport, workspace tabs, channel rows, step buttons, mixer controls and dialogs.
- Keyboard-operable knobs and faders: arrows, Page Up/Down and Home/End change values, with spoken current values.
- Reduce motion, reduce transparency, high contrast, visible focus rings, interface scale and density settings.
- ARIA live regions announce hints, saves and errors without stealing focus; a skip link reaches the workspace.

### Performance

- Dialogs, the command palette and the changelog are **code-split**, so the initial studio bundle is smaller.
- Workspace panels are memoised, so theme, dialog and settings changes do not rerender the rack, playlist or mixer.
- Playhead painting stays on `requestAnimationFrame` and only updates when the step changes.

### Interface fixes

- **Undo/redo is global** across the studio, including when a dropdown has focus; `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` work from the playlist, rack, piano roll and mixer.
- Select and option text is explicitly themed against its background, with `color-scheme` set for light and dark themes so native menus never inherit white-on-white or white-on-dark text.
- **Discord Rich Presence** toggle in Settings → Workflow. It now uses OpenBeats' built-in Discord application ID (`1569568675198140446`), reports “Making a beat..” with the current project name, and clears the presence when switched off.

### Interface

- Classic / Modern interface modes over the same theme tokens.
- Eleven themes, including Glass and Liquid Glass in light and dark variants, plus Studio 2006.
- Colour editor with a colour wheel, HEX field and R/G/B inputs for every theme token, glass toggle and JSON import/export.
- Command palette (Ctrl/Cmd+K) covering transport, views, channels, audio tools and project actions.

### Workflow research

- Added project-wide **key detection** (major/minor profile) to the piano roll toolbar.
- Rounded playlist clip edges for clearer section boundaries, a recurring Ableton user request.
- Audited current reference DAW and Ableton requests; already covered: dynamic mixer tracks, loop/chord generation,
  command palette, device A/B, browser and project portability through `.obeats`. See `docs/RESEARCH.md`.

### Design

- Glass reworked after comparing it with Apple's Liquid Glass guidance: near-opaque content panels, frosted chrome,
  specular rims and edge depth, plus a solid fallback when `backdrop-filter` is unavailable.
- `docs/GLASS.md` records the comparison and the remaining gaps; `docs/EXCHANGE.md` records format fidelity.

### Compatibility notes

- Third-party **VST3/AU hosting is not included** in 1.0.0. The plugin library and OpenBeats Gain prove discovery, packaging and download; a native plugin host and audio bridge need per-platform SDK work that is not part of this release.
- reference DAW `.flp` is a proprietary binary event stream, so reference DAW projects travel through MIDI rather than `.flp`.
- The **Rust/CPAL audio migration plan** is published in `docs/RUST_AUDIO.md`. 1.0.0 still renders with Web Audio; a
  native engine requires ALSA development headers (and equivalent platform work) plus the staged port described there.
