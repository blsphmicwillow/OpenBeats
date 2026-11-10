import { useApp } from '../store';

export function HintBar() {
  const ui = useApp((s) => s.ui);
  const project = useApp((s) => s.project);
  const audioReady = useApp((s) => s.audioReady);
  const lastSaved = useApp((s) => s.lastSaved);
  const transport = useApp((s) => s.transport);
  const { setUI } = useApp.getState();

  return (
    <div className="hintbar">
      <span
        className={`led-dot ${audioReady ? '' : 'off'}`}
        title={audioReady ? 'Audio engine running' : 'Audio engine idle — click or press Space'}
        aria-hidden="true"
      />
      <span className="hint-main" role="status" aria-live="polite" aria-atomic="true">
        {ui.hint}
      </span>
      <span className="sr-only">{lastSaved ? `Last autosave ${new Date(lastSaved).toLocaleTimeString()}` : 'Not autosaved yet'}</span>
      <div className="hint-right">
        <span>
          {project.channels.length} ch · {project.patterns.length} pat · {project.clips.length} clips
        </span>
        <span>{transport.songMode ? 'song mode' : 'pattern mode'}</span>
        <span>{lastSaved ? `autosaved ${new Date(lastSaved).toLocaleTimeString()}` : 'not saved yet'}</span>
        <button className="tbtn small" onClick={() => setUI({ tutorialStep: 0 })} title="Replay the guided tour">
          Tutorial
        </button>
        <button className="tbtn small" onClick={() => setUI({ aboutOpen: true })} title="Manual (F1)">
          Help
        </button>
      </div>
    </div>
  );
}
