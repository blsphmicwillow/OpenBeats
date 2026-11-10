import { useRef, useState } from 'react';
import { useApp } from '../store';
import { Modal } from '../ui/Modal';

type Tab = 'import' | 'export';

const FORMATS = [
  {
    id: 'midi',
    name: 'MIDI',
    ext: '.mid',
    works: 'FL Studio · Ableton · Logic · Cubase · Studio One · Bitwig · REAPER',
    detail: 'Notes, tempo, track names and programs. The universal path into every DAW.',
  },
  {
    id: 'als',
    name: 'Ableton Live Set',
    ext: '.als',
    works: 'Ableton Live 10–12 — import only',
    detail: 'Reads MIDI tracks, session and arrangement clips, tempo and track names. Devices and audio clips are skipped.',
  },
  {
    id: 'rpp',
    name: 'REAPER project',
    ext: '.rpp',
    works: 'REAPER — import and export',
    detail: 'Plain-text project with tracks, MIDI items and tempo. Audio items and FX chains are not written.',
  },
] as const;

export function ExchangeDialog() {
  const open = useApp((s) => s.ui.exchangeOpen);
  const [tab, setTab] = useState<Tab>('import');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { setUI, importSongFile, exportMidi, exportRpp, saveProjectFile, exportWav, openProjectFile } = useApp.getState();

  if (!open) return null;

  const pick = () => fileRef.current?.click();

  return (
    <Modal
      title="Import / export song"
      subtitle="Move the arrangement between OpenBeats and other DAWs"
      onClose={() => setUI({ exchangeOpen: false })}
      footer={
        <>
          <span className="tiny-note">
            Notes, tempo and track names travel. Devices, automation and audio clips stay in the original DAW.
          </span>
          <div className="spacer" />
          <button className="btn" onClick={() => setUI({ exchangeOpen: false })}>
            Close
          </button>
        </>
      }
    >
      <div className="settings-tabs" style={{ marginBottom: 12 }}>
        <button className={`settings-tab ${tab === 'import' ? 'active' : ''}`} onClick={() => setTab('import')}>
          Import into OpenBeats
        </button>
        <button className={`settings-tab ${tab === 'export' ? 'active' : ''}`} onClick={() => setTab('export')}>
          Export from OpenBeats
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".mid,.midi,.smf,.als,.rpp,.obeats,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            await importSongFile(file);
          } finally {
            setBusy(false);
          }
        }}
      />

      {tab === 'import' && (
        <>
          <h3>Open a song</h3>
          <p className="hinttext">
            Pick a file and OpenBeats rebuilds it as channels, patterns and playlist clips. Everything is parsed locally —
            nothing is uploaded.
          </p>
          <div className="exchange-grid">
            {FORMATS.map((format) => (
              <button
                key={format.id}
                className="exchange-card"
                onClick={pick}
                disabled={busy}
                title={`Choose a ${format.ext} file`}
              >
                <div className="exchange-card-head">
                  <b>{format.name}</b>
                  <span className="exchange-badge">{format.ext}</span>
                </div>
                <small>{format.detail}</small>
                <span className="exchange-works">{format.works}</span>
              </button>
            ))}
            <button className="exchange-card" onClick={() => fileRef.current?.click()} disabled={busy}>
              <div className="exchange-card-head">
                <b>OpenBeats project</b>
                <span className="exchange-badge">.obeats</span>
              </div>
              <small>Reopen a native project with mixer, effects and theme settings intact.</small>
              <span className="exchange-works">OpenBeats</span>
            </button>
          </div>
          <p className="exchange-note">
            <b>FL Studio:</b> .flp is a proprietary binary format with plugin state, so it is not parsed directly. Export
            MIDI here and use <i>File → Import → MIDI</i> in FL Studio; every note, track and the tempo arrive. Exporting
            from FL Studio to OpenBeats works the same way.
          </p>
          <button className="btn primary" onClick={pick} disabled={busy}>
            {busy ? 'Reading…' : 'Choose a song file…'}
          </button>
        </>
      )}

      {tab === 'export' && (
        <>
          <h3>Send this song out</h3>
          <p className="hinttext">
            The arrangement is flattened onto a timeline: each channel becomes one track, notes keep their bar positions,
            and the project tempo is written into the file.
          </p>
          <div className="exchange-grid">
            <button className="exchange-card" onClick={() => void exportMidi()}>
              <div className="exchange-card-head">
                <b>Multi-track MIDI</b>
                <span className="exchange-badge">.mid</span>
              </div>
              <small>Type 1 MIDI with one track per channel — imports as separate tracks in FL Studio, Ableton, Logic, Cubase, Studio One, Bitwig and REAPER.</small>
              <span className="exchange-works">best universal option</span>
            </button>
            <button className="exchange-card" onClick={() => void exportRpp()}>
              <div className="exchange-card-head">
                <b>REAPER project</b>
                <span className="exchange-badge">.rpp</span>
              </div>
              <small>Native text project with tracks and MIDI items. Open it directly in REAPER.</small>
              <span className="exchange-works">REAPER</span>
            </button>
            <button className="exchange-card" onClick={() => void saveProjectFile()}>
              <div className="exchange-card-head">
                <b>OpenBeats project</b>
                <span className="exchange-badge">.obeats</span>
              </div>
              <small>The full session: channels, patterns, clips, mixer, effects, routing and settings.</small>
              <span className="exchange-works">OpenBeats</span>
            </button>
            <button className="exchange-card" onClick={() => void exportWav()}>
              <div className="exchange-card-head">
                <b>Audio bounce</b>
                <span className="exchange-badge">.wav</span>
              </div>
              <small>Render the song to audio, optionally normalised for a streaming target.</small>
              <span className="exchange-works">any DAW or editor</span>
            </button>
          </div>
          <p className="exchange-note">
            Ableton Live reads this MIDI as separate tracks (<b>Live accepts SMF type 1</b>). To go the other way, import
            the Live Set or export MIDI from Live and open it here.
          </p>
        </>
      )}
    </Modal>
  );
}
