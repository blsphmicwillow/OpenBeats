import { useEffect, useLayoutEffect, useState } from 'react';
import { useApp } from '../store';
import type { WorkspaceTab } from '../model/types';

interface Step {
  title: string;
  body: React.ReactNode;
  target?: string;
  tab?: WorkspaceTab;
  needsBrowser?: boolean;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to OpenBeats',
    body: (
      <>
        <p>
          This is an open-source beatmaking studio with a pattern-based workflow: channels feed a rack, patterns hold the
          notes, and the playlist arranges them into a song.
        </p>
        <p>
          A demo called <b>Neon Drift</b> is already loaded. Press <span className="kbd">Space</span> to hear it, then take
          this two-minute tour — you can replay it any time from Help.
        </p>
        <ul>
          <li>The engine starts on your first click or key press.</li>
          <li>Everything you change is autosaved in this browser.</li>
          <li>Nothing here is a copy of another DAW: it is original GPL software.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Transport and tempo',
    body: (
      <>
        <p>
          <b>PAT / SONG</b> switches between looping the current pattern and playing the playlist arrangement. Drag the
          tempo display (or scroll it) to change BPM, and use the swing knob for a shuffled feel.
        </p>
        <p>
          <b>Bounce</b> renders the whole song to a WAV file faster than real time. <b>R</b> arms recording so the QWERTY
          keys write notes while the song rolls.
        </p>
      </>
    ),
    target: '[data-tour="transport"]',
  },
  {
    title: 'The browser',
    body: (
      <>
        <p>
          Packs are built-in instruments — click one to audition it, double-click to add it as a channel. The Projects tab
          saves and opens <span className="code">.obeats</span> files, and Samples lets you import your own one-shots.
        </p>
        <p>Search filters the pack list, so a full library stays usable.</p>
      </>
    ),
    target: '[data-tour="browser"]',
    needsBrowser: true,
  },
  {
    title: 'The Channel Rack',
    body: (
      <>
        <p>
          Every row is an instrument. Click the name to hear it, use <b>M</b> and <b>S</b> to mute or solo, and watch the
          thin meter for its level. The gear opens the instrument: preset, tone, envelope, transposition and mixer routing.
        </p>
        <p>Right-click a row for clone, unload, transpose and delete.</p>
      </>
    ),
    target: '[data-tour="rack"]',
  },
  {
    title: 'Step sequencing',
    body: (
      <>
        <p>
          These squares are the selected pattern. Click to place a note, right-click to clear the channel. Each step
          writes a real note, so it appears in the piano roll too — the two are the same data.
        </p>
        <p>
          Change the pattern length next to the pattern name, and switch patterns to build sections. <b>+ Channel</b> adds
          another instrument.
        </p>
      </>
    ),
    target: '[data-tour="steps"]',
  },
  {
    title: 'The Playlist',
    body: (
      <>
        <p>
          Double-click an empty lane to paint the selected pattern as a clip. Drag clips to arrange, drag their right edge
          to lengthen, right-click for clone and track moves. Double-click a clip to edit its notes.
        </p>
        <ul>
          <li>Click the ruler to move the playhead; drag the orange loop bar to set the loop.</li>
          <li>Tracks have mute, solo and a collapse switch.</li>
          <li>Song mode plays this arrangement from top to bottom.</li>
        </ul>
      </>
    ),
    target: '[data-tour="playlist"]',
    tab: 'playlist',
  },
  {
    title: 'The Piano Roll',
    body: (
      <>
        <p>
          Click the grid to draw notes with the current length, drag a note to move it, drag its right edge to resize, and
          double-click to delete. The velocity lane at the bottom shapes how hard each note hits.
        </p>
        <p>
          Choose a key and scale to shade the safe notes, then use <b>Quantise</b> to tidy timing. <b>+1 / −1</b> transposes
          the channel instantly.
        </p>
      </>
    ),
    target: '[data-tour="pianoroll"]',
    tab: 'pianoroll',
  },
  {
    title: 'The Mixer',
    body: (
      <>
        <p>
          Each channel feeds an insert strip with a fader, pan, mute/solo and an insert chain. The demo routes drums to a
          <b> Drums Bus</b> and the music to a <b>Music Bus</b>; both then feed the master.
        </p>
        <p>
          Click a strip to edit its chain below: EQ, compressor, delay, reverb, drive and filter. Add a send to share one
          reverb across several strips. Routing is free-form — OpenBeats refuses routes that would feed back.
        </p>
      </>
    ),
    target: '[data-tour="mixer"]',
    tab: 'mixer',
  },
  {
    title: 'Make it yours',
    body: (
      <>
        <p>
          Settings holds six built-in themes, an editable custom theme, accent overrides, interface scale and every
          shortcut. The Open source tab exports your settings and explains the license.
        </p>
        <p>
          Press <span className="kbd">F1</span> any time for the full manual, or <span className="kbd">F11</span> for
          settings.
        </p>
      </>
    ),
    target: '[data-tour="settings"]',
  },
  {
    title: 'You are ready',
    body: (
      <>
        <p>
          Start from the demo or File ▸ New project. Save an <span className="code">.obeats</span> file to keep a song, and
          bounce a WAV when it is done.
        </p>
        <p>
          The studio is GPL-3.0: read it, change it, share it. Have fun — and make something loud.
        </p>
      </>
    ),
  },
];

