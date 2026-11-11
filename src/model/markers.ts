import type { Marker } from './types';

/** Markers are arrangement landmarks in 16th steps, independent of the audio engine. */
export function normalizeMarkers(raw: unknown): Marker[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Marker[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const m = entry as Partial<Marker>;
    if (typeof m.id !== 'string' || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({
      id: m.id,
      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 64) : 'Marker',
      start: Math.max(0, Math.round(typeof m.start === 'number' && Number.isFinite(m.start) ? m.start : 0)),
    });
  }
  return out.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
}

export function nextMarker(markers: Marker[], fromStep: number): Marker | undefined {
  return [...markers]
    .sort((a, b) => a.start - b.start)
    .find((marker) => marker.start > fromStep + 0.001);
}

export function previousMarker(markers: Marker[], fromStep: number): Marker | undefined {
  return [...markers]
    .sort((a, b) => b.start - a.start)
    .find((marker) => marker.start < fromStep - 0.001);
}

/** Loop range from a marker to the next one, or a musically useful default. */
export function markerLoopRange(
  markers: Marker[],
  id: string,
  fallbackEnd: number,
): { start: number; end: number } | null {
  const sorted = [...markers].sort((a, b) => a.start - b.start);
  const index = sorted.findIndex((marker) => marker.id === id);
  if (index < 0) return null;
  const start = sorted[index].start;
  const next = sorted[index + 1];
  const end = Math.max(start + 16, next?.start ?? fallbackEnd);
  return { start, end };
}
