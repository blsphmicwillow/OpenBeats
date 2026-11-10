import type {
  Channel,
  Effect,
  EffectType,
  Note,
  Pattern,
  PresetId,
  Project,
  Settings,
  Strip,
  Theme,
} from './types';
import { DEFAULT_THEME } from '../themes';
import { DEFAULT_UPDATE_REPO } from '../lib/version';

let uidCounter = 0;
export function uid(prefix = 'id'): string {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}`;
}

export interface PresetDef {
  id: PresetId;
  name: string;
  category: string;
  blurb: string;
  root: number;
  tone: number;
  decay: number;
  attack: number;
  release: number;
  gain: number;
  poly: boolean;
}

export const PRESETS: PresetDef[] = [
  { id: 'kick', name: 'Kick', category: 'Drums', blurb: 'Punchy sine kick with a click transient', root: 36, tone: 0.35, decay: 0.42, attack: 0, release: 0.1, gain: 0.95, poly: false },
  { id: 'snare', name: 'Snare', category: 'Drums', blurb: 'Noise + body snare', root: 38, tone: 0.5, decay: 0.35, attack: 0, release: 0.1, gain: 0.85, poly: false },
  { id: 'hat', name: 'Hi-Hat', category: 'Drums', blurb: 'Tight closed hat', root: 42, tone: 0.75, decay: 0.12, attack: 0, release: 0.05, gain: 0.65, poly: false },
  { id: 'openhat', name: 'Open Hat', category: 'Drums', blurb: 'Long open hi-hat', root: 46, tone: 0.7, decay: 0.5, attack: 0, release: 0.2, gain: 0.6, poly: false },
  { id: 'clap', name: 'Clap', category: 'Drums', blurb: 'Layered clap bursts', root: 39, tone: 0.55, decay: 0.3, attack: 0, release: 0.15, gain: 0.8, poly: false },
  { id: 'tom', name: 'Tom', category: 'Drums', blurb: 'Tuned floor tom', root: 45, tone: 0.3, decay: 0.45, attack: 0, release: 0.15, gain: 0.8, poly: false },
  { id: 'rim', name: 'Rimshot', category: 'Drums', blurb: 'Short metallic rim', root: 44, tone: 0.8, decay: 0.1, attack: 0, release: 0.05, gain: 0.7, poly: false },
  { id: 'bass', name: 'Sub Bass', category: 'Bass', blurb: 'Saw + sub with a filter envelope', root: 33, tone: 0.32, decay: 0.5, attack: 0.02, release: 0.2, gain: 0.8, poly: false },
  { id: 'sub', name: 'Deep Sub', category: 'Bass', blurb: 'Clean sine sub for 808 lines', root: 31, tone: 0.15, decay: 0.6, attack: 0.01, release: 0.25, gain: 0.85, poly: false },
  { id: 'lead', name: 'Lead', category: 'Synth', blurb: 'Detuned saw lead', root: 69, tone: 0.55, decay: 0.45, attack: 0.01, release: 0.25, gain: 0.7, poly: true },
  { id: 'keys', name: 'FM Keys', category: 'Keys', blurb: 'Bell-ish FM electric keys', root: 60, tone: 0.5, decay: 0.5, attack: 0.01, release: 0.35, gain: 0.75, poly: true },
  { id: 'chords', name: 'Chord Stack', category: 'Keys', blurb: 'Wide detuned supersaw chords', root: 57, tone: 0.45, decay: 0.6, attack: 0.12, release: 0.45, gain: 0.62, poly: true },
  { id: 'pluck', name: 'Pluck', category: 'Synth', blurb: 'Short filtered pluck', root: 72, tone: 0.6, decay: 0.28, attack: 0.005, release: 0.2, gain: 0.7, poly: true },
  { id: 'pad', name: 'Warm Pad', category: 'Synth', blurb: 'Slow evolving pad', root: 60, tone: 0.4, decay: 0.8, attack: 0.45, release: 0.7, gain: 0.55, poly: true },
  { id: 'fx', name: 'Riser FX', category: 'FX', blurb: 'Noise riser for transitions', root: 60, tone: 0.6, decay: 0.9, attack: 0.5, release: 0.6, gain: 0.5, poly: false },
  { id: 'sample', name: 'Sampler', category: 'Sampler', blurb: 'Drop in your own one-shot', root: 60, tone: 0.5, decay: 0.6, attack: 0, release: 0.2, gain: 0.85, poly: true },
];

export function presetDef(id: PresetId): PresetDef {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  /** 0..1 normalisation for logarithmic controls. */
  log?: boolean;
}

export interface EffectDef {
  type: EffectType;
  name: string;
  category: string;
  blurb: string;
  params: ParamDef[];
}

export const EFFECT_DEFS: Record<EffectType, EffectDef> = {
  eq3: {
    type: 'eq3',
    name: 'Para EQ (3 band)',
    category: 'EQ',
    blurb: 'Low shelf, mid bell and high shelf.',
    params: [
      { key: 'low', label: 'Low', min: -18, max: 18, step: 0.1, def: 0, unit: 'dB' },
      { key: 'mid', label: 'Mid', min: -18, max: 18, step: 0.1, def: 0, unit: 'dB' },
      { key: 'high', label: 'High', min: -18, max: 18, step: 0.1, def: 0, unit: 'dB' },
      { key: 'freq', label: 'Mid Hz', min: 200, max: 6000, step: 1, def: 1000, unit: 'Hz', log: true },
    ],
  },
  eq10: {
    type: 'eq10',
    name: 'Graphic EQ (10 band)',
    category: 'EQ',
    blurb: 'Ten bands from 31 Hz to 16 kHz with a live curve.',
    params: Array.from({ length: 10 }, (_, i) => ({
      key: `g${i}`,
      label: ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'][i],
      min: -18,
      max: 18,
      step: 0.1,
      def: 0,
      unit: 'dB',
    })),
  },
  comp: {
    type: 'comp',
    name: 'Compressor',
    category: 'Dynamics',
    blurb: 'Glue and control dynamics with makeup gain.',
    params: [
      { key: 'threshold', label: 'Thresh', min: -60, max: 0, step: 0.5, def: -20, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.1, def: 4, unit: ':1' },
      { key: 'attack', label: 'Attack', min: 0, max: 1, step: 0.01, def: 0.15 },
      { key: 'release', label: 'Release', min: 0, max: 1, step: 0.01, def: 0.35 },
      { key: 'makeup', label: 'Makeup', min: 0, max: 24, step: 0.1, def: 0, unit: 'dB' },
      { key: 'knee', label: 'Knee', min: 0, max: 40, step: 0.5, def: 6, unit: 'dB' },
    ],
  },
  limiter: {
    type: 'limiter',
    name: 'Limiter',
    category: 'Dynamics',
    blurb: 'Brick wall on the master bus.',
    params: [
      { key: 'threshold', label: 'Ceiling', min: -12, max: 0, step: 0.1, def: -1, unit: 'dB' },
      { key: 'release', label: 'Release', min: 0, max: 1, step: 0.01, def: 0.25 },
    ],
  },
  reverb: {
    type: 'reverb',
    name: 'Reverb',
    category: 'Space',
    blurb: 'Generated convolution hall. 100% wet suits an FX bus.',
    params: [
      { key: 'size', label: 'Size', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'decay', label: 'Decay', min: 0, max: 1, step: 0.01, def: 0.55 },
      { key: 'damp', label: 'Damp', min: 0, max: 1, step: 0.01, def: 0.45 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 0.25 },
    ],
  },
  delay: {
    type: 'delay',
    name: 'Delay',
    category: 'Space',
    blurb: 'Stereo ping-pong echo with feedback and tone.',
    params: [
      { key: 'time', label: 'Time', min: 0, max: 1, step: 0.01, def: 0.32 },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, def: 0.35 },
      { key: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 0.25 },
    ],
  },
  drive: {
    type: 'drive',
    name: 'Overdrive',
    category: 'Distortion',
    blurb: 'Soft-clip saturation for weight and grit.',
    params: [
      { key: 'amount', label: 'Drive', min: 1, max: 40, step: 0.1, def: 6 },
      { key: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  filter: {
    type: 'filter',
    name: 'Filter',
    category: 'Filter',
    blurb: 'Resonant low-pass sweep.',
    params: [
      { key: 'cutoff', label: 'Cutoff', min: 0, max: 1, step: 0.01, def: 0.8 },
      { key: 'res', label: 'Reso', min: 0.1, max: 20, step: 0.1, def: 1 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
};

export function createEffect(type: EffectType): Effect {
  const def = EFFECT_DEFS[type];
  return {
    id: uid('fx'),
    type,
    bypass: false,
    params: Object.fromEntries(def.params.map((p) => [p.key, p.def])),
  };
}

export function effectLabel(type: EffectType): string {
  return EFFECT_DEFS[type]?.name ?? type;
}

export function createChannel(opts: Partial<Channel> & { preset: PresetId; name?: string }): Channel {
  const preset = presetDef(opts.preset);
  return {
    id: uid('ch'),
    name: opts.name ?? preset.name,
    color: opts.color ?? DEFAULT_THEME.channelColors[0],
    mixer: opts.mixer ?? 1,
    gain: opts.gain ?? preset.gain,
    pan: opts.pan ?? 0,
    mute: false,
    solo: false,
    root: opts.root ?? preset.root,
    tone: opts.tone ?? preset.tone,
    decay: opts.decay ?? preset.decay,
    attack: opts.attack ?? preset.attack,
    release: opts.release ?? preset.release,
    stepLen: opts.stepLen ?? 1,
    sample: opts.sample,
    unloaded: false,
    transpose: 0,
    ...opts,
  } as Channel;
}

export function createPattern(name: string, color: string, bars = 2): Pattern {
  return { id: uid('pat'), name, color, bars, notes: {} };
}

export function createStrip(id: number, name: string, color: string): Strip {
  return {
    id,
    name,
    color,
    gain: id === 0 ? 0.9 : 0.8,
    pan: 0,
    mute: false,
    solo: false,
    route: 0,
    sends: [],
    effects: [],
    group: '',
    collapsed: false,
  };
}

export function note(pitch: number, start: number, len = 1, vel = 0.85): Note {
  return { id: uid('n'), pitch, start, len, vel };
}

export function stepsPerBar(project: Project): number {
  return project.beatsPerBar * 4;
}

/* ------------------------------------------------------------------ */
/* Demo song                                                          */
/* ------------------------------------------------------------------ */

export function demoProject(): Project {
  const colors = DEFAULT_THEME.channelColors;
  const strips: Strip[] = [createStrip(0, 'Master', colors[0])];
  for (let i = 1; i <= 10; i += 1) strips.push(createStrip(i, '', colors[i - 1]));
  const drums = createStrip(11, 'Drums Bus', colors[8]);
  const music = createStrip(12, 'Music Bus', colors[4]);
  const verb = createStrip(13, 'Reverb FX', colors[5]);
  strips.push(drums, music, verb);

  const chans: Channel[] = [
    createChannel({ preset: 'kick', name: 'Kick', color: colors[0], mixer: 1 }),
    createChannel({ preset: 'snare', name: 'Snare', color: colors[1], mixer: 2 }),
    createChannel({ preset: 'clap', name: 'Clap', color: colors[2], mixer: 3 }),
    createChannel({ preset: 'hat', name: 'Hi-Hat', color: colors[3], mixer: 4 }),
    createChannel({ preset: 'openhat', name: 'Open Hat', color: colors[4], mixer: 5 }),
    createChannel({ preset: 'bass', name: 'Bass', color: colors[5], mixer: 6 }),
    createChannel({ preset: 'lead', name: 'Lead', color: colors[6], mixer: 7 }),
    createChannel({ preset: 'chords', name: 'Chords', color: colors[7], mixer: 8 }),
    createChannel({ preset: 'pluck', name: 'Pluck', color: colors[8], mixer: 9 }),
    createChannel({ preset: 'fx', name: 'Riser', color: colors[9], mixer: 10 }),
  ];
  chans.forEach((c, i) => {
    strips[c.mixer].name = c.name;
    strips[c.mixer].color = c.color;
    strips[c.mixer].route = i < 5 ? 11 : 12;
  });
  strips[11].color = colors[8];
  strips[12].color = colors[4];
  strips[13].color = colors[5];

  // Effects on the demo strips.
  const kickDrive = createEffect('drive');
  kickDrive.params.amount = 3;
  kickDrive.params.mix = 0.5;
  strips[1].effects.push(kickDrive, createEffect('eq3'));
  strips[2].effects.push(createEffect('eq3'));
  const clapVerb = createEffect('reverb');
  clapVerb.params.mix = 0.12;
  clapVerb.params.size = 0.3;
  strips[3].effects.push(clapVerb);
  strips[6].effects.push(createEffect('comp'), createEffect('eq3'));
  const leadDelay = createEffect('delay');
  leadDelay.params.mix = 0.22;
  leadDelay.params.feedback = 0.3;
  strips[7].effects.push(leadDelay, createEffect('eq10'));
  strips[8].effects.push(createEffect('eq3'));
  strips[11].effects.push(createEffect('comp'), createEffect('eq3'));
  strips[12].effects.push(createEffect('eq3'));
  const verbFx = createEffect('reverb');
  verbFx.params.mix = 1;
  verbFx.params.size = 0.7;
  verbFx.params.decay = 0.75;
  strips[13].effects.push(verbFx);
  strips[13].gain = 0.8;
  strips[2].sends.push({ to: 13, amount: 0.3 });
  strips[3].sends.push({ to: 13, amount: 0.18 });
  strips[8].sends.push({ to: 13, amount: 0.22 });
  strips[0].effects.push(createEffect('comp'), createEffect('limiter'));

  const p1 = createPattern('Drums A', colors[0], 2);
  const kick: Note[] = [];
  [0, 10, 16, 26].forEach((s) => kick.push(note(36, s, 1, 0.95)));
  kick.push(note(36, 30, 1, 0.55));
  p1.notes[chans[0].id] = kick;
  p1.notes[chans[1].id] = [note(38, 8, 1, 0.9), note(38, 24, 1, 0.9), note(38, 14, 1, 0.3), note(38, 31, 1, 0.4)];
  p1.notes[chans[2].id] = [note(39, 8, 1, 0.7), note(39, 24, 1, 0.7)];
  const hats: Note[] = [];
  for (let s = 0; s < 32; s += 2) hats.push(note(42, s, 1, s % 4 === 0 ? 0.6 : 0.38));
  hats.push(note(42, 15, 1, 0.3), note(42, 23, 1, 0.32));
  p1.notes[chans[3].id] = hats;
  p1.notes[chans[4].id] = [note(46, 6, 2, 0.5), note(46, 22, 2, 0.45)];

  const p2 = createPattern('Bassline', colors[5], 2);
  p2.notes[chans[5].id] = [
    note(33, 0, 2, 0.9),
    note(33, 3, 1, 0.7),
    note(36, 6, 2, 0.85),
    note(33, 10, 2, 0.8),
    note(40, 12, 3, 0.8),
    note(31, 16, 2, 0.9),
    note(31, 19, 1, 0.7),
    note(36, 22, 2, 0.85),
    note(33, 24, 2, 0.85),
    note(29, 26, 2, 0.8),
    note(40, 28, 3, 0.85),
  ];

  const p3 = createPattern('Chords', colors[7], 4);
  const chordNotes: Note[] = [];
  ([[0, [57, 60, 64]], [16, [53, 57, 60]], [32, [55, 60, 64]], [48, [55, 59, 62]]] as const).forEach(
    ([start, pitches]) => pitches.forEach((p) => chordNotes.push(note(p, start, 14, 0.6))),
  );
  p3.notes[chans[7].id] = chordNotes;

  const p4 = createPattern('Lead', colors[6], 2);
  p4.notes[chans[6].id] = [
    note(69, 0, 2, 0.8),
    note(72, 2, 2, 0.75),
    note(76, 4, 4, 0.85),
    note(74, 8, 2, 0.7),
    note(72, 10, 2, 0.7),
    note(69, 12, 3, 0.8),
    note(67, 16, 2, 0.75),
    note(69, 18, 2, 0.7),
    note(72, 20, 4, 0.85),
    note(76, 26, 4, 0.8),
  ];
  p4.notes[chans[8].id] = [note(81, 4, 1, 0.4), note(84, 20, 1, 0.35)];

  const p5 = createPattern('Fill', colors[2], 1);
  const fill: Note[] = [];
  for (let s = 0; s < 16; s += 1) fill.push(note(38, s, 1, 0.2 + s * 0.045));
  p5.notes[chans[1].id] = fill;
  p5.notes[chans[9].id] = [note(60, 0, 16, 0.5)];

  const patterns = [p1, p2, p3, p4, p5];

  const tracks = [
    { id: uid('tr'), name: 'Drums', color: colors[0], mute: false, solo: false, height: 92 },
    { id: uid('tr'), name: 'Bass', color: colors[5], mute: false, solo: false, height: 92 },
    { id: uid('tr'), name: 'Chords', color: colors[7], mute: false, solo: false, height: 92 },
    { id: uid('tr'), name: 'Lead', color: colors[6], mute: false, solo: false, height: 92 },
    { id: uid('tr'), name: 'FX', color: colors[9], mute: false, solo: false, height: 76 },
  ];

  const clips = [
    { id: uid('cl'), pattern: p1.id, track: 0, start: 0, len: 32 },
    { id: uid('cl'), pattern: p1.id, track: 0, start: 32, len: 32 },
    { id: uid('cl'), pattern: p1.id, track: 0, start: 64, len: 32 },
    { id: uid('cl'), pattern: p5.id, track: 4, start: 96, len: 16 },
    { id: uid('cl'), pattern: p2.id, track: 1, start: 0, len: 32 },
    { id: uid('cl'), pattern: p2.id, track: 1, start: 32, len: 32 },
    { id: uid('cl'), pattern: p2.id, track: 1, start: 64, len: 32 },
    { id: uid('cl'), pattern: p2.id, track: 1, start: 96, len: 32 },
    { id: uid('cl'), pattern: p3.id, track: 2, start: 0, len: 64 },
    { id: uid('cl'), pattern: p3.id, track: 2, start: 64, len: 64 },
    { id: uid('cl'), pattern: p4.id, track: 3, start: 32, len: 32 },
    { id: uid('cl'), pattern: p4.id, track: 3, start: 96, len: 32 },
  ];

  return {
    version: 1,
    name: 'Neon Drift (demo)',
    bpm: 118,
    swing: 0,
    beatsPerBar: 4,
    beatUnit: 4,
    channels: chans,
    patterns,
    tracks,
    clips,
    strips,
    currentPattern: p1.id,
    masterGain: 0.85,
    metronome: false,
    loop: true,
    loopStart: 0,
    loopEnd: 128,
    selectedStrip: 1,
    selectedChannel: chans[0].id,
    updatedAt: Date.now(),
  };
}

export function blankProject(): Project {
  const colors = DEFAULT_THEME.channelColors;
  const strips: Strip[] = [createStrip(0, 'Master', colors[0])];
  for (let i = 1; i <= 8; i += 1) strips.push(createStrip(i, '', colors[i - 1]));
  const chans = [
    createChannel({ preset: 'kick', name: 'Kick', color: colors[0], mixer: 1 }),
    createChannel({ preset: 'snare', name: 'Snare', color: colors[1], mixer: 2 }),
    createChannel({ preset: 'hat', name: 'Hi-Hat', color: colors[2], mixer: 3 }),
    createChannel({ preset: 'bass', name: 'Bass', color: colors[3], mixer: 4 }),
    createChannel({ preset: 'lead', name: 'Lead', color: colors[4], mixer: 5 }),
  ];
  chans.forEach((c) => {
    strips[c.mixer].name = c.name;
    strips[c.mixer].color = c.color;
  });
  const p = createPattern('Pattern 1', colors[0], 2);
  return {
    version: 1,
    name: 'Untitled',
    bpm: 120,
    swing: 0,
    beatsPerBar: 4,
    beatUnit: 4,
    channels: chans,
    patterns: [p],
    tracks: [
      { id: uid('tr'), name: 'Track 1', color: colors[0], mute: false, solo: false, height: 92 },
      { id: uid('tr'), name: 'Track 2', color: colors[1], mute: false, solo: false, height: 92 },
      { id: uid('tr'), name: 'Track 3', color: colors[2], mute: false, solo: false, height: 92 },
      { id: uid('tr'), name: 'Track 4', color: colors[3], mute: false, solo: false, height: 92 },
    ],
    clips: [],
    strips,
    currentPattern: p.id,
    masterGain: 0.85,
    metronome: false,
    loop: true,
    loopStart: 0,
    loopEnd: 64,
    selectedStrip: 1,
    selectedChannel: chans[0].id,
    updatedAt: Date.now(),
  };
}

export const DEFAULT_KEYMAP: Settings['keymap'] = {
  playToggle: 'Space',
  record: 'r',
  songMode: 'l',
  playlist: 'F5',
  pianoRoll: 'F7',
  mixer: 'F9',
  browser: 'F10',
  settings: 'F11',
  save: 'Ctrl+S',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  duplicate: 'Ctrl+D',
  nextPattern: 'PageDown',
  prevPattern: 'PageUp',
  metronome: 'c',
  help: 'F1',
};

export function defaultCustomTheme(): Theme {
  return { ...DEFAULT_THEME, id: 'custom', name: 'My Theme' };
}

export function defaultSettings(): Settings {
  return {
    themeId: 'charcoal',
    uiMode: 'classic',
    masterTarget: 'none',
    updateRepo: DEFAULT_UPDATE_REPO,
    autoCheckUpdates: true,
    dismissedUpdate: null,
    changelogSeen: '',
    customTheme: defaultCustomTheme(),
    accent: null,
    scale: 1,
    density: 'comfortable',
    showHints: true,
    cursorHints: false,
    snap: 1,
    autoScroll: true,
    showMeters: true,
    reduceMotion: false,
    highContrast: false,
    focusRings: true,
    reduceTransparency: false,
    autosaveMinutes: 2,
    keymap: { ...DEFAULT_KEYMAP },
    tutorialDone: false,
    sweepDemo: false,
  };
}
