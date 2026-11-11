import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { Modal } from '../ui/Modal';

const STORAGE_KEY = 'openbeats.learn.v1';

type LearnAction = 'play' | 'rack' | 'playlist' | 'pianoroll' | 'mixer' | 'browser' | 'bounce' | 'new' | 'tour';

interface LearnModule {
  id: string;
  title: string;
  eyebrow: string;
  summary: string;
  steps: string[];
  action: LearnAction;
  actionLabel: string;
}

const MODULES: LearnModule[] = [
  {
    id: 'start',
    title: 'Start here',
    eyebrow: 'Orientation',
    summary: 'Learn the four places you will use most: the transport, Channel Rack, playlist and piano roll. Nothing is hidden behind a right-click-only menu.',
    steps: [
      'Press Space to play or stop. The status bar and playhead are your clock.',
      'Use the Channel Rack to choose an instrument and draw a first pattern.',
      'Use the Playlist to arrange pattern and audio clips into a song.',
      'Use Bounce when you want a finished audio file.',
    ],
    action: 'play',
    actionLabel: 'Start the transport',
  },
  {
    id: 'rack',
    title: 'Channel Rack',
    eyebrow: 'Instruments',
    summary: 'The rack is where a beat begins. Each channel is an instrument with its own mixer route, envelope, tone and step pattern.',
    steps: [
      'Pick a preset such as Kick, Glass Keys, Velvet Choir or FM Bass.',
      'Click steps in the grid to place notes. Right-click a channel for cloning and clearing.',
      'Use Mute and Solo while auditioning parts.',
      'Open the channel settings to shape attack, decay, tone and release.',
    ],
    action: 'rack',
    actionLabel: 'Go to the rack',
  },
  {
    id: 'piano',
    title: 'Piano roll',
    eyebrow: 'Melody & harmony',
    summary: 'The piano roll is the precise editor for the selected pattern. The Channel Rack grid and piano roll edit the same notes.',
    steps: [
      'Draw a note by clicking an empty pitch row.',
      'Drag the right edge of a note to change its length.',
      'Drag velocity bars to make the performance less mechanical.',
      'Use the scale display to keep melodies in key.',
    ],
    action: 'pianoroll',
    actionLabel: 'Open piano roll',
  },
  {
    id: 'playlist',
    title: 'Playlist',
    eyebrow: 'Arrangement',
    summary: 'The playlist is the song canvas. Pattern clips repeat musical ideas; audio clips bring in samples and recordings.',
    steps: [
      'Double-click an empty lane to paint the current pattern.',
      'Drag clips to move them, or drag the right edge to resize.',
      'Use Split at the playhead to cut a clip, and Ctrl/Cmd+C/X/V to rearrange it.',
      'Drag the ruler to scrub; use the orange loop bar for a section loop.',
    ],
    action: 'playlist',
    actionLabel: 'Open playlist',
  },
  {
    id: 'mixer',
    title: 'Mixer & effects',
    eyebrow: 'Balance',
    summary: 'Every channel feeds a mixer strip. Set levels, pan, sends and insert effects, then route strips into buses or the master.',
    steps: [
      'Start with faders and pan; leave headroom before adding processing.',
      'Add an EQ and compressor to the master or a bus.',
      'Use a 100% wet reverb strip as a send shared by several channels.',
      'Try Chorus, Tremolo, Auto Pan or Ring Mod on a synth or drum bus.',
    ],
    action: 'mixer',
    actionLabel: 'Open mixer',
  },
  {
    id: 'sounds',
    title: 'Samples & browser',
    eyebrow: 'Sound library',
    summary: 'The browser previews one-shots and packs without stopping the song. Imported samples become sampler channels or playlist audio clips.',
    steps: [
      'Drop a WAV, MP3, OGG or FLAC anywhere on the studio to create a sampler channel.',
      'Drop audio onto a playlist lane to create an audio clip.',
      'Click a browser sample to audition it, then double-click to load it.',
      'Use Import Pack for folders or zipped sample collections.',
    ],
    action: 'browser',
    actionLabel: 'Open browser',
  },
  {
    id: 'export',
    title: 'Save, bounce & share',
    eyebrow: 'Finish a track',
    summary: 'Save the editable project as .obeats, bounce audio, or exchange MIDI and REAPER projects with another studio.',
    steps: [
      'Save early with Ctrl/Cmd+S so the project can be reopened.',
      'Use Bounce for WAV or FLAC; MP3, OGG and M4A need ffmpeg.',
      'Check the master meter and leave a little headroom before export.',
      'Use Import / export song for MIDI, Ableton or REAPER interchange.',
    ],
    action: 'bounce',
    actionLabel: 'Open bounce',
  },
  {
    id: 'first-song',
    title: 'Your first song',
    eyebrow: 'Guided path',
    summary: 'A short, complete path from silence to a bounced track. Follow the steps in order; you can return to Learn at any time.',
    steps: [
      'Start a blank project and set a tempo you can nod to.',
      'Make a drum pattern in the Channel Rack, then a bass or chord pattern.',
      'Open the Playlist and arrange a loop, then a second section.',
      'Balance the mixer and add one effect that supports the song.',
      'Bounce a WAV, listen away from the screen, and revise one thing.',
    ],
    action: 'new',
    actionLabel: 'Start a blank project',
  },
];

