import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../store';
import {
  getAudioDevices,
  nativeInputStatus,
  nativeSetInputMonitor,
  nativeStartInput,
  nativeStartInputRecording,
  nativeStopInput,
  nativeStopInputRecording,
  type AudioDevices,
  type NativeInputReading,
} from '../lib/nativeAudio';
import { friendlyDeviceName, readDevMode, writeDevMode } from '../lib/deviceNames';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function noteName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Input monitoring, one-take recording and the tuner, plus the Dev Mode view. */
export function InputPanel() {
  const toast = useApp((s) => s.ui.toast);
  const audio = useApp((s) => s.settings.audio);
  const patchSettings = useApp((s) => s.patchSettings);
  const [devices, setDevices] = useState<AudioDevices>({ inputs: [], outputs: [] });
  const [open, setOpen] = useState(false);
  const [monitor, setMonitor] = useState(false);
  const [recording, setRecording] = useState(false);
  const [reading, setReading] = useState<NativeInputReading | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(readDevMode);
  const [draftDevice, setDraftDevice] = useState(audio.inputId ?? '');
  const device = audio.inputId ?? '';
  const gain = audio.monitorGain;

  useEffect(() => {
    setDraftDevice(audio.inputId ?? '');
  }, [audio.inputId]);

  const refreshInputs = useCallback(async () => {
    const list = await getAudioDevices();
    setDevices(list);
  }, []);

  useEffect(() => {
    void refreshInputs();
  }, [refreshInputs]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => {
      void nativeInputStatus().then(setReading);
    }, 120);
    return () => window.clearInterval(id);
  }, [open]);

  const toggleDevMode = (value: boolean) => {
    setDevMode(value);
    writeDevMode(value);
  };

  const openInput = useCallback(async (): Promise<boolean> => {
    if (open) return true;
    try {
      const name = await nativeStartInput(device || undefined);
      setOpen(Boolean(name));
      setNote(
        name ? `Listening on ${devMode ? name : friendlyDeviceName(name)}` : 'Input needs the desktop build.',
      );
      return Boolean(name);
    } catch (err) {
      setOpen(false);
      setNote(errorText(err));
      return false;
    }
  }, [open, device, devMode]);

  const toggleMonitor = async () => {
    if (!(await openInput())) return;
    const next = !monitor;
    try {
      await nativeSetInputMonitor(next, gain);
      setMonitor(next);
      setNote(next ? 'Monitoring the input — headphones recommended.' : 'Monitoring off.');
    } catch (err) {
      setNote(errorText(err));
    }
  };

  const toggleRecord = async () => {
    if (!recording) {
      if (!(await openInput())) return;
      try {
        const started = await nativeStartInputRecording();
        setRecording(started);
        setNote(started ? 'Recording the input…' : 'Recording needs the desktop build.');
      } catch (err) {
        setNote(errorText(err));
      }
      return;
    }
    try {
      const take = await nativeStopInputRecording();
      setRecording(false);
      setNote(take ? `Saved ${take.seconds.toFixed(1)}s to ${take.path}` : 'No take was captured.');
    } catch (err) {
      setRecording(false);
      setNote(errorText(err));
    }
  };

  const inputs = devices.inputs;
  const tuning = reading?.tuning ?? null;
  const savedMissing = Boolean(device) && !inputs.some((input) => input.id === device);
  const inputPending = draftDevice !== device;

  const saveInput = async () => {
    if (recording) {
      setNote('Stop the take before switching input.');
      return;
    }
    patchSettings({
      audio: { ...useApp.getState().settings.audio, inputId: draftDevice || null },
    });
    setOpen(false);
    setMonitor(false);
    await nativeStopInput();
    setNote(draftDevice ? 'Input device saved — reopen Monitor or Record to use it.' : 'Using the system default input.');
  };

  return (
    <>
      <div className="field">
        <div className="field-label">
          Input device
          <small>
            {inputs.length === 0
              ? 'No input device was reported.'
              : inputPending
                ? 'Unsaved input — press Save to use it.'
                : savedMissing
                  ? 'The saved input is unavailable; choose another device and press Save.'
                  : `${inputs.length} input${inputs.length === 1 ? '' : 's'} available`}
          </small>
        </div>
        <div className="field-control" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="text-input"
            style={{ flex: 1 }}
            value={draftDevice}
            onMouseDown={() => void refreshInputs()}
            onChange={(e) => {
              setDraftDevice(e.target.value);
              setNote('Unsaved input — press Save to use it.');
            }}
            aria-label="Input device"
            disabled={inputs.length === 0}
          >
            {inputs.length === 0 && <option value="">No inputs found</option>}
            <option value="">System default</option>
            {savedMissing && (
              <option value={device}>{audio.inputId} · unavailable</option>
            )}
            {inputs.map((d) => (
              <option key={d.id} value={d.id}>
                {devMode ? d.id : d.friendly_name}
                {d.is_default ? ' · default' : ''}
              </option>
            ))}
          </select>
          <button
            className="btn primary"
            onClick={() => void saveInput()}
            disabled={!inputPending || recording}
          >
            Save
          </button>
        </div>
      </div>

      <div className="field">
        <div className="field-label">
          Monitor input
          <small>Routes the input to the master output. Use headphones to avoid feedback.</small>
        </div>
        <div className="field-control" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className={`btn ${monitor ? 'primary' : 'ghost'}`} onClick={() => void toggleMonitor()}>
            {monitor ? 'Monitoring' : 'Monitor'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={gain}
            onChange={(e) => {
              const value = Number(e.target.value);
              patchSettings({
                audio: { ...useApp.getState().settings.audio, monitorGain: value },
              });
              if (monitor) {
                void nativeSetInputMonitor(true, value).catch((err) => setNote(errorText(err)));
              }
            }}
            aria-label="Monitor level"
            style={{ flex: 1 }}
          />
          <span className="tiny-note">{Math.round(gain * 100)}%</span>
        </div>
      </div>

      <div className="field">
        <div className="field-label">
          Record a take
          <small>Captures the input as a 16-bit WAV; the file is saved wherever you choose.</small>
        </div>
        <div className="field-control" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className={`btn ${recording ? 'primary' : ''}`} onClick={() => void toggleRecord()}>
            {recording ? 'Stop & save' : 'Record input'}
          </button>
          <div style={{ flex: 1, height: 8, background: 'var(--panel3)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, (reading?.peak ?? 0) * 120)}%`,
                height: '100%',
                background: (reading?.peak ?? 0) > 0.95 ? '#e2725b' : 'var(--accent)',
                transition: 'width 80ms linear',
              }}
            />
          </div>
          {tuning && (
            <span className="tiny-note" style={{ minWidth: 96, textAlign: 'right' }}>
              {noteName(tuning.midi)} {tuning.cents >= 0 ? '+' : ''}
              {tuning.cents.toFixed(0)}¢
            </span>
          )}
        </div>
      </div>

      <div className="field">
        <div className="field-label">
          Dev Mode
          <small>Show host-qualified device IDs, including WASAPI, ASIO, CoreAudio and ALSA names.</small>
        </div>
        <div className="field-control">
          <input type="checkbox" checked={devMode} onChange={(e) => toggleDevMode(e.target.checked)} />
        </div>
      </div>

      {devMode && (
        <div className="browser-empty" style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 1.6 }}>
          {devices.inputs.map((d) => (
            <div key={`input:${d.id}`}>
              [input] {d.friendly_name} · {d.id}
              {d.is_default ? ' · default' : ''}
            </div>
          ))}
          {devices.outputs.map((d) => (
            <div key={`output:${d.id}`}>
              [output] {d.friendly_name} · {d.id}
              {d.is_default ? ' · default' : ''}
            </div>
          ))}
          {reading && (
            <div>
              rms {reading.rms.toFixed(4)} · peak {reading.peak.toFixed(4)} · {reading.recording ? 'recording' : 'idle'}
            </div>
          )}
        </div>
      )}

      {note && <div className="tiny-note">{note}</div>}
      {!note && toast && <div className="tiny-note">{toast}</div>}
    </>
  );
}
