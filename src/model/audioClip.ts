/**
 * Playlist audio clips (Task B, 1.0.5).
 *
 * ENGINE: these clips are executed by **Web Audio only**. The native Rust/CPAL
 * sequencer expands *pattern* clips (`crates/openbeats-audio/src/clips.rs`) and
 * has no audio-clip voice, so desktop playback falls back to the WebView engine
 * for this feature. There is no Rust implementation to agree with yet.
 *
 * Ticks are the model unit: 480 per quarter note, 120 per 16th step, so one
 * 4/4 bar is 1920 ticks. The playlist UI still works in 16th steps; helpers
 * below convert at the boundary.
 */

/** Ticks per quarter note (PPQ). */
export const TICKS_PER_BEAT = 480;
/** Ticks per 16th-note step, matching the step sequencer's unit. */
export const TICKS_PER_STEP = TICKS_PER_BEAT / 4;
/** Ticks in one 4/4 bar. */
export const TICKS_PER_BAR = TICKS_PER_BEAT * 4;

/**
 * Where the bytes live.
 *
 * `path` is an opaque locator, `hash` is the SHA-256 of the file so a project
 * can prove the media it reopened is the media it saved. In 1.0.5 browser and
 * desktop builds both store the bytes in the WebView's IndexedDB
 * (`idb://openbeats-media/<hash>`); native app-data persistence is not wired.
 */
export interface MediaRef {
  path: string;
  hash: string;
  mime: string;
  bytes: number;
  name: string;
}

export type LoopMode = 'off' | 'loop';

export interface AudioClip {
  id: string;
  /** Stable id of the decoded sample in the session sample library. */
  sample_id: string;
  media_ref: MediaRef;
  /** Start on the song timeline, in ticks from song start. */
  start_tick: number;
  /** Length on the timeline, in ticks. */
  length_ticks: number;
  /**
   * First tick of the source media used by this clip. Nonzero after a split,
   * so the right-hand half resumes at the cut point instead of replaying the
   * start of the file. Omitted means zero for projects saved before 1.0.6.
   */
  source_offset_ticks?: number;
  gain: number;
  pan: number;
  pitch_cents: number;
  /**
   * Persisted for the .obeats contract. 1.0.5 Web Audio playback ignores it:
   * resampling would change pitch, and a phase-vocoder stretcher is not built.
   */
  stretch_ratio: number;
  /** Fade lengths in ticks. */
  fade_in: number;
  fade_out: number;
  /** Reverse playback. ENGINE: Web Audio only; the native path has no audio-clip voice. */
  reversed?: boolean;
  /** Peak-normalize to -1 dBFS. ENGINE: Web Audio only. */
  normalized?: boolean;
  loop_mode: LoopMode;
  /** Display name (file name by default). */
  name: string;
  /** Playlist track index. */
  track: number;
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / TICKS_PER_BEAT) * (60 / bpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return (seconds * bpm * TICKS_PER_BEAT) / 60;
}

/** 16th steps (the playlist/sequencer unit) → ticks. */
export function stepsToTicks(steps: number): number {
  return steps * TICKS_PER_STEP;
}

/** Ticks → whole 16th steps, for code that still speaks steps. */
export function ticksToSteps(ticks: number): number {
  return Math.round(ticks / TICKS_PER_STEP);
}

/** 1-based bar number → tick of that bar's downbeat. */
export function barToTicks(bar: number, beatsPerBar = 4): number {
  return Math.max(0, bar - 1) * beatsPerBar * TICKS_PER_BEAT;
}

export function audioClipEndTick(clip: AudioClip): number {
  return clip.start_tick + clip.length_ticks;
}

/** Keep a slip offset inside the decoded media, leaving room for the clip. */
export function clampSourceOffset(
  offsetTicks: number,
  clipLengthTicks: number,
  sourceDurationTicks: number,
): number {
  const max = Math.max(0, Math.round(sourceDurationTicks) - Math.max(1, Math.round(clipLengthTicks)));
  return Math.max(0, Math.min(max, Math.round(offsetTicks)));
}

export interface SnapContext {
  /** Grid resolution in ticks; 0 disables grid snapping. */
  gridTicks: number;
  /** How close (in ticks) a candidate must be to win, usually ~10 px of zoom. */
  thresholdTicks: number;
  playheadTick: number;
  /** Start/end ticks of neighbouring clips on the same track. */
  edges: number[];
}

/**
 * Snapping precedence, highest first: playhead → clip edge → grid.
 *
 * The playhead wins because dropping a clip exactly under it is the intent
 * users have most often when they have just positioned it; clip edges come
 * next because butt-joining two clips is the second most common intent.
 */
