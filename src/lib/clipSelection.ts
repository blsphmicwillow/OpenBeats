import { TICKS_PER_STEP } from '../model/audioClip';

/**
 * Playlist clip selection is deliberately model-free: ids are the only state,
 * so a batch edit never has to keep stale clip objects in sync.
 */
export function selectClipId(current: string[], id: string, additive: boolean): string[] {
  if (!additive) return [id];
  return current.includes(id) ? current : [...current, id];
}

/** Snaps a pattern-clip start (16th steps) to the grid. Zero disables snapping. */
export function quantizeStep(start: number, snap: number): number {
  const value = Math.max(0, start);
  if (!Number.isFinite(snap) || snap <= 0) return value;
  return Math.max(0, Math.round(value / snap) * snap);
}

/** Snaps an audio-clip start (ticks) to the same step grid. */
export function quantizeTick(tick: number, snap: number): number {
  const value = Math.max(0, Math.round(tick));
  if (!Number.isFinite(snap) || snap <= 0) return value;
  const grid = snap * TICKS_PER_STEP;
  return Math.max(0, Math.round(value / grid) * grid);
}
