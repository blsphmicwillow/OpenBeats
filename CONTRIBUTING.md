# Contributing to OpenBeats

Thanks for helping. OpenBeats is a Tauri + React + Web Audio project with a
Rust/CPAL audio engine; most work happens in TypeScript, with a growing amount
of Rust in the native path.

Everyone who takes part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
Decisions and the maintainer ladder are described in [GOVERNANCE.md](GOVERNANCE.md).

## Ways to contribute

You do not have to write code to be useful:

- **Reproduce bugs** and say which version and platform you saw them on.
- **Test on hardware** the maintainers do not have. Windows and macOS audio,
  Bluetooth devices, multi-channel interfaces and plugin routing are the weakest
  areas. A report with exact steps is worth more than a guess.
- **Translate or correct strings.** Spanish, French and German live in
  `src/i18n/locales/`. Native speakers are especially welcome; the current files
  were machine-authored.
- **Improve documentation**: install steps, troubleshooting, architecture notes.
- **Submit a theme** or a sample-pack layout that imports cleanly.
- **Review pull requests** in an area you know.
- **Answer questions** in [Discussions](https://github.com/blsphmicwillow/OpenBeats/discussions).

Issues labelled **good first issue** are scoped to be a first contribution. Say
in the issue that you are taking it so nobody duplicates the work.

## Before you start

- Open an issue for anything larger than a bug fix, a translation or a theme, so
  the approach can be agreed first.
- Read `docs/ARCHITECTURE.md` (data flow) and `docs/THEMING.md` (if you touch UI
  colours).
- By contributing you agree your work is licensed under GPL-3.0-or-later. See
  [LICENSING.md](LICENSING.md).

## Setup

Requirements: Node 20+, npm 10+, Rust 1.92+ for native work. The Tauri system
packages are in [docs/BUILDING.md](docs/BUILDING.md).

```bash
npm ci
npm run dev      # http://localhost:3000
```

`npm ci` uses the committed lockfile. Do not replace it with `npm install` and
do not upgrade dependencies as part of an unrelated change.

## Checks

Every pull request should pass the same gates CI runs:

```bash
npm run typecheck
npm test
npm run build
npm run docs:check
cargo fmt --all -- --check
cargo test -p openbeats-audio --lib
```

Then smoke-test the app: play the demo, open each tab, change a theme, export a
WAV. If you touched audio scheduling or export, include the measured peak or
loudness in the PR description. If you could not run a check because you lack
the platform or the hardware, say so in the PR instead of leaving it implied.

## Commit sign-off (DCO)

The repository requires a Developer Certificate of Origin sign-off on every
commit. It is not a copyright assignment and there is no CLA; it is a statement
that you wrote the change or have the right to submit it under the project
licence.

```bash
git commit -s -m "your message"
```

That adds:

```
Signed-off-by: Your Name <your@email>
```

Use a real name and an address you can be reached at. If you forget, `git commit
--amend -s` fixes the last commit. A pull request with unsigned commits cannot
be merged.

## Style

- TypeScript strict mode, no `any` unless unavoidable and commented.
- Components stay functional; state lives in the single Zustand store.
- New colours must be theme tokens, never hard-coded hex values in components.
- Effect and instrument additions belong in `src/audio/`, with a matching entry
  in the model's union types.
- Keep keyboard shortcuts in the command palette and `Help → Shortcuts` in sync.
- The audio callback must not allocate, lock, log or touch the filesystem. This
  is a hard rule, not a preference.

## Commits and pull requests

- One logical change per PR; describe the user-visible effect, not the file list.
- Keep the PR small enough to review. Split a refactor from a behaviour change.
- Screenshots for UI changes (light and dark, Classic and Modern where relevant).
- Note anything you could not test (macOS signing, a physical microphone, a
  Windows audio endpoint).
- Do not bump the version or edit `CHANGELOG.md` unless the maintainers ask; the
  release manager does that.

A maintainer aims to review within about 7 days. If a PR has had no response
after 14 days, a polite ping in the PR is appropriate, not rude.

## Translations

- The English string is the key. Add the key to `src/i18n/locales/es.ts`,
  `fr.ts` and `de.ts`; a missing key falls back to English at runtime.
- `src/i18n/coverage.test.ts` scans the UI for `t('...')` keys and fails if a key
  is missing from a locale, so run `npm test` after adding strings.
- Keep product names, file formats and technical terms (WAV, CLAP, VST3, BPM)
  untranslated unless there is a widely used local form.
- Long-form prose (Tutorial, Learn modules, Help) is still English. Translating
  it is a larger, welcome project; open an issue first.

## Plugins and sample packs

- The plugin registry is `plugins/registry.json`. Validate it with
  `npm run plugins:check`; resolve release URLs with `npm run plugins:fetch`.
- New registry entries go through the plugin submission issue template.
- Pack import layouts and limits are in `docs/IMPORT_PACKS.md`.
- Do not submit code or assets copied from a commercial DAW.

## Review and merge

- A maintainer reviews for correctness, real-time safety, tests and honest
  claims. "It compiles" is not enough for an audio change.
- CI must be green. A failing check is fixed, not skipped or muted.
- The maintainer merges when the change is ready. If you need a specific merge
  style or want to keep your branch, say so in the PR.
