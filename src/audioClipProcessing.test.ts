import { describe, expect, it } from 'vitest';
import {
  NORMALIZE_CEILING,
  normalizationGain,
  reverseChannelData,
} from './audio/audioClipProcessing';

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
});
