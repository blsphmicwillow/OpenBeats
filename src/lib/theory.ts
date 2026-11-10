/**
 * “Inspire Me”: deterministic four-chord progressions. No network, no model —
 * just voice-led triads and sevenths in the chosen key and mood, ready to drop
 * into the piano roll.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type Mode = 'minor' | 'major' | 'dorian' | 'mixolydian' | 'phrygian';
export type Mood = 'dark' | 'uplifting' | 'dreamy' | 'aggressive' | 'chill';

export interface ProgressionChord {
  /** MIDI pitches, low to high. */
  pitches: number[];
  /** Display name, e.g. “Cm7”. */
  name: string;
  /** Length in 16th steps. */
  len: number;
  start: number;
}

const SCALES: Record<Mode, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/** Scale degrees by mood; 0-indexed. */
const MOODS: Record<Mood, { bpm: number; degrees: number[][]; seventh: boolean }> = {
  dark: { bpm: 140, degrees: [[0, 5, 3, 4], [0, 3, 5, 4], [0, 6, 5, 4]], seventh: true },
  uplifting: { bpm: 126, degrees: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 5]], seventh: false },
  dreamy: { bpm: 96, degrees: [[0, 5, 3, 4], [0, 3, 0, 4], [0, 4, 5, 2]], seventh: true },
  aggressive: { bpm: 150, degrees: [[0, 1, 5, 6], [0, 6, 5, 6], [0, 3, 1, 6]], seventh: false },
  chill: { bpm: 88, degrees: [[0, 3, 5, 4], [0, 5, 1, 4], [0, 2, 5, 4]], seventh: true },
};

const QUALITY_MINOR = new Set([1, 2, 5]);
const QUALITY_MAJOR = new Set([0, 3, 4]);

function triad(root: number, degree: number, mode: Mode, seventh: boolean): number[] {
  const scale = SCALES[mode];
  const pick = (d: number) => {
    const octave = Math.floor(d / scale.length);
    return root + 12 * octave + scale[d % scale.length];
  };
  const base = degree;
  const notes = [pick(base), pick(base + 2), pick(base + 4)];
  if (seventh) notes.push(pick(base + 6));
  return notes;
}

/** Names a chord from the pitches actually generated, so quality can never drift. */
function chordName(pitches: number[], seventh: boolean): string {
  const letter = NOTE_NAMES[((pitches[0] % 12) + 12) % 12];
  const third = pitches[1] - pitches[0];
  const minor = third === 3 ? 'm' : '';
  if (!seventh) return `${letter}${minor}`;
  const seventhInterval = pitches[3] - pitches[0];
  if (third === 4 && seventhInterval === 11) return `${letter}maj7`;
  return `${letter}${minor}7`;
}

export interface InspireOptions {
  root: number;
  mode: Mode;
  mood: Mood;
  bars?: number;
  seed?: number;
}

/** Estimates the project key from note pitch classes with Krumhansl-style profiles. */
export function detectKey(notes: { pitch: number }[]): string | null {
  if (!notes.length) return null;
  const histogram = new Array(12).fill(0);
  for (const note of notes) histogram[((note.pitch % 12) + 12) % 12] += 1;
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  let best = { score: -Infinity, root: 0, mode: 'major' };
  for (const [profile, mode] of [[major, 'major'], [minor, 'minor']] as const) {
    for (let root = 0; root < 12; root += 1) {
      let score = 0;
      for (let i = 0; i < 12; i += 1) score += histogram[(root + i) % 12] * profile[i];
      if (score > best.score) best = { score, root, mode };
    }
  }
  return `${NOTE_NAMES[best.root]} ${best.mode}`;
}

export function generateProgression(opts: InspireOptions): { chords: ProgressionChord[]; bpm: number; scale: string } {
  const bars = opts.bars ?? 4;
  const mood = MOODS[opts.mood];
  const patterns = mood.degrees;
  const seed = opts.seed ?? Math.floor(Math.random() * 1e6);
  const degrees = patterns[seed % patterns.length];
  const chordLen = bars >= 4 ? 16 : 8;
  const chords: ProgressionChord[] = [];
  for (let i = 0; i < bars; i += 1) {
    const degree = degrees[i % degrees.length];
    const pitches = triad(opts.root, degree, opts.mode, mood.seventh);
    chords.push({
      pitches,
      name: chordName(pitches, mood.seventh),
      start: i * chordLen,
      len: chordLen,
    });
  }
  return {
    chords,
    bpm: mood.bpm,
    scale: `${NOTE_NAMES[opts.root % 12]} ${opts.mode}`,
  };
}

/** Converts the generated chords into piano-roll notes at a given velocity. */
export function progressionNotes(chords: ProgressionChord[], velocity = 0.8): { pitch: number; start: number; len: number; vel: number }[] {
  const notes: { pitch: number; start: number; len: number; vel: number }[] = [];
  for (const chord of chords) {
    for (const pitch of chord.pitches) {
      notes.push({ pitch, start: chord.start, len: Math.max(2, chord.len - 1), vel: velocity });
    }
  }
  return notes;
}

/** Simple bass root per chord, one octave below. */
export function bassLine(chords: ProgressionChord[]): { pitch: number; start: number; len: number; vel: number }[] {
  return chords.map((c) => ({
    pitch: Math.max(24, c.pitches[0] - 12),
    start: c.start,
    len: Math.max(2, c.len - 2),
    vel: 0.85,
  }));
}
