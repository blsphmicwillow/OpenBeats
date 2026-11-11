# OpenBeats wiring audit — 1.0.7

Source audited: `release/1.0.6` at `855699d`, plus the local
`release/1.0.7` planning branch. This is a **wiring audit and blocker report**,
not a claim that the missing paths were implemented.

## 1. Command inventory

Generated from `#[tauri::command]` functions, the `generate_handler!` table in
`src-tauri/src/lib.rs`, and `nativeInvoke`/`invokeNative` calls under `src/`.

| Measure | Count |
| --- | ---: |
| Rust `#[tauri::command]` functions found by the source scan | 75 |
| Entries in `generate_handler!` | 80 |
| Distinct frontend command names invoked | 68 |
| Registered commands with no frontend caller | 12 |

The 80 handler entries include commands defined outside the
`#[tauri::command]` scan (for example `discord_presence`, `open_external`,
`save_text_file`) and the app's file/dialog helpers. The audit counts below use
the command names, not the macro table alone.

### 1.1 Registered but never invoked from React

These have a Rust implementation and a handler entry, but no `invoke` call in
`src/`:

- `audio_engine_info`
- `automation_apply`
- `check_for_updates`
- `export_audio`
- `key_labels`
- `load_plugin_chain`
- `plugin_host_support`
- `recover_plugin_chain`
- `recovery_flush`
- `render_effect_graph`
- `scan_plugins`
- `stamp_chord`
- `stop_input`
- `unload_plugin_chain`

`scan_plugins_linux` and `load_plugin_linux` are new and are invoked by the
plugin browser; they reach the Linux sidecar but not the mixer or CPAL.

`mixer_order`, `mixer_render`, `automation_value` and `automation_sample` do
have frontend wrappers, but those wrappers are not called by any component. They
are therefore "UI bridge exists, UI caller does not".

### 1.2 Frontend helpers with no caller

These are exported from `src/lib/nativeAudio.ts` but have no call site under
`src/`:

- `nativeMixerOrder`
- `nativeMixerRender`
- `nativeAutomationValue`
- `nativeAutomationSample`
- `nativeAutomationApply`
- `nativeEffectGraphOrder`
- all plugin host commands (`scan_plugins`, `load_plugin_chain`,
  `unload_plugin_chain`, `recover_plugin_chain`, `plugin_host_support`)

The plugin library (`PluginBrowser.tsx`) is registry-only: it calls
`loadPluginCatalog` and `openExternal`, never the host commands.

### 1.3 End-to-end audio commands (working path)

These reach the CPAL engine and are the reference for a wired feature:

`start_playback`, `stop_playback`, `playback_state`, `play_test_tone`,
`play_test_note`, `play_metronome`, `set_playhead_position`, `set_cue_gain`,
`select_audio_device`, `set_low_latency`, `get_audio_devices`.

### 1.4 UI/offline-only commands

`mixer_order`, `mixer_render`, `automation_value`, `automation_sample`,
`automation_apply`, `effect_graph_order`, `render_effect_graph` operate on
explicit data passed in the command. They do not read or write the running
`CallbackState`, so they cannot affect playback.

## 2. Rust audio graph reality

### 2.1 What the CPAL callback actually runs

`src-tauri/crates/openbeats-audio/src/engine.rs`, `CallbackState::next_frame`:

```text
Sequencer triggers
  -> VoicePool::next_frame()          (global stereo pair)
  -> Eq3 per channel
  -> Compressor per channel
  -> TruePeakLimiter
  -> master_gain
  -> clamp and output
```

Everything before the master chain is summed into one stereo pair. There is no
per-strip bus, no insert slot, no send bus and no automation evaluation in the
callback.

### 2.2 What exists but is offline-only

| Module | Capability | Why it is not in the callback |
| --- | --- | --- |
| `mixer.rs` | `MixerGraph` with routing, sends, solo/mute, sidechain, cycle refusal; `render()` takes `&[(f32, f32)]` | Still offline: the callback now has per-strip frames, but routing/sends are not evaluated there. |
| `automation.rs` | `AutomationLane`/`AutomationSet` with linear, hold and curved segments | Gain lanes on `PlaybackChannel` are now evaluated per frame; `AutomationSet` and arbitrary targets are still offline. |
| `effect_graph.rs` | Mono modular graph (gain, low-pass, high-pass, drive) with cycle refusal | Still a Tauri command, not the callback; the per-strip chain uses its own stereo processors. |
| `plugins` | `PluginHost` scan/open/process/recover on Windows/macOS; Linux stub | No frontend caller and no insert slot; Linux has a separate CLAP sidecar. |
| `dsp/*` | EQ3, compressor, limiter, true-peak, dynamic EQ, mid/side, transmitter | EQ3, compressor and limiter are now available in the per-strip insert chain; the master chain is unchanged. |

## 3. Per-strip status

**Per-strip gain inserts and gain automation are wired; routing/sends and
plugin inserts are not.**

