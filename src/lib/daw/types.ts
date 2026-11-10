/** Shared song representation used by every import/export format. */
export interface ExchangeNote {
  pitch: number;
  /** Start in 16th-note steps from the start of the song. */
  start: number;
  /** Length in 16th-note steps. */
  len: number;
  /** 0..1 */
  vel: number;
}

export interface ExchangeTrack {
  name: string;
  /** General MIDI program number when known. */
  program?: number;
  notes: ExchangeNote[];
}

export interface ExchangeSong {
  name: string;
  bpm: number;
  tracks: ExchangeTrack[];
  source: 'midi' | 'als' | 'rpp';
  /** Human-readable warnings, e.g. skipped automation. */
  notes?: string[];
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
