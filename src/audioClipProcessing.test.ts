import { describe, expect, it } from 'vitest';
import { scheduleWindows } from './audio/audioClipScheduler';
import { clampSourceOffset, type AudioClip } from './model/audioClip';
import {
  NORMALIZE_CEILING,
  normalizationGain,
  reverseChannelData,
  sourceOffsetForWindow,
} from './audio/audioClipProcessing';

const clip = (reversed: boolean, sourceOffset: number): AudioClip => ({
  id: 'clip',
  sample_id: 'sample',
  media_ref: { path: 'idb://x', hash: 'hash', mime: 'audio/wav', bytes: 1, name: 'x.wav' },
  start_tick: 0,
  length_ticks: 960,
  source_offset_ticks: sourceOffset,
  gain: 1,
  pan: 0,
  pitch_cents: 0,
  stretch_ratio: 1,
  fade_in: 0,
  fade_out: 0,
  reversed,
  loop_mode: 'off',
  name: 'x.wav',
  track: 0,
});

describe('audio clip processing', () => {
  it('reverses channel data without mutating the source', () => {
    const source = new Float32Array([0.25, 0.5, -0.75, 1]);
    const reversed = reverseChannelData(source);
    expect(Array.from(reversed)).toEqual([1, -0.75, 0.5, 0.25]);
    expect(Array.from(source)).toEqual([0.25, 0.5, -0.75, 1]);
  });

  it('normalizes peak to -1 dBFS', () => {
    const gain = normalizationGain(0.25);
    expect(gain * 0.25).toBeCloseTo(NORMALIZE_CEILING, 8);
    expect(gain).toBeGreaterThan(1);
  });

  it('leaves silent buffers at unity instead of dividing by zero', () => {
    expect(normalizationGain(0)).toBe(1);
    expect(normalizationGain(Number.NaN)).toBe(1);
  });

  it('uses source offset directly for normal playback', () => {
    expect(sourceOffsetForWindow(clip(false, 2), 10, 1.5, 4, 0.5)).toBe(1.5);
  });

  it('mirrors a source offset inside the reversed segment', () => {
    // 2 ticks at 0.5 s/tick = 1 s into a 4 s clip; the segment starts at
    // 10 - (1 + 4) = 5 s in the reversed buffer.
    expect(sourceOffsetForWindow(clip(true, 2), 10, 1.5, 4, 0.5)).toBe(5.5);
    expect(sourceOffsetForWindow(clip(true, 2), 10, 2.5, 4, 0.5)).toBe(6.5);
  });

  it('clamps a slip offset inside the source media', () => {
    expect(clampSourceOffset(-20, 100, 1000)).toBe(0);
    expect(clampSourceOffset(450, 100, 1000)).toBe(450);
    expect(clampSourceOffset(950, 100, 1000)).toBe(900);
  });

  it('schedules a split half from its media offset', () => {
    const rightHalf = { ...clip(false, 960), start_tick: 1920, length_ticks: 960 };
    const windows = scheduleWindows(
      [rightHalf],
      { bpm: 120, fromTick: 1920, horizonSec: 2, loop: false, loopStartTick: 0, loopEndTick: 0 },
      { clip: 10 },
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].offsetSec).toBe(1);
  });
});
