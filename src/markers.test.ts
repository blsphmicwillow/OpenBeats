import { describe, expect, it } from 'vitest';
import { markerLoopRange, nextMarker, normalizeMarkers, previousMarker } from './model/markers';
import { parseRpp, writeRpp } from './lib/daw/rpp';

describe('arrangement markers', () => {
  it('normalizes old or malformed project data and sorts by position', () => {
    const markers = normalizeMarkers([
      { id: 'b', name: ' Chorus ', start: 64 },
      { id: 'a', name: '', start: -8 },
      { id: 'a', name: 'duplicate', start: 12 },
      { bad: true },
    ]);
    expect(markers).toEqual([
      { id: 'a', name: 'Marker', start: 0 },
      { id: 'b', name: 'Chorus', start: 64 },
    ]);
  });

  it('finds the next and previous marker without wrapping past the playhead', () => {
    const markers = normalizeMarkers([
      { id: 'intro', name: 'Intro', start: 0 },
      { id: 'drop', name: 'Drop', start: 32 },
      { id: 'outro', name: 'Outro', start: 96 },
    ]);
    expect(nextMarker(markers, 10)?.id).toBe('drop');
    expect(nextMarker(markers, 96)).toBeUndefined();
    expect(previousMarker(markers, 64)?.id).toBe('drop');
    expect(previousMarker(markers, 0)).toBeUndefined();
  });

  it('loops from a marker to the next marker, or a safe fallback', () => {
    const markers = normalizeMarkers([
      { id: 'intro', name: 'Intro', start: 0 },
      { id: 'drop', name: 'Drop', start: 32 },
    ]);
    expect(markerLoopRange(markers, 'intro', 128)).toEqual({ start: 0, end: 32 });
    expect(markerLoopRange(markers, 'drop', 128)).toEqual({ start: 32, end: 128 });
    expect(markerLoopRange(markers, 'missing', 128)).toBeNull();
  });

  it('round-trips markers through REAPER project interchange', () => {
    const text = writeRpp({
      name: 'Marker song',
      bpm: 120,
      source: 'rpp',
      markers: [
        { name: 'Intro', start: 0 },
        { name: 'Drop', start: 32 },
      ],
      tracks: [
        {
          name: 'Lead',
          notes: [{ pitch: 60, start: 0, len: 4, vel: 0.8 }],
        },
      ],
    });
    const parsed = parseRpp(text);
    expect(parsed.markers).toHaveLength(2);
    expect(parsed.markers?.[0]).toMatchObject({ name: 'Intro', start: 0 });
    expect(parsed.markers?.[1].name).toBe('Drop');
    expect(parsed.markers?.[1].start).toBeCloseTo(32, 6);
  });
});
