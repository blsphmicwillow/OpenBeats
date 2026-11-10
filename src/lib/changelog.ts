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
          'Multi-track MIDI import/export (SMF type 1) for FL Studio, Ableton, Logic, Cubase, Studio One, Bitwig and REAPER.',
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
          'Audited FL Studio 2026 and Ableton Live 12 requests; dynamic mixer tracks, loop/chord generation, device A/B and project portability were already covered.',
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
          'FL Studio .flp is a proprietary binary format, so FL Studio projects travel through MIDI rather than .flp.',
          'The Rust/CPAL audio migration is planned in docs/RUST_AUDIO.md; 1.0.0 still renders with Web Audio.',
        ],
      },
    ],
  },
];
