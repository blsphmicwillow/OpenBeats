# Security policy

OpenBeats is a local desktop application. It has no accounts, no server and no
telemetry, so the security surface is the app, its installers and the optional
update check. Reports about any of those are welcome.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.1.x | Yes |
| 1.0.x and older | No, please reproduce on 1.1.0 first |

Fixes land on `main` and in the next release. Security fixes are not backported
to older minor versions unless the maintainers say otherwise in the advisory.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting:

https://github.com/blsphmicwillow/OpenBeats/security/advisories/new

The report is visible only to the repository maintainers until an advisory is
published.

Please include:

- The OpenBeats version, platform and installer type (AppImage, deb, RPM, Arch
  package, Windows setup, macOS DMG, or a browser build).
- A description of the impact, and who could trigger it.
- Reproduction steps or a proof of concept, with any project files reduced to
  the smallest example that still reproduces.
- Whether the issue is already public, and any deadline you are working to.

Never include passwords, tokens or other people's private data. If a report
needs a large file, say so in the first message and a maintainer will arrange a
private channel.

## What to expect

- Acknowledgement within 7 days.
- An initial assessment within 14 days, including whether the report is in
  scope and a rough fix timeline.
- A fix and a GitHub Security Advisory for confirmed issues. Credit is given
  unless you ask to stay anonymous.
- If a report is declined, you get the reasoning, not silence.

These are best-effort targets for a volunteer project, not a commercial service
level. There is no bug bounty.

## Scope

In scope:

- The application code in this repository, including the React front end, the
  Rust desktop shell, the native audio engine and the plugin host.
- The release installers and the update checker.
- Import paths that parse untrusted files: `.zip` sample packs, `.als`, `.rpp`,
  `.mid`, `.obeats`, plugin bundles and audio metadata.
- Anything that could execute code, read files outside the chosen project or
  sample folders, escape the plugin helper process, or corrupt a project.

Out of scope:

- Third-party plugins loaded by the user. Report those to the plugin's author.
- Vulnerabilities in the operating system, WebKitGTK, GStreamer, PipeWire,
  PulseAudio, ALSA or the user's audio drivers.
- Attacks that require an already-compromised machine, physical access, or the
  user deliberately running a malicious binary.
- Missing hardening that has no demonstrated impact, such as a missing security
  header in a local-only build.

## Safe harbour

Good-faith research on your own machine, against your own projects and data, is
welcome. Do not test against other people's machines or data, do not run
denial-of-service tests against GitHub infrastructure, and give the maintainers
a reasonable chance to fix the issue before publishing details.

## Licence

OpenBeats is free software under GPL-3.0-or-later. The source is public, so
security does not depend on keeping the code secret. See [LICENSING.md](LICENSING.md).
