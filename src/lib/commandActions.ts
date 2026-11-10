/**
 * Applies a locally-parsed command to the studio.
 *
 * The parser lives in Rust (`parse_native_command`), so nothing leaves the
 * machine. Actions that do not exist yet are reported honestly instead of being
 * silently ignored.
 */

import { PRESETS } from '../model/defaults';
import { useApp } from '../store';
import type { ParsedCommand } from './nativeAudio';

function channelByName(name: string) {
  const needle = name.trim().toLowerCase();
  return useApp
    .getState()
    .project.channels.find((channel) => channel.name.toLowerCase().includes(needle));
}

/** Runs the command; returns a short description of what happened. */
export function applyParsedCommand(command: ParsedCommand): string {
  const store = useApp.getState();
  const [targetName, effectName] = (command.target ?? '').split(':');

  switch (command.action) {
    case 'play':
      store.play();
      return 'Playing';
    case 'stop':
      store.stop();
      return 'Stopped';
    case 'undo':
      store.undo();
      return 'Undo';
    case 'redo':
      store.redo();
      return 'Redo';
    case 'show_mixer':
      store.setUI({ tab: 'mixer' });
      return 'Mixer';
    case 'show_piano_roll':
      store.setUI({ tab: 'pianoroll' });
      return 'Piano roll';
    case 'show_playlist':
      store.setUI({ tab: 'playlist' });
      return 'Playlist';
    case 'new_pattern':
      store.addPattern();
      return 'New pattern';
    case 'export_wav':
      void store.exportWav();
      return 'Bouncing to WAV';
    case 'set_tempo':
      if (command.value) {
        store.setBpm(Math.round(command.value));
        return `Tempo ${Math.round(command.value)} BPM`;
      }
      return 'No tempo given';
    case 'mute_channel':
    case 'unmute_channel': {
      const channel = channelByName(targetName ?? '');
      if (!channel) return `No channel called “${targetName}”`;
      store.updateChannel(channel.id, { mute: command.action === 'mute_channel' });
      return `${command.action === 'mute_channel' ? 'Muted' : 'Unmuted'} ${channel.name}`;
    }
    case 'solo_channel':
    case 'unsolo_channel': {
      const channel = channelByName(targetName ?? '');
      if (!channel) return `No channel called “${targetName}”`;
      store.updateChannel(channel.id, { solo: command.action === 'solo_channel' });
      return `${command.action === 'solo_channel' ? 'Soloed' : 'Unsoloed'} ${channel.name}`;
    }
    case 'add_channel': {
      const preset = PRESETS.find((item) => item.id === command.target);
      if (!preset) return `No instrument called “${command.target}”`;
      store.addChannel(preset.id);
      return `Added ${preset.name}`;
    }
    case 'add_effect':
      return effectName
        ? `Adding ${effectName} to ${targetName} is not wired to a store action yet`
        : 'Say which effect and channel, e.g. “add reverb to snare”';
    default:
      return `“${command.raw}” is not a command I can run locally yet`;
  }
}
