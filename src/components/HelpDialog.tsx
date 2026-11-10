import { useState } from 'react';
import { useApp } from '../store';
import { Modal } from '../ui/Modal';
import { KEY_ACTION_LABELS } from '../ui/keymapLabels';
import { nativeSubmitSuggestion } from '../lib/nativeAudio';
import { APP_VERSION } from '../lib/version';
import type { KeyAction } from '../model/types';

function SuggestionsDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async () => {
    if (text.trim().length < 4) {
      setError('Please write a little more so the report is useful.');
      setStatus('error');
      return;
    }
    setStatus('sending');
    setError('');
    try {
      const sent = await nativeSubmitSuggestion(text.trim());
      if (sent) {
        setStatus('sent');
        setText('');
      } else {
        setStatus('error');
        setError('Sending failed — the desktop build is required to post a report.');
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      title="Suggestions & Fixes"
      subtitle={`Sent from OpenBeats ${APP_VERSION} · includes your OS and app version`}
      onClose={onClose}
      footer={
        <>
          <span className="tiny-note">Be kind and specific: what you expected, what happened, and the steps.</span>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Send report'}
          </button>
        </>
      }
    >
      <div className="settings-pane" style={{ padding: 0 }}>
        <p className="hinttext">
          Found a bug or want a feature? This posts a message to the OpenBeats community inbox. Nothing else about your
          project is uploaded.
        </p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (status !== 'sending') setStatus('idle');
          }}
          placeholder="e.g. The pack import skips .flac files in subfolders…"
          rows={7}
          maxLength={1800}
          style={{ width: '100%', resize: 'vertical' }}
        />
        <div className="tiny-note" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{text.trim().length}/1800</span>
          {status === 'sent' && <span style={{ color: 'var(--accent)' }}>Sent — thank you!</span>}
          {status === 'error' && <span style={{ color: '#e2725b' }}>{error}</span>}
        </div>
      </div>
    </Modal>
  );
}

