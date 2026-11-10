import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { Modal } from '../ui/Modal';
import { NOTE_NAMES, bassLine, generateProgression, progressionNotes, type Mode, type Mood } from '../lib/theory';

const MODES: Mode[] = ['minor', 'major', 'dorian', 'mixolydian', 'phrygian'];
const MOODS: { id: Mood; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'uplifting', label: 'Uplifting' },
  { id: 'dreamy', label: 'Dreamy' },
  { id: 'aggressive', label: 'Aggressive' },
  { id: 'chill', label: 'Chill' },
];

/** “Inspire Me”: four-chord progressions written straight into the piano roll. */
export function InspireDialog() {
  const open = useApp((s) => s.ui.inspireOpen);
  const [root, setRoot] = useState(9);
  const [mode, setMode] = useState<Mode>('minor');
  const [mood, setMood] = useState<Mood>('dark');
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1000));
  const [withBass, setWithBass] = useState(true);

  const progression = useMemo(
    () => generateProgression({ root, mode, mood, bars: 4, seed }),
    [root, mode, mood, seed],
  );

  if (!open) return null;

  const close = () => useApp.getState().setUI({ inspireOpen: false });

  const insert = () => {
    const state = useApp.getState();
    const channelId = state.project.selectedChannel;
    if (!channelId) {
      state.toast('Select a channel to receive the chords');
      return;
    }
    state.addNotes(channelId, progressionNotes(progression.chords));
    if (withBass) {
      const bass =
        state.project.channels.find((c) => /bass|sub/i.test(c.name)) ??
        state.project.channels.find((c) => c.preset === 'bass' || c.preset === 'sub');
      if (bass) state.addNotes(bass.id, bassLine(progression.chords));
    }
    state.setUI({ inspireOpen: false, tab: 'pianoroll' });
    state.toast(`${progression.chords.map((c) => c.name).join(' – ')} written to the piano roll`);
  };

  return (
    <Modal
      title="Inspire Me"
      subtitle="A four-chord progression in the key and mood you pick"
      onClose={close}
      narrow
      footer={
        <>
          <label className="checkline">
            <input type="checkbox" checked={withBass} onChange={(e) => setWithBass(e.target.checked)} />
            Add a root bass line
          </label>
          <div className="spacer" />
          <button className="btn ghost" onClick={() => setSeed(Math.floor(Math.random() * 1000))}>
            Shuffle
          </button>
          <button className="btn primary" onClick={insert}>
            Write to piano roll
          </button>
        </>
      }
    >
      <div className="inspire">
        <div className="inspire-controls">
          <label>
            Key
            <select className="select" value={root} onChange={(e) => setRoot(Number(e.target.value))}>
              {NOTE_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scale
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vibe
            <select className="select" value={mood} onChange={(e) => setMood(e.target.value as Mood)}>
              {MOODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="inspire-meta">
          Suggested tempo <b>{progression.bpm} BPM</b> · {progression.scale}
        </div>

        <div className="chord-row">
          {progression.chords.map((chord, i) => (
            <div className="chord" key={i}>
              <b>{chord.name}</b>
              <span>{chord.pitches.map((p) => NOTE_NAMES[p % 12]).join(' ')}</span>
              <em>bar {i + 1}</em>
            </div>
          ))}
        </div>

        <p className="hinttext">
          Chords land on bar lines with a one-step gap between them, so you can hear the changes immediately. Undo once
          removes the whole progression.
        </p>
      </div>
    </Modal>
  );
}
