# Roadmap

Ordered by impact, not by promise. Nothing here has a date.

## Next
- **Native Rust audio engine** — port the transport, instruments, mixer, effects and offline renderer to CPAL/Rust; keep the Web Audio implementation as the reference until null tests pass. See [docs/RUST_AUDIO.md](docs/RUST_AUDIO.md).
- **Signed updater keys** so the banner can download and install a release in place.
- **Stem separation** — bundle a small source-separation model, split a clip into drums/bass/vocals/other on import, keep everything on-device.
- **WASM wavetable synth** — replace the oscillator engine with a wavetable oscillator behind the same `Instrument` interface, with user wavetable import.
- **Mixer folders and track freeze** — group strips under collapsible folders; render a channel to audio and disable its inserts to free CPU.

## Later
- Per-clip effects and clip automation.
- Plugin delay compensation and a latency budget readout.
- Snapshot diffing and side-by-side project comparison.
- Dockable panels and a second window for the mixer.
- Spectral editor for audio clips.
- Live performance mode (clip launcher, scene triggering).
- MIDI 2.0 input and MPE.
- ARA-style integration is **not** planned: it depends on closed host APIs.
- Native-speaker review of the Spanish, French and German translations.

## Known gaps
- Installers are unsigned unless signing secrets are configured; macOS and Windows will warn.
- No cloud sync, accounts or telemetry. Projects are local JSON.
- Assistants are local heuristics, not generative models; they explain and correct, they do not compose full songs.

## How to help

Pick an item above, or a [good first issue](https://github.com/blsphmicwillow/OpenBeats/contribute). A hardware report for Windows or macOS audio, or for plugin routing, is as useful as a patch. See [CONTRIBUTING.md](CONTRIBUTING.md).
