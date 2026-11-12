import { describe, expect, it } from 'vitest';
import { createsWebAudio, resolveAudioInit } from './audioInit';

describe('resolveAudioInit', () => {
  it('browser build: Web Audio is the engine', () => {
    const mode = resolveAudioInit({ shell: false, nativeSampleRate: 0, chimePending: false });
    expect(mode).toBe('browser');
    expect(createsWebAudio(mode)).toBe(true);
  });

  it('desktop with a native stream open: no Web Audio context', () => {
    const mode = resolveAudioInit({ shell: true, nativeSampleRate: 44_100, chimePending: false });
    expect(mode).toBe('native');
    expect(createsWebAudio(mode)).toBe(false);
  });

  it('desktop where the chime opens the device first: deferred, no context', () => {
    const mode = resolveAudioInit({ shell: true, nativeSampleRate: 0, chimePending: true });
    expect(mode).toBe('deferred');
    expect(createsWebAudio(mode)).toBe(false);
  });

  it('desktop with no native stream: falls back to Web Audio', () => {
    const mode = resolveAudioInit({ shell: true, nativeSampleRate: 0, chimePending: false });
    expect(mode).toBe('fallback');
    expect(createsWebAudio(mode)).toBe(true);
  });

  it('a native stream wins over a pending chime', () => {
    expect(
      resolveAudioInit({ shell: true, nativeSampleRate: 48_000, chimePending: true })
    ).toBe('native');
  });
});
