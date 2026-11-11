import { describe, expect, it } from 'vitest';
import { quantizeStep, quantizeTick, selectClipId } from './lib/clipSelection';
import { TICKS_PER_STEP } from './model/audioClip';

describe('playlist clip selection', () => {
  it('replaces the selection for a plain click', () => {
    expect(selectClipId(['a', 'b'], 'c', false)).toEqual(['c']);
  });

  it('adds to the selection without duplicating ids', () => {
    expect(selectClipId(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(selectClipId(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
  });
});

describe('batch quantize', () => {
  it('snaps pattern clip starts to the grid', () => {
    expect(quantizeStep(5, 1)).toBe(5);
    expect(quantizeStep(4.6, 1)).toBe(5);
    expect(quantizeStep(4.1, 4)).toBe(4);
    expect(quantizeStep(9, 4)).toBe(8);
  });

  it('leaves positions alone when snapping is off or invalid', () => {
    expect(quantizeStep(4.37, 0)).toBe(4.37);
    expect(quantizeStep(4.37, Number.NaN)).toBe(4.37);
    expect(quantizeTick(1234, 0)).toBe(1234);
  });

  it('snaps audio ticks on the same step grid', () => {
    expect(quantizeTick(0.6 * TICKS_PER_STEP, 1)).toBe(TICKS_PER_STEP);
    expect(quantizeTick(3.4 * TICKS_PER_STEP, 4)).toBe(4 * TICKS_PER_STEP);
    expect(quantizeTick(-20, 1)).toBe(0);
  });
});
