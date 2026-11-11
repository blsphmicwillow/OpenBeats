export interface ChangelogEntry {
  version: string;
  date: string;
  headline: string;
  groups: { title: string; items: string[] }[];
}

/**
 * The Changelog tab reads this list. Keep the newest entry first and bump
 * APP_VERSION in version.ts with every release.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.6',
    date: '2026-11-11',
    headline: 'Arrangement markers for faster song navigation and section loops.',
    groups: [
      {
        title: 'Playlist markers',
        items: [
          'Add named markers at the playhead from the playlist toolbar or with F6.',
          'Click a marker to jump to it, drag it to move it, double-click to rename it, or right-click to loop to the next marker.',
          'Alt+Left and Alt+Right jump to the previous and next marker without changing the loop.',
          'Markers are stored in the .obeats project and normalized when older projects load.',
          'Pattern and audio clips have visible fade handles; a selected clip also exposes gain, pan and fade controls in the inspector.',
          'Right-click an overlapping clip to create a one-click crossfade with the next clip.',
          'Browser samples can be dragged straight onto a playlist lane, and pointer drags no longer select surrounding UI text.',
          'Offline export now includes playlist audio clips and rehydrates their media when a saved project is bounced in a fresh session.',
          'Mixer volume and pan automation lanes with linear, hold and smooth segments, editing in the mixer and offline-bounce support.',
          'Tempo-synced automation presets for a four-bar fade-in, 1/8 tremolo and 1/4 ducking pulse.',
          'The tutorial welcome title and native splash read the package version, so both always match the release.',
          'Automation is Web Audio only: native CPAL playback ignores it, so projects with automation points use the Web Audio transport and the mixer labels that limit.',
          'Fixed offline export using pattern-local steps instead of absolute song steps, so later arrangement clips no longer collapse toward the start of the bounce.',
        ],
      },
      {
        title: 'Interchange and engine split',
        items: [
          'REAPER .rpp export now writes markers and .rpp import reads them back.',
          'Markers are timeline data only: they do not change the audio path. Pattern clips keep the Rust/Web Audio split, and playlist audio clips remain Web Audio only with native playback pending.',
        ],
      },
    ],
  },
  {
    version: '1.0.5',
    date: '2026-11-11',
    headline: 'Playlist audio clips, honest engine docs and an automated theme audit.',
    groups: [
      {
        title: 'Playlist audio clips (Web Audio only)',
        items: [
          'Drop a WAV, MP3, OGG, FLAC or AIFF file on a playlist lane to get an audio clip with a waveform, gain, pan, fades and loop controls.',
          'Clips follow the loop region: a wrap resumes at the wrapped offset instead of going silent.',
          'Waveforms build as a peak pyramid in a Web Worker with progressive level-of-detail, so a five-minute 48 kHz file does not block the UI.',
          'Media bytes are SHA-256 addressed in the WebView IndexedDB; native app-data persistence is planned for 1.1.',
          'This is Web Audio only: the Rust/CPAL engine has no audio-clip voice, and the playlist says so.',
        ],
      },
      {
        title: 'Documentation corrections',
        items: [
          'CPAL runs the transport, 16 voices and the master EQ → compressor → limiter; reverb, delay, drive, filter and the 10-band EQ are Web Audio only.',
          'Mixer routing, automation lanes and the modular effect graph are tested in Rust but not wired into the CPAL callback.',
          'Desktop playback and offline bounce can diverge, and per-clip pan is per-note in Rust versus channel pan in Web Audio.',
          'Plugin hosting exists on Windows/macOS out-of-process, but inserts are not routed into the audio callback and Linux hosting is unsupported; loading plugins into the mixer is still not implemented.',
        ],
      },
      {
        title: 'Quality',
        items: [
          'scripts/qa-visual.mjs measures WCAG contrast for 11 themes × 2 interface modes and writes docs/QA_THEMES_1.0.5.md with screenshots.',
          'All 22 combinations pass WCAG AA after a small --dim adjustment on Mint Studio and Studio 2006.',
          'Vitest covers playlist audio clips and pack import, and a root Cargo workspace makes cargo test -p openbeats work from the repository root.',
        ],
      },
    ],
  },
  {
    version: '1.0.4',
    date: '2026-11-10',
    headline: 'Working microphone capture on Windows and macOS.',
    groups: [
      {
        title: 'Audio input',
        items: [
          'Windows input enumerates every CPAL host, prefers WASAPI and falls back to ASIO when the installed build provides it.',
          'Input streams use the device native F32, I16 or U16 sample format and channel count instead of assuming the defaults.',
          'A failed Windows microphone stream reports “Microphone access denied. Please check Windows Privacy Settings.”',
          'macOS declares NSMicrophoneUsageDescription, opens the CoreAudio host explicitly, and points a missing device to System Settings → Privacy & Security → Microphone.',
          'Device enumeration now returns separate inputs and outputs and hides endpoints with no usable stream configuration.',
          'Input monitoring uses a dedicated 256-sample buffer, and recorded takes are written as 16-bit PCM WAV with hound.',
        ],
      },
      {
        title: 'Notes',
        items: [
          'Volim cried watching the programming. We felt that. The audio input bugs were rough. We fixed them.',
        ],
      },
    ],
  },
  {
    version: '1.0.3',
    date: '2026-11-10',
    headline: 'Crash-free pack importing, FL-style pack layouts and a transparent import report.',
    groups: [
      {
        title: 'Pack importing',
        items: [
          'Import Pack no longer crashes: the blocking picker and extraction run off the UI thread, cancellation is quiet, errors reach the UI, and an importer panic becomes an error instead of ending the app.',
          'OpenBeats detects its own manifest packs, FL-style category folders, generic one-shot zips and flat sample dumps, then categorises or auto-tags every sample.',
          'The import report lists samples by category, preset metadata, skipped files and reasons, warnings, archive sizes and a per-file log.',
          'Zips are validated before extraction: size, entry, 100× compression-ratio, traversal, absolute/backslash path, duplicate and symlink guards, plus an extension allow-list.',
          'Corrupt audio headers, oversized samples and non-UTF-8 filenames are reported without panicking; zip packs can be uninstalled from their recorded file manifest while source folders are left untouched.',
        ],
      },
      {
        title: 'Updates',
        items: [
          'The updater now selects the installer for the running package: AppImages are replaced in place and relaunched, deb/rpm packages open the system installer, Windows uses a detached helper to avoid file locks, and macOS opens the DMG without closing the app.',
          'Download URLs remain restricted to this repository, downloads are bounded, AppImage headers are validated before replacement, and update failures show the real error in the banner.',
          'The AppImage desktop entry includes X-AppImage-Version so desktop integration and update tools can read the installed version.',
        ],
      },
      {
        title: 'Linux AppImage compatibility',
        items: [
          'The rebuilt 1.0.3 AppImage includes X-AppImage-Version=1.0.3, has an executable payload and bundles no libfuse; it installs and lists correctly with Shelly 3.0.6 and 3.2.1, and its main window opens at 1440×900 in a fresh Linux display.',
          'Linux release builds request appimage, deb and rpm explicitly, and set NO_STRIP=1 so linuxdeploy cannot run an outdated strip binary over modern ELF payloads.',
          'On Arch, install FUSE 3 with sudo pacman -S fuse3, or use --appimage-extract-and-run if FUSE is unavailable.',
        ],
      },
      {
        title: 'FL Studio compatibility',
        items: [
          '.fxp presets expose plugin 4CC, name and parameter count as metadata; .fst presets are preview-only with readable strings; .flp projects are read-only pattern references.',
          'FL native and VST2 content is clearly labelled as not executable here, and the limitations are documented in docs/IMPORT_PACKS.md.',
        ],
      },
      {
        title: 'Tests',
        items: [
          'Adversarial tests cover empty and truncated zips, traversal, symlinks, compression bombs, the 10,000-entry limit, corrupt WAVs, oversized samples, non-UTF-8 names and FXP parsing.',
          'A Node test mocks a rejected import and asserts that the UI shows the error instead of failing silently.',
        ],
      },
    ],
  },
  {
    version: '1.0.2',
    date: '2026-11-10',
    headline: 'Auditioning through the engine, a draggable playhead, bundled MP3 export and a working updater.',
    groups: [
      {
        title: 'Auditioning and playback',
        items: [
          'Browser samples, channel-rack test notes and the metronome play through a dedicated CPAL preview voice that bypasses the sequencer, so they sound while the transport is stopped.',
          'Clicking an instrument fires a one-shot C4 note at velocity 100 through the native synth; a second click replaces the preview.',
          'The metronome is rendered in the audio callback, accented every 16 steps, and the engine picks up toggles without a restart.',
          'Seeking during native playback sends a seek command instead of stopping and restarting the stream.',
        ],
      },
      {
        title: 'Timeline and devices',
        items: [
          'A thicker, draggable playhead with a grab cursor: dragging updates the native playhead in real time, and the playlist and piano roll follow playback when it leaves the viewport.',
          'Friendly input and output device names by default. Dev Mode is off by default and reveals the raw ALSA/PipeWire strings, host API, channels and sample rates.',
        ],
      },
      {
        title: 'Export and files',
        items: [
          'MP3 export uses the bundled LAME encoder at 128/192/320 kbps instead of ffmpeg. WAV, 24-bit WAV and FLAC stay native; OGG and M4A use ffmpeg when installed.',
          'The desktop export command opens the native save dialog, and Save project as… writes .obeats files anywhere on disk.',
        ],
      },
      {
        title: 'Updates',
        items: [
          'The update button downloads the current platform installer, validates that it comes from this repository’s GitHub releases, marks the Linux AppImage executable, launches it and restarts the app.',
        ],
      },
      {
        title: 'Performance and tests',
        items: [
          'The sequencer renders into a preallocated trigger buffer reused by the audio callback, removing per-tick allocation from the playback path.',
          '243 audio-crate unit tests cover metronome defaults, preview and seek, trigger-buffer reuse, installer URL validation and the bundled MP3 stream, and CI runs them with the mp3 feature enabled.',
        ],
      },
    ],
  },
  {
    version: '1.0.1',
    date: '2026-11-10',
    headline: 'Exporters, sample packs, input tools, a rebuilt tour and smoother timeline editing.',
    groups: [
      {
        title: 'Export and preview',
        items: [
          'Native WAV (16/24-bit) writing and a pure-Rust FLAC encoder, with MP3/OGG/M4A transcoding through ffmpeg when it is installed. Exports run on a blocking thread behind the desktop export command and its save dialog; Bounce keeps rendering WAV.',
          'Sample preview runs on its own stream: auditioning never interrupts playback and a second click replaces the first preview.',
        ],
      },
      {
        title: 'Packs and samples',
        items: [
          'Import a sample pack from a folder or a .zip. Samples are scanned recursively and tagged from their names and folders (kick, snare, hat, 808, bass and more).',
          'The pack index is stored as JSON and reloaded at launch, so imported packs survive a restart.',
          'Symphonia decodes wav, mp3, ogg, flac and m4a previews on every platform.',
        ],
      },
      {
        title: 'Input and tuning',
        items: [
          'A CPAL input stream with an optional monitor path, a mono take recorder that saves 16-bit WAV, and a tuner with note and cents display.',
          'Dev Mode in Settings → Audio reveals raw device strings, host APIs, channel counts and sample rates.',
        ],
      },
      {
        title: 'Startup, updates and feedback',
        items: [
          'A native splash window closes itself when the studio mounts, and the startup chime plays through the CPAL engine from a bundled WAV asset.',
          'Release checks parse tags, notes, assets and platform download links in Rust, and compare preview and production versions numerically.',
          'Help → Suggestions & Fixes posts a validated report with your OS and app version.',
        ],
      },
      {
        title: 'Timeline and editing',
        items: [
          'Edge auto-scroll while dragging: the playlist scrolls for clips, the loop bar and the playhead; the piano roll scrolls in both directions for note moves and resizes. The dragged item stays under the pointer and the edge glows.',
          'Drags commit once per animation frame, so items no longer lag behind the pointer.',
          'Visible grab and resize handles, loop and playhead readouts, and grabbing cursors for every drag.',
        ],
      },
      {
        title: 'Guided tour',
        items: [
          'The tour is rebuilt around the whole studio: transport, browser and packs, rack, steps, playlist, piano roll, mixer, bounce and files, audio and input, plugins, help and feedback — thirteen targeted stops.',
        ],
      },
      {
        title: 'Composition and DSP',
        items: [
          'Chord progression generator with pop, jazz, lo-fi, trap, house, cinematic and blues recipes.',
          'Velocity curve maths (linear, exponential, logarithmic, S-curve, compress), spectral freeze/blur and a seeded granular engine.',
        ],
      },
      {
        title: 'Builds and tests',
        items: [
          'Linux (.deb, RPM, AppImage), Windows (msi, nsis) and macOS (dmg) installers are built from the v1.0.1 tag.',
          '239 unit tests cover WAV/FLAC headers, decode round-trips, tuner pitch, progression diatonicism, velocity curves, spectral freeze, granular grains, release parsing, webhook payloads and pack scanning.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-10',
    headline: 'The first public OpenBeats release: a native studio, DAW interchange, autosave and accessibility.',
    groups: [
      {
        title: 'Native audio engine',
        items: [
          'Desktop playback runs in Rust: CPAL output, a sample-accurate sequencer, 16 synth voices, a 3-band EQ, compressor and limiter on the master chain. Web Audio stays as the browser fallback.',
          'Transmitter transient/sustain split with hold and release, and a 60-second Audio Logger you can recover to WAV at any time.',
          'Chord detection and in-key chord suggestions, per-clip gain, pan, pitch, stretch and fades, custom note names and clip normalisation, all computed natively.',
          'VST3/CLAP hosting on Windows and macOS with out-of-process crash recovery; on Linux the plugin browser works and hosting is reported as unavailable.',
        ],
      },
      {
        title: 'Mixing, automation and editing',
        items: [
          'Mixer routing in Rust: free routing to any track, multiple sends, pre-fader sends, mute/solo and a sidechain ducker, with routing cycles refused.',
          'Automation lanes for any parameter: linear, hold, eased and S-curve segments, min/max re-ranging, looping and bipolar ranges.',
          'Piano-roll tools: strum, arpeggiate, flam, and twelve scales for highlighting and snapping.',
          'Playlist tools: slice, chop, quantize clip starts, trim, duplicate and consolidate.',
          'Modular effect graph: gain, low-pass, high-pass and drive nodes with summed fan-in and cycle rejection.',
        ],
      },
      {
        title: 'Studio',
        items: [
          'Channel rack with step sequencer, per-channel knobs, audition previews and live meters.',
          'Playlist with pattern clips, a piano roll with velocity lane, and a routing mixer with buses, sends and eight effects.',
          'Offline WAV bounce, mastering targets, Fix My Mix analysis with A/B, Hum to Melody and Inspire Me.',
          'Guided first-run tour and an in-app manual.',
        ],
      },
      {
        title: 'Projects',
        items: [
          'First launch opens a saved “Tutorial” project instead of a blank song.',
          'Projects dialog for opening old songs, starting a new one, saving the current song and deleting library entries.',
          'The last project is restored on launch; the Tutorial project cannot be deleted.',
        ],
      },
      {
        title: 'Desktop',
        items: [
          'Tauri 2 shell with Linux (.deb, RPM and AppImage), Windows (msi and nsis) and macOS (dmg) installers built by CI.',
          'Linux AppImage builds bundle GStreamer and the audio plugins; .deb and .rpm declare GStreamer plus a PulseAudio-compatible server. Windows installers embed WebView2 offline.',
          'Native window chrome, project/song/sample file dialogs and reveal-in-folder, with browser fallbacks.',
          'Animated startup splash with a short synthesized chime, switchable in Settings → Workflow.',
          'Update checks against GitHub Releases with a dismissible banner and Help → Check for updates; automatic launch checks can be switched off completely.',
          'Arch Linux openbeats-bin package: installs the 1.0.0 AppImage to /opt/openbeats with GTK, GStreamer and PulseAudio dependencies declared.',
          'Install guide covers Arch/AUR, AppImage, deb, RPM, Windows, macOS and source builds, plus a README FAQ.',
          'Plugin library with search, VST3/CLAP filters and vendor-style category filters, backed by a GitHub registry and bundled offline fallback; downloads open the publisher release.',
          'OpenBeats Gain proof plugin: Rust nice-plug source exporting VST3 and CLAP, with a Linux bundle and build script. Hosting inside OpenBeats remains future work.',
          'Community plugin submission template and registry validation scripts.',
        ],
      },
      {
        title: 'Interchange',
        items: [
          'Multi-track MIDI import/export (SMF type 1) for reference DAW, Ableton, Logic, Cubase, Studio One, Bitwig and REAPER.',
          'Ableton Live Set (.als) import from the gzipped XML, including tracks, clips, notes and tempo.',
          'REAPER (.rpp) import and export with tempo, tracks and MIDI items.',
          'Import / export song dialog with per-format fidelity notes and native binary save dialogs.',
        ],
      },
      {
        title: 'Sounds',
        items: [
          'Drag audio files anywhere into the studio to create sampler channels; multiple files import in one drop.',
          'Drop .mid, .als, .rpp or .obeats files to open them, with a visible drop target and clear feedback.',
          'One-shot import auto-tags tempo, brightness and instrument family, with a session sample bank.',
        ],
      },
      {
        title: 'Audio reliability',
        items: [
          'No more frozen green transport: audio must actually reach the running state before playback starts.',
          'WebKitGTK audio unlock uses a bounded resume plus a silent buffer, triggered by the first Spacebar or click.',
          'Linux packages now declare GStreamer base, good and PulseAudio plugins for Web Audio output.',
        ],
      },
      {
        title: 'Autosave',
        items: [
          'Crash-safe local snapshots with a selectable interval: 2, 5, 10, 15, 30 or 60 minutes, or Never.',
          'A final snapshot is written when the window closes, and the last snapshot restores automatically after a crash.',
          '“Save now” in Settings and the exact last-autosave time are always visible.',
        ],
      },
      {
        title: 'Accessibility',
        items: [
          'Screen-reader names and states for transport, workspace tabs, channel rows, steps, mixers and dialogs.',
          'Keyboard-operable knobs and faders with arrow, Page and Home/End control and spoken values.',
          'Reduce motion, reduce transparency, high contrast, visible focus rings, interface scale and density settings.',
          'ARIA live regions announce hints, saves and errors without trapping focus.',
        ],
      },
      {
        title: 'Performance',
        items: [
          'Dialogs, the command palette and the changelog are code-split, so the studio loads without their JavaScript.',
          'Workspace panels are memoised so theme and dialog changes do not rerender the rack, playlist or mixer.',
          'Playhead painting stays on requestAnimationFrame and is limited to step changes.',
        ],
      },
      {
        title: 'Interface fixes',
        items: [
          'Undo and redo are global, including when a select or dropdown has focus (Ctrl/Cmd+Z, Shift+Z, Y).',
          'Select and option text is explicitly colored against light and dark themes, with native color-scheme support.',
          'Discord Rich Presence now uses OpenBeats built-in application ID 1569568675198140446; reports “Making a beat..” and the project name, and can be switched off.',
        ],
      },
      {
        title: 'Interface',
        items: [
          'Classic and Modern interface modes over the same theme tokens.',
          'Eleven themes, including glass and liquid-glass variants in light and dark, plus Studio 2006.',
          'Colour editor with a wheel, HEX field and RGB inputs for every theme token, a glass toggle and JSON import/export.',
          'Command palette (Ctrl/Cmd+K) for transport, views, channels and project actions.',
        ],
      },
      {
        title: 'Workflow research',
        items: [
          'Project-wide key detection in the piano roll toolbar, estimated from all note pitch classes.',
          'Rounded playlist clip edges for clearer section boundaries, a recurring Ableton request.',
          'Audited reference DAW 2026 and Ableton Live 12 requests; dynamic mixer tracks, loop/chord generation, device A/B and project portability were already covered.',
        ],
      },
      {
        title: 'Design',
        items: [
          'Glass reworked against Apple Liquid Glass guidance: opaque content, frosted chrome, specular rims and a solid fallback.',
          'Docs compare glassmorphism with Liquid Glass and list the remaining fidelity gaps honestly.',
        ],
      },
      {
        title: 'Compatibility',
        items: [
          'Third-party VST3/AU hosting is not included in 1.0.0; the plugin library, OpenBeats Gain and file downloads ship, but loading plugins into the mixer remains future work.',
          'reference DAW .flp is a proprietary binary format, so reference DAW projects travel through MIDI rather than .flp.',
          'The Rust/CPAL audio migration is planned in docs/RUST_AUDIO.md; 1.0.0 still renders with Web Audio.',
        ],
      },
    ],
  },
];
