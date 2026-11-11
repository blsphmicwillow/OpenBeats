import { describe, expect, it } from 'vitest';
import { bitCrushCurve } from './audio/effects';

describe('bitcrusher curve', () => {
  it('quantises to the requested bit depth', () => {
    const curve = bitCrushCurve(4);
    const unique = new Set(Array.from(curve).map((value) => value.toFixed(6)));
    // The curve spans both polarities, so 4 bit levels produce 33 steps.
    expect(unique.size).toBeLessThanOrEqual(2 * 2 ** 4 + 1);
    expect(curve[0]).toBe(-1);
    expect(curve[curve.length - 1]).toBe(1);
  });

  it('returns a usable curve for extreme bit depths', () => {
    const low = bitCrushCurve(1);
    const high = bitCrushCurve(24);
    expect(low.length).toBe(2048);
    expect(high.length).toBe(2048);
    expect(Array.from(high).every((value) => value >= -1 && value <= 1)).toBe(true);
  });
});
