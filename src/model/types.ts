/**
 * OpenBeats — core data model.
 *
 * The project follows FL Studio's mental model:
 *   channels  -> the instruments in the Channel Rack
 *   patterns  -> per-channel notes; the Channel Rack's step grid is a view of them
 *   playlist  -> tracks holding clips that reference patterns
 *   strips    -> the mixer, with free routing to buses and the master
 */

export type PresetId =
  | 'kick'
  | 'snare'
  | 'hat'
  | 'openhat'
  | 'clap'
  | 'tom'
  | 'rim'
  | 'bass'
  | 'sub'
  | 'lead'
  | 'keys'
  | 'chords'
  | 'pluck'
  | 'pad'
  | 'fx'
  | 'sample';

export type EffectType =
  | 'eq3'
  | 'eq10'
  | 'comp'
  | 'limiter'
  | 'reverb'
  | 'delay'
  | 'drive'
  | 'filter';

export interface Note {
  id: string;
  /** MIDI note number. */
  pitch: number;
  /** Start position in 16th-note steps. */
  start: number;
  /** Length in steps. */
  len: number;
  /** 0..1 */
  vel: number;
}

export interface Channel {
  id: string;
  name: string;
  color: string;
  preset: PresetId;
  /** Mixer strip this channel feeds. */
  mixer: number;
  /** 0..1.25 */
  gain: number;
  /** -1..1 */
  pan: number;
  mute: boolean;
  solo: boolean;
  /** MIDI note the step sequencer writes, and the sample root for `sample` channels. */
  root: number;
  /** 0..1 — brightness / filter opening. */
  tone: number;
  /** 0..1 — envelope decay. */
  decay: number;
  /** 0..1 — envelope attack. */
  attack: number;
  /** 0..1 — envelope release. */
  release: number;
  /** Step length in steps for step-sequencer notes. */
  stepLen: number;
  /** Loaded one-shot sample (session only; see README). */
  sample?: {
    id: string;
    name: string;
    root: number;
    /** Auto-tagger output. */
    tags?: string[];
    bpm?: number | null;
    brightness?: number;
    kind?: string;
  };
  /** "Unload instrument" — keeps the channel but stops it using CPU/RAM. */
  unloaded?: boolean;
  /** Note offset in semitones, for the one-click transpose feature. */
  transpose?: number;
}

export interface Pattern {
  id: string;
  name: string;
  color: string;
  /** Length in bars (4/4). */
  bars: number;
  /** channelId -> notes */
  notes: Record<string, Note[]>;
}

export interface Track {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
  height: number;
}

export interface Clip {
  id: string;
  pattern: string;
  track: number;
  /** Start in steps. */
  start: number;
  /** Length in steps. */
  len: number;
  /**
   * Clip gain envelope value, 1 = unity. Multiplies the clip's velocity in both
   * the Web Audio path and the native Rust sequencer.
   */
  gain?: number;
  /** Per-clip pan, -1 (left) .. 1 (right). Applied by the native engine. */
  pan?: number;
  /** Per-clip transpose in semitones. */
  pitch?: number;
  /** Time multiplier: 2 plays the pattern twice as long (half speed). */
  stretch?: number;
  /** Fade lengths in steps. */
  fadeIn?: number;
  fadeOut?: number;
}

export interface Effect {
  id: string;
  type: EffectType;
  bypass: boolean;
  params: Record<string, number>;
}

export interface Send {
  to: number;
  amount: number;
}

export interface Strip {
  id: number;
  name: string;
  color: string;
  gain: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** Where this strip's output goes. 0 = master. */
  route: number;
  sends: Send[];
  effects: Effect[];
  /** Optional group label used by the mixer's collapse feature. */
  group: string;
  collapsed: boolean;
}

export interface Project {
  version: 1;
  name: string;
  bpm: number;
  /** 0..1 — delays odd 16ths. */
  swing: number;
  beatsPerBar: number;
  beatUnit: number;
  channels: Channel[];
  patterns: Pattern[];
  tracks: Track[];
  clips: Clip[];
  strips: Strip[];
  currentPattern: string;
  masterGain: number;
  metronome: boolean;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  /** Index of the mixer strip currently in focus. */
  selectedStrip: number;
  selectedChannel: string | null;
  updatedAt: number;
}

