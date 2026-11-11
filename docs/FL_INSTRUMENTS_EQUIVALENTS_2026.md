# Instrument purpose map: FL Studio editions → OpenBeats 1.0.6

Source: the official [FL Studio pricing page, Instruments comparison](https://www.image-line.com/fl-studio/pricing#instruments),
read on 2026-11-11. The page lists 39 instruments across Fruity, Producer, Signature and All Plugins
Edition; this document walks that list once, in page order, and names the OpenBeats instrument that
serves the same musical purpose.

**What this is not.** No Image-Line names, artwork, presets, samples, parameter layouts or DSP code are
used or copied. OpenBeats counterparts are original engines and original voices built from oscillators,
noise, filters, delay lines and sample buffers; "purpose" is the only thing shared. The map is a design
record, not a claim of sonic identity.

## Engine note

The ten instruments marked **new** below are **Web Audio only** in 1.0.6. The Rust/CPAL pool still has
its 19 native voices, so on desktop these presets play the closest native voice (see
`src/lib/nativeVoices.ts`); offline bounces and the browser build use the full Web Audio voice.
The 2026 originals that already existed (Glass Keys, Velvet Choir, FM Bass, chorus/phaser/bitcrusher,
tremolo/auto pan/ring mod) keep their existing engine coverage.

## One-by-one map

| # | FL Studio instrument | Purpose on the pricing page | OpenBeats counterpart | Status |
| --- | --- | --- | --- | --- |
| 1 | Drumaxx | Physical-modelling drum synthesizer | **Anvil** — modelled membrane plus inharmonic strike | new |
| 2 | Harmor | Additive synth with resynthesis and effects | **Prism** — additive partial spectrum with drift | new |
| 3 | Kepler Exo | Analog-style synth with an expanded palette | **Sundial** — three-saw analog poly | new |
| 4 | Morphine | Additive synth for evolving, morphing tones | **Prism** (slow envelope + Tone drift) | new |
| 5 | Ogun | Metallic additive synth | **Prism** with high Tone, plus **Glass Keys** | new |
| 6 | Poizone | Simple subtractive synth with punchy sounds | **Sundial** | new |
| 7 | Sakura | Physical-modelling plucked/string synth | **Cordwood** — Karplus-Strong string | new |
| 8 | Sawer | Vintage sawtooth analog synth | **Sundial** | new |
| 9 | Toxic Biohazard | Hybrid FM/subtractive synth | **Vector Nine** — FM operators through a filter | new |
| 10 | Transistor Bass | Analog bass synth with sequencer and drive | **Acid Well** — resonant mono acid bass | new |
| 11 | DirectWave Full | Multi-sample instrument and sampler | **Sampler** (one-shot sample voice) | existing |
| 12 | Harmless | Additive synth with a subtractive workflow | **Prism** | new |
| 13 | Kepler | Vintage analog synth emulation | **Sundial** | new |
| 14 | Slicex | Slice and rearrange audio with beat detection | **Sampler** + Playlist audio clips and split | existing |
| 15 | SoundFont Player | Play `.sf2` SoundFont instruments | **Sampler** (WAV/MP3/OGG/FLAC/AIFF, not `.sf2`) | existing, format gap |
| 16 | Sytrus | FM + subtractive + additive synth | **Vector Nine** | new |
| 17 | 3x OSC | Three-oscillator subtractive synth | **Sundial** | new |
| 18 | Autogun | Generates patches from randomised parameters | **Dice** — channel-seeded generative patch | new |
| 19 | BassDrum | Dedicated kick-drum synthesizer | **Kick** (pitch-swept sine + click) | existing |
| 20 | BeepMap | Builds sounds from image data | **Sampler** (image import is not supported) | existing, input gap |
| 21 | BooBass | Electric bass-guitar emulation | **Cordwood** with a low root, or **Sub Bass** | new |
| 22 | Channel Sampler | Basic sample playback | **Sampler** | existing |
| 23 | DirectWave Player | Plays sampled instruments | **Sampler** | existing |
| 24 | Drumpad | Pad-triggered drum sampling | **Sampler** + step sequencer | existing |
| 25 | FLEX | Preset-based versatile instrument | **Sundial** and the built-in Keys/Synth presets | existing |
| 26 | Fruity DrumSynth Live | Real-time drum synthesis | **Anvil** | new |
| 27 | Fruity DX10 | FM digital synth | **Vector Nine** | new |
| 28 | Fruity Granulizer | Granular sample playback | **Dust Devil** — granular cloud (sample or noise) | new |
| 29 | Fruity Kick | Simple kick-drum synthesizer | **Kick** | existing |
| 30 | FPC | Drum pads and layered drum kits | **Sampler** + step sequencer | existing |
| 31 | Fruity Slicer | Slice loops for rearrangement | **Sampler** + Playlist split | existing |
| 32 | Fruity Slicer 2 | Loop slicing with flexible playback | **Sampler** + Playlist split | existing |
| 33 | GMS | Multi-oscillator synth with modulation | **Sundial** | new |
| 34 | MiniSynth | Compact subtractive synth | **Sundial** | new |
| 35 | Plucked! | Physical-modelling plucked strings | **Cordwood** | new |
| 36 | SimSynth | Classic subtractive synth | **Sundial** | new |
| 37 | Speech Synthesizer | Typed text turned into computer vocals | **Chatter** — formant vocal synth (no text input) | new, input gap |
| 38 | Wave Traveller | Vinyl scratch simulation from splines | **Sampler** with a scratch sample (no spline editor) | existing, editor gap |
| 39 | FL Keys | Virtual piano with tone and velocity response | **Hammer Felt** — felted physical piano | new |

## Gaps recorded rather than hidden

- **SoundFont (`.sf2`)**: the Sampler reads common audio formats, not `.sf2`.
- **BeepMap**: no image-to-sound import.
- **Speech Synthesizer**: Chatter synthesises vowels and consonants from pitch, not typed text.
- **Wave Traveller**: no spline scratch editor; any scratch sample can be loaded in the Sampler.
- **Slicer / Slicex / Granulizer slice editing**: Playlist split and clip editing exist; there is no
  transient-detection or slice-map editor.
- **Native voices**: the ten new engines are Web Audio only, with a closest-voice fallback on desktop.
  Native CPAL voices for them are pending because the Rust toolchain is not available in this
  environment, so they could not be built or tested.

## Why many synths share a counterpart

FL's 39 entries contain several near-duplicate families (analog subtractive, additive, FM, physical,
drum synthesis, sampling). Building 39 separate oscillator engines would duplicate the same DSP with
different labels. OpenBeats instead ships one strong original engine per family — Anvil, Prism,
Sundial, Cordwood, Vector Nine, Acid Well, Dice, Dust Devil, Chatter, Hammer Felt — and routes each
FL purpose to the family that actually serves it. The result is fewer, deeper instruments rather than
a long list of aliases.
