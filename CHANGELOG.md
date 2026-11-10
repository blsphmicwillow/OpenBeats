# Changelog

The same entries are bundled into the app and shown in the **Changelog** tab, so the notes ship with the build.
Keep this file and `src/lib/changelog.ts` in sync, and bump `APP_VERSION` in `src/lib/version.ts`.

## 1.1.0 — 2026-11-10

**Native desktop builds, an update checker, and a local mix assistant.**

### Desktop

- Tauri 2 shell (`src-tauri/`) with Linux (deb + AppImage), Windows (msi + nsis) and macOS (dmg) installers.
- Native save/open project dialogs and “reveal in folder”, with graceful browser fallbacks.
- `.github/workflows/release.yml` builds all three platforms on every push to `main`; a `v*` tag publishes a GitHub
  Release that the in-app update checker reads.
- Update banner on launch with release notes and a direct download link; configurable repository in
  Settings → Workflow.

### Mixing

- **Fix My Mix** renders the master, runs an FFT analysis, and proposes concrete corrections: clipping, over-compression,
  kick/bass low-end overlap, harsh highs, mono width and low loudness.
- Applying a fix inserts ordinary `eq10`, `comp` and `limiter` effects on the Master strip, plus an **A/B** toggle
  between the original chain and the fix.
- **Mastering targets** on bounce: Spotify (−14 LUFS), Club (−9), SoundCloud (−13), YouTube (−14), each with shelf EQ,
  glue compression, a ceiling and loudness matching.

### Writing

- **Hum to Melody** records the microphone, tracks pitch with autocorrelation, quantises the contour and writes notes to
  the selected channel's piano roll.
- **Inspire Me** generates four-chord progressions by key, scale and mood, with an optional root bass line.
- Sample import auto-tags tempo, brightness and instrument family ("dark", "punchy", "140 bpm", …).

### Interchange

- **MIDI import/export** (SMF type 1) with one track per channel, tempo, programs and running-status parsing — works with FL Studio, Ableton, Logic, Cubase, Studio One, Bitwig and REAPER.
- **Ableton Live Set (`.als`) import**: gunzips the XML and rebuilds MIDI tracks, clips and notes as channels, patterns and playlist clips.
- **REAPER (`.rpp`) import and export**: tempo, tracks, MIDI items and note events round-trip as plain text.
- New **Import / export song** dialog with a per-format matrix and honest fidelity notes; native binary save/open dialogs for MIDI.

### Design

- Glass was reworked after comparing it with Apple's Liquid Glass guidance: content panels are now near-opaque, chrome keeps the frost, surfaces have specular rims and edge depth, and there is a solid fallback when `backdrop-filter` is unavailable.
- New **Reduce transparency** accessibility option removes every blur and renders opaque panels.

### Interface

- Classic / Modern interface modes. Both read the same theme tokens, so every palette restyles either way.
- New **Studio 2006** theme.
- **Glass** and **Liquid Glass** themes, each in a **light and dark** variant: translucent panels and 22 px backdrop blur.
- **Colour editor** with a colour wheel, HEX field and R/G/B inputs for every theme token, plus a glass-surface
  toggle for custom themes and JSON import/export.
- **Updates** tab with a clear opt-out of automatic launch checks (no request is made when disabled) and a manual
  check that still works.
- **Accessibility** tab: reduced motion, high contrast, visible focus rings, interface scale, density and hint toggles.
- **Command palette** (Ctrl/Cmd+K) covering transport, views, channels, audio tools and project actions.

## 1.0.0 — 2026-10-28

First public build: channel rack and step sequencer, playlist, piano roll with velocity lane, routing mixer with buses
and sends, eight native effects, offline WAV bounce, six themes, guided first-run tour.
