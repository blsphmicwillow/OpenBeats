import { create } from 'zustand';
import type {
  Channel,
  Clip,
  EffectType,
  KeyAction,
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
import { downloadBlob, renderSongToWav } from './audio/export';
import { checkForUpdate } from './lib/updates';
import { APP_VERSION, DEFAULT_UPDATE_REPO } from './lib/version';
import { openTextNative, saveBinaryNative, saveTextNative } from './lib/native';
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
    strips: strips.map((s, i) => ({ ...createStrip(s.id ?? i, s.name ?? 'Insert', s.color ?? '#888'), ...s })),
    tracks: Array.isArray(p.tracks) && p.tracks.length ? p.tracks : base.tracks,
    clips: Array.isArray(p.clips) ? p.clips : [],
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
  updateChannel(id: string, patch: Partial<Channel>, coalesce?: string): void;
  removeChannel(id: string): void;
  duplicateChannel(id: string): void;
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
  addClip(patternId: string, track: number, start: number, len: number): void;
  updateClip(id: string, patch: Partial<Clip>, coalesce?: string): void;
  removeClip(id: string): void;

  updateStrip(id: number, patch: Partial<Strip>, coalesce?: string): void;
  addStrip(): void;
  removeStrip(id: number): void;
  selectStrip(id: number): void;
  addEffect(stripId: number, type: EffectType): void;
  addEffectWithParams(stripId: number, type: EffectType, params: Record<string, number>): string;
  removeEffect(stripId: number, effectId: string): void;
  updateEffect(stripId: number, effectId: string, params: Record<string, number>, coalesce?: string): void;
  setRoute(stripId: number, target: number): void;
  addSend(stripId: number, to: number): void;
  updateSend(stripId: number, index: number, amount: number): void;
  removeSend(stripId: number, index: number): void;

  newProject(kind: 'blank' | 'demo'): void;
  saveCurrentProject(name?: string): void;
  openSavedProject(id: string): void;
  deleteSavedProject(id: string): void;
  saveProjectFile(): void;
  openProjectFile(file: File): Promise<void>;
  openProjectNative(): Promise<void>;
  exportWav(): Promise<void>;
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
    tutorialStep: storedSettings.tutorialDone ? null : 0,
    paletteOpen: false,
    fixMixOpen: false,
    humOpen: false,
    inspireOpen: false,
    exchangeOpen: false,
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
    if (nativeShell()) {
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
    const wasPlaying = get().transport.playing;
    get().stop();
    const target = Math.max(0, Math.round(step));
    set((s) => ({ transport: { ...s.transport, step: target, anchorStep: target } }));
    if (wasPlaying) get().play(target);
  },

  setBpm(value) {
    const bpm = Math.max(20, Math.min(300, value));
    get().patchProject((p) => {
      p.bpm = bpm;
    });
  },

  toggleMetronome() {
    get().patchProject((p) => {
      p.metronome = !p.metronome;
    });
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

  removeClip(id) {
    get().patchProject((p) => {
      p.clips = p.clips.filter((c) => c.id !== id);
    });
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
    get().stop();
    set((s) => ({ ui: { ...s.ui, exporting: { progress: 0 } } }));
    try {
      const target = get().settings.masterTarget;
      const blob = await renderSongToWav(get().project, { master: target });
      const name = get().project.name.replace(/[^\w\- ]+/g, '').trim() || 'openbeats';
      downloadBlob(blob, target === 'none' ? `${name}.wav` : `${name}-${target}.wav`);
      get().toast(target === 'none' ? 'WAV bounced — check your downloads' : `Mastered for ${target} — WAV downloaded`);
    } catch (err) {
      console.error(err);
      get().toast('Bounce failed — see the console for details');
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
  const state = useApp.getState();
  void state.initAudio().then(() => {
    if (engine.ctx) engine.preview(channel);
  });
}

/* ------------------------------------------------------------------ *
 * Native (Rust/CPAL) transport
 * ------------------------------------------------------------------ */

let nativeActive = false;
let nativePoll: number | null = null;

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
    playTimer = setInterval(() => tick(), 20);
  });
}

export function previewPitch(channel: Channel, pitch: number) {
  const state = useApp.getState();
  void state.initAudio().then(() => {
    if (engine.ctx) engine.preview(channel, pitch);
  });
}
