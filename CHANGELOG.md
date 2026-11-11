# Changelog

The same entries are bundled into the app and shown in the **Changelog** tab, so the notes ship with the build.
Keep this file and `src/lib/changelog.ts` in sync, and bump `APP_VERSION` in `src/lib/version.ts`.

## 1.0.6 — 2026-11-11

**OpenBeats v1.0.6 — arrangement markers, section loops and RPP marker interchange.**

### Playlist markers

- Add named markers at the playhead from the playlist toolbar or with **F6**.
- Click a marker to jump to it, drag it to move it, double-click to rename it, or right-click to loop from it to the next marker.
- **Alt+Left** and **Alt+Right** move between markers without changing the loop.
- Markers are persisted in `.obeats` projects and old projects load with an empty marker list.
- Pattern and audio clips have visible fade handles. Selecting a clip exposes gain, pan and fade controls in the inspector.
- Right-clicking an overlapping clip offers a one-click crossfade with the next clip.
- Browser samples can be dragged onto playlist lanes, and playlist drags no longer select surrounding interface text.
- Offline export now includes playlist audio clips and reloads their media for saved projects before rendering.
- Mixer **volume and pan automation lanes** with **linear, hold and smooth** segments. Click to add points, drag to edit, select a point and choose its outgoing segment shape, right-click to remove, and clear a lane from the mixer.
- **Tempo-synced presets**: a four-bar smooth fade-in, a 1/8-note tremolo and a 1/4-note ducking pulse. Presets replace the selected lane and stay aligned to the 16th grid as the project tempo changes.
- Automation is **Web Audio only**. Projects with automation points use the Web Audio transport for playback, and the same ramps are applied during offline bounce; native CPAL playback ignores automation.
- The tutorial welcome title and the native splash document now read the package version, so they cannot drift from the release.
- Split the selected pattern or audio clip at the playhead from the playlist toolbar or clip menu; the split preserves outer fades and media.
- Reverse and peak-normalize selected audio clips from the inspector or clip menu. ENGINE: **Web Audio only**, applied identically during live playback and offline bounce; native CPAL audio-clip playback remains pending.
- Fixed offline export using pattern-local note steps instead of absolute song steps; later arrangement clips no longer collapse toward the start of the bounce.
- REAPER `.rpp` export writes the marker list and import reads it back.

Markers are arrangement data only and do not change which engine plays audio. Pattern clips keep the Rust/Web Audio split; playlist audio clips remain **Web Audio only** with native playback pending.

## 1.0.5 — 2026-11-11

**OpenBeats v1.0.5 — playlist audio clips, honest engine documentation and an automated theme audit.**

Linux, Windows and macOS installers are built by CI from the `v1.0.5` tag and attached to that GitHub release.
1.0.4 stays available from its own tag.

### Playlist audio clips (Web Audio only)

- Drop a WAV, MP3, OGG, FLAC or AIFF file on a playlist lane to create an audio clip with a waveform, gain, pan,
  fade and loop controls. Clips follow the loop region: a wrap resumes at the wrapped offset instead of going silent.
- Waveforms are built as a peak pyramid in a Web Worker with progressive level-of-detail, so a five-minute 48 kHz
  stereo file does not block the UI thread. The pyramid builds in about 53 ms (measured).
- Media bytes are SHA-256 addressed in the WebView's IndexedDB, so a reopened project can verify its media.
  **Native app-data persistence is planned for 1.1**; 1.0.5 caches media in the WebView.
- **This feature runs in Web Audio only.** The Rust/CPAL engine has no audio-clip voice, so the playlist toolbar
  reads “Playlist audio clips: Web Audio (desktop native pending).”

### Documentation corrections

- The engine split is now stated where users look: CPAL runs the transport, the 16 voices and the master
  EQ → compressor → limiter; reverb, delay, drive, filter and the 10-band EQ are Web Audio only; mixer routing,
  automation lanes and the modular effect graph are tested in Rust but not wired into the CPAL callback.
- Desktop playback and offline bounce can diverge, and per-clip pan is applied per note by Rust while the Web Audio
  fallback uses channel pan.
- Plugin copy matches reality: hosting exists on Windows/macOS through an out-of-process helper, but inserts are not
  routed into the audio callback and Linux hosting is unsupported, so loading plugins into the mixer is still not
  implemented.