export function HelpDialog() {
  const open = useApp((s) => s.ui.aboutOpen);
  const keymap = useApp((s) => s.settings.keymap);
  const { setUI } = useApp.getState();
  const [suggestions, setSuggestions] = useState(false);
  if (!open) return null;

  return (
    <>
      <Modal
        title="OpenBeats manual"
        subtitle={`Version ${APP_VERSION} · GPL-3.0 · an original open-source studio`}
        onClose={() => setUI({ aboutOpen: false })}
        footer={
          <>
            <span className="tiny-note">Press Esc to close. The tutorial replays from Help ▸ Tutorial.</span>
            <div className="spacer" />
            <button className="btn ghost" onClick={() => setSuggestions(true)}>
              Suggestions & Fixes
            </button>
            <button
              className="btn primary"
              onClick={() => setUI({ aboutOpen: false, tutorialStep: 0 })}
            >
              Replay the tour
            </button>
          </>
        }
      >
        <div className="manual">
          <h4>First beat in one minute</h4>
          <ul>
            <li>Press <span className="code">Space</span> to start the demo, or File ▸ New project for silence.</li>
            <li>Click steps in the Channel Rack to place drums in the selected pattern.</li>
            <li>Double-click an empty playlist lane to paint that pattern into the arrangement.</li>
            <li>Switch to Song mode and press Space: the arrangement plays instead of the loop.</li>
            <li>Bounce renders a WAV; Save writes a portable <span className="code">.obeats</span> file.</li>
          </ul>

          <h4>How the project is organised</h4>
          <p>
            <b>Channels</b> are instruments. Each one feeds a <b>mixer strip</b>. A <b>pattern</b> holds notes for any number of
            channels — the Channel Rack grid and the piano roll are two editors for the same notes. The <b>playlist</b> holds
            clips that reference patterns across tracks, so one pattern can appear many times in a song.
          </p>
          <p>
            Because step notes live in the pattern, changing a pattern changes every clip that uses it. Clone a pattern when
            you want a variation.
          </p>

          <h4>Editing</h4>
          <ul>
            <li>Channel rack: click a step to toggle, right-click a channel to clear it.</li>
            <li>Piano roll: click to draw, drag to move, drag the right edge to resize, double-click to delete.</li>
            <li>Velocity lane: drag the bars under the piano roll.</li>
            <li>Playlist: drag clips horizontally, drag the right edge to resize, right-click for clone and track moves.</li>
            <li>Loop: drag the orange bar in the ruler; click the ruler to move the playhead.</li>
            <li>Undo/redo covers channel, note, clip, mixer and theme-of-project changes.</li>
          </ul>

          <h4>Mixer, buses and effects</h4>
          <p>
            Every strip has a fader, pan, mute/solo, an insert chain and a route. Route strips into buses and buses into the
            master — OpenBeats blocks routes that would loop back on themselves. Sends are post-fader: add a reverb strip at
            100% wet and send several channels to it. On the demo, drums go to <b>Drums Bus</b>, music to <b>Music Bus</b>, and
            selected channels send to a shared <b>Reverb FX</b>.
          </p>
          <p>
            Native effects: 3-band parametric EQ, 10-band graphic EQ with a draggable curve, compressor, limiter, reverb,
            ping-pong delay, overdrive and a resonant filter. They follow the theme and render into the bounce.
          </p>

          <h4>Browser, packs and preview</h4>
          <ul>
            <li><b>Packs</b> lists imported sample folders. Single-click auditions a sample on the preview stream without stopping playback; double-click loads it as a channel.</li>
            <li><b>Import pack</b> accepts a folder of wav/mp3/ogg/flac files and tags samples from their names and folders.</li>
            <li>The ■ button stops the preview. Project playback is never interrupted by an audition.</li>
          </ul>

          <h4>Keyboard</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
            {(Object.keys(keymap) as KeyAction[]).map((action) => (
              <div className="keymap-row" key={action}>
                <span style={{ flex: 1 }}>{KEY_ACTION_LABELS[action]}</span>
                <span className="km-combo">{keymap[action]}</span>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 8 }}>
            Note input: <span className="code">Z S X D C V G B H N J M</span> plays the lower octave and{' '}
            <span className="code">Q 2 W 3 E R 5 T 6 Y 7 U</span> the upper one, relative to the selected channel. With record
            armed and the transport rolling, those keys write notes at the playhead. <span className="code">+</span> and{' '}
            <span className="code">−</span> transpose the selected channel.
          </p>

          <h4>Customisation</h4>
          <ul>
            <li>Settings ▸ Appearance: six themes, editable custom theme, accent override, UI scale, motion.</li>
            <li>Settings ▸ Keyboard: click any shortcut and press a new combination.</li>
            <li>Settings ▸ Workflow: startup chime, hints, pointer values, meters, autosave and default snap.</li>
            <li>Themes export as JSON and can be imported on another machine.</li>
          </ul>

          <h4>Files</h4>
          <p>
            <span className="code">.obeats</span> is plain JSON containing channels, patterns, clips, mixer state and tempo —
            readable and diff-friendly. Samples you import are decoded into memory for the session only; bounce a WAV to keep
            the result, or reload the sample after reopening the project.
          </p>

          <h4>Honest limits</h4>
          <ul>
            <li>Browsers cannot host VST/AU binaries, so OpenBeats ships its own native effects and synths instead.</li>
            <li>Input monitoring and recording need the desktop build; the web demo has no microphone access.</li>
            <li>MP3, OGG and M4A export need ffmpeg installed; WAV and FLAC are encoded natively.</li>
            <li>Sample buffers are not embedded in the project file.</li>
          </ul>

          <h4>Credits & license</h4>
          <p>
            OpenBeats is original software distributed under the GNU General Public License v3. It contains no code, images,
            presets or sounds from any commercial DAW. Built with React, TypeScript, Vite, Zustand and the Web Audio API.
            Interface conventions are inspired by classic pattern-based studios; the implementation is entirely its own.
          </p>
        </div>
      </Modal>
      {suggestions && <SuggestionsDialog onClose={() => setSuggestions(false)} />}
    </>
  );
}
