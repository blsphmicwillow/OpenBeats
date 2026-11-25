# Support

OpenBeats is maintained by volunteers. There is no paid support, no account and
no telemetry, so the fastest route is usually the documentation.

## Read this first

- [Install guide](docs/INSTALL.md): downloads, platform requirements and common
  install errors.
- [Building from source](docs/BUILDING.md): toolchains, system packages and
  installer builds.
- [README troubleshooting](README.md#troubleshooting): Linux audio diagnostics
  and the in-app **Copy diagnostics** button.
- [FAQ](README.md#faq): plugins, updates, project storage and engine questions.

## Ask a question

Use [GitHub Discussions](https://github.com/blsphmicwillow/OpenBeats/discussions)
for:

- "How do I ...?" questions about the workflow.
- Audio setup help that is not clearly a bug.
- Showing what you made, or asking for feedback on a workflow.
- Ideas that are not yet a concrete feature request.

## Report a bug

Open an [issue](https://github.com/blsphmicwillow/OpenBeats/issues/new/choose)
with the bug template. Include the version, platform, audio engine and steps to
reproduce. If the problem is audio, attach the output of **Settings → Audio →
Copy diagnostics**. Reports that cannot be reproduced may be closed, so include
the smallest project that shows the problem when you can.

## Request a feature

Open an issue with the feature template, or add it to an existing roadmap
discussion. Describe the workflow problem first. Read [ROADMAP.md](ROADMAP.md)
before proposing something that is explicitly out of scope.

## Report a security problem

Do not open a public issue. Follow [SECURITY.md](SECURITY.md) and use GitHub's
private vulnerability reporting.

## Plugin and sample-pack questions

- [docs/PLUGINS.md](docs/PLUGINS.md): what is hosted, on which platform, and what
  is still not routed into the mixer.
- [docs/IMPORT_PACKS.md](docs/IMPORT_PACKS.md): supported pack layouts, limits
  and why some files are skipped.
- Plugin registry problems: open an issue with the plugin submission template.

## Translation corrections

Spanish, French and German strings live in `src/i18n/locales/`. A native
speaker's correction is a welcome pull request; see
[CONTRIBUTING.md](CONTRIBUTING.md#translations).

## What to expect

- Issues and pull requests are usually looked at within 7 days.
- A reply is not a promise of a fix. The maintainers triage by impact and
  available hardware.
- Hardware-specific bugs, especially Windows and macOS audio or plugin routing,
  may stay open until someone with that hardware can reproduce them. Reports
  from testers are genuinely useful here.

## How to help without writing code

Reproduce an issue and say which version and platform you saw it on. Test a
release on hardware the maintainers do not have. Improve a translation. Answer a
question in Discussions. All of that reduces the queue.
