import type { ToneVerdict } from './audioVerdict';

/** What the engine reports about one test-tone window. */
export interface ToneReport {
  /** Callbacks observed during the window. */
  callbacks: number;
  /** Peak of the last rendered block, dBFS. */
  peakDb: number;
  /** Peak of the audio the engine actually rendered, 0..1. */
  renderedPeak: number;
  /** RMS of that same audio, 0..1. */
  renderedRms: number;
  /** Callbacks later than 1.5x nominal during the window. */
  deadlineMisses: number;
  /** Sound-server node the stream is connected to, when the backend knows. */
  sink: string;
}

/** Formats a linear level as dBFS without pretending -inf exists. */
export function dbfs(level: number): string {
  if (!(level > 0)) return '−∞ dBFS';
  return `${(20 * Math.log10(level)).toFixed(1)} dBFS`;
}

/**
 * The sentence under the test tone. It reports what the engine delivered and
 * what the device was doing, so "I hear nothing" can be split into a silent
 * graph, a stream that cannot keep up, or audio going somewhere else.
 */
export function toneReportMessage(report: ToneReport): string {
  const delivered = `engine rendered ${dbfs(report.renderedPeak)} peak, ${dbfs(report.renderedRms)} RMS`;
  const where = report.sink ? `connected to “${report.sink}”` : 'connected to the system default';
  if (report.callbacks === 0) {
    return `The stream opened but produced no callbacks, so nothing reached the device (${where}).`;
  }
  if (report.renderedPeak <= 0) {
    return `The stream ran (${report.callbacks.toLocaleString()} callbacks) but the engine delivered silence (${where}). This is an engine problem, not a device problem.`;
  }
  if (report.deadlineMisses > 0) {
    return `The ${delivered} (${where}), but ${report.deadlineMisses.toLocaleString()} callbacks missed their deadline — the buffer is too small for this device. If you hear chopping or nothing, turn Low-latency mode off.`;
  }
  return `The ${delivered} (${where}). If you hear nothing, the audio is going to another output: check the device is the one you are listening to, and that it is not muted.`;
}

/** The block behind "Copy diagnostics": plain text a tester can paste as-is. */
export interface DiagnosticsInput {
  version: string;
  platform: string;
  bridge: string;
  device: string;
  host: string;
  sink: string;
  sampleRate: number;
  channels: number;
  bufferFrames: number;
  lowLatency: boolean;
  callbacks: number;
  peakDb: number;
  intervalMaxMs: number;
  deadlineMisses: number;
  streamErrors: number;
  deviceSwaps: number;
  lastError: string;
}

export function diagnosticsText(input: DiagnosticsInput): string {
  const lines = [
    `OpenBeats ${input.version}`, 
    `platform: ${input.platform}`,
    `host: ${input.host || 'unknown'}`,
    `device: ${input.device || 'system default'}`,
    `sink: ${input.sink || '(none reported)'}`,
    `format: ${input.channels} ch @ ${Math.round(input.sampleRate)} Hz, ${input.bufferFrames} frames/callback`,
    `low latency: ${input.lowLatency ? 'on' : 'off'}`,
    `callbacks: ${input.callbacks}`,
    `peak: ${input.peakDb.toFixed(1)} dBFS`,
    `worst callback interval: ${input.intervalMaxMs.toFixed(1)} ms`,
    `deadline misses: ${input.deadlineMisses}`,
    `stream errors: ${input.streamErrors}, rebuilds: ${input.deviceSwaps}`,
    `audio bridge: ${input.bridge}`,
    `last error: ${input.lastError || '(none)'}`,
  ];
  return lines.join('\n');
}

/** Value of the backend `audio_bridge_status` command. */
export type BridgeState = 'ok' | 'missing-bridge' | 'no-server' | 'unknown';

/**
 * The sentence shown after a failed test tone.
 *
 * The three desktop platforms fail for different reasons, and one generic
 * sentence ("try another output") is what leaves a tester with a red verdict and
 * nothing to do. Each string names the things that actually cause silence there.
 *
 * `platform` is the value of the `platform` command: `linux`, `windows`,
 * `macos`, or `web` outside the desktop build.
 */
export function toneAdvice(platform: string, verdict: ToneVerdict['kind']): string {
  if (verdict === 'ok' || verdict === 'no-engine') return '';

  switch (platform) {
    case 'linux':
      return verdict === 'stalled'
        ? ' Install the ALSA→PipeWire bridge (pipewire-alsa, or libasound2-plugins on Debian/Ubuntu), then reopen Audio settings. `aplay -L | grep -iE "pipewire|pulse"` must list a device.'
        : ' Make sure the sink is not muted or at 0% in your mixer, and that the saved output still exists.';
    case 'windows':
      return verdict === 'stalled'
        ? ' Try another output from the list, and close anything holding the endpoint in exclusive mode (Sound settings → the device → "Allow applications to take exclusive control" should be off).'
        : ' Check the Windows Volume Mixer for both "openbeats.exe" (native output) and "msedgewebview2.exe" (the app window), that the selected endpoint is the one you actually hear, and that neither is muted.';
    case 'macos':
      return verdict === 'stalled'
        ? ' Check System Settings → Sound that the selected output is connected and is not a stale aggregate or multi-output device, then press Test tone again.'
        : ' Check System Settings → Sound output level, that no aggregate device is selected, and that another app is not holding the device at a different sample rate.';
    default:
      return verdict === 'stalled'
        ? ' Try another output device.'
        : ' Check the output level and the selected device.';
  }
}

/**
 * Shown in Audio settings when the backend enumerates no output device at all.
 *
 * This is the silent-app case: there is no stream, so no callbacks, no peak and
 * no error — the picker would just be an empty dropdown. The message has to name
 * the cause, and on Linux that means separating "nothing is running" from "the
 * sound server is running but ALSA has no bridge to it".
 */
export function noOutputDevicesAdvice(platform: string, bridge: BridgeState): string {
  switch (platform) {
    case 'linux':
      if (bridge === 'missing-bridge') {
        return 'PipeWire or PulseAudio is running, but ALSA has no bridge device to open. Install pipewire-alsa (or libasound2-plugins on Debian/Ubuntu), then reopen this panel.';
      }
      if (bridge === 'no-server') {
        return 'No sound server answered and ALSA reported no output devices. Start PipeWire or PulseAudio, install the ALSA bridge (pipewire-alsa, or libasound2-plugins), then reopen this panel.';
      }
      return 'ALSA reported no output devices. Run `aplay -L` in a terminal; if no pulse or pipewire entry is listed, install pipewire-alsa (or libasound2-plugins), then reopen this panel.';
    case 'windows':
      return 'Windows reported no output endpoint. Check Sound settings that an output device exists, is enabled and is not disabled, then reopen this panel.';
    case 'macos':
      return 'CoreAudio reported no output device. Connect or re-enable one in System Settings → Sound, then reopen this panel.';
    default:
      return 'No output device was found.';
  }
}
