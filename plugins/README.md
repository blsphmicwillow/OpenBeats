# OpenBeats plugin registry

This directory is the source of truth for the **plugin library** in OpenBeats.
It is a discovery and download index, not a plugin host. OpenBeats 1.0.6 can
browse the registry and open GitHub Release downloads. The 1.0.9 branch adds a
Linux CLAP-only sidecar that can scan and load local bundles, but the loaded
plugin is not routed into the mixer yet. The source-verified implementation
report is in [`docs/PLUGIN_HOST_REVERSE_ENGINEERING_1.0.7.md`](../docs/PLUGIN_HOST_REVERSE_ENGINEERING_1.0.7.md). See
[`docs/PLUGINS.md`](../docs/PLUGINS.md) for the native-hosting boundary.

## Registry format

`registry.json` is fetched from this repository at runtime, with the same file
bundled into the app as an offline fallback. Each entry is:

```json
{
  "id": "unique-slug",
  "name": "Display name",
  "author": "Author or team",
  "category": "Dynamics - Compressor",
  "description": "One short paragraph, plain text.",
  "homepage": "https://github.com/owner/repo",
  "repo": "owner/repo",
  "releaseTag": "optional-pinned-tag",
  "assetPattern": "optional-regex-for-the-download",
  "formats": ["vst3", "clap"],
  "platforms": ["linux-x86_64", "macos", "windows"],
  "license": "GPL-3.0-or-later",
  "verified": false,
  "featured": false,
  "notes": "Optional installation or support note."
}
```

Rules:

- `repo` must be a public GitHub `owner/repo`; downloads are read from its
  Releases, never from an arbitrary URL.
- `releaseTag` is optional. Without it the app asks GitHub for `releases/latest`
  and ignores drafts and prereleases.
- `assetPattern` is optional; it narrows the downloadable assets. Prefer a
  `.zip`, `.tar.gz`, `.clap` or `.vst3` bundle.
- `category` is optional but recommended, using a vendor-style path such as
  `Dynamics - Compressor`, `Delay` or `Instrument - Synth` so the plugin library
  can filter a large collection.
- `verified` means an OpenBeats maintainer checked the publisher, licence and
  release provenance. It is not a security audit. Leave it `false` for new
  submissions.
- Do not put secrets, tokens, or direct non-GitHub download URLs in this file.

## Submit a plugin

Open an issue with the **Plugin submission** template. A maintainer reviews the
repository, licence, release assets and install instructions, then opens a PR
that adds the entry to `registry.json` and regenerates any lock/cache used by
the site.

The app refreshes the registry when the Plugin library opens. A release can be
replaced without shipping a new OpenBeats build; this is why the app fetches
GitHub Release metadata instead of baking download links into the binary.

## Validate locally

```bash
npm run plugins:check
```

This checks the JSON shape, unique IDs, GitHub repository format, supported
formats and the pinned assets/URLs where possible. It intentionally does not
download or execute plugin binaries.

## Build the first-party example

```bash
cd plugins/openbeats-gain
./build.sh
```

The output is a Linux VST3/CLAP archive plus unpacked bundles. A release tagged
`openbeats-gain-v0.1.0` carries the archive referenced by the registry entry.
