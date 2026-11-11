import { create } from 'zustand';
import type {
  Channel,
  Clip,
  EffectType,
  KeyAction,
  AutomationPoint,
  AutomationTarget,
  Marker,
  MenuItem,
  Note,
  Pattern,
  PresetId,
  Project,
  SavedProject,
  Settings,
  Strip,
  UIState,
} from './model/types';
import {
  blankProject,
  createChannel,
  createEffect,
  createPattern,
  createStrip,
  DEFAULT_KEYMAP,
  defaultSettings,
  demoProject,
  note as makeNote,
  uid,
} from './model/defaults';
import { engine, routeIsSafe } from './audio/engine';
import { SAMPLE_BANK } from './audio/instruments';
import { advanceAudioClips, startAudioClips, stopAudioClips } from './audio/audioClipTransport';
import { createAudioClipFromDrop, normalizeAudioClips, TICKS_PER_STEP, type AudioClip } from './model/audioClip';
import { splitAudioClip, splitPatternClip } from './model/clipSplit';
import {
  pasteAudioClip,
  pastePatternClip,
  snapshotClip,
  type ClipClipboard,
} from './model/clipClipboard';
import { markerLoopRange, nextMarker, normalizeMarkers, previousMarker } from './model/markers';
import { normalizeAutomation, projectHasAutomation } from './model/automation';
import { putSample } from './audio/mediaStore';
import { buildPeaksOffThread } from './audio/waveformClient';
import { registerSample } from './audio/sampleLibrary';
import { analyzeSample } from './lib/tagging';
import {
  eventsAtPatternStep,
  eventsAtSongStep,
  isChannelAudible,
  patternSteps,
  songLengthSteps,
  stepsToSeconds,
  swingOffset,
} from './audio/sequencer';
import { downloadBlob, renderSongToBuffer, renderSongToWav } from './audio/export';
import { masterBuffer, type MasterTarget } from './lib/mastering';
import { nativeExportAudio } from './lib/nativeAudio';
import { exportFormat, type ExportFormatId } from './lib/exportFormats';
import { checkForUpdate } from './lib/updates';
import { APP_VERSION, DEFAULT_UPDATE_REPO } from './lib/version';
import { isNative, openTextNative, saveBinaryNative, saveTextNative } from './lib/native';
import { parseMidi, writeMidi } from './lib/daw/midi';
import { parseAls } from './lib/daw/als';
import { parseRpp, writeRpp } from './lib/daw/rpp';
import { exchangeFromProject, projectFromExchange } from './lib/daw/project';

const PROJECT_KEY = 'openbeats.project.v1';
const SETTINGS_KEY = 'openbeats.settings.v1';
const AUTOSAVE_KEY = 'openbeats.autosave.v1';
const LIBRARY_KEY = 'openbeats.projects.v1';
export const AUTOSAVE_INTERVALS = [0, 2, 5, 10, 15, 30, 60] as const;

export function currentPattern(project: Project): Pattern | undefined {
  return project.patterns.find((p) => p.id === project.currentPattern) ?? project.patterns[0];
}

export function channelNotes(project: Project, channelId: string): Note[] {
  return currentPattern(project)?.notes[channelId] ?? [];
}

export function channelStrip(project: Project, channel: Channel): Strip | undefined {
  return project.strips.find((s) => s.id === channel.mixer);
}

export function patternById(project: Project, id: string): Pattern | undefined {
  return project.patterns.find((p) => p.id === id);
}

function loadStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function normalizeSettings(raw: Partial<Settings> | null): Settings {
  const base = defaultSettings();
  if (!raw) return base;
  const minutes = AUTOSAVE_INTERVALS.includes(raw.autosaveMinutes as (typeof AUTOSAVE_INTERVALS)[number])
    ? (raw.autosaveMinutes as Settings['autosaveMinutes'])
    : (raw as Partial<Settings> & { autoSave?: boolean }).autoSave === false
      ? 0
      : base.autosaveMinutes;
  const storedRepo = typeof raw.updateRepo === 'string' ? raw.updateRepo.trim() : '';
  const updateRepo =
    !storedRepo || storedRepo.toLowerCase() === 'openbeats/openbeats'
      ? DEFAULT_UPDATE_REPO
      : storedRepo;
  return {
    ...base,
    ...raw,
    updateRepo,
    autosaveMinutes: minutes,
    keymap: { ...DEFAULT_KEYMAP, ...(raw.keymap ?? {}) },
    customTheme: { ...base.customTheme, ...(raw.customTheme ?? {}) },
    fxChains: Array.isArray(raw.fxChains) ? raw.fxChains : [],
    layouts: Array.isArray(raw.layouts) ? raw.layouts : [],
  };
}

export function normalizeProject(raw: unknown): Project {
  const base = blankProject();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Project>;
  const channels = Array.isArray(p.channels) && p.channels.length ? p.channels : base.channels;
  const patterns = Array.isArray(p.patterns) && p.patterns.length ? p.patterns : base.patterns;
  const strips = Array.isArray(p.strips) && p.strips.length ? p.strips : base.strips;
  return {
    ...base,
    ...p,
    version: 1,
    channels: channels.map((c) => ({ ...createChannel({ preset: c.preset ?? 'kick' }), ...c })),
    patterns: patterns.map((pat) => ({ ...createPattern('Pattern', '#888', 2), ...pat, notes: pat.notes ?? {} })),
    strips: strips.map((s, i) => ({
      ...createStrip(s.id ?? i, s.name ?? 'Insert', s.color ?? '#888'),
      ...s,
      automation: normalizeAutomation(s.automation),
    })),
    tracks: Array.isArray(p.tracks) && p.tracks.length ? p.tracks : base.tracks,
    clips: Array.isArray(p.clips) ? p.clips : [],
    markers: normalizeMarkers(p.markers),
    // Projects written before 1.0.5 have no audioClips key; they load unchanged.
    audioClips: normalizeAudioClips(p.audioClips),
    currentPattern: patterns.some((x) => x.id === p.currentPattern) ? (p.currentPattern as string) : patterns[0].id,
    selectedChannel: channels.some((c) => c.id === p.selectedChannel) ? (p.selectedChannel as string) : channels[0].id,
    selectedStrip: typeof p.selectedStrip === 'number' ? p.selectedStrip : 0,
    updatedAt: Date.now(),
  } as Project;
}

interface History {
  past: Project[];
  future: Project[];
}

export interface AppState {
  project: Project;
  savedProjects: SavedProject[];
  settings: Settings;
  ui: UIState;
  transport: { playing: boolean; songMode: boolean; record: boolean; step: number; anchorStep: number; anchorTime: number };
  history: History;
  audioReady: boolean;
  audioError: string | null;
  lastSaved: number | null;
  /** Transient; clip copy/cut/paste is intentionally not saved in the project. */
  clipClipboard: ClipClipboard | null;

  patchProject(updater: (p: Project) => void, opts?: { history?: boolean; coalesce?: string }): void;
  pushHistory(coalesce?: string): void;
  undo(): void;
  redo(): void;
  patchSettings(patch: Partial<Settings>): void;
  setUI(patch: Partial<UIState>): void;
  hint(text: string): void;
  toast(text: string): void;
  openMenu(x: number, y: number, items: MenuItem[]): void;
  closeMenu(): void;

  initAudio(): Promise<boolean>;
  togglePlay(): void;
  play(fromStep?: number): void;
  stop(): void;
  updatePlayhead(): void;
  toggleSongMode(): void;
  toggleRecord(): void;
  rewind(): void;
  seek(step: number): void;
  setBpm(value: number): void;
  setSwing(value: number): void;
  toggleMetronome(): void;

  selectChannel(id: string): void;
  addChannel(preset: PresetId): void;
  /** Creates a channel, playlist track and mixer strip as one linked unit. */
  addLinkedChannel(preset: PresetId): void;
  updateChannel(id: string, patch: Partial<Channel>, coalesce?: string): void;
  removeChannel(id: string): void;
  duplicateChannel(id: string): void;
  /** Moves an existing channel onto a fresh playlist track and mixer strip. */
  relinkChannel(channelId: string): void;
  toggleStep(channelId: string, step: number): void;
  clearChannelSteps(channelId: string): void;

