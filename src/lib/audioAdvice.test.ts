import { describe, expect, it } from 'vitest';
import {
  dbfs,
  diagnosticsText,
  noOutputDevicesAdvice,
  toneAdvice,
  toneReportMessage,
  type BridgeState,
} from './audioAdvice';

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

  it('names the missing bridge when no output device is enumerated on Linux', () => {
    const advice = noOutputDevicesAdvice('linux', 'missing-bridge');
    expect(advice).toContain('pipewire-alsa');
    expect(advice).toContain('libasound2-plugins');
  });

  it('separates "no server" from "no bridge" on Linux', () => {
    const noServer = noOutputDevicesAdvice('linux', 'no-server');
    const missing = noOutputDevicesAdvice('linux', 'missing-bridge');
    expect(noServer).not.toBe(missing);
    expect(noServer).toContain('No sound server');
    expect(missing).toContain('is running');
  });

  it('still says something actionable when the bridge status is unknown', () => {
    for (const bridge of ['ok', 'unknown'] as BridgeState[]) {
      const advice = noOutputDevicesAdvice('linux', bridge);
      expect(advice).toContain('aplay -L');
      expect(advice).toContain('pipewire-alsa');
    }
  });

  it('points at the platform sound settings for an empty device list', () => {
    expect(noOutputDevicesAdvice('windows', 'unknown')).toContain('Sound settings');
    expect(noOutputDevicesAdvice('windows', 'unknown')).not.toContain('pipewire');
    expect(noOutputDevicesAdvice('macos', 'unknown')).toContain('System Settings');
    expect(noOutputDevicesAdvice('web', 'unknown')).toBe('No output device was found.');
  });

  it('formats levels in dBFS with a floor instead of -Infinity', () => {
    expect(dbfs(1)).toBe('0.0 dBFS');
    expect(dbfs(0)).toBe('−∞ dBFS');
    expect(dbfs(0.5)).toBe('-6.0 dBFS');
  });

  it('says when the engine delivered silence, separately from the device', () => {
    const message = toneReportMessage({
      callbacks: 120,
      peakDb: -120,
      renderedPeak: 0,
      renderedRms: 0,
      deadlineMisses: 0,
      sink: 'bluez_output.00_00.1',
    });
    expect(message).toContain('engine delivered silence');
    expect(message).toContain('bluez_output.00_00.1');
    expect(message).not.toContain('another output');
  });

  it('reports deadline misses and points at low-latency mode', () => {
    const message = toneReportMessage({
      callbacks: 900,
      peakDb: -3,
      renderedPeak: 0.7,
      renderedRms: 0.2,
      deadlineMisses: 12,
      sink: '',
    });
    expect(message).toContain('12 callbacks missed their deadline');
    expect(message).toContain('Low-latency mode off');
  });

  it('reports produced audio and points at the output when nothing is heard', () => {
    const message = toneReportMessage({
      callbacks: 900,
      peakDb: -3,
      renderedPeak: 0.7,
      renderedRms: 0.2,
      deadlineMisses: 0,
      sink: 'bluez_output.00_00.1',
    });
    expect(message).toContain('another output');
    expect(message).toContain('bluez_output.00_00.1');
  });

  it('says nothing was delivered when there were no callbacks at all', () => {
    const message = toneReportMessage({
      callbacks: 0,
      peakDb: -120,
      renderedPeak: 0,
      renderedRms: 0,
      deadlineMisses: 0,
      sink: '',
    });
    expect(message).toContain('no callbacks');
  });

  it('builds a pastable diagnostics block with every field', () => {
    const text = diagnosticsText({
      version: '1.0.9',
      platform: 'linux',
      bridge: 'ok',
      device: 'pipewire',
      host: 'ALSA',
      sink: 'bluez_output.00_00.1',
      sampleRate: 44100,
      channels: 2,
      bufferFrames: 32,
      lowLatency: true,
      callbacks: 512,
      peakDb: -18.4,
      intervalMaxMs: 41.2,
      deadlineMisses: 7,
      streamErrors: 0,
      deviceSwaps: 1,
      stallReopens: 2,
      lastReopen: 'stall reopen 2/3: no callback while playing',
      lastError: '',
    });
    for (const expected of [
      'OpenBeats 1.0.9',
      'platform: linux',
      'sink: bluez_output.00_00.1',
      '2 ch @ 44100 Hz, 32 frames/callback',
      'deadline misses: 7',
      'stall reopens: 2',
      'last stall reopen: stall reopen 2/3',
      'audio bridge: ok',
      'last error: (none)',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('every non-empty advice starts with a space so it appends to a sentence', () => {
    for (const platform of ['linux', 'windows', 'macos', 'web']) {
      for (const kind of ['stalled', 'silent'] as const) {
        expect(toneAdvice(platform, kind).startsWith(' ')).toBe(true);
      }
    }
  });
});
