import type { ToneVerdict } from './audioVerdict';

/** Value of the backend `audio_bridge_status` command. */
export type BridgeState = 'ok' | 'missing-bridge' | 'no-server' | 'unknown';

/**
 * The sentence shown after a failed test tone.
 *
 * The three desktop platforms fail for different reasons, and one generic
 * sentence ("try another output") is what leaves a tester with a red verdict and
 * nothing to do. Each string names the things that actually cause silence there.
 *
 * `platform` is the value of the `platform` command: `linux`, `windows`,
 * `macos`, or `web` outside the desktop build.
 */
export function toneAdvice(platform: string, verdict: ToneVerdict['kind']): string {
  if (verdict === 'ok' || verdict === 'no-engine') return '';

  switch (platform) {
    case 'linux':
      return verdict === 'stalled'
        ? ' Install the ALSA→PipeWire bridge (pipewire-alsa, or libasound2-plugins on Debian/Ubuntu), then reopen Audio settings. `aplay -L | grep -iE "pipewire|pulse"` must list a device.'
        : ' Make sure the sink is not muted or at 0% in your mixer, and that the saved output still exists.';
    case 'windows':
      return verdict === 'stalled'
        ? ' Try another output from the list, and close anything holding the endpoint in exclusive mode (Sound settings → the device → "Allow applications to take exclusive control" should be off).'
        : ' Check the Windows Volume Mixer for both "openbeats.exe" (native output) and "msedgewebview2.exe" (the app window), that the selected endpoint is the one you actually hear, and that neither is muted.';
    case 'macos':
      return verdict === 'stalled'
        ? ' Check System Settings → Sound that the selected output is connected and is not a stale aggregate or multi-output device, then press Test tone again.'
        : ' Check System Settings → Sound output level, that no aggregate device is selected, and that another app is not holding the device at a different sample rate.';
    default:
      return verdict === 'stalled'
        ? ' Try another output device.'
        : ' Check the output level and the selected device.';
  }
}

/**
 * Shown in Audio settings when the backend enumerates no output device at all.
 *
 * This is the silent-app case: there is no stream, so no callbacks, no peak and
 * no error — the picker would just be an empty dropdown. The message has to name
 * the cause, and on Linux that means separating "nothing is running" from "the
 * sound server is running but ALSA has no bridge to it".
 */
export function noOutputDevicesAdvice(platform: string, bridge: BridgeState): string {
  switch (platform) {
    case 'linux':
      if (bridge === 'missing-bridge') {
        return 'PipeWire or PulseAudio is running, but ALSA has no bridge device to open. Install pipewire-alsa (or libasound2-plugins on Debian/Ubuntu), then reopen this panel.';
      }
      if (bridge === 'no-server') {
        return 'No sound server answered and ALSA reported no output devices. Start PipeWire or PulseAudio, install the ALSA bridge (pipewire-alsa, or libasound2-plugins), then reopen this panel.';
      }
      return 'ALSA reported no output devices. Run `aplay -L` in a terminal; if no pulse or pipewire entry is listed, install pipewire-alsa (or libasound2-plugins), then reopen this panel.';
    case 'windows':
      return 'Windows reported no output endpoint. Check Sound settings that an output device exists, is enabled and is not disabled, then reopen this panel.';
    case 'macos':
      return 'CoreAudio reported no output device. Connect or re-enable one in System Settings → Sound, then reopen this panel.';
    default:
      return 'No output device was found.';
  }
}