export interface Theme {
  id: string;
  name: string;
  bg: string;
  panel: string;
  panel2: string;
  panel3: string;
  border: string;
  text: string;
  dim: string;
  accent: string;
  accentText: string;
  playhead: string;
  selection: string;
  channelColors: string[];
  dark: boolean;
  /** Enables translucent panels and backdrop blur (Glass / Liquid Glass). */
  glass?: boolean;
}

export type KeyAction =
  | 'playToggle'
  | 'record'
  | 'songMode'
  | 'playlist'
  | 'pianoRoll'
  | 'mixer'
  | 'browser'
  | 'settings'
  | 'save'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'nextPattern'
  | 'prevPattern'
  | 'metronome'
  | 'help';

export type UiMode = 'classic' | 'modern';
export type MasterTarget = 'none' | 'spotify' | 'club' | 'soundcloud' | 'youtube';

export interface Settings {
  themeId: string;
  /** Classic FL-style chrome or the modernised vector skin. Themes apply to both. */
  uiMode: UiMode;
  /** Bounce target for the mastering chain. */
  masterTarget: MasterTarget;
  /** GitHub repo (owner/name) used for update checks. */
  updateRepo: string;
  autoCheckUpdates: boolean;
  /** Version the user dismissed, so the banner does not return. */
  dismissedUpdate: string | null;
  changelogSeen: string;
  customTheme: Theme;
  /** Overrides the theme accent when set. */
  accent: string | null;
  /** UI scale 0.8 .. 1.3 */
  scale: number;
  density: 'comfortable' | 'compact';
  showHints: boolean;
  /** Show parameter values next to the pointer, not only in the hint bar. */
  cursorHints: boolean;
  /** Grid snap in steps: 1 = 1/16, 0.25 = 1/64, 0 = off */
  snap: number;
  autoScroll: boolean;
  showMeters: boolean;
  /** Short synthesized sound when the app opens. */
  startupChime: boolean;
  reduceMotion: boolean;
  /** Stronger borders and text for low-vision use. */
  highContrast: boolean;
  /** Always draw a visible keyboard focus ring. */
  focusRings: boolean;
  /** Replace translucent glass with opaque panels and disable blur. */
  reduceTransparency: boolean;
  /** Minutes between autosaves; 0 disables timed autosave. */
  autosaveMinutes: 0 | 2 | 5 | 10 | 15 | 30 | 60;
  /** Discord Rich Presence, including the "Making a beat.." activity. */
  discordRpc: boolean;
  keymap: Record<KeyAction, string>;
  tutorialDone: boolean;
  sweepDemo: boolean;
}

export type WorkspaceTab = 'playlist' | 'pianoroll' | 'mixer' | 'changelog';

export interface SavedProject {
  id: string;
  name: string;
  updatedAt: number;
  project: Project;
}

export interface UpdateInfo {
  version: string;
  notes: string;
  url: string;
  publishedAt?: string;
  repo: string;
  /** Direct installer for this platform, when the release has one. */
  downloadUrl?: string;
}

export interface UIState {
  tab: WorkspaceTab;
  browserOpen: boolean;
  rackWidth: number;
  browserWidth: number;
  lowerHeight: number;
  hint: string;
  contextMenu: { x: number; y: number; items: MenuItem[] } | null;
  settingsOpen: boolean;
  aboutOpen: boolean;
  tutorialStep: number | null;
  paletteOpen: boolean;
  fixMixOpen: boolean;
  humOpen: boolean;
  inspireOpen: boolean;
  exchangeOpen: boolean;
  exportOpen: boolean;
  projectHubOpen: boolean;
  pluginsOpen: boolean;
  update: UpdateInfo | null;
  updateChecking: boolean;
  exporting: null | { progress: number };
  toast: string | null;
}

export interface MenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
  submenu?: MenuItem[];
}

export interface TransportSnapshot {
  playing: boolean;
  songMode: boolean;
  step: number;
  bar: number;
  beat: number;
  startedAt: number;
}
