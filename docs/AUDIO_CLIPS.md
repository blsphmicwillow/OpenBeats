# Playlist audio clips (1.0.5)

**Engine: Web Audio only.** The UI states this in the playlist toolbar:

> Playlist audio clips: Web Audio (desktop native pending).

The Rust/CPAL engine expands *pattern* clips
(`src-tauri/crates/openbeats-audio/src/clips.rs`) and has no audio-clip voice, so
a desktop project that contains audio clips is played by the WebView engine. The
native transport does not receive them. There is no second implementation to
compare against yet, so no parity claim is made here.

## Model

`src/model/audioClip.ts`:

```ts
AudioClip {
  id, sample_id, media_ref,
  start_tick, length_ticks,
  gain, pan, pitch_cents, stretch_ratio,
  fade_in, fade_out, loop_mode, track, name
}
```

- Ticks are 480 per quarter note (120 per 16th step, 1920 per 4/4 bar), so the
  playlist's step-based pattern clips and tick-based audio clips share one
  timeline without rounding drift.
- `media_ref` is `{ path, hash, mime, bytes, name }`; `hash` is the file's
  SHA-256.
- `audioClips` lives on `Project`, so `.obeats` round-trips it as part of the
  normal project JSON. Projects saved before 1.0.5 have no such key and load
  unchanged with an empty list (`normalizeAudioClips`).
- `stretch_ratio` is stored for the format but **ignored by 1.0.5 playback**:
  resampling would change pitch and a phase-vocoder stretcher is not built.
  (Pattern clips do stretch in the Rust sequencer; that is a different path.)

## Media storage — documented limitation

Bytes are stored in the WebView's IndexedDB (`src/audio/mediaStore.ts`), keyed by
their SHA-256, at `idb://openbeats-media/<hash>`. Identical files share one copy,
and re-opening a project can re-hash the bytes to prove integrity.

**Media is cached in the WebView for 1.0.5; native app-data persistence is
planned for 1.1.** The Tauri filesystem commands are not used for clip media
yet: streaming through them needs a chunked read/write command pair and a
migration, and shipping a half-wired path would be worse than stating the gap.

## Waveform LOD

- `src/audio/waveform.ts` builds a peak pyramid (min/max pairs, bucket doubling
  per level) and an LRU cache keyed `sample_id:mip_level`.
- `src/audio/waveform.worker.ts` runs the pyramid in a Web Worker;
  `waveformClient.ts` falls back to the same pure function when a Worker is
  unavailable. Channel data is copied before transfer so the decoded
  `AudioBuffer` is not detached.
- `AudioClipWave.tsx` picks a level for the current pixel width, so zooming
  refines the drawing without rescanning samples.

**Measured:** a 5-minute 48 kHz stereo file (14.4 M frames per channel) builds a
6-level pyramid in **53.0 ms** on the development machine, off the UI thread.

## Scheduling and the loop-region fix

`src/audio/audioClipScheduler.ts` separates maths from nodes:

- `scheduleWindows(clips, transport, bufferDurations)` is pure. It converts
  ticks → seconds from the tempo, intersects each clip with the current loop
  pass and the look-ahead horizon, and returns
  `{ clipId, whenSec, offsetSec, durationSec, loopPass, loopWithinSource }`.
- `AudioClipPlayer` turns those windows into `AudioBufferSourceNode`s with gain,
  fades and an optional panner.

**Loop fix:** windows are computed for the current pass *and* the wrapped pass,
and a wrap resumes at `loopStart − clipStart` into the file. A clip that starts
before the loop therefore continues from the correct offset on every pass
instead of going silent or restarting at zero. `advanceAudioClips` extends one
pass when the transport step moves backwards, without stopping what is playing.

## Snapping and drag

Precedence is **playhead → clip edge → grid** (`resolveSnapTick`), with a 10 px
tolerance converted to ticks from the current zoom. A drag only renders a ghost;
peaks are computed on drop, and a cancelled pointer drag restores the original
`start_tick`, so a cancel leaves no model residue.

## Tests

`src/playlist.test.ts` (Vitest + jsdom, mocked Web Audio):

1. schedules a mocked `AudioBufferSourceNode`;
2. simulates a real DOM drop of a 5-second file at bar 3;
3. asserts `start_tick === 3840` and `length_ticks === 4800`;
4. simulates a playhead seek to bar 5;
5. asserts the scheduled buffer offset is 4 s (and 1 s of audio remains);
6. asserts a cancelled drag leaves the model untouched;
7. asserts a loop wrap resumes at the wrapped offset one pass later.

Run with `npm test`.