### Quality

- New `scripts/qa-visual.mjs` measures WCAG contrast for all 11 built-in themes in both interface modes
  (22 combinations) and writes `docs/QA_THEMES_1.0.5.md` with screenshots.
- **22/22 combinations pass WCAG AA** (4.5:1 body text, 3:1 large/UI). Mint Studio and Studio 2006 needed a small
  `--dim` adjustment to clear the bar.
- Vitest covers playlist audio clips and pack import, and a root Cargo workspace makes `cargo test -p openbeats`
  work from the repository root.

### Verification

- `npm test`, `npm run typecheck` and `cargo test` pass locally, and 22/22 theme combinations pass the contrast
  harness.

## 1.0.4 — 2026-11-10

**OpenBeats v1.0.4 — working microphone capture on Windows and macOS.**

Linux, Windows and macOS installers are built by CI from the `v1.0.4` tag and attached to that GitHub release.
1.0.3 stays available from its own tag.

### Fixes

- Fixed Windows audio input detection. Input now enumerates all CPAL hosts, prefers WASAPI, and falls back to an
  ASIO host when the installed build provides one.
- The input stream now uses the device's native sample format (F32, I16 or U16) and channel count instead of assuming
  the default format and channels.
- Failed Windows input streams report **“Microphone access denied. Please check Windows Privacy Settings.”** so the
  privacy setting is discoverable instead of producing a generic device error.
- Fixed macOS microphone permission prompts by adding `NSMicrophoneUsageDescription` to `src-tauri/Info.plist` and
  selecting the CoreAudio host explicitly.
- macOS `BuildStreamError::DeviceNotAvailable` now points to **System Settings → Privacy & Security → Microphone**.
- Device enumeration is unified into `AudioDevices { inputs, outputs }`. Only devices that report a usable input or
  output configuration are listed, so ghost endpoints no longer appear in the pickers.
- Input capture uses a dedicated 256-sample buffer, routes monitored input to the master output, and writes recorded
  takes as 16-bit PCM WAV through the `hound` crate.

### Notes

- **Volim cried watching the programming.** We felt that. The audio input bugs were rough. We fixed them.

### Verification

- `cargo check` and `cargo test` cover the audio crate and desktop crate. Windows and macOS installers are built and
  attached by the release workflow.

## 1.0.3 — 2026-11-10

**Crash-free pack importing, FL-style pack layouts and a transparent import report.**

Linux, Windows and macOS installers are built by CI from the `v1.0.3` tag and attached to that GitHub release.
1.0.2 stays available from its own tag.

### Pack importing

- **Import Pack no longer crashes.** The blocking folder/zip picker and the whole import now run on a worker thread
  instead of the UI thread; cancellation returns quietly, real errors reach the UI, and the release profile unwinds so
  an unexpected importer panic becomes an error instead of terminating the app.
- OpenBeats recognises its own `manifest.json` packs, FL-style category folders (`Kicks/`, `Snares/`, `Hats/`, …),
  generic one-shot zips and flat sample dumps. Samples are categorised from folders or auto-tagged from their names.
- The import report lists imported samples by category, preset metadata, skipped files and reasons, warnings, archive
  sizes and a per-file log.
- ZIP imports are validated before extraction: 500 MB archive and 50 MB sample caps, a configurable 2 GB total budget,
  a 10,000-entry limit, 100× compression-ratio guards, traversal/absolute/backslash rejection, duplicate and symlink
  rejection, and an extension allow-list. Extraction happens in a private staging folder before the pack is indexed.
- Corrupt WAV/AIFF/FLAC/OGG/MP3 headers, oversized files and non-UTF-8 filenames are handled without panicking.
- Pack samples appear in the Browser's Samples tab and can be previewed or loaded; imported zips can be uninstalled
  using a recorded file manifest, while source folders chosen in place are never deleted.
- Packs can be imported from **File → Import pack folder… / Import pack .zip…**, the Browser, or by dropping a zip.

### Updates

- The in-app updater now chooses the installer that matches the running package instead of always downloading the
  AppImage. AppImages are replaced in place and relaunched; deb/rpm updates open the system package installer; Windows
  uses a detached helper so the running executable is not locked while MSI/NSIS installs; macOS opens the DMG without
  closing the app first. Installer URLs are still restricted to this repository's GitHub releases, downloads are
  bounded and AppImage headers are validated before replacement.
