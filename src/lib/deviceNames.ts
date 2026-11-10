/** localStorage key shared by the Audio settings and the input panel. */
export const DEV_MODE_KEY = 'openbeats.devMode';

export function readDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDevMode(enabled: boolean): void {
  try {
    localStorage.setItem(DEV_MODE_KEY, enabled ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/**
 * Turns raw ALSA/PipeWire/CoreAudio strings into something a person can read.
 * Dev Mode bypasses this and shows the backend string unchanged.
 */
export function friendlyDeviceName(raw: string): string {
  const original = raw.trim();
  if (!original) return 'System default';
  if (/^(default|sysdefault|pulse|pipewire|auto_null)$/i.test(original)) return 'System default';

  let name = original
    .replace(/^(alsa|pulseaudio|pipewire|wasapi|coreaudio|jack)[:\s]+/i, '')
    .replace(/^alsa_(output|input)\./i, '')
    .replace(/^alsa\./i, '')
    .replace(/\b(hw|plughw|front|surround\d*|dmix|default|sysdefault):[^\s,]*/gi, ' ')
    .replace(/\.(analog|digital|hdmi|stereo|mono|multichannel|surround\d*)[-.]?/gi, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) name = original;
  name = name
    .replace(/\b(pulse|pipewire|alsa|usb|hdmi|analog|stereo|spdif)\b/gi, (word) => {
      const lower = word.toLowerCase();
      if (lower === 'hdmi' || lower === 'usb' || lower === 'spdif') return word.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return name;
}
