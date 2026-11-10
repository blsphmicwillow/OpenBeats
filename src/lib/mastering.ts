import type { BaseAudioContext } from '../audio/audio-context-types';

export type MasterTarget = 'none' | 'spotify' | 'club' | 'soundcloud' | 'youtube';

interface TargetProfile {
  id: MasterTarget;
  name: string;
  blurb: string;
  /** Approximate integrated loudness in LUFS. */
  lufs: number;
  /** True-peak ceiling in dBFS. */
  ceiling: number;
  /** Low / high shelf in dB. */
  low: number;
  high: number;
  /** Glue compressor threshold in dB. */
  threshold: number;
  ratio: number;
}

export const MASTER_TARGETS: TargetProfile[] = [
  { id: 'none', name: 'None', blurb: 'Bounce the mix exactly as it plays.', lufs: 0, ceiling: -1, low: 0, high: 0, threshold: 0, ratio: 1 },
  { id: 'spotify', name: 'Spotify', blurb: 'Streaming-safe −14 LUFS, −1 dBTP, gentle glue.', lufs: -14, ceiling: -1, low: 0.5, high: 1, threshold: -18, ratio: 2.5 },
  { id: 'club', name: 'Club', blurb: 'Loud and forward, −9 LUFS with tight low end.', lufs: -9, ceiling: -0.3, low: 1.5, high: 0.5, threshold: -14, ratio: 4 },
  { id: 'soundcloud', name: 'SoundCloud', blurb: '−13 LUFS with a softer limiter for lossy playback.', lufs: -13, ceiling: -1.2, low: 0.5, high: 0.8, threshold: -17, ratio: 3 },
  { id: 'youtube', name: 'YouTube', blurb: '−14 LUFS and a −1 dBTP ceiling for video.', lufs: -14, ceiling: -1, low: 0.3, high: 0.8, threshold: -18, ratio: 2.5 },
];

export function masterProfile(id: MasterTarget): TargetProfile {
  return MASTER_TARGETS.find((t) => t.id === id) ?? MASTER_TARGETS[0];
}

function measureRms(buffer: AudioBuffer): number {
  let sum = 0;
  let count = 0;
  const stride = Math.max(1, Math.floor(buffer.length / 200000));
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += stride) {
      sum += data[i] * data[i];
      count += 1;
    }
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  }
  return peak;
}

/**
 * Offline mastering chain: shelf tilt → glue compressor → limiter → loudness
 * match. Runs on the same buffer the bounce produced, so nothing is re-rendered.
 */
export async function masterBuffer(buffer: AudioBuffer, target: MasterTarget): Promise<AudioBuffer> {
  const profile = masterProfile(target);
  if (profile.id === 'none') return buffer;

  const OfflineCtor: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OfflineCtor(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 120;
  low.gain.value = profile.low;

  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 6500;
  high.gain.value = profile.high;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = profile.threshold;
  comp.ratio.value = profile.ratio;
  comp.attack.value = 0.008;
  comp.release.value = 0.18;
  comp.knee.value = 6;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = profile.ceiling - 1;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  limiter.knee.value = 0;

  // Loudness match: naive RMS→LUFS offset (−0.7 dB) is close enough for a
  // delivery target and keeps the chain deterministic.
  const currentLufs = 20 * Math.log10(Math.max(1e-6, measureRms(buffer))) - 0.7;
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0.25, Math.min(4, Math.pow(10, (profile.lufs - currentLufs) / 20)));

  source.connect(low);
  low.connect(high);
  high.connect(comp);
  comp.connect(gain);
  gain.connect(limiter);
  limiter.connect(ctx.destination);
  source.start();

  const out = await ctx.startRendering();

  // Final safety trim to the delivery ceiling.
  const peak = peakOf(out);
  const ceilingLin = Math.pow(10, profile.ceiling / 20);
  if (peak > ceilingLin) {
    const scale = ceilingLin / peak;
    for (let c = 0; c < out.numberOfChannels; c += 1) {
      const data = out.getChannelData(c);
      for (let i = 0; i < data.length; i += 1) data[i] *= scale;
    }
  }
  return out;
}

export function lufsOf(buffer: AudioBuffer): number {
  return 20 * Math.log10(Math.max(1e-6, measureRms(buffer))) - 0.7;
}

export type { BaseAudioContext };
