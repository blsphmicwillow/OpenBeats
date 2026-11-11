import { useEffect, useLayoutEffect, useState } from 'react';
import { useApp } from '../store';
import { APP_VERSION } from '../lib/version';
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
    title: `Welcome to OpenBeats ${APP_VERSION}`,
    body: (
      <>
        <p>
          This is an open-source beatmaking studio with a pattern-based workflow: channels feed a rack, patterns hold the
          notes, and the playlist arranges them into a song.
        </p>
        <p>
          A demo called <b>Neon Drift</b> is already loaded. Press <span className="kbd">Space</span> to hear it, then take
          this tour — Help ▸ Tutorial replays it any time.
        </p>
        <ul>
          <li>The desktop build runs its own Rust audio engine and plays a short chime on startup.</li>
          <li>Everything you change is autosaved, so a crash never loses the song.</li>
          <li>Nothing here is a copy of another studio: it is original GPL software.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Transport, tempo and mix',
    body: (
      <>
        <p>
          <b>PAT / SONG</b> switches between looping the current pattern and playing the playlist arrangement. Drag the
          tempo display (or scroll it) to change BPM, and use the swing knob for a shuffled feel.
        </p>
        <p>
          <b>Loop</b> follows the orange bar in the playlist, <b>Metro</b> adds a click, and the master knob sets the final
          level. <b>Bounce</b> opens the export dialog and renders faster than real time; <b>R</b> arms QWERTY recording.
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
          <b>Packs</b> holds imported samples above the built-in instruments. Single-click auditions on a preview stream
          that never interrupts playback, and double-click adds an instrument or loads a sample.
        </p>
        <p>
          The <b>Projects</b> tab saves and opens <span className="code">.obeats</span> songs; <b>Samples</b> lists your
          one-shots and drops. Search filters every tab at once.
        </p>
      </>
    ),
    target: '[data-tour="browser"]',
    needsBrowser: true,
  },
  {
    title: 'Packs and previews',
    body: (
      <>
        <p>
          <b>Import pack</b> takes a folder or a <span className="code">.zip</span>. OpenBeats scans it recursively and
          tags each sample from its name and folder — kick, snare, hat, 808, bass and more.
        </p>
        <p>
          Click a sample to hear it, double-click to load it as a channel. The ■ button stops the preview without touching
          the song.
        </p>
        <ul>
          <li>Previews decode wav, mp3, ogg, flac and m4a on every platform.</li>
          <li>The pack index is kept locally, so packs survive a restart.</li>
        </ul>
      </>
    ),
    target: '[data-tour="pack-import"]',
    needsBrowser: true,
  },
  {
    title: 'The Channel Rack',
    body: (
      <>
        <p>
          Every row is an instrument. Click the name to hear it, use <b>M</b> and <b>S</b> to mute or solo, and watch the
          thin meter for its level. The gear opens the instrument: preset, tone, envelope, transposition and routing.
        </p>
        <p>Right-click a row for clone, relink, unload, transpose and delete. <b>+ Channel</b> adds another one.</p>
      </>
    ),
    target: '[data-tour="rack"]',
  },
  {
    title: 'Ten new instruments',
    body: (
      <>
        <p>
          Beyond the classic drums and synths, the rack now ships ten original engines: <b>Anvil</b> (modelled drum),
          <b>Prism</b> (additive), <b>Sundial</b> (analog poly), <b>Cordwood</b> (physical string), <b>Vector Nine</b> (FM),
          <b>Acid Well</b> (resonant bass), <b>Dice</b> (generative), <b>Dust Devil</b> (granular), <b>Chatter</b>
          (formant voice) and <b>Hammer Felt</b> (felted piano).
        </p>
        <p>
          Audition them in the browser or pick one from the channel's Instrument menu. Tone, Decay, Attack and Release
          shape each engine. ENGINE: Web Audio only — the desktop build plays the closest native voice for these ten.
        </p>
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
          Change the pattern length next to the pattern name, and switch patterns to build sections. The top bar’s pattern
          menu clones or deletes them.
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
          to lengthen, right-click for clone and track moves.
        </p>
        <ul>
          <li>Drag the orange loop bar to set the loop; drag the playhead to scrub.</li>
          <li>Dragging near the left or right edge scrolls the timeline — clips, loop and playhead stay under the pointer.</li>
          <li>Tracks have mute, solo and a collapse switch; song mode plays the arrangement.</li>
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
          Choose a key and scale to shade safe notes, then use <b>Quantise</b> to tidy timing. The chips show the detected
          song key and the chord under the playhead. Dragging near an edge auto-scrolls the grid in both directions.
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
    title: 'Linked channels, chains and layouts',
    body: (
      <>
        <p>
          <b>Linked</b> in the rack creates a channel with its own playlist track and mixer strip. Right-click a channel
          and choose <b>Relink</b> to move it onto a fresh track and strip while its inserts, sends, gain, pan and group
          come along.
        </p>
        <p>
          On a mixer strip, <b>Chains</b> saves the insert chain as a template and recalls it on any other strip,
          including the master. In Settings ▸ Appearance, save panel sizes, browser state, the active view and collapsed
          groups as a named workspace layout; the View menu lists saved layouts and ticks the one in effect.
        </p>
      </>
    ),
    target: '[data-tour="mixer"]',
  },
  {
    title: 'Bounce, save and interchange',
    body: (
      <>
        <p>
          <b>Bounce</b> opens the export dialog: WAV 16/24-bit and FLAC render in the app, while MP3, OGG and M4A use
          ffmpeg, each with optional mastering. <b>Save</b> writes a portable{' '}
          <span className="code">.obeats</span> project with channels, patterns, clips and mixer state.
        </p>
        <p>
          File ▸ Import / export song… moves music through MIDI, and imports Live Set (.als) and REAPER (.rpp) projects.
          Projects autosave, and the Projects dialog reopens old songs.
        </p>
      </>
    ),
    target: '[data-tour="bounce"]',
  },
  {
    title: 'Audio, input and Dev Mode',
    body: (
      <>
        <p>
          Settings ▸ Audio picks the output device, low-latency mode, cue gain and a test tone. Below that, the input panel
          monitors a microphone, records a take to WAV and shows a tuner while you play.
        </p>
        <p>
          <b>Dev Mode</b> reveals raw device strings, host APIs, channel counts and sample rates. The other tabs hold
          appearance, accessibility, workflow and keyboard shortcuts.
        </p>
      </>
    ),
    target: '[data-tour="settings"]',
  },
  {
    title: 'Plugins, help and feedback',
    body: (
      <>
        <p>
          <b>Plugins</b> opens the VST3/CLAP library. <b>F1</b> opens the full manual and every shortcut; the same dialog
          hosts <b>Suggestions &amp; Fixes</b>, which sends a report with your OS and version.
        </p>
        <p>
          Help ▸ Check for updates compares your build with the newest GitHub release, and the Changelog tab keeps the
          notes offline.
        </p>
      </>
    ),
    target: '[data-tour="help"]',
  },
  {
    title: 'You are ready',
    body: (
      <>
        <p>
          Start from the demo or File ▸ New project. Save an <span className="code">.obeats</span> file to keep a song, and
          export audio when it is done.
        </p>
        <p>
          Try <span className="kbd">Ctrl</span>+<span className="kbd">K</span> for the command palette, and{' '}
          <span className="kbd">F11</span> for settings. The studio is GPL-3.0: read it, change it, share it. Have fun —
          and make something loud.
        </p>
      </>
    ),
  },
];

export function Tutorial() {
  const stepIndex = useApp((s) => s.ui.tutorialStep);
  const browserOpen = useApp((s) => s.ui.browserOpen);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // The browser panel is hidden on narrow screens, so drop its tour stops there.
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
  const tipWidth = Math.min(380, window.innerWidth - 24);
  const tipMax = Math.max(220, window.innerHeight - 24);
  let tipStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + 16;
    const above = rect.top - 16 - Math.min(320, tipMax);
    const top = below + 220 < window.innerHeight ? below : Math.max(12, above);
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - tipWidth / 2), window.innerWidth - tipWidth - 12);
    tipStyle = { top, left, width: tipWidth, maxHeight: tipMax };
  } else {
    tipStyle = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: tipWidth,
      maxHeight: tipMax,
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
