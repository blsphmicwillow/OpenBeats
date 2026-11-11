import { describe, expect, it } from 'vitest';
import type { AudioClip } from './model/audioClip';
import { splitAudioClip, splitPatternClip } from './model/clipSplit';
import type { Clip } from './model/types';

describe('clip splitting', () => {
  it('splits a pattern clip and keeps only the outer fades', () => {
    const clip: Clip = {
      id: 'cl-1',
      pattern: 'pat-1',
      track: 2,
      start: 16,
      len: 32,
      gain: 0.8,
      fadeIn: 4,
      fadeOut: 6,
    };
    const parts = splitPatternClip(clip, 28, (() => {
      let n = 0;
      return () => `new-${++n}`;
    })());
    expect(parts).not.toBeNull();
    const [left, right] = parts!;
    expect(left).toMatchObject({ id: 'new-1', start: 16, len: 12, fadeIn: 4, fadeOut: 0, gain: 0.8 });
    expect(right).toMatchObject({ id: 'new-2', start: 28, len: 20, fadeIn: 0, fadeOut: 6, gain: 0.8 });
  });

  it('splits an audio clip at a tick and preserves media', () => {
    const clip: AudioClip = {
      id: 'ac-1',
      sample_id: 'sample-1',
      media_ref: { path: 'idb://x', hash: 'abc', mime: 'audio/wav', bytes: 100, name: 'loop.wav' },
      start_tick: 480,
      length_ticks: 1920,
      source_offset_ticks: 480,
      gain: 1,
      pan: 0,
      pitch_cents: 0,
      stretch_ratio: 1,
      fade_in: 120,
      fade_out: 240,
      loop_mode: 'loop',
      name: 'loop.wav',
      track: 1,
    };
    const parts = splitAudioClip(clip, 1440, (() => {
      let n = 0;
      return () => `part-${++n}`;
    })());
    expect(parts).not.toBeNull();
    const [left, right] = parts!;
    expect(left).toMatchObject({ id: 'part-1', start_tick: 480, length_ticks: 960, source_offset_ticks: 480, fade_in: 120, fade_out: 0, loop_mode: 'loop' });
    expect(right).toMatchObject({ id: 'part-2', start_tick: 1440, length_ticks: 960, source_offset_ticks: 1440, fade_in: 0, fade_out: 240 });
    expect(right.media_ref).toBe(clip.media_ref);
  });

  it('rejects a playhead outside the clip', () => {
    const clip: Clip = { id: 'c', pattern: 'p', track: 0, start: 8, len: 8 };
    expect(splitPatternClip(clip, 8, () => 'x')).toBeNull();
    expect(splitPatternClip(clip, 16, () => 'x')).toBeNull();
  });
});