  selectPattern(id: string): void;
  addPattern(): void;
  duplicatePattern(id?: string): void;
  renamePattern(id: string, name: string): void;
  setPatternBars(id: string, bars: number): void;
  removePattern(id: string): void;

  addNote(channelId: string, note: Omit<Note, 'id'>): void;
  updateNote(channelId: string, noteId: string, patch: Partial<Note>, coalesce?: string): void;
  removeNote(channelId: string, noteId: string): void;
  addNotes(channelId: string, notes: Omit<Note, 'id'>[]): void;
  transposeChannel(channelId: string, semitones: number): void;

  addTrack(): void;
  updateTrack(index: number, patch: Partial<Project['tracks'][number]>, coalesce?: string): void;
  removeTrack(index: number): void;
  addMarker(start?: number): void;
  updateMarker(id: string, patch: Partial<Marker>, coalesce?: string): void;
  removeMarker(id: string): void;
  jumpMarker(direction: 1 | -1): void;
  loopFromMarker(id: string): void;
  addClip(patternId: string, track: number, start: number, len: number): void;
  updateClip(id: string, patch: Partial<Clip>, coalesce?: string): void;
  /** Batch edit pattern clips in one history entry. */
  updateClips(ids: string[], patch: Partial<Clip>, coalesce?: string): void;
  removeClip(id: string): void;
  copyClip(id: string): boolean;
  cutClip(id: string): boolean;
  pasteClipAt(atStep: number): string | null;
  splitClipAt(id: string, atStep: number): boolean;
  addAudioClip(clip: AudioClip): void;
  updateAudioClip(id: string, patch: Partial<AudioClip>, coalesce?: string): void;
  /** Batch edit audio clips in one history entry. */
  updateAudioClips(ids: string[], patch: Partial<AudioClip>, coalesce?: string): void;
  removeAudioClip(id: string): void;
  importAudioClipFiles(files: File[], track: number, startTick: number): Promise<number>;

  updateStrip(id: number, patch: Partial<Strip>, coalesce?: string): void;
  setAutomation(stripId: number, target: AutomationTarget, points: AutomationPoint[], coalesce?: string): void;
  addStrip(): void;
  removeStrip(id: number): void;
  selectStrip(id: number): void;
  addEffect(stripId: number, type: EffectType): void;
  addEffectWithParams(stripId: number, type: EffectType, params: Record<string, number>): string;
  removeEffect(stripId: number, effectId: string): void;
  updateEffect(stripId: number, effectId: string, params: Record<string, number>, coalesce?: string): void;
  saveFxChain(stripId: number): void;
  applyFxChain(stripId: number, chainId: string): void;
  removeFxChain(chainId: string): void;
  setRoute(stripId: number, target: number): void;
  addSend(stripId: number, to: number): void;
  updateSend(stripId: number, index: number, amount: number): void;
  removeSend(stripId: number, index: number): void;
  saveWorkspaceLayout(name: string): void;
  applyWorkspaceLayout(id: string): void;
  removeWorkspaceLayout(id: string): void;

  newProject(kind: 'blank' | 'demo'): void;
  saveCurrentProject(name?: string): void;
  openSavedProject(id: string): void;
  deleteSavedProject(id: string): void;
  saveProjectFile(): void;
  openProjectFile(file: File): Promise<void>;
  openProjectNative(): Promise<void>;
  exportWav(): Promise<void>;
  exportSong(opts: { format: ExportFormatId; quality: number; sampleRate: number; master: MasterTarget }): Promise<boolean>;
  importSongFile(file: File): Promise<void>;
  importSampleFiles(files: File[], replaceSelected?: boolean): Promise<void>;
  autosaveNow(): void;
  exportMidi(): Promise<void>;
  exportRpp(): Promise<void>;
  checkUpdates(silent?: boolean): Promise<void>;
  resetAll(): void;
  setKey(action: KeyAction, combo: string): void;
  initPersistence(): void;
}

let playTimer: ReturnType<typeof setInterval> | null = null;
let nextStep = 0;
let nextTime = 0;

let lastCoalesceKey: string | null = null;
let lastCoalesceAt = 0;

function interleaveBuffer(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const lanes = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  const out = new Float32Array(buffer.length * channels);
  for (let i = 0; i < buffer.length; i += 1) {
    for (let c = 0; c < channels; c += 1) out[i * channels + c] = lanes[c][i];
  }
  return out;
}

function seedLibrary(): SavedProject[] {
  let list = loadStored<SavedProject[]>(LIBRARY_KEY) ?? [];
  if (!list.some((entry) => entry.name === 'Tutorial')) {
    const tutorial = demoProject();
    tutorial.name = 'Tutorial';
    list = [{ id: 'tutorial', name: 'Tutorial', updatedAt: Date.now(), project: tutorial }, ...list];
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
    } catch {
      /* storage unavailable */
    }
  }
  return list;
}

const storedSettings = normalizeSettings(loadStored<Settings>(SETTINGS_KEY));
const storedProject = loadStored<Project>(PROJECT_KEY);
const savedProjects = seedLibrary();
const tutorialProject = savedProjects.find((entry) => entry.name === 'Tutorial')?.project;
const initialProject = storedProject ? normalizeProject(storedProject) : normalizeProject(tutorialProject ?? demoProject());

