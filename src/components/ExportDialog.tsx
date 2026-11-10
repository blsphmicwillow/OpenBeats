import { useState } from 'react';
import { songLengthSteps, stepsToSeconds } from '../audio/sequencer';
import { EXPORT_FORMATS, exportFormat, qualityLabel, type ExportFormatId } from '../lib/exportFormats';
import { MASTER_TARGETS, type MasterTarget } from '../lib/mastering';
import { isNative } from '../lib/native';
import { useApp } from '../store';
import { Modal } from '../ui/Modal';

export function ExportDialog() {
  const open = useApp((s) => s.ui.exportOpen);
  const exporting = useApp((s) => s.ui.exporting);
  const project = useApp((s) => s.project);
  const settings = useApp((s) => s.settings);
  const { setUI, exportSong } = useApp.getState();

  const [format, setFormat] = useState<ExportFormatId>('wav16');
  const [quality, setQuality] = useState(5);
  const [sampleRate, setSampleRate] = useState(44100);
  const [master, setMaster] = useState<MasterTarget>(settings.masterTarget);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const native = isNative();
  const chosen = exportFormat(format);
  const unavailable = !native && chosen.desktopOnly;
  const working = busy || Boolean(exporting);
  const profile = MASTER_TARGETS.find((target) => target.id === master) ?? MASTER_TARGETS[0];

  const length = songLengthSteps(project);
  const seconds = length * stepsToSeconds(1, project.bpm);
  const bars = Math.ceil(length / 16);
  const duration = `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

  const run = async () => {
    if (working || unavailable) return;
    setBusy(true);
    const ok = await exportSong({ format, quality, sampleRate, master });
    setBusy(false);
    if (ok) setUI({ exportOpen: false });
  };

  return (
    <Modal
      title="Export audio"
      subtitle="Render the arrangement offline, then encode it"
      onClose={() => setUI({ exportOpen: false })}
      footer={
        <>
          <span className="tiny-note">
            {bars} bar{bars === 1 ? '' : 's'} · ~{duration} · stereo · {sampleRate / 1000} kHz ·{' '}
            {profile.id === 'none' ? 'raw mix' : `${profile.name} mastering`}
          </span>
          <div className="spacer" />
          <button className="btn" onClick={() => setUI({ exportOpen: false })}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void run()} disabled={working || unavailable}>
            {working ? 'Rendering…' : `Export ${chosen.name}`}
          </button>
        </>
      }
    >
      <div className="export-grid" role="group" aria-label="File format">
        {EXPORT_FORMATS.map((option) => {
          const locked = !native && option.desktopOnly;
          return (
            <button
              key={option.id}
              type="button"
              className={`export-card ${format === option.id ? 'selected' : ''}`}
              aria-pressed={format === option.id}
              disabled={locked || working}
              title={locked ? 'Available in the desktop build' : `Export ${option.name}`}
              onClick={() => setFormat(option.id)}
            >
              <div className="export-card-head">
                <b>{option.name}</b>
                <span className="exchange-badge">{option.ext}</span>
              </div>
              <small>{option.detail}</small>
              {locked && <span className="exchange-works">desktop app only</span>}
            </button>
          );
        })}
      </div>

      <div className="export-fields">
        <div className="field">
          <div className="field-label">
            Sample rate
            <small>The render and the encoded file both use this rate.</small>
          </div>
          <div className="field-control">
            <select
              className="select"
              value={sampleRate}
              onChange={(e) => setSampleRate(Number(e.target.value))}
              disabled={working}
            >
              <option value="44100">44.1 kHz — music standard</option>
              <option value="48000">48 kHz — video and games</option>
            </select>
          </div>
        </div>

        <div className="field">
          <div className="field-label">
            Mastering
            <small>Applied to the offline render before encoding.</small>
          </div>
          <div className="field-control">
            <select
              className="select"
              value={master}
              onChange={(e) => setMaster(e.target.value as MasterTarget)}
              disabled={working}
            >
              {MASTER_TARGETS.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.id === 'none' ? 'None (raw mix)' : `${target.name} · ${target.lufs} LUFS`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {chosen.lossy && (
          <div className="field export-quality">
            <div className="field-label">
              Quality
              <small>{qualityLabel(format, quality)}</small>
            </div>
            <div className="field-control">
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={quality}
                aria-label="Encoder quality"
                disabled={working}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </div>
          </div>
        )}
      </div>

      <p className="exchange-note">
        {!native ? (
          <>
            The browser build writes <b>16-bit WAV</b> only. FLAC, MP3, OGG, M4A and 24-bit WAV are encoded by the desktop
            app.
          </>
        ) : chosen.lossy ? (
          <>
            <b>{chosen.name}</b> is encoded with <b>ffmpeg</b>, which must be on your PATH. Without it, export WAV or FLAC
            instead.
          </>
        ) : (
          <>
            <b>{chosen.name}</b> is encoded in the app — no extra tools, nothing uploaded. A native save dialog asks where
            to put the file.
          </>
        )}
      </p>
    </Modal>
  );
}
