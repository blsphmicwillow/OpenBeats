/**
 * Peak computation client.
 *
 * ENGINE: Web Audio path only (visualisation of decoded buffers).
 *
 * Uses the worker when the platform has one, so a 5-minute file never scans
 * samples on the UI thread; falls back to the same pure function when a worker
 * is unavailable (unit tests, restricted WebViews).
 */

import { buildPeakPyramid, DEFAULT_BASE_BUCKET, DEFAULT_LEVELS } from './waveform';

export function buildPeaksOffThread(
  sampleId: string,
  channels: Float32Array[],
  baseBucket = DEFAULT_BASE_BUCKET,
  levels = DEFAULT_LEVELS,
): Promise<Float32Array[]> {
  const fallback = () => Promise.resolve(buildPeakPyramid(channels, baseBucket, levels));
  if (typeof Worker === 'undefined' || !channels.length) return fallback();
  try {
    return new Promise<Float32Array[]>((resolve) => {
      const worker = new Worker(new URL('./waveform.worker.ts', import.meta.url), {
        type: 'module',
      });
      const received: Float32Array[] = [];
      let settled = false;
      const done = (value: Float32Array[]) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        resolve(value);
      };
      worker.onmessage = (event: MessageEvent<{ level: number; peaks: Float32Array; done: boolean }>) => {
        const { level, peaks, done: last } = event.data;
        received[level] = peaks;
        if (last) done(received);
      };
      worker.onerror = () => done(buildPeakPyramid(channels, baseBucket, levels));
      // Copy the channel data: transferring the live AudioBuffer lanes would
      // detach them and silence playback.
      const copies = channels.map((lane) => lane.slice());
      worker.postMessage(
        { id: 1, sampleId, channels: copies, baseBucket, levels },
        copies.map((lane) => lane.buffer),
      );
    });
  } catch {
    return fallback();
  }
}