export const useApp = create<AppState>((set, get) => ({
  project: initialProject,
  savedProjects,
  settings: storedSettings,
  ui: {
    tab: 'playlist',
    browserOpen: true,
    rackWidth: 470,
    browserWidth: 232,
    lowerHeight: 46,
    hint: 'Welcome to OpenBeats — press Space to play, or take the tour from Help ▸ Tutorial.',
    contextMenu: null,
    settingsOpen: false,
    aboutOpen: false,
    learnOpen: false,
    tutorialStep: storedSettings.tutorialDone ? null : 0,
    paletteOpen: false,
    fixMixOpen: false,
    humOpen: false,
    inspireOpen: false,
    exchangeOpen: false,
    exportOpen: false,
    projectHubOpen: false,
    pluginsOpen: false,
    update: null,
    updateChecking: false,
    exporting: null,
    toast: null,
  },
  transport: { playing: false, songMode: false, record: false, step: 0, anchorStep: 0, anchorTime: 0 },
  history: { past: [], future: [] },
  audioReady: false,
  audioError: null,
  lastSaved: loadStored<{ savedAt: number }>(AUTOSAVE_KEY)?.savedAt ?? null,
  clipClipboard: null,

  patchProject(updater, opts) {
    if (opts?.history !== false) get().pushHistory(opts?.coalesce);
    const next = structuredClone(get().project);
    updater(next);
    next.updatedAt = Date.now();
    set({ project: next });
    engine.sync(next);
  },

  pushHistory(coalesce) {
    const now = performance.now();
    if (coalesce && coalesce === lastCoalesceKey && now - lastCoalesceAt < 900) {
      lastCoalesceAt = now;
      return;
    }
    lastCoalesceKey = coalesce ?? null;
    lastCoalesceAt = now;
    set((s) => ({
      history: { past: [...s.history.past.slice(-59), s.project], future: [] },
    }));
  },

  undo() {
    const { history, project } = get();
    const prev = history.past[history.past.length - 1];
    if (!prev) return;
    set({
      project: prev,
      history: { past: history.past.slice(0, -1), future: [project, ...history.future].slice(0, 60) },
    });
    engine.sync(prev);
    get().toast('Undo');
  },

  redo() {
    const { history, project } = get();
    const next = history.future[0];
    if (!next) return;
    set({
      project: next,
      history: { past: [...history.past, project].slice(-60), future: history.future.slice(1) },
    });
    engine.sync(next);
    get().toast('Redo');
  },

  patchSettings(patch) {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  },

  setUI(patch) {
    set((s) => ({ ui: { ...s.ui, ...patch } }));
  },

  hint(text) {
    set((s) => ({ ui: { ...s.ui, hint: text } }));
  },

  toast(text) {
    set((s) => ({ ui: { ...s.ui, toast: text } }));
    window.setTimeout(() => {
      if (get().ui.toast === text) set((s) => ({ ui: { ...s.ui, toast: null } }));
    }, 2400);
  },

  openMenu(x, y, items) {
    set((s) => ({ ui: { ...s.ui, contextMenu: { x, y, items } } }));
  },

  closeMenu() {
    set((s) => ({ ui: { ...s.ui, contextMenu: null } }));
  },

  async initAudio() {
    const ok = await engine.ensure(get().project);
    set({ audioReady: ok, audioError: ok ? null : engine.error });
    if (ok) engine.sync(get().project);
    return ok;
  },

  togglePlay() {
    if (get().transport.playing) get().stop();
    else get().play();
  },

  play(fromStep) {
    const start = Math.max(0, fromStep ?? get().transport.step);
    if (nativeShell() && !projectHasAutomation(get().project)) {
      void startNativeFromSnapshot(start).then((ok) => {
        if (!ok) startWebAudioPlayback(start);
      });
      return;
    }
    startWebAudioPlayback(start);
  },

  stop() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    if (nativePoll) {
      clearInterval(nativePoll);
      nativePoll = null;
    }
    if (nativeActive) {
      nativeActive = false;
      void import('./lib/nativeAudio').then((mod) => mod.stopNativePlayback());
    }
    stopAudioClips();
    engine.clearAutomation(get().project);
    set((s) => ({ transport: { ...s.transport, playing: false } }));
  },

  updatePlayhead() {
    const { transport, project } = get();
    if (!transport.playing || nativeActive || !engine.ctx) return;
    const stepSec = stepsToSeconds(1, project.bpm);
    const total = transport.songMode
      ? songLengthSteps(project)
      : patternSteps(project, project.currentPattern);
    const elapsed = Math.max(0, engine.now - transport.anchorTime);
    const step = Math.floor(transport.anchorStep + elapsed / stepSec) % Math.max(1, total);
    if (step !== transport.step) {
      if (step < transport.step && projectHasAutomation(project)) {
        engine.scheduleAutomation(project, step, engine.now);
      }
      set((s) => ({ transport: { ...s.transport, step } }));
    }
  },

  toggleRecord() {
    const record = !get().transport.record;
    set((s) => ({ transport: { ...s.transport, record } }));
    get().hint(
      record
        ? 'Record armed — press Space to roll and play the QWERTY keys to write notes.'
        : 'Record off.',
    );
  },

  toggleSongMode() {
    const songMode = !get().transport.songMode;
    set((s) => ({
      transport: { ...s.transport, songMode, step: 0 },
      ui: { ...s.ui, hint: songMode ? 'Song mode — the playlist arrangement plays.' : 'Pattern mode — the current pattern loops.' },
    }));
    if (get().transport.playing) {
      get().stop();
      get().play(0);
    }
  },

  rewind() {
    get().stop();
    set((s) => ({ transport: { ...s.transport, step: 0, anchorStep: 0 } }));
  },

  seek(step) {
    const target = Math.max(0, Math.round(step));
    const wasPlaying = get().transport.playing;
    if (wasPlaying && nativeActive) {
      // Native playback keeps the stream open and seeks the sequencer, so a
      // playhead drag does not click or drop the audio device.
      void import('./lib/nativeAudio').then((mod) => mod.nativeSetPlayhead(target));
      set((s) => ({
        transport: {
          ...s.transport,
          step: target,
          anchorStep: target,
          anchorTime: performance.now() / 1000,
        },
      }));
      return;
    }
    if (wasPlaying && engine.ctx) {
      // Keep the Web Audio context and play timer alive. Restarting the whole
      // transport on every pointer frame was the source of playhead-drag lag.
      const project = get().project;
      nextStep = target;
      nextTime = engine.now + 0.04;
      set((s) => ({
        transport: {
          ...s.transport,
          step: target,
          anchorStep: target,
          anchorTime: nextTime,
        },
      }));
      if (engine.graph) startAudioClips(engine.ctx, engine.graph.master, project, target);
      if (projectHasAutomation(project)) {
        engine.clearAutomation(project);
        engine.scheduleAutomation(project, target, nextTime);
      }
      return;
    }
    get().stop();
    set((s) => ({ transport: { ...s.transport, step: target, anchorStep: target } }));
  },

  setBpm(value) {
    const bpm = Math.max(20, Math.min(300, value));
    get().patchProject((p) => {
      p.bpm = bpm;
    });
  },

  toggleMetronome() {
    const wasPlaying = get().transport.playing;
    const step = get().transport.step;
    get().patchProject((p) => {
      p.metronome = !p.metronome;
    });
    // The native snapshot carries the metronome flag, so restart the stream at
    // the same step to apply it mid-playback.
    if (wasPlaying) {
      get().stop();
      get().play(step);
    }
  },

  setSwing(value) {
    const swing = Math.max(0, Math.min(0.9, value));
    get().patchProject(
      (p) => {
        p.swing = swing;
      },
      { coalesce: 'swing' },
    );
  },

  selectChannel(id) {
    get().patchProject((p) => {
      p.selectedChannel = id;
    }, { history: false });
  },

  addChannel(preset) {
    const colors = ['#ff8a3d', '#ffc93c', '#6fd08c', '#4cc9f0', '#7b8cff', '#c77dff', '#ff6b9d'];
    get().patchProject((p) => {
      const index = p.channels.length;
      const id = Math.max(0, ...p.strips.map((s) => s.id)) + 1;
      const strip = createStrip(id, '', colors[index % colors.length]);
      strip.name = preset;
      p.strips.push(strip);
      const ch = createChannel({
        preset,
        color: colors[index % colors.length],
        mixer: id,
        name: preset.charAt(0).toUpperCase() + preset.slice(1),
      });
      p.channels.push(ch);
      strip.name = ch.name;
      p.selectedChannel = ch.id;
      strip.route = 0;
    });
    get().toast('Channel added');
  },

  addLinkedChannel(preset) {
    const colors = ['#ff8a3d', '#ffc93c', '#6fd08c', '#4cc9f0', '#7b8cff', '#c77dff', '#ff6b9d'];
    get().patchProject((p) => {
      const color = colors[p.channels.length % colors.length];
      const stripId = Math.max(0, ...p.strips.map((s) => s.id)) + 1;
      const strip = createStrip(stripId, '', color);
      strip.route = 0;
      p.strips.push(strip);
      const channel = createChannel({ preset, color, mixer: stripId });
      strip.name = channel.name;
      p.channels.push(channel);
      p.tracks.push({
        id: uid('tr'),
        name: channel.name,
        color,
        mute: false,
        solo: false,
        height: 92,
      });
      p.selectedChannel = channel.id;
      p.selectedStrip = stripId;
    });
    get().toast('Linked channel, playlist track and mixer strip created');
  },

  updateChannel(id, patch, coalesce) {
    get().patchProject(
      (p) => {
        const ch = p.channels.find((c) => c.id === id);
        if (!ch) return;
        Object.assign(ch, patch);
        const strip = p.strips.find((s) => s.id === ch.mixer);
        if (strip && patch.name) strip.name = patch.name;
        if (strip && patch.color) strip.color = patch.color;
      },
      { coalesce },
    );
  },

  removeChannel(id) {
    get().patchProject((p) => {
      const channel = p.channels.find((c) => c.id === id);
      if (!channel) return;
      p.channels = p.channels.filter((c) => c.id !== id);
      p.patterns.forEach((pat) => {
        delete pat.notes[id];
      });
      const stillUsed = p.channels.some((c) => c.mixer === channel.mixer);
      if (!stillUsed && channel.mixer !== 0) {
        p.strips = p.strips.filter((s) => s.id !== channel.mixer);
      }
      p.selectedChannel = p.channels[0]?.id ?? null;
    });
    get().toast('Channel removed — undo with Ctrl+Z');
  },

  duplicateChannel(id) {
    get().patchProject((p) => {
      const source = p.channels.find((c) => c.id === id);
      if (!source) return;
      const stripId = Math.max(0, ...p.strips.map((s) => s.id)) + 1;
      const clone = structuredClone(source);
      clone.id = uid('ch');
      clone.name = `${source.name} copy`;
      clone.mixer = stripId;
      p.channels.push(clone);
      const strip = createStrip(stripId, clone.name, clone.color);
      strip.effects = source.mixer ? structuredClone(p.strips.find((s) => s.id === source.mixer)?.effects ?? []).map((fx) => ({ ...fx, id: uid('fx') })) : [];
      p.strips.push(strip);
      p.patterns.forEach((pat) => {
        const notes = pat.notes[id];
        if (!notes) return;
        pat.notes[clone.id] = notes.map((n) => ({ ...n, id: uid('n') }));
      });
      p.selectedChannel = clone.id;
    });
    get().toast('Channel cloned');
  },

  relinkChannel(channelId) {
    let label = 'Channel';
    get().patchProject((p) => {
      const channel = p.channels.find((c) => c.id === channelId);
      if (!channel) return;
      label = channel.name;
      const oldId = channel.mixer;
      const oldStrip = p.strips.find((s) => s.id === oldId);
      const stripId = Math.max(0, ...p.strips.map((s) => s.id)) + 1;
      const strip = createStrip(stripId, channel.name, channel.color);
      strip.route = 0;
      // Preserve the processing the channel already had, so relinking does not
      // silently drop a mix. Effect ids are regenerated for the new strip.
      if (oldStrip) {
        strip.effects = oldStrip.effects.map((fx) => ({ ...fx, id: uid('fx'), params: { ...fx.params } }));
        strip.sends = oldStrip.sends.map((send) => ({ ...send }));
        strip.group = oldStrip.group;
        strip.gain = oldStrip.gain;
        strip.pan = oldStrip.pan;
      }
      p.strips.push(strip);
      channel.mixer = stripId;
      p.tracks.push({
        id: uid('tr'),
        name: channel.name,
        color: channel.color,
        mute: false,
        solo: false,
        height: 92,
      });
      // The previous strip is removed only when nothing else feeds it; routes and
      // sends that pointed at it move to the replacement.
      const oldUsed = p.channels.some((c) => c.id !== channelId && c.mixer === oldId);
      if (oldStrip && oldId !== 0 && !oldUsed) {
        p.strips = p.strips.filter((s) => s.id !== oldId);
        p.strips.forEach((s) => {
          if (s.route === oldId) s.route = stripId;
          s.sends.forEach((send) => {
            if (send.to === oldId) send.to = stripId;
          });
        });
        if (p.selectedStrip === oldId) p.selectedStrip = stripId;
      }
      p.selectedChannel = channelId;
      p.selectedStrip = stripId;
    });
    get().toast(`Relinked “${label}” to a new playlist track and mixer strip`);
  },

  toggleStep(channelId, step) {
    get().patchProject((p) => {
      const pat = currentPattern(p);
      const ch = p.channels.find((c) => c.id === channelId);
      if (!pat || !ch) return;
      const notes = pat.notes[channelId] ?? [];
      const existing = notes.findIndex((n) => Math.abs(n.start - step) < 0.01);
      if (existing >= 0) notes.splice(existing, 1);
      else notes.push(makeNote(ch.root + (ch.transpose ?? 0), step, ch.stepLen, 0.85));
      pat.notes[channelId] = notes;
    });
  },

  clearChannelSteps(channelId) {
    get().patchProject((p) => {
      const pat = currentPattern(p);
      if (pat) pat.notes[channelId] = [];
    });
  },

  selectPattern(id) {
    get().patchProject((p) => {
      p.currentPattern = id;
    }, { history: false });
  },

  addPattern() {
    get().patchProject((p) => {
      const pat = createPattern(`Pattern ${p.patterns.length + 1}`, '#7b8cff', 2);
      p.patterns.push(pat);
      p.currentPattern = pat.id;
    });
    get().toast('New pattern');
  },

  duplicatePattern(id) {
    get().patchProject((p) => {
      const source = p.patterns.find((x) => x.id === (id ?? p.currentPattern));
      if (!source) return;
      const clone: Pattern = structuredClone(source);
      clone.id = uid('pat');
      clone.name = `${source.name} copy`;
      Object.keys(clone.notes).forEach((key) => {
        clone.notes[key] = clone.notes[key].map((n) => ({ ...n, id: uid('n') }));
      });
      p.patterns.push(clone);
      p.currentPattern = clone.id;
    });
  },

  renamePattern(id, name) {
    get().patchProject((p) => {
      const pat = p.patterns.find((x) => x.id === id);
      if (pat) pat.name = name;
    });
  },

  setPatternBars(id, bars) {
    get().patchProject((p) => {
      const pat = p.patterns.find((x) => x.id === id);
      if (pat) pat.bars = Math.max(1, Math.min(32, Math.round(bars)));
    });
  },

  removePattern(id) {
    get().patchProject((p) => {
      if (p.patterns.length <= 1) return;
      p.patterns = p.patterns.filter((x) => x.id !== id);
      p.clips = p.clips.filter((c) => c.pattern !== id);
      if (p.currentPattern === id) p.currentPattern = p.patterns[0].id;
    });
  },

  addNote(channelId, n) {
    get().patchProject((p) => {
      const pat = currentPattern(p);
      if (!pat) return;
      const notes = pat.notes[channelId] ?? [];
      notes.push({ ...n, id: uid('n') });
      pat.notes[channelId] = notes;
    });
  },

  updateNote(channelId, noteId, patch, coalesce) {
    get().patchProject(
      (p) => {
        const pat = currentPattern(p);
        const notes = pat?.notes[channelId];
        if (!notes) return;
        const target = notes.find((n) => n.id === noteId);
        if (target) Object.assign(target, patch);
      },
      { coalesce },
    );
  },

  removeNote(channelId, noteId) {
    get().patchProject((p) => {
      const pat = currentPattern(p);
      if (!pat?.notes[channelId]) return;
      pat.notes[channelId] = pat.notes[channelId].filter((n) => n.id !== noteId);
    });
  },

  addNotes(channelId, incoming) {
    get().patchProject((p) => {
      const pat = currentPattern(p);
      if (!pat) return;
      const list = pat.notes[channelId] ?? [];
      incoming.forEach((n) => list.push({ ...n, id: uid('n') }));
      pat.notes[channelId] = list;
    });
  },

  transposeChannel(channelId, semitones) {
    get().patchProject((p) => {
      const pat = currentPattern(p);
      const notes = pat?.notes[channelId];
      if (!notes) return;
      notes.forEach((n) => {
        n.pitch = Math.max(0, Math.min(127, n.pitch + semitones));
      });
    });
    get().toast(`${semitones > 0 ? '+' : ''}${semitones} semitones`);
  },

  addTrack() {
    get().patchProject((p) => {
      p.tracks.push({
        id: uid('tr'),
        name: `Track ${p.tracks.length + 1}`,
        color: '#7b8cff',
        mute: false,
        solo: false,
        height: 92,
      });
    });
  },

  updateTrack(index, patch, coalesce) {
    get().patchProject(
      (p) => {
        const track = p.tracks[index];
        if (track) Object.assign(track, patch);
      },
      { coalesce },
    );
  },

  removeTrack(index) {
    get().patchProject((p) => {
      if (p.tracks.length <= 1) return;
      p.clips = p.clips.filter((c) => c.track !== index).map((c) => (c.track > index ? { ...c, track: c.track - 1 } : c));
      p.tracks.splice(index, 1);
    });
  },

  addMarker(start) {
    const state = get();
    const at = Math.max(0, Math.round(start ?? state.transport.step));
    const markerStart = state.settings.snap ? Math.round(at / state.settings.snap) * state.settings.snap : at;
    state.patchProject((p) => {
      const same = p.markers.filter((m) => Math.abs(m.start - markerStart) < 0.001).length;
      p.markers.push({
        id: uid('mk'),
        name: same ? `Marker ${p.markers.length + 1}` : `Marker ${p.markers.length + 1}`,
        start: markerStart,
      });
      p.markers.sort((a, b) => a.start - b.start);
    });
    state.toast(`Marker at bar ${Math.floor(markerStart / (state.project.beatsPerBar * 4)) + 1}`);
  },

  updateMarker(id, patch, coalesce) {
    get().patchProject(
      (p) => {
        const marker = p.markers.find((m) => m.id === id);
        if (marker) Object.assign(marker, patch);
        p.markers = normalizeMarkers(p.markers);
      },
      { coalesce },
    );
  },

  removeMarker(id) {
    get().patchProject((p) => {
      p.markers = p.markers.filter((m) => m.id !== id);
    });
  },

  jumpMarker(direction) {
    const state = get();
    const marker =
      direction > 0
        ? nextMarker(state.project.markers, state.transport.step)
        : previousMarker(state.project.markers, state.transport.step);
    if (marker) state.seek(marker.start);
    else state.hint(direction > 0 ? 'No later marker' : 'No earlier marker');
  },

  loopFromMarker(id) {
    const state = get();
    const range = markerLoopRange(state.project.markers, id, songLengthSteps(state.project));
    if (!range) return;
    state.patchProject((p) => {
      p.loopStart = range.start;
      p.loopEnd = range.end;
      p.loop = true;
    });
    state.toast(`Looping bars ${Math.floor(range.start / (state.project.beatsPerBar * 4)) + 1}–${Math.ceil(range.end / (state.project.beatsPerBar * 4))}`);
  },

  addClip(patternId, track, start, len) {
    get().patchProject((p) => {
      p.clips.push({ id: uid('cl'), pattern: patternId, track, start: Math.max(0, start), len: Math.max(4, len) });
    });
  },

  updateClip(id, patch, coalesce) {
    get().patchProject(
      (p) => {
        const clip = p.clips.find((c) => c.id === id);
        if (clip) Object.assign(clip, patch);
      },
      { coalesce },
    );
  },

  updateClips(ids, patch, coalesce) {
    if (!ids.length) return;
    const selected = new Set(ids);
    get().patchProject(
      (p) => {
        p.clips.forEach((clip) => {
          if (selected.has(clip.id)) Object.assign(clip, patch);
        });
      },
      { coalesce },
    );
  },

  removeClip(id) {
    get().patchProject((p) => {
      p.clips = p.clips.filter((c) => c.id !== id);
    });
  },

  copyClip(id) {
    const entry = snapshotClip(get().project, id);
    if (!entry) return false;
    set({ clipClipboard: entry });
    get().hint(`${entry.kind === 'audio' ? 'Audio' : 'Pattern'} clip copied`);
    return true;
  },

  cutClip(id) {
    const entry = snapshotClip(get().project, id);
    if (!entry) return false;
    set({ clipClipboard: entry });
    if (entry.kind === 'pattern') get().removeClip(id);
    else get().removeAudioClip(id);
    get().toast('Clip cut — paste it at the playhead');
    return true;
  },

  pasteClipAt(atStep) {
    const entry = get().clipClipboard;
    if (!entry) {
      get().hint('Clipboard is empty');
      return null;
    }
    if (entry.kind === 'pattern' && !get().project.patterns.some((p) => p.id === entry.clip.pattern)) {
      get().toast('The copied pattern no longer exists');
      return null;
    }
    let newId: string | null = null;
    get().patchProject((p) => {
      const track = Math.max(0, Math.min(entry.clip.track, Math.max(0, p.tracks.length - 1)));
      if (entry.kind === 'pattern') {
        const id = uid('cl');
        newId = id;
        p.clips.push(pastePatternClip(entry.clip, atStep, track, id));
      } else {
        const id = uid('ac');
        newId = id;
        p.audioClips.push(pasteAudioClip(entry.clip, atStep, track, id));
      }
    });
    if (newId) get().toast('Clip pasted at the playhead');
    return newId;
  },

  splitClipAt(id, atStep) {
    let split = false;
    get().patchProject((p) => {
      const patternIndex = p.clips.findIndex((clip) => clip.id === id);
      if (patternIndex >= 0) {
        const clip = p.clips[patternIndex];
        const parts = splitPatternClip(clip, atStep, () => uid('cl'));
        if (parts) {
          p.clips.splice(patternIndex, 1, ...parts);
          split = true;
        }
        return;
      }
      const audioIndex = p.audioClips.findIndex((clip) => clip.id === id);
      if (audioIndex < 0) return;
      const clip = p.audioClips[audioIndex];
      const parts = splitAudioClip(clip, atStep * TICKS_PER_STEP, () => uid('ac'));
      if (parts) {
        p.audioClips.splice(audioIndex, 1, ...parts);
        split = true;
      }
    });
    return split;
  },

  addAudioClip(clip) {
    get().patchProject((p) => {
      p.audioClips.push(clip);
    });
  },

  updateAudioClip(id, patch, coalesce) {
    get().patchProject(
      (p) => {
        const clip = p.audioClips.find((c) => c.id === id);
        if (clip) Object.assign(clip, patch);
      },
      { coalesce },
    );
  },

  updateAudioClips(ids, patch, coalesce) {
    if (!ids.length) return;
    const selected = new Set(ids);
    get().patchProject(
      (p) => {
        p.audioClips.forEach((clip) => {
          if (selected.has(clip.id)) Object.assign(clip, patch);
        });
      },
      { coalesce },
    );
  },

  removeAudioClip(id) {
    get().patchProject((p) => {
      p.audioClips = p.audioClips.filter((c) => c.id !== id);
    });
  },

  /**
   * Drop handler for playlist audio clips: decode, hash into the media store,
   * compute peak LODs off the UI thread, then commit the model clip.
   * ES/CPAL note: the clip plays through Web Audio only (native pending).
   */
  async importAudioClipFiles(files, track, startTick) {
    await get().initAudio();
    const ctx = engine.ctx;
    if (!ctx) {
      get().toast('Audio could not start — click the studio and try again');
      return 0;
    }
    let cursor = Math.max(0, startTick);
    let added = 0;
    for (const file of files) {
      try {
        const bytes = await file.arrayBuffer();
        // decodeAudioData detaches its input, so hand it a copy and keep the
        // original for hashing into the media store.
        const buffer = await ctx.decodeAudioData(bytes.slice(0));
        const ref = await putSample({
          bytes,
          name: file.name,
          mime: file.type || 'audio/wav',
        });
        const sampleId = uid('smp');
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
          buffer.getChannelData(i),
        );
        // Peaks are computed on drop, never during the drag (ghost only).
        const pyramid = await buildPeaksOffThread(sampleId, channels);
        registerSample(sampleId, buffer, ref, pyramid);
        const clip = createAudioClipFromDrop({
          id: uid('ac'),
          sampleId,
          mediaRef: ref,
          name: file.name,
          bpm: get().project.bpm,
          durationSec: buffer.duration,
          track,
          startTick: cursor,
        });
        get().addAudioClip(clip);
        cursor += clip.length_ticks;
        added += 1;
      } catch (err) {
        console.warn(`Could not import audio clip “${file.name}”`, err);
        get().toast(`Could not import “${file.name}” as an audio clip`);
      }
    }
    if (added) {
      get().toast(
        `${added} audio clip${added === 1 ? '' : 's'} added — Web Audio only in 1.0.5 (native playback pending)`,
      );
    }
    return added;
  },

  updateStrip(id, patch, coalesce) {
    get().patchProject(
      (p) => {
        const strip = p.strips.find((s) => s.id === id);
        if (strip) Object.assign(strip, patch);
      },
      { coalesce },
    );
  },

  setAutomation(stripId, target, points, coalesce) {
    get().patchProject(
      (p) => {
        const strip = p.strips.find((s) => s.id === stripId);
        if (!strip) return;
        strip.automation = normalizeAutomation([
          ...strip.automation.filter((lane) => lane.target !== target),
          { target, points },
        ]);
      },
      { coalesce },
    );
  },

  addStrip() {
    let newId = 0;
    get().patchProject((p) => {
      newId = Math.max(0, ...p.strips.map((s) => s.id)) + 1;
      p.strips.push(createStrip(newId, `Insert ${newId}`, '#8ecae6'));
    });
    get().selectStrip(newId);
    get().toast('Insert added — set its input from a channel’s FX route');
  },

  removeStrip(id) {
    if (id === 0) return;
    get().patchProject((p) => {
      p.strips = p.strips.filter((s) => s.id !== id);
      p.channels.forEach((c) => {
        if (c.mixer === id) c.mixer = 0;
      });
      p.strips.forEach((s) => {
        if (s.route === id) s.route = 0;
        s.sends = s.sends.filter((send) => send.to !== id);
      });
      if (p.selectedStrip === id) p.selectedStrip = 0;
    });
  },

  selectStrip(id) {
    get().patchProject((p) => {
      p.selectedStrip = id;
    }, { history: false });
  },

  addEffect(stripId, type) {
    get().patchProject((p) => {
      const strip = p.strips.find((s) => s.id === stripId);
      if (!strip) return;
      strip.effects.push(createEffect(type));
    });
  },

  addEffectWithParams(stripId, type, params) {
    let created = '';
    get().patchProject((p) => {
      const strip = p.strips.find((s) => s.id === stripId);
      if (!strip) return;
      const fx = createEffect(type);
      fx.params = { ...fx.params, ...params };
      created = fx.id;
      strip.effects.push(fx);
    });
    return created;
  },

  removeEffect(stripId, effectId) {
    get().patchProject((p) => {
      const strip = p.strips.find((s) => s.id === stripId);
      if (!strip) return;
      strip.effects = strip.effects.filter((fx) => fx.id !== effectId);
    });
  },

  saveFxChain(stripId) {
    const strip = get().project.strips.find((s) => s.id === stripId);
    if (!strip) return;
    if (!strip.effects.length) {
      get().toast('Add an effect before saving a chain');
      return;
    }
    const base = strip.id === 0 ? 'Master' : strip.name.trim() || `Insert ${strip.id}`;
    const existing = get().settings.fxChains;
    const used = new Set(existing.map((chain) => chain.name));
    let name = `${base} chain`;
    let suffix = 2;
    while (used.has(name)) {
      name = `${base} chain ${suffix}`;
      suffix += 1;
    }
    const chain = {
      id: uid('chain'),
      name,
      effects: strip.effects.map((fx) => ({ ...fx, id: uid('fx'), params: { ...fx.params } })),
    };
    get().patchSettings({ fxChains: [...existing, chain] });
    get().toast(`Saved “${name}” (${chain.effects.length} fx)`);
  },

  applyFxChain(stripId, chainId) {
    const chain = get().settings.fxChains.find((item) => item.id === chainId);
    if (!chain) return;
    get().patchProject((p) => {
      const strip = p.strips.find((s) => s.id === stripId);
      if (!strip) return;
      strip.effects = chain.effects.map((fx) => ({ ...fx, id: uid('fx'), params: { ...fx.params } }));
    });
    get().toast(`Loaded “${chain.name}” (${chain.effects.length} fx)`);
  },

  removeFxChain(chainId) {
    get().patchSettings({
      fxChains: get().settings.fxChains.filter((chain) => chain.id !== chainId),
    });
  },

  updateEffect(stripId, effectId, params, coalesce) {
    get().patchProject(
      (p) => {
        const strip = p.strips.find((s) => s.id === stripId);
        const fx = strip?.effects.find((e) => e.id === effectId);
        if (fx) Object.assign(fx.params, params);
      },
      { coalesce },
    );
  },

  setRoute(stripId, target) {
    if (!routeIsSafe(get().project, stripId, target)) {
      get().toast('That route would create a feedback loop');
      return;
    }
    get().updateStrip(stripId, { route: target });
  },

  addSend(stripId, to) {
    if (to === stripId) return;
    if (!routeIsSafe(get().project, stripId, to)) {
      get().toast('That send would create a feedback loop');
      return;
    }
    get().patchProject((p) => {
      const strip = p.strips.find((s) => s.id === stripId);
      if (!strip || strip.sends.some((x) => x.to === to)) return;
      strip.sends.push({ to, amount: 0.25 });
    });
  },

  updateSend(stripId, index, amount) {
    get().patchProject(
      (p) => {
        const strip = p.strips.find((s) => s.id === stripId);
        if (strip?.sends[index]) strip.sends[index].amount = amount;
      },
      { coalesce: `send:${stripId}:${index}` },
    );
  },

  removeSend(stripId, index) {
    get().patchProject((p) => {
      const strip = p.strips.find((s) => s.id === stripId);
      if (strip) strip.sends.splice(index, 1);
    });
  },

  saveWorkspaceLayout(name) {
    const trimmed = name.trim();
    if (!trimmed) {
      get().toast('Name the layout first');
      return;
    }
    const { ui, project, settings } = get();
    const layout = {
      id: uid('lay'),
      name: trimmed,
      rackWidth: ui.rackWidth,
      browserWidth: ui.browserWidth,
      lowerHeight: ui.lowerHeight,
      browserOpen: ui.browserOpen,
      tab: ui.tab,
      collapsedGroups: project.strips.filter((s) => s.collapsed && s.group).map((s) => s.group),
    };
    get().patchSettings({
      layouts: [...settings.layouts.filter((item) => item.name !== trimmed), layout],
    });
    get().toast(`Layout “${trimmed}” saved`);
  },

  applyWorkspaceLayout(id) {
    const layout = get().settings.layouts.find((item) => item.id === id);
    if (!layout) return;
    get().setUI({
      rackWidth: layout.rackWidth,
      browserWidth: layout.browserWidth,
      lowerHeight: layout.lowerHeight,
      browserOpen: layout.browserOpen,
      tab: layout.tab,
    });
    const groups = new Set(layout.collapsedGroups);
    get().patchProject(
      (p) => {
        p.strips.forEach((strip) => {
          if (strip.group) strip.collapsed = groups.has(strip.group);
        });
      },
      { history: false },
    );
    get().toast(`Layout “${layout.name}” applied`);
  },

  removeWorkspaceLayout(id) {
    get().patchSettings({ layouts: get().settings.layouts.filter((layout) => layout.id !== id) });
  },

  newProject(kind) {
    get().stop();
    const project = kind === 'demo' ? demoProject() : blankProject();
    if (kind === 'blank') project.name = 'Untitled';
    set({
      project,
      history: { past: [...get().history.past, get().project].slice(-60), future: [] },
      transport: { ...get().transport, step: 0, anchorStep: 0 },
    });
    engine.sync(project);
    get().toast(kind === 'demo' ? 'Demo song loaded' : 'New project');
  },

  saveCurrentProject(name) {
    const current = get().project;
    const project = structuredClone(current);
    if (name?.trim()) project.name = name.trim();
    const now = Date.now();
    const existing = get().savedProjects.find((entry) => entry.name === project.name || entry.id === project.name);
    const entry: SavedProject = {
      id: existing?.id ?? uid('prj'),
      name: project.name,
      updatedAt: now,
      project: { ...project, updatedAt: now },
    };
    const savedProjects = existing
      ? get().savedProjects.map((item) => (item.id === existing.id ? entry : item))
      : [entry, ...get().savedProjects];
    set({ savedProjects, project: { ...project, updatedAt: now } });
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(savedProjects));
    } catch {
      /* storage full */
    }
    get().toast(`Saved “${project.name}” to Projects`);
  },

  openSavedProject(id) {
    const entry = get().savedProjects.find((item) => item.id === id);
    if (!entry) return;
    const project = normalizeProject(structuredClone(entry.project));
    get().stop();
    set({
      project,
      history: { past: [...get().history.past, get().project].slice(-60), future: [] },
      transport: { ...get().transport, step: 0, anchorStep: 0 },
      ui: { ...get().ui, projectHubOpen: false },
    });
    engine.sync(project);
    get().toast(`Opened “${project.name}”`);
  },

  deleteSavedProject(id) {
    if (id === 'tutorial') {
      get().toast('The Tutorial project is part of the app');
      return;
    }
    const savedProjects = get().savedProjects.filter((entry) => entry.id !== id);
    set({ savedProjects });
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(savedProjects));
    } catch {
      /* storage full */
    }
    get().toast('Project removed from the library');
  },

  async saveProjectFile() {
    const project = get().project;
    const text = JSON.stringify({ format: 'openbeats-project', version: 1, project }, null, 2);
    const filename = `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'project'}.obeats`;
    // Native builds get a real OS save dialog; the browser falls back to a download.
    if (await saveTextNative(text, filename)) {
      get().toast('Project saved to disk');
      return;
    }
    downloadBlob(new Blob([text], { type: 'application/json' }), filename);
    get().toast('Project saved as .obeats');
  },

  async openProjectFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const raw = parsed.project ?? parsed;
      const project = normalizeProject(raw);
      get().stop();
      set({
        project,
        history: { past: [...get().history.past, get().project].slice(-60), future: [] },
        transport: { ...get().transport, step: 0, anchorStep: 0 },
      });
      engine.sync(project);
      get().toast(`Opened “${project.name}”`);
    } catch (err) {
      get().toast('That file is not a valid OpenBeats project');
      console.error(err);
    }
  },

  async exportWav() {
    await get().exportSong({
      format: 'wav16',
      quality: 5,
      sampleRate: 44100,
      master: get().settings.masterTarget,
    });
  },

  async exportSong({ format, quality, sampleRate, master }) {
    const state = get();
    state.stop();
    set((s) => ({ ui: { ...s.ui, exporting: { progress: 0 } } }));
    const name = state.project.name.replace(/[^\w\- ]+/g, '').trim() || 'openbeats';
    try {
      if (!isNative()) {
        if (format !== 'wav16') {
          get().toast('That format needs the desktop build — the browser writes 16-bit WAV');
          return false;
        }
        const blob = await renderSongToWav(state.project, { sampleRate, master });
        downloadBlob(blob, master === 'none' ? `${name}.wav` : `${name}-${master}.wav`);
        get().toast(master === 'none' ? 'WAV exported — check your downloads' : `Mastered for ${master} — WAV downloaded`);
        return true;
      }

      const rendered = await renderSongToBuffer(state.project, { sampleRate });
      const buffer = master === 'none' ? rendered : await masterBuffer(rendered, master);
      const saved = await nativeExportAudio({
        format,
        quality,
        sampleRate,
        channels: buffer.numberOfChannels,
        pcm: interleaveBuffer(buffer),
      });
      if (!saved) {
        get().toast('The export was cancelled');
        return false;
      }
      const file = saved.split(/[\\/]/).pop() || 'audio';
      get().toast(`Saved ${file} — ${exportFormat(format).name}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/cancel/i.test(message)) {
        get().toast('The export was cancelled');
      } else {
        console.error(err);
        get().toast(message || 'Export failed — see the console for details');
      }
      return false;
    } finally {
      set((s) => ({ ui: { ...s.ui, exporting: null } }));
    }
  },

  async openProjectNative() {
    const text = await openTextNative();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      const project = normalizeProject(parsed.project ?? parsed);
      get().stop();
      set({
        project,
        history: { past: [...get().history.past, get().project].slice(-60), future: [] },
        transport: { ...get().transport, step: 0, anchorStep: 0 },
      });
      engine.sync(project);
      get().toast(`Opened “${project.name}”`);
    } catch {
      get().toast('That file is not a valid OpenBeats project');
    }
  },

  async importSongFile(file) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    try {
      if (ext === 'obeats' || ext === 'json') {
        await get().openProjectFile(file);
        return;
      }
      let song;
      if (ext === 'mid' || ext === 'midi' || ext === 'smf') {
        song = parseMidi(await file.arrayBuffer());
      } else if (ext === 'als') {
        song = await parseAls(await file.arrayBuffer());
      } else if (ext === 'rpp') {
        song = parseRpp(await file.text());
      } else {
        throw new Error('Unsupported file type');
      }
      const project = projectFromExchange(song);
      get().stop();
      set({
        project,
        history: { past: [...get().history.past, get().project].slice(-60), future: [] },
        transport: { ...get().transport, step: 0, anchorStep: 0 },
        ui: { ...get().ui, exchangeOpen: false, tab: 'playlist' },
      });
      engine.sync(project);
      get().toast(
        `Imported ${song.tracks.length} track${song.tracks.length === 1 ? '' : 's'} from ${
          ext === 'als' ? 'Ableton' : ext === 'rpp' ? 'REAPER' : 'MIDI'
        }`,
      );
    } catch (err) {
      console.error(err);
      get().toast(err instanceof Error ? err.message : 'That song could not be imported');
    }
  },

  async importSampleFiles(files, replaceSelected = false) {
    const audio = files.filter(
      (file) => file.type.startsWith('audio/') || /\.(wav|mp3|ogg|oga|flac|m4a|aiff?|webm)$/i.test(file.name),
    );
    if (!audio.length) {
      get().toast('Drop WAV, MP3, OGG, FLAC or AIFF files to import sounds');
      return;
    }
    await get().initAudio();
    const ctx = engine.ctx;
    if (!ctx) {
      get().toast('Audio could not start — check your browser permissions');
      return;
    }
    type Loaded = { name: string; sample: NonNullable<Channel['sample']> };
    const loaded: Loaded[] = [];
    for (const file of audio) {
      try {
        const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        const id = uid('smp');
        SAMPLE_BANK.set(id, buffer);
        const tags = analyzeSample(buffer);
        loaded.push({
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 22) || 'Sample',
          sample: { id, name: file.name, root: 60, tags: tags.tags, bpm: tags.bpm, brightness: tags.brightness, kind: tags.type },
        });
      } catch {
        /* skip files the platform cannot decode */
      }
    }
    if (!loaded.length) {
      get().toast('Those audio files could not be decoded');
      return;
    }
    const colors = ['#ff8a3d', '#ffc93c', '#6fd08c', '#4cc9f0', '#7b8cff', '#c77dff', '#ff6b9d'];
    get().patchProject((p) => {
      loaded.forEach((item, i) => {
        const selected = p.channels.find((c) => c.id === p.selectedChannel) ?? p.channels[0];
        if (replaceSelected && i === 0 && selected) {
          Object.assign(selected, { preset: 'sample', name: item.name, sample: item.sample, gain: 0.85 });
          return;
        }
        const index = p.channels.length;
        const stripId = Math.max(0, ...p.strips.map((s) => s.id)) + 1;
        const color = colors[index % colors.length];
        const strip = createStrip(stripId, item.name, color);
        strip.route = 0;
        const channel = createChannel({ preset: 'sample', name: item.name, color, mixer: stripId, sample: item.sample, gain: 0.85 });
        p.channels.push(channel);
        p.strips.push(strip);
        p.selectedChannel = channel.id;
      });
    });
    const failed = audio.length - loaded.length;
    get().toast(
      `Imported ${loaded.length} sound${loaded.length === 1 ? '' : 's'}${failed ? ` · ${failed} could not be decoded` : ''}`,
    );
  },

  autosaveNow() {
    try {
      const savedAt = Date.now();
      localStorage.setItem(PROJECT_KEY, JSON.stringify(get().project));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(get().settings));
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt }));
      set({ lastSaved: savedAt });
    } catch {
      /* storage full or blocked */
    }
    // Mirror the autosave into the native recovery thread, which flushes a
    // hidden .recovery file at most every 30 seconds.
    if (isNative()) {
      const snapshot = JSON.stringify(get().project);
      void import('./lib/nativeAudio')
        .then(async ({ startSessionRecovery, recoveryUpdate }) => {
          await startSessionRecovery();
          await recoveryUpdate(snapshot);
        })
        .catch(() => {
          /* recovery is best effort */
        });
    }
  },

  async exportMidi() {
    const project = get().project;
    const song = exchangeFromProject(project);
    if (!song.tracks.length) {
      get().toast('Add some notes before exporting MIDI');
      return;
    }
    const bytes = writeMidi(song);
    const name = `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'openbeats'}.mid`;
    if (await saveBinaryNative(bytes, name)) get().toast('MIDI saved to disk');
    else {
      downloadBlob(new Blob([bytes as BlobPart], { type: 'audio/midi' }), name);
      get().toast('MIDI exported — open it in any DAW');
    }
  },

  async exportRpp() {
    const project = get().project;
    const song = exchangeFromProject(project);
    if (!song.tracks.length) {
      get().toast('Add some notes before exporting a REAPER project');
      return;
    }
    const text = writeRpp(song);
    const name = `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'openbeats'}.rpp`;
    if (await saveTextNative(text, name)) get().toast('REAPER project saved');
    else {
      downloadBlob(new Blob([text], { type: 'text/plain' }), name);
      get().toast('REAPER project exported');
    }
  },

  async checkUpdates(silent = false) {
    if (get().ui.updateChecking) return;
    set((s) => ({ ui: { ...s.ui, updateChecking: true } }));
    const info = await checkForUpdate(APP_VERSION, get().settings.updateRepo);
    set((s) => ({ ui: { ...s.ui, updateChecking: false, update: info } }));
    if (info) get().toast(`Version ${info.version} is available`);
    else if (!silent) get().toast('You are on the latest build');
  },

  resetAll() {
    localStorage.removeItem(PROJECT_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    window.location.reload();
  },

  setKey(action, combo) {
    set((s) => ({ settings: { ...s.settings, keymap: { ...s.settings.keymap, [action]: combo } } }));
  },

  initPersistence() {
    let timer: number | null = null;
    let lastProject = get().project;
    let lastSettings = get().settings;
    let dirty = false;
    const save = () => {
      if (!get().settings.autosaveMinutes) return;
      get().autosaveNow();
      dirty = false;
    };
    const schedule = () => {
      if (timer) window.clearInterval(timer);
      timer = null;
      const minutes = get().settings.autosaveMinutes;
      if (!minutes) return;
      timer = window.setInterval(() => {
        if (dirty) save();
      }, minutes * 60_000);
    };
    useApp.subscribe((state) => {
      if (state.project !== lastProject) {
        lastProject = state.project;
        dirty = true;
      }
      if (state.settings !== lastSettings) {
        lastSettings = state.settings;
        dirty = true;
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(lastSettings));
        } catch {
          /* storage full or blocked */
        }
        schedule();
      }
    });
    schedule();
    window.addEventListener('pagehide', () => {
      if (get().settings.autosaveMinutes) save();
    });
  },
}));

function tick() {
  const state = useApp.getState();
  const ctx = engine.ctx;
  if (!ctx || !state.transport.playing) return;
  const { project, transport } = state;
  const stepSec = stepsToSeconds(1, project.bpm);
  const total = transport.songMode ? songLengthSteps(project) : patternSteps(project, project.currentPattern);
  let guard = 0;
  while (nextTime < ctx.currentTime + 0.15 && guard < 128) {
    const local = ((nextStep % total) + total) % total;
    // Playlist audio clips are scheduled by Web Audio only (native pending).
    // `advanceAudioClips` detects the wrap because `local` moves backwards, and
    // then queues the next loop pass at the wrapped offset.
    if (transport.songMode) advanceAudioClips(project, local);
    if (!project.loop && nextStep >= total) {
      state.stop();
      return;
    }
    const events = transport.songMode
      ? eventsAtSongStep(project, local)
      : eventsAtPatternStep(project, project.currentPattern, local);
    for (const event of events) {
      if (!isChannelAudible(project, event.channelId)) continue;
      const channel = project.channels.find((c) => c.id === event.channelId);
      if (!channel) continue;
      const swing = swingOffset(local, project.swing, stepSec);
      engine.triggerChannel(
        channel,
        event.pitch,
        event.vel * (event.gain ?? 1),
        nextTime + swing,
        event.lenSteps * stepSec * 0.96,
      );
    }
    if (project.metronome && local % 4 === 0) {
      engine.click(nextTime, local % 16 === 0);
    }
    nextStep += 1;
    nextTime += stepSec;
    guard += 1;
  }
}

/** Preview a channel from the browser/rack, initialising audio on demand. */
export function previewChannel(channel: Channel) {
  previewPitch(channel, channel.root);
}

/* ------------------------------------------------------------------ *
 * Native (Rust/CPAL) transport
 * ------------------------------------------------------------------ */

let nativeActive = false;
let nativePoll: number | null = null;

/** Clock used by the visual playhead; native and Web Audio use different epochs. */
export function transportNow(): number {
  return nativeActive ? performance.now() / 1000 : engine.now;
}

/** True inside the Tauri shell, where the Rust engine can take the transport. */
function nativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

async function startNativeFromSnapshot(start: number): Promise<boolean> {
  const { buildPlaybackSnapshot, startNativePlayback } = await import('./lib/nativeAudio');
  const { project, transport } = useApp.getState();
  const snapshot = buildPlaybackSnapshot(project, transport.songMode, start);
  const status = await startNativePlayback(snapshot);
  if (!status) return false;

  nativeActive = true;
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
  useApp.setState((s) => ({
    audioReady: true,
    audioError: null,
    transport: {
      ...s.transport,
      playing: true,
      anchorStep: start,
      anchorTime: performance.now() / 1000,
      step: start,
    },
    ui: { ...s.ui, hint: `Playing natively on ${status.device} — Space to stop.` },
  }));
  if (nativePoll) clearInterval(nativePoll);
  nativePoll = window.setInterval(() => {
    void pollNativeTransport();
  }, 60);
  return true;
}

async function pollNativeTransport() {
  const { nativePlaybackState } = await import('./lib/nativeAudio');
  const state = await nativePlaybackState();
  if (!state) return;
  const store = useApp.getState();
  if (!state.playing) {
    if (store.transport.playing) store.stop();
    return;
  }
  if (state.step !== store.transport.step) {
    useApp.setState((s) => ({ transport: { ...s.transport, step: state.step } }));
  }
}

function startWebAudioPlayback(start: number) {
  void useApp.getState().initAudio().then((ok) => {
    if (!ok || !engine.ctx) {
      useApp.getState().toast(engine.error ?? 'Audio could not start — click the studio and try again');
      return;
    }
    if (playTimer) clearInterval(playTimer);
    nextStep = Math.max(0, start);
    nextTime = engine.now + 0.08;
    useApp.setState((s) => ({
      transport: {
        ...s.transport,
        playing: true,
        anchorStep: nextStep,
        anchorTime: nextTime,
        step: nextStep,
      },
      ui: { ...s.ui, hint: 'Playing — Space to stop, L toggles pattern/song mode.' },
    }));
    const project = useApp.getState().project;
    if (engine.ctx && engine.graph) {
      startAudioClips(engine.ctx, engine.graph.master, project, nextStep);
      if (projectHasAutomation(project)) engine.scheduleAutomation(project, nextStep, nextTime);
    }
    playTimer = setInterval(() => tick(), 20);
  });
}

export function previewPitch(channel: Channel, pitch: number) {
  // Native builds audition through CPAL, independent of the transport; the
  // Web Audio path is only for the browser demo.
  if (nativeShell()) {
    void import('./lib/nativeAudio').then(({ nativePlayTestNote }) =>
      nativePlayTestNote({
        preset: channel.preset,
        pitch,
        gain: channel.gain,
        pan: channel.pan,
        root: channel.root,
        attack: channel.attack,
        decay: channel.decay,
        release: channel.release,
        tone: channel.tone,
      }),
    );
    return;
  }
  const state = useApp.getState();
  void state.initAudio().then(() => {
    if (engine.ctx) engine.preview(channel, pitch);
  });
}
