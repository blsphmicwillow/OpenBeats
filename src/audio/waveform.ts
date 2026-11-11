/**
 * Waveform peak pyramids with progressive LOD and an LRU cache.
 *
 * ENGINE: Web Audio path only (it visualises decoded buffers). Nothing here is
 * executed by Rust.
 *
 * Level 0 is the finest bucket (`baseBucket` frames per min/max pair); each
 * further level doubles the bucket, so a 5-minute 48 kHz stereo file can be
 * drawn from a few hundred pairs at the coarsest level and refined as the user
 * zooms. The heavy pass runs in `waveform.worker.ts` so the UI thread never
 * blocks.
 */

export interface Peak {
  min: number;
  max: number;
}

export const DEFAULT_BASE_BUCKET = 256;
export const DEFAULT_LEVELS = 6;

/** Bucket size in frames for a mip level. */
export function bucketForLevel(level: number, baseBucket = DEFAULT_BASE_BUCKET): number {
  return baseBucket * 2 ** Math.max(0, Math.floor(level));
}

/**
 * Builds one mip level as interleaved [min, max, min, max, …] floats.
 * All channels are folded together so the drawing code needs one array.
 */
export function buildPeakLevel(channels: Float32Array[], bucketSize: number): Float32Array {
  const frames = channels.reduce((max, lane) => Math.max(max, lane.length), 0);
  const bucket = Math.max(1, Math.floor(bucketSize));
  const count = Math.ceil(frames / bucket);
  const out = new Float32Array(count * 2);
  if (count === 0) return out;
  for (let b = 0; b < count; b += 1) {
    let min = 0;
    let max = 0;
    const start = b * bucket;
    const end = Math.min(frames, start + bucket);
    for (const lane of channels) {
      for (let i = start; i < end; i += 1) {
        const value = lane[i] ?? 0;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}

/** Halves a level's resolution without touching the source samples. */
export function downscalePeaks(peaks: Float32Array): Float32Array {
  const buckets = Math.floor(peaks.length / 2);
  const out = new Float32Array(Math.ceil(buckets / 2) * 2);
  for (let b = 0; b < out.length / 2; b += 1) {
    const a = b * 2;
    const c = a + 1;
    const aMin = peaks[a * 2] ?? 0;
    const aMax = peaks[a * 2 + 1] ?? 0;
    const bMin = c < buckets ? (peaks[c * 2] ?? 0) : 0;
    const bMax = c < buckets ? (peaks[c * 2 + 1] ?? 0) : 0;
    out[b * 2] = Math.min(aMin, bMin);
    out[b * 2 + 1] = Math.max(aMax, bMax);
  }
  return out;
}

/**
 * Full pyramid, level 0 first. Each level after 0 is derived from the previous
 * one, which is O(n) total instead of re-scanning the samples per level.
 */
export function buildPeakPyramid(
  channels: Float32Array[],
  baseBucket = DEFAULT_BASE_BUCKET,
  levels = DEFAULT_LEVELS,
): Float32Array[] {
  const out: Float32Array[] = [buildPeakLevel(channels, baseBucket)];
  for (let level = 1; level < Math.max(1, levels); level += 1) {
    out.push(downscalePeaks(out[level - 1]));
  }
  return out;
}

export function peakKey(sampleId: string, level: number): string {
  return `${sampleId}:${Math.max(0, Math.floor(level))}`;
}

/** Small LRU keyed by `${sampleId}:${level}` — the spec's cache key. */
export class PeakCache {
  private readonly capacity: number;
  private readonly entries = new Map<string, Float32Array>();

  constructor(capacity = 24) {
    this.capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.entries.size;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): Float32Array | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: Float32Array): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Picks the level whose bucket is at most `pixelsPerBucket` wide, so zooming in
 * selects a finer level and zooming out a coarser one (progressive LOD).
 */
export function levelForWidth(peaksPerLevel: number[], pixelWidth: number): number {
  if (!peaksPerLevel.length) return 0;
  for (let level = 0; level < peaksPerLevel.length; level += 1) {
    const count = peaksPerLevel[level];
    if (count > 0 && pixelWidth / count >= 0.5) return level;
  }
  return peaksPerLevel.length - 1;
}
