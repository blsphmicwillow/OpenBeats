/**
 * Waveform peak worker.
 *
 * ENGINE: Web Audio path only — it consumes decoded channel data and returns
 * peak pyramids so the UI thread never scans samples.
 *
 * The worker is intentionally thin: all maths lives in `waveform.ts`, which is
 * unit-tested without a worker.
 */

import { buildPeakPyramid, DEFAULT_BASE_BUCKET, DEFAULT_LEVELS } from './waveform';

export interface PeakBuildRequest {
  id: number;
  sampleId: string;
  channels: Float32Array[];
  baseBucket?: number;
  levels?: number;
}

export interface PeakBuildResponse {
  id: number;
  sampleId: string;
  /** One pyramid level per message, finest first. */
  level: number;
  peaks: Float32Array;
  done: boolean;
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<PeakBuildRequest>) => void) | null;
  postMessage: (message: PeakBuildResponse, transfer?: Transferable[]) => void;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<PeakBuildRequest>) => {
  const { id, sampleId, channels, baseBucket, levels } = event.data;
  if (!Array.isArray(channels) || !channels.length) return;
  const pyramid = buildPeakPyramid(channels, baseBucket ?? DEFAULT_BASE_BUCKET, levels ?? DEFAULT_LEVELS);
  pyramid.forEach((peaks, level) => {
    scope.postMessage(
      { id, sampleId, level, peaks, done: level === pyramid.length - 1 },
      [peaks.buffer],
    );
  });
};