export function resolveSnapTick(rawTick: number, ctx: SnapContext): number {
  const raw = Math.max(0, rawTick);
  const threshold = Math.max(0, ctx.thresholdTicks);
  if (threshold > 0 && Math.abs(raw - ctx.playheadTick) <= threshold) {
    return Math.max(0, ctx.playheadTick);
  }
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const edge of ctx.edges) {
    const distance = Math.abs(raw - edge);
    if (distance <= threshold && distance < bestDistance) {
      best = edge;
      bestDistance = distance;
    }
  }
  if (best !== null) return Math.max(0, best);
  if (ctx.gridTicks > 0) return Math.max(0, Math.round(raw / ctx.gridTicks) * ctx.gridTicks);
  return raw;
}

export const AUDIO_CLIP_MIME = 'application/x-openbeats-audio-clip';

export interface CreateAudioClipInput {
  sampleId: string;
  mediaRef: MediaRef;
  name: string;
  bpm: number;
  /** Decoded duration of the file in seconds. */
  durationSec: number;
  track: number;
  startTick: number;
  id: string;
}

/** Builds the model object a drop creates. Pure, so the drop handler is testable. */
export function createAudioClipFromDrop(input: CreateAudioClipInput): AudioClip {
  const lengthTicks = Math.max(1, Math.round(secondsToTicks(Math.max(0, input.durationSec), input.bpm)));
  return clampAudioClip({
    id: input.id,
    sample_id: input.sampleId,
    media_ref: input.mediaRef,
    start_tick: Math.max(0, Math.round(input.startTick)),
    length_ticks: lengthTicks,
    source_offset_ticks: 0,
    gain: 1,
    pan: 0,
    pitch_cents: 0,
    stretch_ratio: 1,
    fade_in: 0,
    fade_out: 0,
    reversed: false,
    normalized: false,
    loop_mode: 'off',
    name: input.name,
    track: Math.max(0, Math.floor(input.track)),
  });
}

/** Keeps a clip inside the ranges the scheduler assumes. */
export function clampAudioClip(clip: AudioClip): AudioClip {
  return {
    ...clip,
    start_tick: Math.max(0, Math.round(clip.start_tick)),
    length_ticks: Math.max(1, Math.round(clip.length_ticks)),
    source_offset_ticks: Math.max(0, Math.round(clip.source_offset_ticks ?? 0)),
    gain: Math.max(0, Math.min(4, clip.gain)),
    pan: Math.max(-1, Math.min(1, clip.pan)),
    pitch_cents: Math.max(-2400, Math.min(2400, Math.round(clip.pitch_cents))),
    stretch_ratio: Math.max(0.25, Math.min(4, clip.stretch_ratio || 1)),
    fade_in: Math.max(0, Math.round(clip.fade_in)),
    fade_out: Math.max(0, Math.round(clip.fade_out)),
    track: Math.max(0, Math.floor(clip.track)),
  };
}

const LOOP_MODES: LoopMode[] = ['off', 'loop'];

/**
 * Reads audio clips out of a stored project. Projects written before 1.0.5 have
 * no `audioClips` key at all, so they load with an empty list — their pattern
 * clips are untouched.
 */
export function normalizeAudioClips(raw: unknown): AudioClip[] {
  if (!Array.isArray(raw)) return [];
  const out: AudioClip[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Partial<AudioClip>;
    if (typeof c.id !== 'string' || typeof c.sample_id !== 'string') continue;
    const ref = c.media_ref;
    if (!ref || typeof ref.hash !== 'string' || typeof ref.path !== 'string') continue;
    out.push(
      clampAudioClip({
        id: c.id,
        sample_id: c.sample_id,
        media_ref: {
          path: ref.path,
          hash: ref.hash,
          mime: typeof ref.mime === 'string' ? ref.mime : 'application/octet-stream',
          bytes: typeof ref.bytes === 'number' ? ref.bytes : 0,
          name: typeof ref.name === 'string' ? ref.name : (c.name ?? 'audio'),
        },
        start_tick: typeof c.start_tick === 'number' ? c.start_tick : 0,
        length_ticks: typeof c.length_ticks === 'number' ? c.length_ticks : 1,
        source_offset_ticks: typeof c.source_offset_ticks === 'number' ? c.source_offset_ticks : 0,
        gain: typeof c.gain === 'number' ? c.gain : 1,
        pan: typeof c.pan === 'number' ? c.pan : 0,
        pitch_cents: typeof c.pitch_cents === 'number' ? c.pitch_cents : 0,
        stretch_ratio: typeof c.stretch_ratio === 'number' ? c.stretch_ratio : 1,
        fade_in: typeof c.fade_in === 'number' ? c.fade_in : 0,
        fade_out: typeof c.fade_out === 'number' ? c.fade_out : 0,
        reversed: c.reversed === true,
        normalized: c.normalized === true,
        loop_mode: LOOP_MODES.includes(c.loop_mode as LoopMode) ? (c.loop_mode as LoopMode) : 'off',
        name: typeof c.name === 'string' ? c.name : 'audio',
        track: typeof c.track === 'number' ? c.track : 0,
      }),
    );
  }
  return out;
}
