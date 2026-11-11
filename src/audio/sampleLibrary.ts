/**
 * Session sample library for playlist audio clips.
 *
 * ENGINE: Web Audio path only. Decoded buffers are held in memory for playback
 * and waveform drawing; the bytes themselves live in `mediaStore.ts`.
 */

import type { MediaRef } from '../model/audioClip';

const buffers = new Map<string, AudioBuffer>();
const peaks = new Map<string, Float32Array[]>();
const refs = new Map<string, MediaRef>();
const names = new Map<string, string>();

export function registerSample(
  sampleId: string,
  buffer: AudioBuffer,
  ref: MediaRef,
  pyramid?: Float32Array[],
): void {
  buffers.set(sampleId, buffer);
  refs.set(sampleId, ref);
  names.set(sampleId, ref.name);
  if (pyramid?.length) peaks.set(sampleId, pyramid);
}

export function getSampleBuffer(sampleId: string): AudioBuffer | undefined {
  return buffers.get(sampleId);
}

export function getSampleRef(sampleId: string): MediaRef | undefined {
  return refs.get(sampleId);
}

export function getSampleName(sampleId: string): string {
  return names.get(sampleId) ?? 'audio';
}

/** Highest pyramid level computed for this sample (0 = finest), or -1. */
export function peakLevelCount(sampleId: string): number {
  return peaks.get(sampleId)?.length ?? 0;
}

export function getSamplePeaks(sampleId: string, level: number): Float32Array | undefined {
  const pyramid = peaks.get(sampleId);
  if (!pyramid?.length) return undefined;
  return pyramid[Math.max(0, Math.min(pyramid.length - 1, level))];
}

export function setSamplePeaks(sampleId: string, pyramid: Float32Array[]): void {
  peaks.set(sampleId, pyramid);
}

export function clearSampleLibrary(): void {
  buffers.clear();
  peaks.clear();
  refs.clear();
  names.clear();
}

/** Buffers for the clips in a project, keyed by clip id (the scheduler's shape). */
export function buffersForClips(
  clips: { id: string; sample_id: string }[],
): Map<string, AudioBuffer> {
  const out = new Map<string, AudioBuffer>();
  for (const clip of clips) {
    const buffer = buffers.get(clip.sample_id);
    if (buffer) out.set(clip.id, buffer);
  }
  return out;
}
