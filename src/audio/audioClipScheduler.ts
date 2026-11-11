/**
 * Web Audio scheduling for playlist audio clips.
 *
 * ENGINE: **Web Audio only.** The Rust/CPAL sequencer has no audio-clip voice,
 * so a desktop project containing audio clips is played by the WebView engine.
 * See the label in README: "Playlist audio clips: Web Audio only in 1.0.5;
 * native Rust playback pending."
 *
 * The pure part (`scheduleWindows`) is the important one: it answers "given the
 * playhead, the loop region and a look-ahead horizon, which slice of which
 * buffer starts when, at which offset". `AudioClipPlayer` only turns those
 * windows into nodes. Keeping the maths pure is what makes loop-wrap offset
 * bugs testable.
 *
 * LOOP-REGION FIX (Task 2.1): when the transport wraps, a clip is re-scheduled
 * with the buffer offset of the wrapped position, not restarted from zero. If
 * the loop starts inside a clip, the new pass resumes that far into the file.
 */

import type { AudioClip } from '../model/audioClip';
import { TICKS_PER_BEAT } from '../model/audioClip';

export interface TransportWindow {
  bpm: number;
  /** Playhead position when scheduling starts, in ticks. */
  fromTick: number;
  /** How far ahead to schedule, in seconds (usually the look-ahead). */
  horizonSec: number;
  loop: boolean;
  loopStartTick: number;
  loopEndTick: number;
  /** Safety valve; the loop is not scheduled forever. */
  maxPasses?: number;
}

export interface ScheduledWindow {
  clipId: string;
  /** Start relative to the moment scheduling runs, in seconds (>= 0). */
  whenSec: number;
  /** Offset into the source buffer, in seconds. */
  offsetSec: number;
  /** How long this window plays, in seconds. */
  durationSec: number;
  /** 0 for the pass the playhead is in, then 1, 2 … for each loop wrap. */
  loopPass: number;
  /** True when the source should loop (`AudioBufferSourceNode.loop`). */
  loopWithinSource: boolean;
}

export const DEFAULT_MAX_PASSES = 8;

function tickSeconds(bpm: number): number {
  return 60 / (Math.max(1, bpm) * TICKS_PER_BEAT);
}

function clipStart(clip: AudioClip): number {
  return clip.start_tick;
}

function clipEnd(clip: AudioClip): number {
  return clip.start_tick + clip.length_ticks;
}

/**
 * Schedules every audio clip for the current pass and the loop passes that fall
 * inside the horizon.
 *
 * `bufferDurations` maps clip id → decoded buffer duration in seconds; it
 * bounds non-looping windows so a clip never asks for audio past its file.
 */
export function scheduleWindows(
  clips: AudioClip[],
  transport: TransportWindow,
  bufferDurations: Record<string, number> = {},
): ScheduledWindow[] {
  const bpm = Math.max(1, transport.bpm);
  const secPerTick = tickSeconds(bpm);
  const horizon = Math.max(0, transport.horizonSec);
  const from = Math.max(0, transport.fromTick);
  const loopLength = transport.loopEndTick - transport.loopStartTick;
  const looping = transport.loop && loopLength > 0 && transport.loopEndTick > from;
  const maxPasses = Math.max(1, transport.maxPasses ?? DEFAULT_MAX_PASSES);

  // Each entry is [passStartTick, passEndTick, secondsUntilPassStart].
  const passes: { start: number; end: number; atSec: number }[] = [];
  if (!looping) {
    passes.push({ start: from, end: Number.POSITIVE_INFINITY, atSec: 0 });
  } else {
    passes.push({ start: from, end: transport.loopEndTick, atSec: 0 });
    const firstWrapSec = (transport.loopEndTick - from) * secPerTick;
    for (let pass = 1; pass < maxPasses; pass += 1) {
      const atSec = firstWrapSec + (pass - 1) * loopLength * secPerTick;
      if (atSec > horizon) break;
      passes.push({ start: transport.loopStartTick, end: transport.loopEndTick, atSec });
    }
  }

  const out: ScheduledWindow[] = [];
  for (let passIndex = 0; passIndex < passes.length; passIndex += 1) {
    const pass = passes[passIndex];
    if (pass.atSec > horizon) break;
    for (const clip of clips) {
      if (clip.length_ticks <= 0) continue;
      const overlapStart = Math.max(clipStart(clip), pass.start);
      const overlapEnd = Math.min(clipEnd(clip), pass.end);
      if (overlapEnd <= overlapStart) continue;

      const windowStartSec = pass.atSec + (overlapStart - pass.start) * secPerTick;
      if (windowStartSec >= horizon) continue;

      const offsetSec = Math.max(0, (overlapStart - clipStart(clip)) * secPerTick);
      const rawDuration = (overlapEnd - overlapStart) * secPerTick;
      const end = Math.min(horizon, windowStartSec + rawDuration);
      const available = bufferDurations[clip.id];
      const loopWithinSource = clip.loop_mode === 'loop';

      let durationSec = Math.max(0, end - windowStartSec);
      if (!loopWithinSource && typeof available === 'number') {
        durationSec = Math.min(durationSec, Math.max(0, available - offsetSec));
      }
      if (durationSec <= 0) continue;

      out.push({
        clipId: clip.id,
        whenSec: Math.max(0, windowStartSec),
        offsetSec,
        durationSec,
        loopPass: passIndex,
        loopWithinSource,
      });
    }
  }
  return out;
}

export interface AudioClipTransportState {
  bpm: number;
  loop: boolean;
  loopStartTick: number;
  loopEndTick: number;
  /** Current playhead in ticks. */
  tick: number;
}