export function Tutorial() {
  const stepIndex = useApp((s) => s.ui.tutorialStep);
  const browserOpen = useApp((s) => s.ui.browserOpen);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // The browser panel is hidden on narrow screens, so drop its tour stop there.
  const steps = STEPS.filter((s) => !s.needsBrowser || window.innerWidth > 1020);
  const step = stepIndex === null ? null : steps[Math.min(stepIndex, steps.length - 1)];

  useEffect(() => {
    if (stepIndex === null || !step) return;
    const state = useApp.getState();
    if (step.needsBrowser && !state.ui.browserOpen) state.setUI({ browserOpen: true });
    if (step.tab) state.setUI({ tab: step.tab });
  }, [stepIndex, step]);

  useLayoutEffect(() => {
    if (!step) return;
    let frame = 0;
    const measure = () => {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(step.target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const timer = window.setTimeout(measure, 90);
    frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [step, browserOpen, stepIndex]);

  const finish = () => {
    useApp.getState().patchSettings({ tutorialDone: true });
    useApp.getState().setUI({ tutorialStep: null, tab: 'playlist' });
    useApp.getState().hint('Tour finished — Help ▸ Tutorial replays it any time.');
  };

  const go = (delta: number) => {
    if (stepIndex === null) return;
    const next = stepIndex + delta;
    if (next < 0) return;
    if (next >= steps.length) finish();
    else useApp.getState().setUI({ tutorialStep: next });
  };

  useEffect(() => {
    if (stepIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!step || stepIndex === null) return null;

  const pad = 5;
  const tipWidth = 366;
  let tipStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + 16;
    const above = rect.top - 16 - 210;
    const top = below + 200 < window.innerHeight ? below : Math.max(12, above);
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - tipWidth / 2), window.innerWidth - tipWidth - 12);
    tipStyle = { top, left, width: tipWidth };
  } else {
    tipStyle = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: tipWidth,
    };
  }

  return (
    <>
      <div className="tour-backdrop" />
      {rect && (
        <div
          className="tour-spot"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      )}
      <div className="tour-tip" style={tipStyle} role="dialog" aria-live="polite">
        <h3>
          {step.title}
          <span className="step-count">
            {stepIndex + 1}/{steps.length}
          </span>
        </h3>
        {step.body}
        <div className="tour-actions">
          <div className="tour-dots">
            {steps.map((_, i) => (
              <i key={i} className={i === stepIndex ? 'on' : ''} />
            ))}
          </div>
          {stepIndex > 0 && (
            <button className="btn ghost" onClick={() => go(-1)} title="Previous (←)">
              Back
            </button>
          )}
          <button className="btn ghost" onClick={finish} title="Skip (Esc)">
            Skip
          </button>
          <button className="btn primary" onClick={() => go(1)} title="Next (→ or Enter)">
            {stepIndex === steps.length - 1 ? 'Start making beats' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}
