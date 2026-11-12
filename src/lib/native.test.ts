import { describe, expect, it } from 'vitest';
import { normalizeAudioError } from './native';

describe('audio error dedupe key', () => {
  it('folds the numbers that change between attempts', () => {
    expect(normalizeAudioError('could not open 48000 Hz on device 3')).toBe(
      normalizeAudioError('could not open 44100 Hz on device 11'),
    );
  });

  it('folds hex handles and collapses whitespace', () => {
    expect(normalizeAudioError('backend  0x7ff6a1 failed')).toBe(
      normalizeAudioError('backend 0x00ffee failed'),
    );
  });

  it('ignores case and surrounding space', () => {
    expect(normalizeAudioError('  DEVICE BUSY  ')).toBe(normalizeAudioError('device busy'));
  });

  it('keeps genuinely different failures apart', () => {
    expect(normalizeAudioError('device busy')).not.toBe(normalizeAudioError('no such device'));
  });
});
