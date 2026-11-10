# Changelog

The same entries are bundled into the app and shown in the **Changelog** tab, so the notes ship with the build.
Keep this file and `src/lib/changelog.ts` in sync, and bump `APP_VERSION` in `src/lib/version.ts`.

## 1.0.0 — 2026-11-10

**The first public OpenBeats release: a native studio, DAW interchange, autosave and accessibility.**

This is the first official release. Everything below shipped in this build; there was no earlier public version.

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
- Update banner and GitHub Releases check. Automatic launch checks have a real opt-out: when disabled, no request is made.
- `.github/workflows/release.yml` builds all three platforms on every push to `main`; a `v*` tag publishes the release.

### Interchange

- **MIDI import/export** (SMF type 1) with one track per channel, tempo, programs and running-status parsing — works with
  FL Studio, Ableton, Logic, Cubase, Studio One, Bitwig and REAPER.
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

### Interface

- Classic / Modern interface modes over the same theme tokens.
- Eleven themes, including Glass and Liquid Glass in light and dark variants, plus Studio 2006.
- Colour editor with a colour wheel, HEX field and R/G/B inputs for every theme token, glass toggle and JSON import/export.
- Command palette (Ctrl/Cmd+K) covering transport, views, channels, audio tools and project actions.

### Workflow research

- Added project-wide **key detection** (major/minor profile) to the piano roll toolbar.
- Rounded playlist clip edges for clearer section boundaries, a recurring Ableton user request.
- Audited current FL Studio and Ableton requests; already covered: dynamic mixer tracks, loop/chord generation,
  command palette, device A/B, browser and project portability through `.obeats`. See `docs/RESEARCH.md`.

### Design

- Glass reworked after comparing it with Apple's Liquid Glass guidance: near-opaque content panels, frosted chrome,
  specular rims and edge depth, plus a solid fallback when `backdrop-filter` is unavailable.
- `docs/GLASS.md` records the comparison and the remaining gaps; `docs/EXCHANGE.md` records format fidelity.

### Compatibility notes

- Third-party **VST3/AU hosting is not included** in 1.0.0. MIDI, `.als` import and `.rpp` provide the DAW bridge; a
  native plugin host needs per-platform SDK work that is not part of this release.
- FL Studio `.flp` is a proprietary binary event stream, so FL Studio projects travel through MIDI rather than `.flp`.
- The **Rust/CPAL audio migration plan** is published in `docs/RUST_AUDIO.md`. 1.0.0 still renders with Web Audio; a
  native engine requires ALSA development headers (and equivalent platform work) plus the staged port described there.
