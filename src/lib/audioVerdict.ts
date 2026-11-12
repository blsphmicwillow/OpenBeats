/**
 * Judging a test tone, kept out of React so it can be tested directly.
 *
 * Silence has three very different causes and the panel has to tell them apart:
 * the engine never answered, the stream opened and never ran, or the stream ran
 * and delivered nothing but zeroes.
 */

/** One poll of the native engine while the tone was playing. */
export interface ToneSample {
  callbacks: number;
  peak: number;
}

export type ToneVerdict =
  /** No reading at all: the engine did not answer, or is not the desktop build. */
  | { kind: 'no-engine' }
  /** The callback counter never moved. */
  | { kind: 'stalled' }
  /** Callbacks ran, but every rendered block was silent. */
  | { kind: 'silent'; callbacks: number }
  /** Audio reached the device while the tone played. */
  | { kind: 'ok'; callbacks: number; peak: number };

/**
 * `before` is the callback counter captured before the tone started.
 *
 * The peak is the maximum across the whole window, not the last sample: a poll
 * can land after the tone finished or between blocks, and the question is
 * whether audio reached the device at any point, not at the last instant. A
 * counter that went backwards means the stream was rebuilt mid-test, which is
 * its own kind of stall and is reported as one rather than as a negative count.
 */
export function judgeTestTone(before: number, samples: ToneSample[]): ToneVerdict {
  if (samples.length === 0) return { kind: 'no-engine' };
  const last = samples[samples.length - 1];
  const callbacks = last.callbacks - before;
  if (callbacks <= 0) return { kind: 'stalled' };
  const peak = samples.reduce((highest, sample) => Math.max(highest, sample.peak), 0);
  if (peak <= 0) return { kind: 'silent', callbacks };
  return { kind: 'ok', callbacks, peak };
}
