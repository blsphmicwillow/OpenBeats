# Roadmap

Ordered by impact, not by promise. Nothing here has a date.

## Next
- **Signed updater keys** so the banner can download and install a release in place.
- **Stem separation** — bundle a small source-separation model, split a clip into drums/bass/vocals/other on import, keep everything on-device.
- **WASM wavetable synth** — replace the oscillator engine with a wavetable oscillator behind the same `Instrument` interface, with user wavetable import.
- **Mixer folders and track freeze** — group strips under collapsible folders; render a channel to audio and disable its inserts to free CPU.

## Later
- Per-clip effects and clip automation.
- Plugin delay compensation and a latency budget readout.
- Project snapshots/version history with diffing.
- Dockable panels and a second window for the mixer.
- Spectral editor for audio clips.
- Live performance mode (clip launcher, scene triggering).
- MIDI 2.0 input and MPE.
- ARA-style integration is **not** planned: it depends on closed host APIs.

## Known gaps
- Installers are unsigned unless signing secrets are configured; macOS and Windows will warn.
- No cloud sync, accounts or telemetry. Projects are local JSON.
- Assistants are local heuristics, not generative models; they explain and correct, they do not compose full songs.
