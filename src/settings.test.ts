import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeSettings, useApp } from './store';

const SETTINGS_KEY = 'openbeats.settings.v1';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('audio settings persistence', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
    // Node 22's global localStorage is unavailable without a storage file, so
    // give the store's bare localStorage calls a deterministic implementation.
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds audio defaults to settings saved before the audio section existed', () => {
    const settings = normalizeSettings({ startupChime: false });
    expect(settings.audio).toEqual({
      outputId: null,
      outputLabel: null,
      inputId: null,
      lowLatency: false,
      cueGain: 1,
      monitorGain: 0.7,
    });
  });

  it('keeps valid audio choices and clamps levels from storage', () => {
    const settings = normalizeSettings({
      audio: {
        outputId: 'PulseAudio|sink:bluez_sink.WH1000XM5',
        outputLabel: 'WH-1000XM5 · Bluetooth · BlueZ',
        inputId: 'ALSA|Microphone',
        lowLatency: true,
        cueGain: 9,
        monitorGain: -1,
      },
    });
    expect(settings.audio.outputId).toBe('PulseAudio|sink:bluez_sink.WH1000XM5');
    expect(settings.audio.outputLabel).toBe('WH-1000XM5 · Bluetooth · BlueZ');
    expect(settings.audio.inputId).toBe('ALSA|Microphone');
    expect(settings.audio.lowLatency).toBe(true);
    expect(settings.audio.cueGain).toBe(2);
    expect(settings.audio.monitorGain).toBe(0);
  });

  it('writes a device change through immediately, without waiting for autosave', () => {
    const before = useApp.getState().settings.audio;
    useApp.getState().patchSettings({
      audio: {
        ...before,
        outputId: 'PulseAudio|sink:alsa_output.hdmi-stereo',
        outputLabel: 'HDMI / DisplayPort · screen',
      },
    });

    const stored = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') as {
      audio?: { outputId?: string; outputLabel?: string };
    };
    expect(stored.audio?.outputId).toBe('PulseAudio|sink:alsa_output.hdmi-stereo');
    expect(stored.audio?.outputLabel).toBe('HDMI / DisplayPort · screen');
  });
});
