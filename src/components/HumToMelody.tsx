import { useRef, useState } from 'react';
import { useApp } from '../store';
import { Modal } from '../ui/Modal';
import { HumRecorder, humToNotes, type HumResult } from '../audio/hum';

/**
 * Records a hummed line from the microphone, tracks the pitch and writes the
 * quantised result into the selected channel's piano roll.
 */
export function HumToMelody() {
  const open = useApp((s) => s.ui.humOpen);
  const bpm = useApp((s) => s.project.bpm);
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<HumResult | null>(null);
  const [notes, setNotes] = useState<{ pitch: number; start: number; len: number; vel: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<HumRecorder | null>(null);

  if (!open) return null;

  const close = () => {
    if (recorder.current) {
      recorder.current.stop();
      recorder.current = null;
    }
    setRecording(false);
    useApp.getState().setUI({ humOpen: false });
  };

  const start = async () => {
    setError(null);
    setResult(null);
    setNotes([]);
    try {
      const rec = new HumRecorder();
      await rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch (err) {
      console.error(err);
      setError('Microphone access was refused or no input device is available.');
    }
  };

  const stop = () => {
    if (!recorder.current) return;
    const res = recorder.current.stop();
    recorder.current = null;
    setRecording(false);
    setResult(res);
    setNotes(humToNotes(res, bpm, 1));
  };

  const insert = () => {
    const state = useApp.getState();
    const channelId = state.project.selectedChannel;
    if (!channelId) {
      state.toast('Select a channel first, then insert the melody');
      return;
    }
    if (!notes.length) return;
    state.addNotes(channelId, notes);
    state.setUI({ humOpen: false, tab: 'pianoroll' });
    state.toast(`${notes.length} notes written to the piano roll`);
  };

  return (
    <Modal
      title="Hum to Melody"
      subtitle="Sing or hum into the microphone — pitch and timing become notes"
      onClose={close}
      narrow
      footer={
        <>
          <span className="tiny-note">Recorded locally at {bpm} BPM; quantised to 1/16 notes.</span>
          <div className="spacer" />
          <button className="btn primary" onClick={insert} disabled={!notes.length || recording}>
            Insert {notes.length || ''} notes
          </button>
        </>
      }
    >
      <div className="hum">
        <div className={`hum-orb ${recording ? 'live' : ''}`}>
          <span />
        </div>
        <p className="hinttext">
          Hold a steady note per syllable. The tracker follows 65 Hz – 1 kHz and ignores breath noise, so a simple
          “doo-doo-doo” works better than words.
        </p>
        <div className="hum-actions">
          {!recording ? (
            <button className="btn primary" onClick={() => void start()}>
              Start recording
            </button>
          ) : (
            <button className="btn danger" onClick={stop}>
              Stop and transcribe
            </button>
          )}
          {recording && <span className="rec-pill">● recording</span>}
        </div>

        {error && <div className="mix-error">{error}</div>}

        {result && !recording && (
          <div className="hum-result">
            <div className="hum-stats">
              <div>
                <span>Captured</span>
                <b>{result.seconds.toFixed(1)}s</b>
              </div>
              <div>
                <span>Voiced frames</span>
                <b>{result.frames.filter((f) => f.hz > 0).length}</b>
              </div>
              <div>
                <span>Notes found</span>
                <b>{notes.length}</b>
              </div>
            </div>
            {notes.length === 0 ? (
              <p className="hinttext">
                Nothing confident enough to transcribe. Try humming louder and closer to the mic, and hold each note a
                little longer.
              </p>
            ) : (
              <div className="hum-notes">
                {notes.slice(0, 24).map((n, i) => (
                  <span key={i}>
                    {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][n.pitch % 12]}
                    {Math.floor(n.pitch / 12) - 1}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
