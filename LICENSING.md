# Licensing

OpenBeats is free software. This page states exactly which licence applies to
which part of the repository, so users, distributors and contributors do not
have to guess.

## Summary

| Part | Licence |
| --- | --- |
| The application: `src/`, the `openbeats` crate in `src-tauri/`, packaging, scripts and documentation | GPL-3.0-or-later |
| `plugins/openbeats-gain` (the first-party CLAP/VST3 proof plugin) | GPL-3.0-or-later |
| `plugins/openbeats-gui-fixture` (test fixture) | GPL-3.0-or-later |
| `src-tauri/crates/openbeats-audio` (native audio engine) | MIT |
| `src-tauri/crates/openbeats-plugins` (plugin hosting) | MIT |
| `src-tauri/plughost-helper` (out-of-process plugin host) | MIT |
| Third-party dependencies | Their own licences |

The full GPL text is in [LICENSE](LICENSE). The MIT licence text is reproduced
below.

## Why the native helper crates are MIT

The audio engine, the plugin host and the plugin host helper are deliberately
permissive: they can be reused in other audio projects, including projects that
are not GPL. That is a deliberate choice, not an accident.

The application as a whole is distributed under GPL-3.0-or-later because it
combines the GPL application code with those MIT crates. If you distribute an
OpenBeats installer or a modified build, the GPL applies to that distribution:
you must provide the corresponding source and keep the same freedoms for the
combined work.

The MIT crates remain available under MIT on their own. If you reuse only
`openbeats-audio`, only that crate's MIT terms apply.

## MIT licence text

Copyright (c) the OpenBeats contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Third-party code and assets

- Rust and npm dependencies keep their own licences. `cargo metadata` and
  `npm ls` list them. The project only accepts dependencies whose licences are
  compatible with GPL-3.0-or-later.
- The demo song, instrument presets, themes and icons are original and generated
  procedurally. No samples, presets, code or assets from a commercial DAW are
  included.
- Sample packs and plugins downloaded by the user are not part of this
  repository and keep the licence their author chose.
- Documentation and screenshots in this repository are GPL-3.0-or-later unless
  a file says otherwise.

## Contributions

By submitting a pull request, issue attachment or patch, you agree that your
contribution is licensed under GPL-3.0-or-later, and that you have the right to
license it. There is no copyright assignment and no contributor licence
agreement.

Every commit needs a Developer Certificate of Origin sign-off. Use:

```bash
git commit -s
```

The sign-off is a statement that you wrote the change, or have the right to
submit it under the project licence. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Releases and source

GitHub releases include the source archives GitHub generates from the tagged
commit. [docs/BUILDING.md](docs/BUILDING.md) documents the exact build steps, and
CI builds the published installers from the tag, so anyone can rebuild a release
from source.

If you redistribute a modified build, keep the GPL notices, make your modified
source available, and do not imply it is an official OpenBeats release.
