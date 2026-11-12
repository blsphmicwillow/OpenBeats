# Releasing OpenBeats

Everything below happens on a branch, in a pull request, or in a workflow
dispatch run. Nothing here creates a tag or publishes a GitHub Release: that is a
separate, explicit decision made after testers sign off.

## 1. Land the code

- Work on a branch, open a PR, keep it small enough to review.
- Required checks: `npm run typecheck`, `npm test`, `npm run build`,
  `cargo test -p openbeats-audio --lib`, `cargo check -p openbeats --lib`, and the
  **Audio smoke** job. The `web` and `desktop` jobs must be green on
  `ubuntu-22.04` and `windows-latest`.
- `npm run docs:check` must pass. It enforces that `package.json`,
  `src/lib/version.ts`, `CHANGELOG.md`, `README.md` and `docs/INSTALL.md` all agree
  on the version and on the installer asset names.

## 2. Bump the version (no tag yet)

Update, all to the same version:

- `package.json` and `package-lock.json`
- `src/lib/version.ts` (`APP_VERSION`)
- `src/lib/changelog.ts` (newest entry first)
- `CHANGELOG.md`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`, `src-tauri/crates/openbeats-audio/Cargo.toml`,
  `src-tauri/crates/openbeats-clap-helper/Cargo.toml`
- `README.md`, `docs/INSTALL.md`, `docs/PLUGINS.md`, `docs/BUILDING.md`,
  `plugins/README.md`

Then run `npm run docs:check` and `cargo check -p openbeats-audio` (the second one
refreshes `Cargo.lock`).

## 3. Build a release candidate

Trigger the Release workflow by hand (`workflow_dispatch`) on the release branch.
It builds Linux, Windows and macOS installers and uploads them as workflow
artifacts without creating a release. Report the run URL and the artifact names to
testers.

The release job in that workflow is tag-gated and does nothing on a dispatch run.

## 4. Tester gate

Nothing ships until real hardware confirms it. For an audio release that means at
least one PipeWire and one PulseAudio machine on Linux plus a Windows machine,
with the Test tone verdict, project playback, sample preview and the settings
dialog read back to us. Any failure is diagnosed from the Stream health row, Last
error, the opened-output log line and `pactl`/`aplay` output, fixed on the branch,
and rebuilt as a new candidate.

## 5. Shipping

Only after the gate passes, and only with explicit approval:

1. Create the tag from the reviewed commit and push it.
2. The Release workflow publishes the artifacts for that tag.
3. Verify the release page and the `releases/latest` response. The in-app update
   checker reads `/releases/latest` and ignores drafts and pre-releases, so a
   pre-release tag does not notify stable users; a pre-release stays invisible to
   them until a normal release exists.

### Arch package checksums

`packaging/arch/PKGBUILD` pins `sha256sums` for the AppImage. Those hashes cannot
be known before the release assets exist, so they are **not** guessed here:

1. Publish the release.
2. Download the AppImage for the published version.
3. Replace the `sha256sums` line with the real hash.
4. Regenerate `.SRCINFO` (`makepkg --printsrcinfo > .SRCINFO`) and open the PR.

The checks in the Release workflow assert that the package metadata declares the
ALSA bridge (`pipewire-alsa` / `libasound2-plugins`), the GStreamer plugins and a
PulseAudio-compatible server, so a packaging edit that drops them fails the build
instead of shipping a silent app.
