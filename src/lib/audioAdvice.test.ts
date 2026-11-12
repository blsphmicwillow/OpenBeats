import { describe, expect, it } from 'vitest';
import { toneAdvice } from './audioAdvice';

describe('platform test-tone advice', () => {
  it('says nothing when the tone was healthy or the engine never answered', () => {
    expect(toneAdvice('linux', 'ok')).toBe('');
    expect(toneAdvice('linux', 'no-engine')).toBe('');
  });

  it('names the ALSA bridge on Linux when callbacks never ran', () => {
    const advice = toneAdvice('linux', 'stalled');
    expect(advice).toContain('pipewire-alsa');
    expect(advice).toContain('aplay -L');
  });

  it('does not offer the bridge advice on Linux when the stream ran', () => {
    const advice = toneAdvice('linux', 'silent');
    expect(advice).not.toContain('pipewire-alsa');
    expect(advice).toContain('muted');
  });

  it('points at exclusive mode and the volume mixer on Windows', () => {
    const stalled = toneAdvice('windows', 'stalled');
    expect(stalled).toContain('exclusive');
    expect(stalled).not.toContain('pipewire');
    const silent = toneAdvice('windows', 'silent');
    expect(silent).toContain('openbeats.exe');
    expect(silent).toContain('msedgewebview2.exe');
  });

  it('points at System Settings on macOS', () => {
    expect(toneAdvice('macos', 'stalled')).toContain('System Settings');
    expect(toneAdvice('macos', 'silent')).toContain('aggregate');
  });

  it('stays neutral for the web build and unknown platforms', () => {
    expect(toneAdvice('web', 'stalled')).not.toContain('pipewire');
    expect(toneAdvice('web', 'stalled')).not.toContain('Windows');
    expect(toneAdvice('', 'silent').length).toBeGreaterThan(0);
  });

  it('every non-empty advice starts with a space so it appends to a sentence', () => {
    for (const platform of ['linux', 'windows', 'macos', 'web']) {
      for (const kind of ['stalled', 'silent'] as const) {
        expect(toneAdvice(platform, kind).startsWith(' ')).toBe(true);
      }
    }
  });
});
