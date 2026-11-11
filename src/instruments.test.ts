import { describe, expect, it } from 'vitest';
import { PRESETS } from './model/defaults';
import { NATIVE_VOICE_APPROX, nativeVoiceId } from './lib/nativeVoices';

const NATIVE_PRESETS = new Set([
  'kick',
  'snare',
  'hat',
  'openhat',
  'clap',
  'tom',
  'rim',
  'bass',
  'sub',
  'fmbass',
  'lead',
  'keys',
  'glass',
  'choir',
  'chords',
  'pluck',
  'pad',
  'fx',
  'sample',
]);

describe('instrument catalog', () => {
  it('keeps preset ids and display names unique', () => {
    const ids = PRESETS.map((preset) => preset.id);
    const names = PRESETS.map((preset) => preset.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('ships the original Web Audio instruments', () => {
    const ids = new Set(PRESETS.map((preset) => preset.id));
    ['anvil', 'prism', 'sundial', 'cordwood', 'vector9', 'acidwell', 'dice', 'dustdevil', 'chatter', 'hammerfelt'].forEach(
      (id) => expect(ids.has(id as (typeof PRESETS)[number]['id'])).toBe(true),
    );
  });

  it('routes every Web Audio-only instrument to a real native voice', () => {
    const ids = new Set(PRESETS.map((preset) => preset.id));
    Object.entries(NATIVE_VOICE_APPROX).forEach(([preset, native]) => {
      expect(ids.has(preset as (typeof PRESETS)[number]['id'])).toBe(true);
      expect(NATIVE_PRESETS.has(native)).toBe(true);
    });
  });

  it('leaves native presets untouched', () => {
    NATIVE_PRESETS.forEach((preset) => expect(nativeVoiceId(preset)).toBe(preset));
    expect(nativeVoiceId('anvil')).toBe('kick');
  });
});
