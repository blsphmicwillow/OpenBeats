import { describe, expect, it } from 'vitest';
import { judgeTestTone, type ToneSample } from './audioVerdict';

const sample = (callbacks: number, peak: number): ToneSample => ({ callbacks, peak });

describe('test-tone verdict', () => {
  it('reports no-engine when nothing was read', () => {
    expect(judgeTestTone(0, [])).toEqual({ kind: 'no-engine' });
  });

  it('reports stalled when the callback counter never moves', () => {
    expect(judgeTestTone(120, [sample(120, 0), sample(120, 0)])).toEqual({
      kind: 'stalled',
    });
  });

  it('reports stalled when the stream was rebuilt and the counter reset', () => {
    expect(judgeTestTone(500, [sample(3, 0)])).toEqual({ kind: 'stalled' });
  });

  it('reports silent when callbacks ran with zero peak throughout', () => {
    expect(judgeTestTone(10, [sample(11, 0), sample(20, 0)])).toEqual({
      kind: 'silent',
      callbacks: 10,
    });
  });

  it('reports ok when audio reached the device', () => {
    expect(judgeTestTone(0, [sample(4, 0.18)])).toEqual({
      kind: 'ok',
      callbacks: 4,
      peak: 0.18,
    });
  });

  it('keeps the peak seen during the tone even if later polls are silent', () => {
    // The tone can end, or a poll can land between blocks; one silent sample
    // must not erase the evidence that audio was there.
    expect(judgeTestTone(0, [sample(4, 0.21), sample(40, 0), sample(80, 0)])).toEqual({
      kind: 'ok',
      callbacks: 80,
      peak: 0.21,
    });
  });

  it('uses the loudest sample of the window', () => {
    const verdict = judgeTestTone(0, [sample(1, 0.02), sample(2, 0.3), sample(3, 0.05)]);
    expect(verdict).toMatchObject({ kind: 'ok', peak: 0.3 });
  });
});
