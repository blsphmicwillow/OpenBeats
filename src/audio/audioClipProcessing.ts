/**
 * Web Audio-only processing for playlist audio clips.
 *
 * ENGINE: these helpers are used by the live Web Audio scheduler and the
 * offline Web Audio bounce. The Rust/CPAL engine has no audio-clip voice, so
 * reverse and normalize are not available in native playback.
 */

import type { AudioClip } from '../model/audioClip';

/** Peak-normalize to -1 dBFS, leaving a little headroom below full scale. */
export const NORMALIZE_CEILING = 10 ** (-1 / 20);

const reversedBuffers = new WeakMap<AudioBuffer, AudioBuffer>();
const bufferPeaks = new WeakMap<AudioBuffer, number>();

export function reverseChannelData(input: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(input.length * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < input.length; i += 1) out[i] = input[input.length - 1 - i];
  return out;
}

/** A cached reversed copy, so repeated schedules do not allocate per window. */
export function reversedBuffer(ctx: BaseAudioContext, source: AudioBuffer): AudioBuffer {
  const cached = reversedBuffers.get(source);
  if (cached) return cached;
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    out.copyToChannel(reverseChannelData(source.getChannelData(channel)), channel);
  }
  reversedBuffers.set(source, out);
  return out;
}

/** Highest absolute sample across all channels. */
export function bufferPeak(buffer: AudioBuffer): number {
  const cached = bufferPeaks.get(buffer);
  if (cached !== undefined) return cached;
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
  }
  bufferPeaks.set(buffer, peak);
  return peak;
}

/** Gain multiplier that brings this buffer's peak to NORMALIZE_CEILING. */
export function normalizationGain(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 1;
  return NORMALIZE_CEILING / peak;
}

export function audioClipLevel(clip: AudioClip, buffer: AudioBuffer): number {
  const level = Math.max(0, clip.gain);
  return clip.normalized ? level * normalizationGain(bufferPeak(buffer)) : level;
}

export function playbackBuffer(ctx: BaseAudioContext, clip: AudioClip, buffer: AudioBuffer): AudioBuffer {
  return clip.reversed ? reversedBuffer(ctx, buffer) : buffer;
}

/**
 * Maps a timeline window's media offset into the buffer being played. Normal
 * clips use the offset directly. A reversed clip plays the reversed copy of
 * its source segment, so the offset is mirrored inside that segment.
 */
export function sourceOffsetForWindow(
  clip: AudioClip,
  bufferDuration: number,
  mediaOffsetSec: number,
  clipDurationSec: number,
  secPerTick: number,
): number {
  if (!clip.reversed) return Math.max(0, mediaOffsetSec);
  const sourceOffsetSec = Math.max(0, clip.source_offset_ticks ?? 0) * secPerTick;
  const fromClip = Math.max(0, mediaOffsetSec - sourceOffsetSec);
  const segmentStart = Math.max(0, bufferDuration - (sourceOffsetSec + clipDurationSec));
  return Math.min(bufferDuration, segmentStart + fromClip);
}
