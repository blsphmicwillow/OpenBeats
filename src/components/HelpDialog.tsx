import { useApp } from '../store';
import { Modal } from '../ui/Modal';
import { KEY_ACTION_LABELS } from '../ui/keymapLabels';
import type { KeyAction } from '../model/types';

export function HelpDialog() {
  const open = useApp((s) => s.ui.aboutOpen);
  const keymap = useApp((s) => s.settings.keymap);
  const { setUI } = useApp.getState();
  if (!open) return null;

  return (
    <Modal
      title="OpenBeats manual"
      subtitle="Version 1.0 · GPL-3.0 · an original open-source studio"
      onClose={() => setUI({ aboutOpen: false })}
      footer={
        <>
          <span className="tiny-note">Press Esc to close. The tutorial replays from Help ▸ Tutorial.</span>
          <div className="spacer" />
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
          <li>There is no microphone or line-in recording yet; MIDI-style input is QWERTY or imported audio.</li>
          <li>Automation lanes, time-signature changes and multi-project album export are not implemented in this version.</li>
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
  );
}
