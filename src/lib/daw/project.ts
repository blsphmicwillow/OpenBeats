/**
 * Converts between the studio project model and the neutral ExchangeSong used
 * by MIDI, Ableton and REAPER. Notes are taken from the arrangement; channels
 * without clips fall back to the current pattern so a sketch still exports.
 */
import { createChannel, createPattern, createStrip, note, uid } from '../../model/defaults';
import { DEFAULT_THEME } from '../../themes';
import type { Channel, PresetId, Project } from '../../model/types';
import { clamp, type ExchangeNote, type ExchangeSong, type ExchangeTrack } from './types';

const PRESET_BY_PROGRAM: { from: number; to: number; preset: PresetId }[] = [
  { from: 0, to: 7, preset: 'keys' },
  { from: 8, to: 15, preset: 'keys' },
  { from: 32, to: 39, preset: 'bass' },
  { from: 80, to: 87, preset: 'lead' },
  { from: 88, to: 95, preset: 'pad' },
  { from: 104, to: 111, preset: 'pluck' },
];

function presetFor(name: string, program?: number): PresetId {
  const n = name.toLowerCase();
  if (/kick|bass ?drum|808/.test(n)) return 'kick';
  if (/snare|rim/.test(n)) return 'snare';
  if (/clap/.test(n)) return 'clap';
  if (/open ?hat/.test(n)) return 'openhat';
  if (/hat|hi-?hat|cymbal/.test(n)) return 'hat';
  if (/drum|perc/.test(n)) return 'kick';
  if (/sub/.test(n)) return 'sub';
  if (/bass/.test(n)) return 'bass';
  if (/chord|stab/.test(n)) return 'chords';
  if (/pad|string|atmos/.test(n)) return 'pad';
  if (/pluck|guitar|harp/.test(n)) return 'pluck';
  if (/lead|synth|saw/.test(n)) return 'lead';
  if (/piano|key|organ|rhodes|electric/.test(n)) return 'keys';
  if (typeof program === 'number') {
    const match = PRESET_BY_PROGRAM.find((r) => program >= r.from && program <= r.to);
    if (match) return match.preset;
  }
  return 'keys';
}

function gmProgramFor(preset: PresetId): number {
  switch (preset) {
    case 'kick':
    case 'snare':
    case 'hat':
    case 'openhat':
    case 'clap':
    case 'tom':
    case 'rim':
      return 0;
    case 'bass':
    case 'sub':
    case 'acidwell':
      return 38;
    case 'lead':
    case 'pluck':
      return 81;
    case 'pad':
    case 'chords':
      return 89;
    case 'keys':
    case 'cordwood':
    case 'hammerfelt':
      return 4;
    case 'prism':
    case 'sundial':
    case 'vector9':
    case 'dice':
    case 'chatter':
    case 'dustdevil':
      return 81;
    default:
      return 0;
  }
}

/** Arrangement notes per channel, with pattern-mode fallback. */
export function exchangeFromProject(project: Project): ExchangeSong {
  const current = project.patterns.find((p) => p.id === project.currentPattern);
  const tracks: ExchangeTrack[] = project.channels.map((channel) => {
    const notes: ExchangeNote[] = [];
    const seen = new Set<string>();
    for (const clip of project.clips) {
      const pattern = project.patterns.find((p) => p.id === clip.pattern);
      if (!pattern) continue;
      for (const n of pattern.notes[channel.id] ?? []) {
        if (n.start >= clip.len) continue;
        const start = clip.start + n.start;
        const key = `${n.pitch}:${start}:${n.len}`;
        if (seen.has(key)) continue;
        seen.add(key);
        notes.push({ pitch: n.pitch, start, len: Math.min(n.len, clip.len - n.start), vel: n.vel });
      }
    }
    if (!notes.length) {
      for (const n of current?.notes[channel.id] ?? []) {
        notes.push({ pitch: n.pitch, start: n.start, len: n.len, vel: n.vel });
      }
    }
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    return { name: channel.name, program: gmProgramFor(channel.preset), notes };
  });
  return {
    name: project.name,
    bpm: project.bpm,
    tracks: tracks.filter((t) => t.notes.length),
    markers: project.markers.map((marker) => ({ name: marker.name, start: marker.start })),
    source: 'midi',
  };
}

/** Builds a fresh OpenBeats project from an imported song. */
export function projectFromExchange(song: ExchangeSong): Project {
  const colors = DEFAULT_THEME.channelColors;
  const tracks = song.tracks
    .filter((t) => t.notes.length)
    .slice(0, 32)
    .map((track, index) => {
      const end = Math.max(...track.notes.map((n) => n.start + n.len), 16);
      const bars = Math.max(1, Math.min(64, Math.ceil(end / 16)));
      const preset = presetFor(track.name, track.program);
      const channel: Channel = createChannel({
        preset,
        name: track.name.slice(0, 48) || `Track ${index + 1}`,
        color: colors[index % colors.length],
        mixer: index + 1,
      });
      const pattern = createPattern(`${channel.name} — imported`, channel.color, bars);
      pattern.notes[channel.id] = track.notes.map((n) =>
        note(clamp(Math.round(n.pitch), 0, 127), Math.max(0, n.start), Math.max(0.0625, n.len), clamp(n.vel, 0.05, 1)),
      );
      return { channel, pattern, end };
    });

  if (!tracks.length) throw new Error('The file did not contain any playable notes');

  const strips = [createStrip(0, 'Master', colors[0])];
  tracks.forEach(({ channel }, index) => {
    const strip = createStrip(index + 1, channel.name, channel.color);
    strip.route = 0;
    strips.push(strip);
  });

  const maxEnd = Math.max(...tracks.map((t) => t.end), 16);
  const project: Project = {
    version: 1,
    name: song.name.slice(0, 80) || 'Imported song',
    bpm: clamp(song.bpm, 20, 300),
    swing: 0,
    beatsPerBar: 4,
    beatUnit: 4,
    channels: tracks.map((t) => t.channel),
    patterns: tracks.map((t) => t.pattern),
    tracks: tracks.map((t, index) => ({
      id: uid('tr'),
      name: t.channel.name,
      color: t.channel.color,
      mute: false,
      solo: false,
      height: 92,
    })),
    markers: (song.markers ?? []).map((marker) => ({
      id: uid('mk'),
      name: marker.name.slice(0, 64) || 'Marker',
      start: Math.max(0, marker.start),
    })),
    clips: tracks.map((t, index) => ({
      id: uid('cl'),
      pattern: t.pattern.id,
      track: index,
      start: 0,
      len: Math.max(16, Math.ceil(t.end / 16) * 16),
    })),
    // Imported interchange files carry musical data only; no audio clips.
    audioClips: [],
    strips,
    currentPattern: tracks[0].pattern.id,
    masterGain: 0.85,
    metronome: false,
    loop: true,
    loopStart: 0,
    loopEnd: Math.max(64, Math.ceil(maxEnd / 16) * 16),
    selectedStrip: 1,
    selectedChannel: tracks[0].channel.id,
    updatedAt: Date.now(),
  };
  return project;
}
