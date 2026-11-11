import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import { previewPitch, useApp } from './store';
import { themeById, themeVars } from './themes';
import { TopBar } from './components/TopBar';
import { BrowserPanel } from './components/BrowserPanel';
import { ChannelRack } from './components/ChannelRack';
import { Playlist } from './components/Playlist';
import { PianoRoll } from './components/PianoRoll';
import { Mixer } from './components/Mixer';
import { HintBar } from './components/HintBar';
import { UpdateBanner } from './components/UpdateBanner';
import { SplashScreen } from './components/SplashScreen';
import { playStartupChime } from './lib/startupChime';
import { KEY_TO_SEMITONE, comboFromEvent } from './ui/keymapLabels';
import { nativeInvoke } from './lib/native';
import { IconGrid, IconMixer, IconPiano, IconWave } from './ui/icons';
import type { KeyAction, WorkspaceTab } from './model/types';

const SettingsDialog = lazy(() => import('./components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })));
const HelpDialog = lazy(() => import('./components/HelpDialog').then((m) => ({ default: m.HelpDialog })));
const Tutorial = lazy(() => import('./components/Tutorial').then((m) => ({ default: m.Tutorial })));
const ContextMenu = lazy(() => import('./components/ContextMenu').then((m) => ({ default: m.ContextMenu })));
const Changelog = lazy(() => import('./components/Changelog').then((m) => ({ default: m.Changelog })));
const CommandPalette = lazy(() => import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })));
const FixMyMix = lazy(() => import('./components/FixMyMix').then((m) => ({ default: m.FixMyMix })));
const HumToMelody = lazy(() => import('./components/HumToMelody').then((m) => ({ default: m.HumToMelody })));
const InspireDialog = lazy(() => import('./components/InspireDialog').then((m) => ({ default: m.InspireDialog })));
const ExchangeDialog = lazy(() => import('./components/ExchangeDialog').then((m) => ({ default: m.ExchangeDialog })));
const ExportDialog = lazy(() => import('./components/ExportDialog').then((m) => ({ default: m.ExportDialog })));
const ProjectHub = lazy(() => import('./components/ProjectHub').then((m) => ({ default: m.ProjectHub })));
const PluginBrowser = lazy(() => import('./components/PluginBrowser').then((m) => ({ default: m.PluginBrowser })));

const MemoTopBar = memo(TopBar);
const MemoBrowserPanel = memo(BrowserPanel);
const MemoChannelRack = memo(ChannelRack);
const MemoPlaylist = memo(Playlist);
const MemoPianoRoll = memo(PianoRoll);
const MemoMixer = memo(Mixer);
const MemoHintBar = memo(HintBar);

const TABS: { id: WorkspaceTab; label: string; icon: React.ReactNode }[] = [
  { id: 'playlist', label: 'Playlist', icon: <IconGrid size={12} /> },
  { id: 'pianoroll', label: 'Piano roll', icon: <IconPiano size={12} /> },
  { id: 'mixer', label: 'Mixer', icon: <IconMixer size={12} /> },
  { id: 'changelog', label: 'Changelog', icon: <IconWave size={12} /> },
];

