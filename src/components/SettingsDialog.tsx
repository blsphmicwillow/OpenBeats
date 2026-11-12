import { useCallback, useEffect, useRef, useState } from 'react';
import { previewChannel, useApp } from '../store';
import { Modal } from '../ui/Modal';
import { THEMES, themeById } from '../themes';
import { ThemeColorEditor } from './ThemeColorEditor';
import { InputPanel } from './InputPanel';
import { DEFAULT_KEYMAP, defaultSettings } from '../model/defaults';
import { engine } from '../audio/engine';
import {
  clearRecovery,
  getAudioDevices,
  nativePlaybackState,
  nativePlayMetronome,
  playNativeTestTone,
  readRecovery,
  recoverAudioLog,
  configureNativeAudio,
  nativeStopPreview,
  setCueGain,
  audioBridgeStatus,
  renderedLevels,
  type AudioDevices,
  type NativePlaybackState,
} from '../lib/nativeAudio';
import { KEY_ACTION_LABELS, comboFromEvent } from '../ui/keymapLabels';
import { APP_VERSION } from '../lib/version';
import { friendlyDeviceName, readDevMode, writeDevMode } from '../lib/deviceNames';
import { audioErrorReport, isNative, nativePlatform } from '../lib/native';
import { judgeTestTone, type ToneSample } from '../lib/audioVerdict';
import {
  diagnosticsText,
  noOutputDevicesAdvice,
  toneAdvice,
  toneReportMessage,
  type BridgeState,
} from '../lib/audioAdvice';
import type { KeyAction, Settings, Theme } from '../model/types';

type Tab = 'appearance' | 'accessibility' | 'workflow' | 'updates' | 'keys' | 'audio' | 'opensource';

/** The tone must outlast the diagnostic window, or a slow open looks silent. */
const TONE_SECONDS = 5;
const TONE_WINDOW_MS = 4000;
const TONE_POLL_MS = 150;

const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'updates', label: 'Updates' },
  { id: 'keys', label: 'Keyboard' },
  { id: 'audio', label: 'Audio' },
  { id: 'opensource', label: 'Open source' },
];

