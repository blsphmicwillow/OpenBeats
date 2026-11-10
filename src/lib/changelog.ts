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
          'Tauri 2 shell with Linux (.deb and AppImage), Windows (msi and nsis) and macOS (dmg) installers built by CI.',
          'Native window chrome, project/song/sample file dialogs and reveal-in-folder, with browser fallbacks.',
          'Update checks against GitHub Releases with a dismissible banner; automatic launch checks can be switched off completely.',
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
          'Third-party VST3/AU hosting is not included in 1.0.0; MIDI, .als import and .rpp provide the DAW bridge.',
          'FL Studio .flp is a proprietary binary format, so FL Studio projects travel through MIDI rather than .flp.',
          'The Rust/CPAL audio migration is planned in docs/RUST_AUDIO.md; 1.0.0 still renders with Web Audio.',
        ],
      },
    ],
  },
];
