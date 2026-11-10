# FL Studio architecture parity

The manual pages requested for this milestone, what was actually readable, and
what now exists in Rust. Everything here is local and offline.

## Pages read

| URL | Status |
| --- | --- |
| `/html/channelrack.htm` | read |
| `/html/envsettings.htm` | read |
| `/html/mixer_iorouting.htm` | read (the `/mixer_routing.htm` path 404s) |
| `/html/mixer.htm` | read |
| `/html/mixer_mixermenu.htm` | read |
| `/html/playlist_automationclip.htm` | read (the `/automation.htm` and `/automation_clip.htm` paths 404) |
| `/html/pianoroll_strum.htm` | read |
| `/html/pianoroll_arpeggiate.htm` | read |
| `/html/pianoroll_tools.htm`, `/html/playlist_tools.htm`, `/html/mixer_effects.htm`, `/html/automation.htm`, `/html/automation_clip.htm`, `/html/mixer_routing.htm` | **404** at these paths; the behaviour was cross-checked against the pages above and the What's New changelog |
| `/html/basics.htm`, `/html/interface.htm`, `/html/export.htm`, `/html/export_wav.htm`, `/html/recording.htm`, `/html/edison.htm`, `/html/plugins.htm`, `/html/plugins/FLEX.htm`, `/html/plugins/Patcher.htm`, `/html/browser.htm` | not fetched: out of scope for the audio engine (UI/cloud/content/recording) |

## Ported in this milestone

### Mixer routing and sidechaining — `src/mixer.rs`

Matches the mixer manual: a strip feeds one destination (master by default) and
any number of extra sends, pre or post fader, with cycles refused. Modulation
free of a feedback path is what the manual promises; a self-route or a loop
returns `MixError::Cycle` instead of producing audio.

* `MixerGraph::order()` — topological mixing order, master last.
* `MixerGraph::render()` — per-strip gain, mute, solo, post-fader sends, pre-fader
  sends that survive mute (the manual's "extract before the fader" trick),
  multiple sends to the same destination summing.
* `Sidechain` — threshold/ratio/attack/release ducker keyed by another strip,
  which is exactly what FL's "send with volume 0" sidechain achieves.
* IPC: `mixer_order`, `mixer_render`.

### Automation — `src/automation.rs`

Automation clips as data: points in 16th steps, linear/hold/ease-in/ease-out/
S-curve segments, min/max re-ranging (the clip channel's MIN/MAX knobs), looping
and bipolar ranges (pan). Lanes are keyed by parameter target so the same lane can
drive `master_gain`, `channel:kick:pan`, or an effect parameter.

* `AutomationLane::value_at`, `sample_steps`, `AutomationSet::apply`.
* IPC: `automation_value`, `automation_sample`, `automation_apply`.

### Piano-roll tools — `src/piano_tools.rs`

* **Strum** — chord grouping by shared start, `start` (positive low→high,
  negative high→low), `tension` acceleration, velocity ramp in the manual's
  direction, all notes kept.
* **Arpeggiate** — up / down / up-down / as-played, rate in steps, octave range.
* **Flam** — repeats with decaying velocity.
* **Scale highlighting** — twelve scales with `is_in_scale`, `scale_pitches`,
  and `snap_to_scale` for the piano roll's highlight and snap modes.
* IPC: `strum_notes`, `arpeggiate_notes`, `flam_notes`, `scale_notes`,
  `snap_note_to_scale`.

### Playlist tools — `src/playlist_tools.rs`

* **Slice** at an interior point (edges refused, total length preserved).
* **Chop** into equal pieces.
* **Quantize** clip starts to a grid.
* **Trim**, **duplicate** (with optional gap), **clip_at** lookup, **consolidate**.
* IPC: `slice_clip`, `chop_clip`, `quantize_clip_start`.

### Modular routing (Patcher-style) — `src/effect_graph.rs`

A graph of gain / low-pass / high-pass / drive nodes with summed fan-in,
topological evaluation, state kept between samples, and cycles rejected before
any audio runs. `add_node`/`connect` build graphs programmatically.

* IPC: `effect_graph_order`, `render_effect_graph`.

## Test coverage

`cargo test -p openbeats-audio --features fundsp-graph` → **118 passing tests**,
including every module above.

## Not ported, and why

| Manual area | Reason |
| --- | --- |
| Audio recording, Edison, one-click record | Needs capture streams and a waveform editor; not part of the playback engine. |
| Export/render settings (`export_wav.htm`) | Bounce still runs in the Web Audio renderer; a Rust offline renderer is a separate job. |
| Patcher's visual editor, plugin hosting inside the graph | The graph maths exists; hosting is `openbeats-plugins` and wrapping it per node is the next step. |
| FLEX, sample packs, Patcher presets | Content, not engine behaviour. |
| MIDI scripting, MIDI import/export | Out of scope for 1.0.0. |
| CPU/buffer settings in `envsettings.htm` | The device layer exposes a fixed buffer; exposing a settings UI is pending. |

## Integration status

The mixer graph, automation lanes and effect graph are complete, tested modules
exposed over IPC. They are **not yet wired into the CPAL callback**: the engine
still runs its fixed EQ → compressor → limiter master chain. Feeding the strips
and automation into the audio thread requires changing the callback, which cannot
be compiled or heard in this environment (no audio device, no ALSA headers); see
[RUST_AUDIO.md](RUST_AUDIO.md) for that limitation.
