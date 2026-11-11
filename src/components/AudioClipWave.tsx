/**
 * Waveform drawing for a playlist audio clip.
 *
 * ENGINE: Web Audio path only (visualisation of a decoded buffer). The peaks
 * come from the worker-computed pyramid; this component only picks a mip level
 * for the current pixel width and paints it.
 */

import { useEffect, useRef } from 'react';
import type { AudioClip } from '../model/audioClip';
import { getSamplePeaks, peakLevelCount } from '../audio/sampleLibrary';

const HEIGHT = 24;

/** Coarsest level that still gives ~2 buckets per pixel, or the finest one. */
export function levelForPixelWidth(levels: number, width: number): number {
  if (levels <= 0) return 0;
  let level = 0;
  while (level < levels - 1 && width > 0 && 900 / 2 ** level > width * 2) level += 1;
  return level;
}

export function AudioClipWave({ clip, width }: { clip: AudioClip; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.floor(HEIGHT * dpr);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);

    const levels = peakLevelCount(clip.sample_id);
    if (!levels) return;
    const peaks = getSamplePeaks(clip.sample_id, levelForPixelWidth(levels, width));
    if (!peaks) return;
    const buckets = Math.floor(peaks.length / 2);
    if (!buckets) return;

    g.fillStyle = 'rgba(255, 255, 255, 0.62)';
    for (let x = 0; x < width; x += 1) {
      const from = Math.floor((x / width) * buckets);
      const to = Math.max(from + 1, Math.floor(((x + 1) / width) * buckets));
      let min = 0;
      let max = 0;
      for (let b = from; b < to && b < buckets; b += 1) {
        if (peaks[b * 2] < min) min = peaks[b * 2];
        if (peaks[b * 2 + 1] > max) max = peaks[b * 2 + 1];
      }
      const top = HEIGHT / 2 - max * (HEIGHT / 2);
      const bottom = HEIGHT / 2 - min * (HEIGHT / 2);
      g.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [clip.sample_id, clip.length_ticks, width]);

  return (
    <canvas
      ref={ref}
      className="clip-wave"
      style={{ width, height: HEIGHT, display: 'block', marginTop: 2, pointerEvents: 'none' }}
      aria-hidden="true"
    />
  );
}
