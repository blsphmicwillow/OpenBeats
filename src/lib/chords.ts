/**
 * Chord naming for the piano roll.
 *
 * Mirrors the Rust implementation in
 * `src-tauri/crates/openbeats-audio/src/chord.rs` so the label the user sees
 * matches what the native engine reports.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Chord templates: semitone offsets from the root. */
const TEMPLATES: Array<{ suffix: string; offsets: number[] }> = [
  { suffix: '', offsets: [0, 4, 7] },
  { suffix: 'm', offsets: [0, 3, 7] },
  { suffix: '7', offsets: [0, 4, 7, 10] },
  { suffix: 'maj7', offsets: [0, 4, 7, 11] },
  { suffix: 'm7', offsets: [0, 3, 7, 10] },
  { suffix: 'dim', offsets: [0, 3, 6] },
  { suffix: 'aug', offsets: [0, 4, 8] },
  { suffix: 'sus2', offsets: [0, 2, 7] },
  { suffix: 'sus4', offsets: [0, 5, 7] },
];

export interface ChordName {
  /** e.g. "Am", "C#dim", "Fmaj7". */
  name: string;
  root: number;
  quality: string;
  bass: string;
}

/**
 * Names the chord for a set of MIDI pitches. Returns null for fewer than two
 * distinct pitch classes, which cannot name a chord.
 */
export function chordFor(pitches: number[]): ChordName | null {
  if (pitches.length === 0) return null;
  const classes = Array.from(new Set(pitches.map((p) => ((p % 12) + 12) % 12))).sort((a, b) => a - b);
  if (classes.length < 2) return null;

  const lowest = Math.min(...pitches);
  const bass = NOTE_NAMES[((lowest % 12) + 12) % 12];

  let best: { score: number; root: number; suffix: string } | null = null;
  for (let root = 0; root < 12; root += 1) {
    for (const template of TEMPLATES) {
      if (template.offsets.length !== classes.length) continue;
      const matches = template.offsets.every((offset) => classes.includes((root + offset) % 12));
      if (!matches) continue;
      const score =
        template.offsets.length * 2 +
        (classes.includes(root) ? 1 : 0) +
        (root === ((lowest % 12) + 12) % 12 ? 1 : 0);
      if (!best || score > best.score) best = { score, root, suffix: template.suffix };
    }
  }
  if (!best) return null;

  return {
    name: `${NOTE_NAMES[best.root]}${best.suffix}`,
    root: best.root,
    quality: best.suffix,
    bass,
  };
}

/**
 * Pitches sounding at `step` for a note list, using the same exclusive end
 * rule as the Rust sequencer.
 */
export function chordAtStep(
  notes: Array<{ pitch: number; start: number; len: number }>,
  step: number,
): ChordName | null {
  const sounding = notes
    .filter((note) => step >= note.start && step < note.start + note.len)
    .map((note) => note.pitch);
  return chordFor(sounding);
}
