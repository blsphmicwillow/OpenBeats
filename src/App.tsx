import { useEffect, useRef } from 'react';
import { previewPitch, useApp } from './store';
import { themeById, themeVars } from './themes';
import { TopBar } from './components/TopBar';
import { BrowserPanel } from './components/BrowserPanel';
import { ChannelRack } from './components/ChannelRack';
import { Playlist } from './components/Playlist';
import { PianoRoll } from './components/PianoRoll';
import { Mixer } from './components/Mixer';
import { HintBar } from './components/HintBar';
import { SettingsDialog } from './components/SettingsDialog';
import { HelpDialog } from './components/HelpDialog';
import { Tutorial } from './components/Tutorial';
import { ContextMenu } from './components/ContextMenu';
import { Changelog } from './components/Changelog';
import { CommandPalette } from './components/CommandPalette';
import { FixMyMix } from './components/FixMyMix';
import { HumToMelody } from './components/HumToMelody';
import { InspireDialog } from './components/InspireDialog';
import { UpdateBanner } from './components/UpdateBanner';
import { KEY_TO_SEMITONE, comboFromEvent } from './ui/keymapLabels';
import { IconGrid, IconMixer, IconPiano, IconWave } from './ui/icons';
import type { KeyAction, WorkspaceTab } from './model/types';

const TABS: { id: WorkspaceTab; label: string; icon: React.ReactNode }[] = [
  { id: 'playlist', label: 'Playlist', icon: <IconGrid size={12} /> },
  { id: 'pianoroll', label: 'Piano roll', icon: <IconPiano size={12} /> },
  { id: 'mixer', label: 'Mixer', icon: <IconMixer size={12} /> },
  { id: 'changelog', label: 'Changelog', icon: <IconWave size={12} /> },
];

