# Playlist audio clips

Playlist audio clips can be dropped on a lane, moved, trimmed from the right
edge, slipped within their source, looped, and displayed as LOD waveforms.
Browser playback uses Web Audio; desktop playback decodes verified sources
into native sample buffers and renders them in the Rust/CPAL callback.

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

## Media storage

Bytes are stored in the WebView's IndexedDB (`src/audio/mediaStore.ts`), keyed by
their SHA-256, at `idb://openbeats-media/<hash>`. Identical files share one copy,
and re-opening a project can re-hash the bytes to prove integrity.

For desktop playback, the frontend sends each missing source to a Tauri command
as base64 in a separate cache request. Rust verifies the SHA-256, stores the
original file under its content hash in app-data `playlist-media`, then decodes
it off the audio callback before starting playback. Sources over 500 MB are
rejected for native playback. Playback JSON contains only clip metadata, not
media bytes. WAV, MP3, OGG, FLAC, AIFF and M4A/AAC use the existing Symphonia
decoder.

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

`src/audio/audioClipScheduler.ts` separates browser scheduling maths from nodes:

- `scheduleWindows(clips, transport, bufferDurations)` is pure. It converts
  ticks → seconds from the tempo, intersects each clip with the current loop
  pass and the look-ahead horizon, and returns
  `{ clipId, whenSec, offsetSec, durationSec, loopPass, loopWithinSource }`.
- `AudioClipPlayer` turns those windows into `AudioBufferSourceNode`s with gain,
  fades and an optional panner.

The native callback renders the active source frame per callback, applying clip
gain, fades, pan, reverse, normalization, source looping and track mute/solo.
Loop-region seeks and wraps follow the native sequencer playhead.

**Loop fix:** windows are computed for the current pass *and* the wrapped pass,
and a wrap resumes at `loopStart − clipStart` into the file. A clip that starts
before the loop therefore continues from the correct offset on every pass
instead of going silent or restarting at zero. `advanceAudioClips` extends one
pass when the transport step moves backwards, without stopping what is playing.

## Snapping and drag

Precedence is **playhead → clip edge → grid** (`resolveSnapTick`), with a 10 px
tolerance converted to ticks from the current zoom. File drags render a ghost;
peaks are computed on drop, and a cancelled pointer drag restores the original
`start_tick`. The right-edge handle trims clip length, keeps fades inside the
new edge, and prevents non-looping clips from extending past their source.

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