- Update failures now show the real error in the banner instead of silently closing the app.
- The AppImage desktop entry now includes `X-AppImage-Version`, so desktop integration and update tools can read the
  installed version.

### Linux AppImage compatibility

- The rebuilt 1.0.3 AppImage carries `X-AppImage-Version=1.0.3`, has an executable payload and bundles no `libfuse`.
  It installs and lists correctly with both Shelly 3.0.6 and Shelly 3.2.1, and its main window opens at 1440×900 in a
  fresh Linux display.
- Linux release builds now request `appimage,deb,rpm` explicitly instead of relying on Tauri's `all` target.
- AppImage builds set `NO_STRIP=1` so linuxdeploy cannot run an outdated strip binary over modern ELF payloads. This
  prevents the malformed-binary/`InvalidExe` failure mode in package managers such as Shelly.
- On Arch, install FUSE 3 with `sudo pacman -S fuse3`. If FUSE is unavailable, or an older package frontend rejects
  the file, run `./OpenBeats_1.0.3_amd64.AppImage --appimage-extract-and-run`.

### FL Studio metadata

- `.fxp` files expose their plugin 4CC, preset name and parameter count as metadata. FXP does not store parameter
  names and OpenBeats does not host VST2.
- `.fst` files are labelled **FL native — preview only, not executable here** with their readable strings in the notes.
- `.flp` files are offered as a read-only pattern reference with inferred channel/pattern names; they are not played
  or converted. Use FL's MIDI export for a musical transfer.

### Verification

- Adversarial Rust tests cover empty/truncated zips, traversal, symlinks, compression bombs, entry limits, corrupt
  WAVs, oversized samples, non-UTF-8 names and FL preset parsing. A Node test covers the rejected-import UI path.
- See [docs/IMPORT_PACKS.md](docs/IMPORT_PACKS.md) for the supported layouts, manifest schema and limits.

## 1.0.2 — 2026-11-10

**Auditioning through the engine, a draggable playhead, bundled MP3 export and a working updater.**

Linux, Windows and macOS installers are built by CI from the `v1.0.2` tag and attached to that GitHub release.
1.0.1 stays available from its own tag.

### Auditioning and playback

- Browser samples, the channel-rack test note and the metronome now play through a dedicated CPAL preview voice that
  bypasses the sequencer, so they are audible while the transport is stopped. The commands send real buffers to the
  output stream instead of only updating state.
- Clicking an instrument fires a one-shot C4 note at velocity 100 through the native synth; a second click replaces
  the previous preview.
- The metronome is rendered in the audio callback from the playback snapshot, accented every 16 steps, and toggling it
  refreshes the running engine.
- Seeking during native playback now sends a seek command instead of stopping and restarting the stream.

### Timeline and devices

- The playhead is thicker, shows a grab cursor and can be dragged; each drag updates the native playhead position in
  real time. The playlist and piano roll scroll to follow playback when it leaves the viewport.
- Input and output devices show friendly names by default. Dev Mode is off by default and reveals the raw ALSA/
  PipeWire strings, host API, channel counts and sample rates when enabled.

### Export and files

- MP3 export uses the bundled `mp3lame-encoder` (LAME) instead of ffmpeg, at 128/192/320 kbps depending on the
  quality setting. WAV, 24-bit WAV and FLAC remain native; OGG and M4A use ffmpeg when it is installed.
- The desktop export command opens the native save dialog, and **Save project as…** saves `.obeats` files anywhere on
  disk through the same dialog.

### Updates

- The update button downloads the installer for the current platform, accepts only GitHub release URLs from this
  repository, marks the Linux AppImage executable, launches it and restarts the app.

### Performance and tests

- The sequencer renders into a preallocated trigger buffer that the audio callback reuses, removing per-tick
  allocation from the playback path.
- 243 audio-crate unit tests cover the metronome defaults, preview and seek commands, trigger-buffer reuse, installer
  URL validation, the bundled MP3 stream, WAV/FLAC headers, decoding and the DSP modules. CI runs them with the
  `mp3` feature enabled.

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