`PlaybackChannel` now carries `inserts` and `automation` with serde defaults,
so old `.obeats` snapshots still parse. `CallbackState` owns one `VoicePool`
per channel, one `StripProcessor` per channel and that channel's lanes. The
callback renders each pool, applies its gain lane, runs its inserts, sums the
strips, then runs the original master EQ -> compressor -> limiter chain.

`strip.rs` implements seven native insert kinds: Gain, Eq3, Compressor,
Limiter, Lowpass, Highpass and Drive. Reverb and delay do not exist in the Rust
DSP, so they were not invented for this pass. `MixerGraph` routing/sends and
plugin inserts are still not in the callback. The frontend snapshot does not
send the new `inserts`/`automation` fields yet; Rust tests construct them
directly.

Measured tests now cover:

- a -6.0206 dB gain insert on strip 0 only: strip 0 becomes 0.5, strip 1
  remains 1.0;
- a volume lane from 0 to 1 over eight steps: 0.0 at step 0, 0.5 at step 4,
  1.0 at step 8;
- a low-pass insert attenuating a Nyquist-rate signal;
- old project JSON defaulting to empty inserts and automation.

## 4. Prompt 1 status: Linux CLAP hosting

**Implemented for scan/load/process; mixer insert still pending.** The
historical `plughost` audit is in
[PLUGIN_HOST_REVERSE_ENGINEERING_1.0.7.md](PLUGIN_HOST_REVERSE_ENGINEERING_1.0.7.md).
The new branch adds:

- `src-tauri/crates/openbeats-clap-helper`: Linux-only `clack-host 0.2` host
  with SCAN, LOAD, PROCESS and a dedicated audio thread.
- `scan_plugins_linux` / `load_plugin_linux` Tauri commands with a lazy sidecar
  and typed `LinuxPluginDescriptor` results.
- `src-tauri/tauri.linux.conf.json` externalBin plus Linux CI staging.
- `PluginBrowser.tsx` scan/load section, explicitly labeled as not yet routed
  into the mixer.

The Windows/macOS `plughost` files and configs are untouched. No mixer insert
point exists on any platform, so a loaded plugin still cannot affect playback.

## 5. Prompt 2 status: wiring existing tools

**Partial, with measured per-strip audio.** The per-channel voice pools,
insert chain and one gain-automation path are implemented and unit-tested.
What remains is not a small wiring patch:

- `MixerGraph` free routing, sends and sidechain are still offline-only.
- Plugin inserts are not routed on any platform.
- The React snapshot does not populate `inserts` or `automation` yet, so the
  running app cannot exercise these fields without a native-snapshot change.
- Reverb and delay are Web Audio only; adding them to Rust would be a new
  effect, not wiring an existing one.

## 6. Verification performed

- `npm run docs:check` — passed.
- `npm run typecheck` — passed.
- `npm test` — 42/42 passed.
- `cargo test -p openbeats-audio --lib` — 261/261 passed, including the
  per-strip -6 dB isolation, volume-ramp, low-pass and old-snapshot-defaults
  tests.
- `cargo check -p openbeats-clap-helper` — passed.
- `cargo build -p openbeats-clap-helper` — passed.
- `cargo check -p openbeats-clap-helper` — passed.
- `cargo build -p openbeats-clap-helper` — passed.
- Sidecar acceptance probe — SCAN found `studio.openbeats.gain`, LOAD returned
  READY, PROCESS returned 64 finite stereo frames at the input RMS, exit 0.
- `cargo test -p openbeats-clap-helper` — 3/3 passed: CLAP_PATH scan plus
  load/process, unknown-ID and process-before-load errors, and killed-helper
  detection. The fixture test skips when `OpenBeatsGain.clap` is absent.
- `cargo check -p openbeats-plugins` — passed (Linux stub).
- `cargo check -p openbeats-plughost-helper` — passed (Linux stub).
- Linux dependency graph — no `plughost` crate.
- `npm run build` — passed.
- `cargo check -p openbeats --lib` — **blocked**, not failed on source: the host
  lacks `glib-2.0`/GTK development headers (`pkg-config` cannot find
  `gobject-2.0`, `gio-2.0`, `glib-2.0`). Tauri command code is therefore
  typechecked only by inspection, not by the Rust compiler.
- All 1.0.6 release assets verified against `SHA256SUMS.txt` — 7/7 OK.

No audio-output verification was possible on this host: the Linux AppImage was
not launched, and the workspace lacks a working desktop audio session. The
tests above are compile/unit/build checks, not a listening test.

## 7. Recommended next patch

Do not add a half-wired plugin button. The next reviewable change should be:

1. ~~A `clack-host` Linux probe that scans and processes `OpenBeatsGain.clap`.~~
   Completed; the helper also has Tauri commands, a bundle entry and UI scan/load.
2. ~~A per-strip bus change, with tests proving a -6 dB insert and a volume
   ramp.~~ Completed for gain inserts and gain automation; routing/sends and
   plugin inserts remain.
3. Wire the routing graph and plugin insert slot, then validate the Tauri
   desktop compile plus the Linux AppImage launch.

Each step can be green on its own; combining them without the bus change would
ship controls that do nothing.