export default function App() {
  const settings = useApp((s) => s.settings);
  const ui = useApp((s) => s.ui);
  const project = useApp((s) => s.project);
  const toast = useApp((s) => s.ui.toast);
  const theme = themeById(settings.themeId, settings.customTheme);
  const booted = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [splash, setSplash] = useState<'visible' | 'leaving' | 'hidden'>('visible');

  const boot = () => {
    if (booted.current) return;
    booted.current = true;
    void useApp.getState().initAudio();
  };

  useEffect(() => {
    const startup = useApp.getState().settings;
    const native = Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    if (startup.startupChime) {
      // The desktop build plays the bundled chime through CPAL, not Web Audio.
      if (native) void nativeInvoke('play_chime');
      else playStartupChime();
    }
    if (native) void nativeInvoke('close_splash');
    const hold = startup.reduceMotion ? 650 : 1600;
    const leave = window.setTimeout(() => setSplash('leaving'), hold);
    const hide = window.setTimeout(() => setSplash('hidden'), hold + 380);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(hide);
    };
  }, []);

  useEffect(() => {
    // WebKitGTK needs a user gesture to unlock Web Audio. Pointer and keyboard
    // gestures both count, and Space must work without clicking first.
    const unlock = () => {
      boot();
      void useApp.getState().initAudio();
    };
    window.addEventListener('keydown', unlock, { once: true });
    return () => window.removeEventListener('keydown', unlock);
  }, []);

  useEffect(() => {
    if (!settings.discordRpc) {
      void nativeInvoke('discord_clear');
      return;
    }
    void nativeInvoke('discord_presence', {
      details: 'Making a beat..',
      state: project.name,
    });
  }, [settings.discordRpc, project.name]);

  useEffect(() => {
    if (!useApp.getState().settings.autoCheckUpdates) return;
    const timer = window.setTimeout(() => void useApp.getState().checkUpdates(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const clearDrag = () => setDragging(false);
    window.addEventListener('dragend', clearDrag);
    window.addEventListener('drop', clearDrag);
    return () => {
      window.removeEventListener('dragend', clearDrag);
      window.removeEventListener('drop', clearDrag);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const state = useApp.getState();
      if (state.transport.playing) state.updatePlayhead();
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
        case 'addMarker':
          state.addMarker();
          break;
        case 'prevMarker':
          state.jumpMarker(-1);
          break;
        case 'nextMarker':
          state.jumpMarker(1);
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
      const isTextField =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTextField) return;
      const state = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        state.setUI({ paletteOpen: !state.ui.paletteOpen });
        return;
      }
      // A select keeps focus after a choice; Space/letters must not hijack it,
      // but undo, redo and the command palette above stay global.
      if (target?.tagName === 'SELECT') return;
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

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!files.length) return;
    const state = useApp.getState();
    const packArchives = files.filter((f) => /\.zip$/i.test(f.name));
    if (packArchives[0]) {
      // Tauri exposes the native path on dropped files. The browser build cannot
      // read an archive path, so it points the user at the native menu instead.
      const path = (packArchives[0] as File & { path?: string }).path;
      state.setUI({ browserOpen: true });
      if (path) {
        window.dispatchEvent(
          new CustomEvent('openbeats:import-pack', { detail: { kind: 'zip', path } }),
        );
      } else {
        state.toast('Use File → Import pack .zip… so OpenBeats can read the archive path');
      }
      return;
    }
    const songs = files.filter((f) => /\.(mid|midi|smf|als|rpp|obeats)$/i.test(f.name));
    const audio = files.filter(
      (f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|oga|flac|m4a|aiff?|webm)$/i.test(f.name),
    );
    if (songs[0]) await state.importSongFile(songs[0]);
    if (audio.length) await state.importSampleFiles(audio);
    if (!songs.length && !audio.length) {
      state.toast('Drop an audio file, MIDI, .als, .rpp or .obeats project');
    }
  };

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
      className={`app density-${settings.density} mode-${settings.uiMode} ${theme.glass ? 'theme-glass' : ''} ${theme.dark ? 'theme-dark' : 'theme-light'} ${settings.reduceMotion ? 'reduce-motion' : ''} ${settings.highContrast ? 'high-contrast' : ''} ${settings.focusRings ? 'focus-rings' : ''} ${settings.reduceTransparency ? 'reduce-transparency' : ''}`}
      style={{ ...(themeVars(theme, settings.accent) as React.CSSProperties), ['--scale' as string]: settings.scale }}
      onPointerDown={boot}
      onContextMenu={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      <a className="skip-link" href="#main-workspace">
        Skip to workspace
      </a>
      <MemoTopBar />
      <UpdateBanner />

      <div className="workspace">
        <MemoBrowserPanel />
        <div className="center">
          <MemoChannelRack />
          <div className="resizer-v" onPointerDown={beginRackResize} title="Drag to resize the channel rack" />
          <div className="main" id="main-workspace" tabIndex={-1}>
            <div className="tabs" role="tablist" aria-label="Workspace views">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  id={`tab-${tab.id}`}
                  role="tab"
                  aria-selected={ui.tab === tab.id}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={ui.tab === tab.id ? 0 : -1}
                  className={`tab ${ui.tab === tab.id ? 'active' : ''}`}
                  onClick={() => useApp.getState().setUI({ tab: tab.id })}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                    e.preventDefault();
                    const index = TABS.findIndex((t) => t.id === tab.id);
                    const next = TABS[(index + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
                    useApp.getState().setUI({ tab: next.id });
                    document.getElementById(`tab-${next.id}`)?.focus();
                  }}
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
                aria-label="Start the guided tour"
              >
                ? tour
              </button>
            </div>
            <div
              className="tab-body"
              id={`panel-${ui.tab}`}
              role="tabpanel"
              aria-labelledby={`tab-${ui.tab}`}
            >
              {ui.tab === 'playlist' && <MemoPlaylist />}
              {ui.tab === 'pianoroll' && <MemoPianoRoll />}
              {ui.tab === 'mixer' && <MemoMixer />}
              {ui.tab === 'changelog' && (
                <Suspense fallback={<div className="browser-empty">Loading release notes…</div>}>
                  <Changelog />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </div>

      <MemoHintBar />

      <Suspense fallback={null}>
        {ui.contextMenu && <ContextMenu />}
        {ui.paletteOpen && <CommandPalette />}
        {ui.fixMixOpen && <FixMyMix />}
        {ui.humOpen && <HumToMelody />}
        {ui.inspireOpen && <InspireDialog />}
        {ui.exchangeOpen && <ExchangeDialog />}
        {ui.exportOpen && <ExportDialog />}
        {ui.projectHubOpen && <ProjectHub />}
        {ui.pluginsOpen && <PluginBrowser />}
        {ui.settingsOpen && <SettingsDialog />}
        {ui.aboutOpen && <HelpDialog />}
        {ui.tutorialStep !== null && <Tutorial />}
      </Suspense>
      {dragging && (
        <div className="drop-overlay" role="status" aria-live="assertive">
          <div className="drop-card">
            <strong>Drop it</strong>
            <span>Audio → new sampler channels · MIDI / .als / .rpp / .obeats → open the song</span>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
      {splash !== 'hidden' && <SplashScreen leaving={splash === 'leaving'} />}
    </div>
  );
}
