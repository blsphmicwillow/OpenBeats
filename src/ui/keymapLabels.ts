import type { KeyAction } from '../model/types';

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  playToggle: 'Play / pause',
  record: 'Arm recording',
  songMode: 'Pattern / song mode',
  playlist: 'Show playlist',
  pianoRoll: 'Show piano roll',
  mixer: 'Show mixer',
  browser: 'Toggle browser',
  settings: 'Open settings',
  save: 'Save project',
  undo: 'Undo',
  redo: 'Redo',
  duplicate: 'Clone pattern',
  nextPattern: 'Next pattern',
  prevPattern: 'Previous pattern',
  metronome: 'Metronome on/off',
  help: 'Manual & shortcuts',
};

export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toLowerCase();
  else if (key === 'Esc') key = 'Escape';
  const modifierOnly = ['Control', 'Shift', 'Alt', 'Meta'].includes(key);
  if (!modifierOnly) parts.push(key);
  return parts.join('+');
}

/** QWERTY → semitone offset, laid out like a piano. */
export const KEY_TO_SEMITONE: Record<string, number> = {
  KeyZ: 0,
  KeyS: 1,
  KeyX: 2,
  KeyD: 3,
  KeyC: 4,
  KeyV: 5,
  KeyG: 6,
  KeyB: 7,
  KeyH: 8,
  KeyN: 9,
  KeyJ: 10,
  KeyM: 11,
  Comma: 12,
  KeyQ: 12,
  Digit2: 13,
  KeyW: 14,
  Digit3: 15,
  KeyE: 16,
  KeyR: 17,
  Digit5: 18,
  KeyT: 19,
  Digit6: 20,
  KeyY: 21,
  Digit7: 22,
  KeyU: 23,
  KeyI: 24,
  Digit9: 25,
  KeyO: 26,
  Digit0: 27,
  KeyP: 28,
};
