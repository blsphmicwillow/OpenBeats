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
    version: '1.1.0',
    date: '2026-11-10',
    headline: 'Native desktop builds, an update checker, and a local mix assistant',
    groups: [
      {
        title: 'Desktop',
        items: [
          'Tauri 2 shell with Linux (deb/AppImage), Windows (msi/nsis) and macOS (dmg) installers built by CI.',
          'Native window chrome, file dialogs and “reveal in folder”, with a web fallback for the demo build.',
          'Automatic update checks against GitHub Releases on launch, with a dismissible banner and release notes.',
        ],
      },
      {
        title: 'Mixing',
        items: [
          'Fix My Mix analyses the rendered master and proposes corrective EQ, compression and low-end control.',
          'Before/after A/B compares the original master chain with the suggested one.',
          'AI mastering targets for Spotify, Club, SoundCloud and YouTube with loudness normalisation.',
        ],
      },
      {
        title: 'Writing',
        items: [
          'Hum to Melody records a microphone take and turns it into quantised piano-roll notes.',
          'Inspire Me generates four-chord progressions in the selected key and mood.',
          'Sample import now tags BPM, brightness and instrument type automatically.',
        ],
      },
      {
        title: 'Interface',
        items: [
          'Classic and Modern interface modes share the same themes, so every palette restyles both ways.',
          'Glass and Liquid Glass themes in both light and dark variants: translucent panels and 22 px backdrop blur.',
          'Colour editor with a wheel, HEX field and RGB sliders for every theme token, a glass toggle, and JSON import/export.',
          'Command palette (Ctrl/Cmd+K) with searchable actions.',
          'New “Studio 2006” theme for the classic rig look.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-28',
    headline: 'First public OpenBeats build',
    groups: [
      {
        title: 'Studio',
        items: [
          'Channel rack with step sequencer, per-channel knobs and live meters.',
          'Playlist, piano roll with velocity lane, and a routing mixer with buses and sends.',
          'Eight native effects, offline WAV bounce, six themes and a guided first-run tour.',
        ],
      },
    ],
  },
];