export function SettingsDialog() {
  const open = useApp((s) => s.ui.settingsOpen);
  const settings = useApp((s) => s.settings);
  const updateChecking = useApp((s) => s.ui.updateChecking);
  const lastSaved = useApp((s) => s.lastSaved);
  const [tab, setTab] = useState<Tab>('appearance');
  const [layoutName, setLayoutName] = useState('');
  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const {
    setUI,
    patchSettings,
    setKey,
    autosaveNow,
    toast,
    saveWorkspaceLayout,
    applyWorkspaceLayout,
    removeWorkspaceLayout,
  } = useApp.getState();

  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (combo) {
        setKey(capturing, combo);
        setCapturing(null);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturing, setKey]);

  if (!open) return null;

  const theme = themeById(settings.themeId, settings.customTheme);
  const updateTheme = (key: keyof Theme, value: string) => {
    patchSettings({
      themeId: 'custom',
      customTheme: { ...settings.customTheme, [key]: value, id: 'custom' },
    });
  };

  const saveFile = (name: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  return (
    <Modal
      title="Settings"
      subtitle="Everything is stored locally in this browser"
      onClose={() => setUI({ settingsOpen: false })}
      footer={
        <>
          <span className="tiny-note">UI scale, theme, keymap and workflow are saved automatically.</span>
          <div className="spacer" />
          <button className="btn ghost" onClick={() => patchSettings(defaultSettings())}>
            Restore defaults
          </button>
          <button className="btn primary" onClick={() => setUI({ settingsOpen: false })}>
            Done
          </button>
        </>
      }
    >
      <div className="settings-layout">
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`settings-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-pane">
          {tab === 'appearance' && (
            <>
              <h3>Theme</h3>
              <p className="hinttext">
                Themes restyle every panel, knob, meter and native effect instantly. Duplicate one, tweak the colours, then
                export it as JSON to share.
              </p>
              <div className="theme-grid">
                {THEMES.map((t) => (
                  <div
                    key={t.id}
                    className={`theme-card ${settings.themeId === t.id ? 'active' : ''}`}
                    onClick={() => patchSettings({ themeId: t.id })}
                  >
                    <div className="tc-name">{t.name}</div>
                    <div className="theme-swatch">
                      <i style={{ background: t.bg }} />
                      <i style={{ background: t.panel }} />
                      <i style={{ background: t.panel3 }} />
                      <i style={{ background: t.accent }} />
                      <i style={{ background: t.text }} />
                    </div>
                  </div>
                ))}
                <div
                  className={`theme-card ${settings.themeId === 'custom' ? 'active' : ''}`}
                  onClick={() => patchSettings({ themeId: 'custom' })}
                >
                  <div className="tc-name">My theme (editable)</div>
                  <div className="theme-swatch">
                    <i style={{ background: settings.customTheme.bg }} />
                    <i style={{ background: settings.customTheme.panel }} />
                    <i style={{ background: settings.customTheme.panel3 }} />
                    <i style={{ background: settings.customTheme.accent }} />
                    <i style={{ background: settings.customTheme.text }} />
                  </div>
                </div>
              </div>

              <div className="field">
                <div className="field-label">
                  Interface mode
                  <small>Classic keeps the workstation chrome; Modern flattens it. Your theme colours carry across both.</small>
                </div>
                <div className="field-control">
                  {(['classic', 'modern'] as const).map((m) => (
                    <button
                      key={m}
                      className={`btn ${settings.uiMode === m ? 'primary' : 'ghost'}`}
                      onClick={() => patchSettings({ uiMode: m })}
                    >
                      {m === 'classic' ? 'Classic' : 'Modern'}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
                <button
                  className="btn"
                  onClick={() =>
                    patchSettings({
                      themeId: 'custom',
                      customTheme: { ...theme, id: 'custom', name: 'My Theme', dark: settings.customTheme.dark },
                    })
                  }
                >
                  Copy current theme → My theme
                </button>
                <button className="btn ghost" onClick={() => saveFile('openbeats-theme.json', theme)}>
                  Export theme JSON
                </button>
                <button className="btn ghost" onClick={() => importRef.current?.click()}>
                  Import theme
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const imported = JSON.parse(await file.text()) as Theme;
                      if (!imported.bg || !imported.accent) throw new Error('missing colours');
                      patchSettings({ themeId: 'custom', customTheme: { ...imported, id: 'custom' } });
                      toast('Theme imported');
                    } catch {
                      toast('That file is not an OpenBeats theme');
                    }
                    e.target.value = '';
                  }}
                />
              </div>

              <div className="field-label" style={{ marginTop: 18 }}>
                Colour editor
                <small style={{ display: 'block', fontWeight: 400 }}>
                  Wheel, HEX and RGB stay in sync. Edits are saved to “My theme”, so built-in palettes stay untouched.
                </small>
              </div>
              <ThemeColorEditor
                theme={theme}
                onChange={(patch) =>
                  patchSettings({
                    themeId: 'custom',
                    customTheme: {
                      ...(settings.themeId === 'custom' ? settings.customTheme : theme),
                      ...patch,
                      id: 'custom',
                      name: 'My theme',
                    },
                  })
                }
              />
              <div className="field">
                <div className="field-label">
                  Glass surfaces
                  <small>Translucent panels and background blur. Works best with the Glass presets.</small>
                </div>
                <div className="field-control">
                  <input
                    type="checkbox"
                    checked={!!theme.glass}
                    onChange={(e) =>
                      patchSettings({
                        themeId: 'custom',
                        customTheme: {
                          ...(settings.themeId === 'custom' ? settings.customTheme : theme),
                          glass: e.target.checked,
                          id: 'custom',
                          name: 'My theme',
                        },
                      })
                    }
                  />
                </div>
              </div>

              <div className="field">
                <div className="field-label">
                  Accent override
                  <small>Pushes one accent colour across the current theme.</small>
                </div>
                <div className="field-control">
                  <input
                    type="color"
                    value={settings.accent ?? theme.accent}
                    onChange={(e) => patchSettings({ accent: e.target.value })}
                  />
                  <button className="btn ghost" onClick={() => patchSettings({ accent: null })}>
                    Clear
                  </button>
                </div>
              </div>

              <h3 style={{ marginTop: 18 }}>Workspace layouts</h3>
              <p className="hinttext">
                Store panel widths, browser visibility, the active view and collapsed mixer groups under a name, then
                recall the whole workspace in one click. Layouts are saved with your settings on this device.
              </p>
              <div className="field">
                <div className="field-label">
                  Layout name
                  <small>For example “Arrangement”, “Mixing” or “Sound design”.</small>
                </div>
                <div className="field-control">
                  <input
                    className="text-input"
                    value={layoutName}
                    onChange={(e) => setLayoutName(e.target.value)}
                    placeholder="Mixing"
                    aria-label="Workspace layout name"
                  />
                  <button
                    className="btn"
                    onClick={() => {
                      saveWorkspaceLayout(layoutName);
                      setLayoutName('');
                    }}
                  >
                    Save current
                  </button>
                </div>
              </div>
              {settings.layouts.length > 0 && (
                <div className="field">
                  <div className="field-label">
                    Saved layouts
                    <small>{settings.layouts.length} saved · applying one never changes your project audio.</small>
                  </div>
                  <div className="field-control" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {settings.layouts.map((layout) => (
                      <span key={layout.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <button
                          className="btn ghost"
                          onClick={() => applyWorkspaceLayout(layout.id)}
                          title={`${layout.rackWidth}px rack · ${layout.browserWidth}px browser · ${layout.tab}`}
                        >
                          {layout.name}
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => removeWorkspaceLayout(layout.id)}
                          aria-label={`Delete layout ${layout.name}`}
                          title="Delete layout"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'workflow' && (
            <>
              <h3>Workflow</h3>
              <p className="hinttext">Small conveniences that change how the studio feels day to day.</p>

              <div className="field">
                <div className="field-label">
                  Bounce mastering
                  <small>Applied to the offline render on export.</small>
                </div>
                <div className="field-control">
                  <select
                    className="select"
                    value={settings.masterTarget}
                    onChange={(e) => patchSettings({ masterTarget: e.target.value as Settings['masterTarget'] })}
                  >
                    <option value="none">None (raw mix)</option>
                    <option value="spotify">Spotify · −14 LUFS</option>
                    <option value="club">Club · −9 LUFS</option>
                    <option value="soundcloud">SoundCloud · −13 LUFS</option>
                    <option value="youtube">YouTube · −14 LUFS</option>
                  </select>
                </div>
              </div>

              {(
                [
                  ['startupChime', 'Startup chime', 'Play a short synthesized ding when OpenBeats opens. Takes effect on the next launch.'],
                  ['showMeters', 'Channel rack meters', 'Display a live level meter on every channel.'],
                  ['autoScroll', 'Follow the playhead', 'Keep the playlist and piano roll near the playhead.'],
                ] as const
              ).map(([key, label, desc]) => (
                <div className="field" key={key}>
                  <div className="field-label">
                    {label}
                    <small>{desc}</small>
                  </div>
                  <div className="field-control">
                    <input
                      type="checkbox"
                      checked={Boolean(settings[key])}
                      onChange={(e) => patchSettings({ [key]: e.target.checked } as Partial<Settings>)}
                    />
                  </div>
                </div>
              ))}
              <div className="field">
                <div className="field-label">
                  Autosave
                  <small>Write a crash-safe snapshot to this device on a timer. A crash restores the last snapshot.</small>
                </div>
                <div className="field-control" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    className="select"
                    aria-label="Autosave interval"
                    value={String(settings.autosaveMinutes)}
                    onChange={(e) =>
                      patchSettings({ autosaveMinutes: Number(e.target.value) as Settings['autosaveMinutes'] })
                    }
                  >
                    <option value="0">Never</option>
                    <option value="2">Every 2 minutes</option>
                    <option value="5">Every 5 minutes</option>
                    <option value="10">Every 10 minutes</option>
                    <option value="15">Every 15 minutes</option>
                    <option value="30">Every 30 minutes</option>
                    <option value="60">Every hour</option>
                  </select>
                  <button className="btn ghost" onClick={autosaveNow}>
                    Save now
                  </button>
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Last autosave
                  <small>{lastSaved ? new Date(lastSaved).toLocaleString() : 'No snapshot yet'}</small>
                </div>
                <div className="field-control">
                  <span className="tiny-note">{settings.autosaveMinutes ? `Autosaves every ${settings.autosaveMinutes} min while you work` : 'Timed autosave is off — use Save now or save a file'}</span>
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Discord Rich Presence
                  <small>Show “Making a beat..” and the current project name in Discord using the built-in OpenBeats app ID.</small>
                </div>
                <div className="field-control">
                  <input
                    type="checkbox"
                    checked={settings.discordRpc}
                    onChange={(e) => patchSettings({ discordRpc: e.target.checked })}
                    aria-label="Enable Discord Rich Presence"
                  />
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Default snap
                  <small>Used by the playlist and piano roll.</small>
                </div>
                <div className="field-control">
                  <select className="select" value={String(settings.snap)} onChange={(e) => patchSettings({ snap: Number(e.target.value) })}>
                    <option value="1">1/16 note</option>
                    <option value="0.5">1/32 note</option>
                    <option value="0.25">1/64 note</option>
                    <option value="0">Off (free)</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Sample previews
                  <small>Audition packs and samples with a single click.</small>
                </div>
                <div className="field-control">
                  <span className="tiny-note">always on</span>
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Tutorial
                  <small>Replay the guided tour of the studio.</small>
                </div>
                <div className="field-control">
                  <button className="btn" onClick={() => { setUI({ settingsOpen: false, tutorialStep: 0 }); }}>
                    Start the tour
                  </button>
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Panel sizes
                  <small>Reset the browser and channel rack widths.</small>
                </div>
                <div className="field-control">
                  <button className="btn ghost" onClick={() => setUI({ rackWidth: 470, browserWidth: 232, browserOpen: true })}>
                    Reset layout
                  </button>
                </div>
              </div>
            </>
          )}

          {tab === 'accessibility' && (
            <>
              <h3>Accessibility</h3>
              <p className="hinttext">
                Readability and motion controls. Everything here applies immediately and is saved with your settings;
                none of it changes your project.
              </p>
              <div className="field">
                <div className="field-label">
                  Reduce motion
                  <small>Disables the recording pulse, meters and interface transitions.</small>
                </div>
                <div className="field-control">
                  <input
                    type="checkbox"
                    checked={settings.reduceMotion}
                    onChange={(e) => patchSettings({ reduceMotion: e.target.checked })}
                  />
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  High contrast
                  <small>Stronger borders, brighter labels and clearer separators on any theme.</small>
                </div>
                <div className="field-control">
                  <input
                    type="checkbox"
                    checked={settings.highContrast}
                    onChange={(e) => patchSettings({ highContrast: e.target.checked })}
                  />
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Keyboard focus rings
                  <small>Always outline the focused control, even when using a mouse.</small>
                </div>
                <div className="field-control">
                  <input
                    type="checkbox"
                    checked={settings.focusRings}
                    onChange={(e) => patchSettings({ focusRings: e.target.checked })}
                  />
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Reduce transparency
                  <small>Replaces frosted glass with solid panels and disables backdrop blur.</small>
                </div>
                <div className="field-control">
                  <input
                    type="checkbox"
                    checked={settings.reduceTransparency}
                    onChange={(e) => patchSettings({ reduceTransparency: e.target.checked })}
                  />
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Interface scale <small>{Math.round(settings.scale * 100)}%</small>
                </div>
                <div className="field-control">
                  <input
                    type="range"
                    min={0.8}
                    max={1.3}
                    step={0.01}
                    value={settings.scale}
                    onChange={(e) => patchSettings({ scale: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Density
                  <small>Compact fits more tracks; comfortable adds breathing room.</small>
                </div>
                <div className="field-control">
                  <select
                    className="select"
                    value={settings.density}
                    onChange={(e) => patchSettings({ density: e.target.value as Settings['density'] })}
                  >
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Hint bar
                  <small>Show the explanation bar at the bottom of the window.</small>
                </div>
                <div className="field-control">
                  <input
                    type="checkbox"
                    checked={settings.showHints}
                    onChange={(e) => patchSettings({ showHints: e.target.checked })}
                  />
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Values at the pointer
                  <small>Show knob and fader values next to the cursor while dragging.</small>
                </div>
                <div className="field-control">
                  <input
                    type="checkbox"
                    checked={settings.cursorHints}
                    onChange={(e) => patchSettings({ cursorHints: e.target.checked })}
                  />
                </div>
              </div>
            </>
          )}

          {tab === 'updates' && (
            <>
              <h3>Updates</h3>
              <p className="hinttext">
                OpenBeats checks this repository’s GitHub Releases for a newer build. The check is a single request to
                api.github.com; nothing about you or your projects is sent.
              </p>
              <div className="field">
                <div className="field-label">
                  Installed version
                  <small>Bundled with this build.</small>
                </div>
                <div className="field-control">
                  <span className="chip">{APP_VERSION}</span>
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Automatic update checks
                  <small>
                    Off means OpenBeats never contacts GitHub on its own — no launch check, no banner. You can still
                    check manually below.
                  </small>
                </div>
                <div className="field-control">
                  <input
                    type="checkbox"
                    checked={settings.autoCheckUpdates}
                    onChange={(e) => {
                      patchSettings({ autoCheckUpdates: e.target.checked });
                      if (!e.target.checked) setUI({ update: null });
                    }}
                  />
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Update repository
                  <small>GitHub “owner/repo” whose Releases feed the checker.</small>
                </div>
                <div className="field-control">
                  <input
                    className="text-input"
                    value={settings.updateRepo}
                    onChange={(e) => patchSettings({ updateRepo: e.target.value })}
                    placeholder="blsphmicwillow/OpenBeats"
                  />
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Check now
                  <small>Manual checks work even when automatic checks are off.</small>
                </div>
                <div className="field-control">
                  <button className="btn" onClick={() => void useApp.getState().checkUpdates()}>Check for updates</button>
                  {updateChecking && <span className="tiny-note">checking…</span>}
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Release notes
                  <small>The Changelog tab always shows what changed in this build.</small>
                </div>
                <div className="field-control">
                  <button className="btn ghost" onClick={() => { setUI({ settingsOpen: false, tab: 'changelog' }); }}>
                    Open changelog
                  </button>
                </div>
              </div>
            </>
          )}

          {tab === 'keys' && (
            <>
              <h3>Keyboard</h3>
              <p className="hinttext">
                Click a shortcut, then press the combination you want. Letters are case-insensitive; Ctrl works as Cmd on
                macOS. QWERTY note keys always play the selected channel.
              </p>
              {(Object.keys(DEFAULT_KEYMAP) as KeyAction[]).map((action) => (
                <div className="keymap-row" key={action}>
                  <span style={{ flex: 1 }}>{KEY_ACTION_LABELS[action]}</span>
                  <button
                    className={`km-combo ${capturing === action ? 'capturing' : ''}`}
                    onClick={() => setCapturing(capturing === action ? null : action)}
                    title="Click, then press a key combination"
                  >
                    {capturing === action ? 'press keys…' : settings.keymap[action]}
                  </button>
                </div>
              ))}
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <button className="btn ghost" onClick={() => patchSettings({ keymap: { ...DEFAULT_KEYMAP } })}>
                  Reset shortcuts
                </button>
              </div>
              <p className="hinttext" style={{ marginTop: 12 }}>
                Editing: <span className="code">Z–M</span> and <span className="code">Q–U</span> play notes,{' '}
                <span className="code">+</span>/<span className="code">−</span> transpose the selected channel,{' '}
                <span className="code">Delete</span> is not bound (use right-click) so nothing disappears by accident.
              </p>
            </>
          )}

          {tab === 'audio' && <AudioTab />}

          {tab === 'opensource' && (
            <>
              <h3>OpenBeats is free software</h3>
              <p className="hinttext">
                OpenBeats is an original, open-source beatmaking studio built with React, TypeScript and the Web Audio API.
                It is licensed under the GNU GPL v3: you can use it, study it, change it and share it. No code, assets or
                samples from any commercial DAW are included — the workflow is inspired by classic pattern-based studios,
                and every sound is synthesised or supplied by you.
              </p>
              <div className="field">
                <div className="field-label">License</div>
                <a className="btn ghost" href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer">
                  GPL-3.0 text
                </a>
              </div>
              <div className="field">
                <div className="field-label">Built with</div>
                <div className="field-control tiny-note">React · Vite · TypeScript · Zustand · Web Audio</div>
              </div>
              <div className="field">
                <div className="field-label">Project format</div>
                <div className="field-control tiny-note">.obeats — readable JSON, versioned</div>
              </div>
              <div className="field">
                <div className="field-label">
                  Settings file
                  <small>Move your theme, shortcuts and workflow between machines.</small>
                </div>
                <div className="field-control">
                  <button className="btn ghost" onClick={() => saveFile('openbeats-settings.json', settings)}>
                    Export settings
                  </button>
                  <button className="btn ghost" onClick={() => setUI({ aboutOpen: true })}>
                    Manual
                  </button>
                </div>
              </div>
              <div className="field">
                <div className="field-label">
                  Start over
                  <small>Clears the autosaved project and every setting.</small>
                </div>
                <div className="field-control">
                  <button
                    className="btn danger"
                    onClick={() => {
                      if (window.confirm('Clear the autosaved project and reset all settings?')) useApp.getState().resetAll();
                    }}
                  >
                    Reset everything
                  </button>
                </div>
              </div>
              <p className="hinttext" style={{ marginTop: 12 }}>
                Tip: projects are plain JSON. Keep them in version control alongside your music — diffs are readable.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AudioTab() {
  const project = useApp((s) => s.project);
  const audioReady = useApp((s) => s.audioReady);
  const [state, setState] = useState<{ state: string; rate: number; base: number } | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      const ctx = engine.ctx;
      setState(ctx ? { state: ctx.state, rate: ctx.sampleRate, base: ctx.baseLatency } : null);
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      <h3>Native audio device</h3>
      <p className="hinttext">
        The desktop build plays through the Rust engine and CPAL. Pick a device here if the default one is silent — on
        Linux the PulseAudio/PipeWire bridge is preferred automatically, because ALSA’s default device can point at a
        null sink while the step counter keeps moving. Choose an output, then press Save to rebuild the stream; the cue
        level saves immediately.
      </p>
      <NativeDevicePanel />
      <InputPanel />
      <h3>Audio engine</h3>
      <p className="hinttext">
        OpenBeats renders everything with Web Audio: instruments are synthesised per note, effects run as native nodes, and
        the WAV bounce reuses the same graph in an offline context.
      </p>
      <div className="field">
        <div className="field-label">Engine</div>
        <div className="field-control">
          <span className={`chip`} style={{ background: audioReady ? undefined : 'color-mix(in srgb,#ef4444 20%,transparent)' }}>
            {state ? `${state.state} · ${Math.round(state.rate / 1000)} kHz` : 'not started'}
          </span>
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          Output latency
          <small>Reported by the browser; smaller is tighter for playing keys.</small>
        </div>
        <div className="field-control tiny-note">
          {state ? `${Math.round((state.base + (engine.ctx?.outputLatency ?? 0)) * 1000)} ms` : '—'}
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          Master chain
          <small>Limiter and compressor on the master strip keep the bounce safe.</small>
        </div>
        <div className="field-control tiny-note">Master → Compressor → Limiter → Output</div>
      </div>
      <div className="field">
        <div className="field-label">Test the engine</div>
        <div className="field-control">
          <button
            className="btn"
            onClick={async () => {
              await useApp.getState().initAudio();
              const ch = project.channels.find((c) => c.preset === 'keys') ?? project.channels[0];
              if (ch) previewChannel(ch);
            }}
          >
            Play a test note
          </button>
          <button className="btn ghost" onClick={() => useApp.getState().stop()}>
            Stop
          </button>
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          Metronome
          <small>Also available from the transport bar (C).</small>
        </div>
        <div className="field-control">
          <input
            type="checkbox"
            checked={project.metronome}
            onChange={() => useApp.getState().toggleMetronome()}
          />
        </div>
      </div>
      <p className="hinttext" style={{ marginTop: 10 }}>
        Browsers only allow sound after a click or key press — press Space or click anywhere in the studio to start the
        engine. The Bounce button renders faster than real time.
      </p>
    </>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Native device controls: enumeration, stream rebuilds, low-latency buffer,
 * cue level, the test tone and the recovery tools. In the browser build the
 * device list is empty and the panel explains why.
 */
function NativeDevicePanel() {
  const audio = useApp((s) => s.settings.audio);
  const patchSettings = useApp((s) => s.patchSettings);
  const [devices, setDevices] = useState<AudioDevices>({ inputs: [], outputs: [] });
  const [snapshot, setSnapshot] = useState<NativePlaybackState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(readDevMode);
  const [draftOutput, setDraftOutput] = useState(audio.outputId ?? '');
  // Only Linux needs the ALSA→sound-server bridge hint; Windows and macOS have
  // no equivalent package and the advice would be wrong there.
  const [platform, setPlatform] = useState('');
  // Only Linux has a bridge to report, but the empty-device-list message needs
  // it to tell "nothing is running" from "no bridge to what is running".
  const [bridge, setBridge] = useState<BridgeState>('unknown');

  useEffect(() => {
    setDraftOutput(audio.outputId ?? '');
  }, [audio.outputId]);

  const refresh = useCallback(async () => {
    const list = await getAudioDevices();
    setDevices(list);
    setSnapshot(await nativePlaybackState());
  }, []);

  useEffect(() => {
    void refresh();
    void nativePlatform().then(setPlatform);
    void audioBridgeStatus()
      .then((status) => setBridge(status as BridgeState))
      .catch(() => setBridge('unknown'));
    const id = window.setInterval(() => {
      void nativePlaybackState().then(setSnapshot);
    }, 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Rust reports stream failures; the bridge reports rejected commands. Show
  // whichever is newer-looking so one row covers both sources.
  const commandError = audioErrorReport();
  const lastError = snapshot?.last_error || commandError?.message || '';
  const lastErrorSuffix = commandError && commandError.count > 1 ? ` (×${commandError.count})` : '';

  const outputs = devices.outputs;
  const savedOutput = audio.outputId ?? '';
  const output = draftOutput;
  const pending = output !== savedOutput;
  const savedMissing = Boolean(savedOutput) && !outputs.some((device) => device.id === savedOutput);
  const selectedOutput = outputs.find((device) => device.id === savedOutput);
  const openName =
    selectedOutput?.friendly_name ?? audio.outputLabel ?? friendlyDeviceName(snapshot?.device || 'none');

  const saveOutput = async () => {
    const label = outputs.find((device) => device.id === output)?.friendly_name ?? null;
    const nextAudio = {
      ...useApp.getState().settings.audio,
      outputId: output || null,
      outputLabel: label,
    };
    try {
      await nativeStopPreview();
      const next = await configureNativeAudio(nextAudio);
      if (!next) {
        setNote('Device selection needs the desktop build.');
        return;
      }
      patchSettings({ audio: nextAudio });
      setSnapshot(next);
      setNote(
        `Saved. Stream open on ${friendlyDeviceName(next.device || 'the system default')}.`,
      );
    } catch (err) {
      setNote(errorText(err));
    }
  };

  const toggleLowLatency = async (enabled: boolean) => {
    const nextAudio = { ...useApp.getState().settings.audio, lowLatency: enabled };
    patchSettings({ audio: nextAudio });
    try {
      const next = await configureNativeAudio(nextAudio);
      if (next) setSnapshot(next);
      setNote(enabled ? 'Using the device minimum buffer.' : 'Using the device default buffer.');
    } catch (err) {
      setNote(errorText(err));
    }
  };

  const recoverSession = async () => {
    try {
      const text = await readRecovery();
      if (!text) {
        setNote('No recovered session was found yet.');
        return;
      }
      await useApp
        .getState()
        .openProjectFile(new File([text], 'recovered-session.obeats', { type: 'application/json' }));
      await clearRecovery();
      setNote('Recovered the last autosaved session.');
    } catch (err) {
      setNote(errorText(err));
    }
  };

  /**
   * Plays the tone and then reads the callback counter, so "silent" can be
   * separated into "the stream never ran" and "the stream ran but the graph is
   * quiet". Without that split a dead device looks exactly like a broken DAW.
   */
  const runTestTone = async () => {
    const first = await nativePlaybackState();
    const before = first?.callbacks ?? 0;
    const deadlineBefore = first?.deadline_misses ?? 0;
    try {
      const ok = await playNativeTestTone(TONE_SECONDS);
      if (!ok) {
        setNote('The test tone needs the desktop build.');
        return;
      }
    } catch (err) {
      setNote(errorText(err));
      return;
    }
    // Opening a device can take a beat, so watch the stream across the whole
    // window rather than sampling once. Both signals must appear before the
    // poll stops early: the counter proves the device ran, the peak proves the
    // tone reached it.
    const samples: ToneSample[] = [];
    let latest: NativePlaybackState | null = null;
    const deadline = Date.now() + TONE_WINDOW_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, TONE_POLL_MS));
      const reading = await nativePlaybackState();
      if (!reading) continue;
      latest = reading;
      samples.push({ callbacks: reading.callbacks, peak: reading.peak });
      if (reading.callbacks > before && reading.peak > 0) break;
    }
    setSnapshot(latest ?? (await nativePlaybackState()));
    const verdict = judgeTestTone(before, samples);
    // Each platform fails differently; the advice is unit-tested separately.
    const advice = toneAdvice(platform, verdict.kind);
    // What the engine actually rendered, read from the same ring the Audio
    // Logger recovers to WAV. The meters say what the graph produced; this says
    // what was handed to the device, which is what splits a silent graph from a
    // silent device.
    const rendered = await renderedLevels(TONE_SECONDS);
    const report = toneReportMessage({
      callbacks: Math.max(0, (latest?.callbacks ?? 0) - before),
      peakDb: latest?.peak_db ?? -120,
      renderedPeak: rendered?.peak ?? 0,
      renderedRms: rendered?.rms ?? 0,
      deadlineMisses: Math.max(0, (latest?.deadline_misses ?? 0) - deadlineBefore),
      sink: latest?.sink ?? '',
    });
    switch (verdict.kind) {
      case 'no-engine':
        setNote('The test tone was sent but the engine did not answer.');
        return;
      case 'stalled':
        setNote(
          `${report} The stream delivered 0 callbacks in ${TONE_WINDOW_MS / 1000} s, so the device opened and never ran.${advice}`,
        );
        return;
      case 'silent':
        setNote(`${report}${advice}`);
        return;
      case 'ok':
        setNote(report + advice);
        return;
    }
  };

  /** One plain-text block a tester can paste, so a readout needs no terminal. */
  const copyDiagnostics = async () => {
    const state = snapshot ?? (await nativePlaybackState());
    const text = diagnosticsText({
      version: APP_VERSION,
      platform: platform || 'unknown',
      bridge,
      device: state?.device ?? '',
      host: state?.host ?? '',
      sink: state?.sink ?? '',
      sampleRate: state?.sample_rate ?? 0,
      channels: state?.channels ?? 0,
      bufferFrames: state?.buffer_frames ?? 0,
      lowLatency: audio.lowLatency,
      callbacks: state?.callbacks ?? 0,
      peakDb: state?.peak_db ?? -120,
      intervalMaxMs: state?.interval_max_ms ?? 0,
      deadlineMisses: state?.deadline_misses ?? 0,
      streamErrors: state?.stream_errors ?? 0,
      deviceSwaps: state?.device_swaps ?? 0,
      stallReopens: state?.stall_reopens ?? 0,
      lastReopen: state?.last_reopen ?? '',
      lastError,
    });
    try {
      await navigator.clipboard.writeText(text);
      setNote('Audio diagnostics copied to the clipboard.');
    } catch {
      setNote(text);
    }
  };

  return (
    <>
      <div className="field">
        <div className="field-label">
          Output device
          <small>
            {pending
              ? 'Unsaved output — press Save to switch the stream.'
              : savedMissing
                ? 'The saved output is unavailable; choose another device and press Save.'
                : snapshot && snapshot.sample_rate > 0
                  ? `Open: ${devMode ? snapshot.device || 'none' : openName} · ${Math.round(
                      snapshot.sample_rate,
                    )} Hz · ${snapshot.channels} ch`
                  : 'The stream opens on the first play or test tone.'}
          </small>
        </div>
        <div className="field-control" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="text-input"
            style={{ flex: 1 }}
            value={output}
            onMouseDown={() => void refresh()}
            onChange={(e) => {
              setDraftOutput(e.target.value);
              setNote('Unsaved output — press Save to switch the stream.');
            }}
            disabled={outputs.length === 0}
            aria-label="Output device"
          >
            {outputs.length === 0 && (
              <option value="">
                {isNative() ? 'No output devices found' : 'No native devices (browser build)'}
              </option>
            )}
            <option value="">System default</option>
            {savedMissing && (
              <option value={savedOutput}>{audio.outputLabel ?? 'Saved device'} · unavailable</option>
            )}
            {outputs.map((device) => (
              <option key={device.id} value={device.id} title={device.id}>
                {devMode ? device.id : device.friendly_name}
                {device.is_default ? ' · default' : ''}
              </option>
            ))}
          </select>
          <button
            className="btn primary"
            onClick={() => void saveOutput()}
            disabled={!pending || outputs.length === 0}
          >
            Save
          </button>
        </div>
        {isNative() && outputs.length === 0 && (
          <p className="tiny-note audio-empty-note" role="status">
            {noOutputDevicesAdvice(platform, bridge)}
          </p>
        )}
      </div>
      <div className="field">
        <div className="field-label">
          Dev Mode
          <small>Show host-qualified device IDs, including WASAPI, ASIO, CoreAudio and ALSA names. Off by default.</small>
        </div>
        <div className="field-control">
          <input
            type="checkbox"
            checked={devMode}
            aria-label="Dev Mode"
            onChange={(e) => {
              setDevMode(e.target.checked);
              writeDevMode(e.target.checked);
            }}
          />
          <span className="tiny-note">{devMode ? 'raw backend names' : 'friendly names'}</span>
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          Low-latency mode
          <small>Rebuilds the stream with the device’s smallest buffer for tighter key response.</small>
        </div>
        <div className="field-control">
          <input
            type="checkbox"
            checked={audio.lowLatency}
            onChange={(e) => void toggleLowLatency(e.target.checked)}
            aria-label="Low-latency mode"
          />
          <span className="chip">{snapshot ? `${snapshot.latency_ms.toFixed(1)} ms` : '—'}</span>
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          Cue level (outputs 3/4)
          <small>Master stays on 1/2; a four-channel interface gets the cue bus on 3/4.</small>
        </div>
        <div className="field-control">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={audio.cueGain}
            onChange={(e) => {
              const value = Number(e.target.value);
              patchSettings({
                audio: { ...useApp.getState().settings.audio, cueGain: value },
              });
              void setCueGain(value);
            }}
            aria-label="Cue level"
          />
          <span className="tiny-note">{Math.round(audio.cueGain * 100)}%</span>
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          Stream health
          <small>
            {snapshot
              ? `${snapshot.callbacks.toLocaleString()} callbacks · peak ${snapshot.peak_db.toFixed(
                  1,
                )} dBFS · ${snapshot.buffer_frames} frames/callback · worst ${snapshot.interval_max_ms.toFixed(
                  1,
                )} ms${snapshot.deadline_misses > 0 ? ` · ${snapshot.deadline_misses} deadline misses` : ''} · ${snapshot.stream_errors} errors · ${snapshot.device_swaps} rebuilds${snapshot.stall_reopens > 0 ? ` · ${snapshot.stall_reopens} stall reopens` : ''}`
              : 'No native stream yet — press Test tone to open one.'}
          </small>
          {snapshot && snapshot.sample_rate > 0 && (
            <small>
              {snapshot.host || 'host'} · {devMode ? snapshot.device : openName}
              {snapshot.sink ? ` → ${snapshot.sink}` : ''}
            </small>
          )}
          {snapshot?.last_reopen && <small>{snapshot.last_reopen}</small>}
        </div>
        <div className="field-control">
          <button className="btn" onClick={() => void runTestTone()}>
            Test tone
          </button>
          <button className="btn ghost" onClick={() => void copyDiagnostics()}>
            Copy diagnostics
          </button>
          <span className="tiny-note" title={lastError || 'no stream errors'}>
            {lastError ? `Last error: ${lastError}${lastErrorSuffix}` : 'No stream errors'}
          </span>
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          Check the device
          <small>“Recover” saves the last 60 seconds of master audio to a WAV file.</small>
        </div>
        <div className="field-control">
          <button
            className="btn ghost"
            onClick={async () => {
              await nativePlayMetronome(true);
              setNote('Played a metronome click through the native engine.');
            }}
          >
            Metronome click
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              const log = await recoverAudioLog(60);
              setNote(
                log
                  ? `Saved ${Math.round(log.seconds)} s to ${log.path}`
                  : 'Nothing has been recorded yet — press play first.',
              );
            }}
          >
            Recover 60 s
          </button>
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          Session recovery
          <small>A Rust thread writes a hidden .recovery file every 30 seconds while you work.</small>
        </div>
        <div className="field-control">
          <button className="btn ghost" onClick={() => void recoverSession()}>
            Restore last session
          </button>
        </div>
      </div>
      {note && <p className="hinttext">{note}</p>}
    </>
  );
}