interface ActiveSource {
  clipId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
  endSec: number;
}

/**
 * Owns the nodes for audio clips: cancels the previous look-ahead, then starts
 * the windows the pure scheduler produced.
 */
export class AudioClipPlayer {
  private readonly ctx: BaseAudioContext;
  private readonly destination: AudioNode;
  private active: ActiveSource[] = [];
  private scheduled: ScheduledWindow[] = [];

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
  }

  /** Windows started by the most recent `schedule` call (diagnostics/tests). */
  get lastWindows(): ScheduledWindow[] {
    return this.scheduled;
  }

  stopAll(): void {
    for (const item of this.active) {
      try {
        item.source.stop();
      } catch {
        /* already stopped */
      }
      try {
        item.source.disconnect();
        item.gain.disconnect();
        item.panner?.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.active = [];
    this.scheduled = [];
  }

  /**
   * Cancels and re-schedules. Called on play, seek and on every loop wrap by
   * the transport tick, so a wrap restarts clips at the wrapped offset.
   */
  schedule(
    clips: AudioClip[],
    buffers: Map<string, AudioBuffer>,
    transport: AudioClipTransportState,
    horizonSec = 0.25,
  ): ScheduledWindow[] {
    this.stopAll();
    return this.startWindows(clips, buffers, transport, horizonSec);
  }

  /**
   * Adds a further loop pass without stopping what is already sounding, so a
   * wrap does not click and clips do not restart from zero.
   */
  extend(
    clips: AudioClip[],
    buffers: Map<string, AudioBuffer>,
    transport: AudioClipTransportState,
    horizonSec = 1,
  ): ScheduledWindow[] {
    return this.startWindows(clips, buffers, transport, horizonSec);
  }

  private startWindows(
    clips: AudioClip[],
    buffers: Map<string, AudioBuffer>,
    transport: AudioClipTransportState,
    horizonSec: number,
  ): ScheduledWindow[] {
    const byId = new Map(clips.map((c) => [c.id, c]));
    const durations: Record<string, number> = {};
    for (const [clipId, buffer] of buffers) {
      if (byId.has(clipId)) durations[clipId] = buffer.duration;
    }
    const windows = scheduleWindows(
      clips,
      {
        bpm: transport.bpm,
        fromTick: transport.tick,
        horizonSec,
        loop: transport.loop,
        loopStartTick: transport.loopStartTick,
        loopEndTick: transport.loopEndTick,
      },
      durations,
    );

    const now = this.ctx.currentTime;
    const started: ScheduledWindow[] = [];
    for (const window of windows) {
      const buffer = buffers.get(window.clipId);
      const clip = byId.get(window.clipId);
      if (!buffer || !clip) continue;
      try {
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        if (window.loopWithinSource) {
          source.loop = true;
          source.loopStart = 0;
          source.loopEnd = buffer.duration;
        }
        const gain = this.ctx.createGain();
        applyClipGain(gain, clip, buffer.duration, this.ctx.currentTime + window.whenSec);
        let panner: StereoPannerNode | null = null;
        if (typeof this.ctx.createStereoPanner === 'function' && clip.pan !== 0) {
          panner = this.ctx.createStereoPanner();
          panner.pan.value = Math.max(-1, Math.min(1, clip.pan));
          gain.connect(panner);
          panner.connect(this.destination);
        } else {
          gain.connect(this.destination);
        }
        source.connect(gain);
        source.start(
          now + window.whenSec,
          window.offsetSec,
          window.loopWithinSource ? undefined : window.durationSec,
        );
        this.active.push({
          clipId: window.clipId,
          source,
          gain,
          panner,
          endSec: now + window.whenSec + window.durationSec,
        });
        started.push(window);
      } catch {
        /* a refused node must not stop the rest of the schedule */
      }
    }
    this.scheduled = started;
    return started;
  }
}

/**
 * Applies clip gain plus fade-in/fade-out ramps. Fades are scheduled against
 * absolute context time so they survive a loop wrap restarting the source.
 */
export function applyClipGain(
  gain: GainNode,
  clip: AudioClip,
  bufferDuration: number,
  startAtSec: number,
): void {
  const param = gain.gain;
  const level = Math.max(0, clip.gain);
  const fadeInSec = ticksToSecSafe(clip.fade_in, clip.length_ticks, bufferDuration);
  const fadeOutSec = ticksToSecSafe(clip.fade_out, clip.length_ticks, bufferDuration);
  const durationSec = ticksToSecSafe(clip.length_ticks, clip.length_ticks, bufferDuration);

  if (fadeInSec <= 0 && fadeOutSec <= 0) {
    param.value = level;
    return;
  }
  param.cancelScheduledValues(startAtSec);
  param.setValueAtTime(fadeInSec > 0 ? 0 : level, startAtSec);
  if (fadeInSec > 0) {
    param.linearRampToValueAtTime(level, startAtSec + Math.min(fadeInSec, durationSec));
  }
  if (fadeOutSec > 0) {
    const fadeStart = startAtSec + Math.max(0, durationSec - fadeOutSec);
    param.setValueAtTime(level, fadeStart);
    param.linearRampToValueAtTime(0, startAtSec + durationSec);
  }
}

/** Ticks → seconds, clamped to the buffer so a faded clip never overruns it. */
function ticksToSecSafe(ticks: number, clipTicks: number, bufferDuration: number): number {
  if (ticks <= 0 || clipTicks <= 0) return 0;
  const ratio = Math.min(1, ticks / clipTicks);
  return ratio * bufferDuration;
}
