# Contributing to OpenBeats

Thanks for helping. OpenBeats is a Tauri + React + Web Audio project; most work happens in TypeScript, with a small Rust host.

## Before you start

- Open an issue for anything larger than a bug fix or a theme, so the approach can be agreed first.
- Read `docs/ARCHITECTURE.md` (data flow) and `docs/THEMING.md` (if you touch UI colours).
- By contributing you agree your work is licensed under GPL-3.0-or-later.

## Setup

```bash
npm install
npm run dev      # http://localhost:3000
```

Native work additionally needs the Rust toolchain and the Tauri system packages — see `docs/BUILDING.md`.

## Checks

Every pull request should pass:

```bash
npx tsc -b
npm run build
cd src-tauri && cargo fmt --all -- --check
```

Then smoke-test the app: play the demo, open each tab, change a theme, export a WAV. If you touched audio scheduling or export, include the measured peak/loudness in the PR description.

## Style

- TypeScript strict mode, no `any` unless unavoidable and commented.
- Components stay functional; state lives in the single Zustand store.
- New colours must be theme tokens, never hard-coded hex values in components.
- Effect and instrument additions belong in `src/audio/`, with a matching entry in the model's union types.
- Keep keyboard shortcuts in the command palette and `Help → Shortcuts` in sync.

## Commits and PRs

- One logical change per PR; describe the user-visible effect, not the file list.
- Screenshots for UI changes (light and dark, classic and modern).
- Note anything you could not test (macOS signing, a physical microphone, and so on).