function readProgress(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeProgress(value: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage can be unavailable in private windows */
  }
}

export function LearnDialog() {
  const setUI = useApp((s) => s.setUI);
  const [done, setDone] = useState<Record<string, boolean>>(readProgress);
  const [activeId, setActiveId] = useState(() => MODULES.find((item) => !readProgress()[item.id])?.id ?? MODULES[0].id);
  const active = MODULES.find((item) => item.id === activeId) ?? MODULES[0];
  const completed = useMemo(() => MODULES.filter((item) => done[item.id]).length, [done]);
  const allDone = completed === MODULES.length;

  const close = () => setUI({ learnOpen: false });

  const run = () => {
    const state = useApp.getState();
    switch (active.action) {
      case 'play':
        close();
        state.togglePlay();
        break;
      case 'rack':
        close();
        state.setUI({ tab: 'playlist', browserOpen: false });
        state.hint('Channel Rack: pick a sound, then click steps to make a pattern.');
        break;
      case 'playlist':
        close();
        state.setUI({ tab: 'playlist' });
        break;
      case 'pianoroll':
        close();
        state.setUI({ tab: 'pianoroll' });
        break;
      case 'mixer':
        close();
        state.setUI({ tab: 'mixer' });
        break;
      case 'browser':
        close();
        state.setUI({ browserOpen: true });
        break;
      case 'bounce':
        close();
        state.setUI({ exportOpen: true });
        break;
      case 'new':
        close();
        state.newProject('blank');
        break;
      case 'tour':
        close();
        state.setUI({ tutorialStep: 0 });
        break;
    }
  };

  const toggleDone = () => {
    const next = { ...done, [active.id]: !done[active.id] };
    setDone(next);
    writeProgress(next);
  };

  const reset = () => {
    setDone({});
    writeProgress({});
  };

  return (
    <Modal
      title="OpenBeats Learn"
      subtitle={`${completed}/${MODULES.length} modules complete · saved on this device`}
      onClose={close}
      footer={
        <>
          <span className="tiny-note">Learn is local: no account, no upload, no network calls.</span>
          <div className="spacer" />
          {completed > 0 && (
            <button className="btn ghost" onClick={reset}>
              Reset progress
            </button>
          )}
          <button className="btn ghost" onClick={() => setUI({ learnOpen: false, tutorialStep: 0 })}>
            Start guided tour
          </button>
          <button className="btn primary" onClick={toggleDone}>
            {done[active.id] ? 'Mark incomplete' : 'Mark complete'}
          </button>
        </>
      }
    >
      <div className="learn-layout">
        <nav className="learn-side" aria-label="Learn modules">
          <div className="learn-progress" aria-label={`${completed} of ${MODULES.length} complete`}>
            <span style={{ width: `${(completed / MODULES.length) * 100}%` }} />
          </div>
          {MODULES.map((item, index) => (
            <button
              key={item.id}
              className={`learn-tab ${item.id === active.id ? 'active' : ''} ${done[item.id] ? 'done' : ''}`}
              aria-current={item.id === active.id ? 'page' : undefined}
              onClick={() => setActiveId(item.id)}
            >
              <span className="learn-index">{done[item.id] ? '✓' : String(index + 1).padStart(2, '0')}</span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.eyebrow}</small>
              </span>
            </button>
          ))}
        </nav>
        <article className="learn-content">
          <div className="learn-eyebrow">{active.eyebrow}</div>
          <h3>{active.title}</h3>
          <p className="learn-summary">{active.summary}</p>
          <ol className="learn-steps">
            {active.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="learn-action">
            <button className="btn primary" onClick={run}>
              {active.actionLabel}
            </button>
            {allDone && <span className="tiny-note">All modules marked complete. Keep making things.</span>}
          </div>
          <div className="learn-tip">
            <strong>Tip</strong>
            <span>
              The guided tour is the fast version. Learn is the reference you can return to while working on a real song.
            </span>
          </div>
        </article>
      </div>
    </Modal>
  );
}