export default function App() {
  const settings = useApp((s) => s.settings);
  const ui = useApp((s) => s.ui);
  const toast = useApp((s) => s.ui.toast);
  const theme = themeById(settings.themeId, settings.customTheme);
  const booted = useRef(false);

  const boot = () => {
    if (booted.current) return;
    booted.current = true;
    void useApp.getState().initAudio();
  };

  useEffect(() => {
    if (!useApp.getState().settings.autoCheckUpdates) return;
    const timer = window.setTimeout(() => void useApp.getState().checkUpdates(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      useApp.getState().updatePlayhead();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const runAction = (action: KeyAction) => {
      const state = useApp.getState();
      switch (action) {
        case 'playToggle':
          state.togglePlay();
          break;
        case 'record':
          state.toggleRecord();
          break;
        case 'songMode':
          state.toggleSongMode();
          break;
        case 'playlist':
          state.setUI({ tab: 'playlist' });
          break;
        case 'pianoRoll':
          state.setUI({ tab: 'pianoroll' });
          break;
        case 'mixer':
          state.setUI({ tab: 'mixer' });
          break;
        case 'browser':
          state.setUI({ browserOpen: !state.ui.browserOpen });
          break;
        case 'settings':
          state.setUI({ settingsOpen: !state.ui.settingsOpen });
          break;
        case 'save':
          state.saveProjectFile();
          break;
        case 'undo':
          state.undo();
          break;
        case 'redo':
          state.redo();
          break;
        case 'duplicate':
          state.duplicatePattern();
          break;
        case 'nextPattern': {
          const index = state.project.patterns.findIndex((p) => p.id === state.project.currentPattern);
          const next = state.project.patterns[(index + 1) % state.project.patterns.length];
          if (next) state.selectPattern(next.id);
          break;
        }
        case 'prevPattern': {
          const index = state.project.patterns.findIndex((p) => p.id === state.project.currentPattern);
          const prev = state.project.patterns[(index - 1 + state.project.patterns.length) % state.project.patterns.length];
          if (prev) state.selectPattern(prev.id);
          break;
        }
        case 'metronome':
          state.toggleMetronome();
          break;
        case 'help':
          state.setUI({ aboutOpen: true });
          break;
        default:
          break;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      const state = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        state.setUI({ paletteOpen: !state.ui.paletteOpen });
        return;
      }
      if (state.ui.settingsOpen || state.ui.aboutOpen || state.ui.tutorialStep !== null || state.ui.paletteOpen) return;

      const combo = comboFromEvent(e);
      const action = (Object.keys(state.settings.keymap) as KeyAction[]).find((key) => state.settings.keymap[key] === combo);
      if (action) {
        e.preventDefault();
        runAction(action);
        return;
      }

      const semitone = KEY_TO_SEMITONE[e.code];
      if (semitone !== undefined && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const channel = state.project.channels.find((c) => c.id === state.project.selectedChannel) ?? state.project.channels[0];
        if (!channel) return;
        e.preventDefault();
        const pitch = channel.root + semitone;
        previewPitch(channel, pitch);
        if (state.transport.record && state.transport.playing) {
          state.addNote(channel.id, { pitch, start: state.transport.step, len: 1, vel: 0.9 });
        }
        return;
      }

      if (e.key === '+' || e.key === '=') {
        const channel = state.project.channels.find((c) => c.id === state.project.selectedChannel);
        if (channel) {
          e.preventDefault();
          state.transposeChannel(channel.id, 1);
        }
      } else if (e.key === '-' || e.key === '_') {
        const channel = state.project.channels.find((c) => c.id === state.project.selectedChannel);
        if (channel) {
          e.preventDefault();
          state.transposeChannel(channel.id, -1);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const beginRackResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = useApp.getState().ui.rackWidth;
    const move = (ev: PointerEvent) => {
      const width = Math.max(320, Math.min(780, startWidth + ev.clientX - startX));
      useApp.getState().setUI({ rackWidth: width });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={`app density-${settings.density} mode-${settings.uiMode} ${theme.glass ? 'theme-glass' : ''} ${theme.dark ? 'theme-dark' : 'theme-light'} ${settings.reduceMotion ? 'reduce-motion' : ''}`}
      style={{ ...(themeVars(theme, settings.accent) as React.CSSProperties), ['--scale' as string]: settings.scale }}
      onPointerDown={boot}
      onContextMenu={(e) => e.preventDefault()}
    >
      <TopBar />
      <UpdateBanner />

      <div className="workspace">
        <BrowserPanel />
        <div className="center">
          <ChannelRack />
          <div className="resizer-v" onPointerDown={beginRackResize} title="Drag to resize the channel rack" />
          <div className="main">
            <div className="tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={`tab ${ui.tab === tab.id ? 'active' : ''}`}
                  onClick={() => useApp.getState().setUI({ tab: tab.id })}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.id !== 'changelog' && (
                    <span className="tab-key">
                      {settings.keymap[tab.id === 'playlist' ? 'playlist' : tab.id === 'pianoroll' ? 'pianoRoll' : 'mixer']}
                    </span>
                  )}
                </button>
              ))}
              <div className="spacer" />
              <button
                className="tbtn small flat"
                onClick={() => useApp.getState().setUI({ tutorialStep: 0 })}
                style={{ margin: '2px 4px 4px' }}
                title="Guided tour"
              >
                ? tour
              </button>
            </div>
            <div className="tab-body">
              {ui.tab === 'playlist' && <Playlist />}
              {ui.tab === 'pianoroll' && <PianoRoll />}
              {ui.tab === 'mixer' && <Mixer />}
              {ui.tab === 'changelog' && <Changelog />}
            </div>
          </div>
        </div>
      </div>

      <HintBar />

      {ui.contextMenu && <ContextMenu />}
      <CommandPalette />
      <FixMyMix />
      <HumToMelody />
      <InspireDialog />
      {ui.settingsOpen && <SettingsDialog />}
      {ui.aboutOpen && <HelpDialog />}
      {ui.tutorialStep !== null && <Tutorial />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
