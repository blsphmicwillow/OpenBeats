import type { BaseAudioContext } from './audio-context-types';
import { buildGraph } from './engine';
import { playVoice } from './instruments';
import { songEvents, songLengthSteps, stepsToSeconds, swingOffset, isChannelAudible } from './sequencer';
import { masterBuffer, masterProfile, type MasterTarget } from '../lib/mastering';
import type { Project } from '../model/types';
import { ticksToSteps, type AudioClip } from '../model/audioClip';
import { applyClipGain, scheduleWindows } from './audioClipScheduler';
import { audioClipLevel, playbackBuffer } from './audioClipProcessing';
import { buffersForClips, registerSample } from './sampleLibrary';
import { getSample } from './mediaStore';
import { scheduleMixerAutomation } from './automation';

function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const length = buffer.length * numCh * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) out.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  out.setUint32(4, length - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, numCh, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * numCh * 2, true);
  out.setUint16(32, numCh * 2, true);
  out.setUint16(34, 16, true);
  writeString(36, 'data');
  out.setUint32(40, length - 44, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c += 1) channels.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i += 1) {
    for (let c = 0; c < numCh; c += 1) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      out.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/**
 * Rehydrates audio-clip buffers from the media store when a saved project is
 * bounced in a fresh session. Without this the offline renderer would silently
 * skip clips whose bytes are no longer in the session sample map.
 */
async function hydrateAudioClipBuffers(
  ctx: OfflineAudioContext,
  clips: AudioClip[],
): Promise<Map<string, AudioBuffer>> {
  const buffers = buffersForClips(clips);
  for (const clip of clips) {
    if (buffers.has(clip.id)) continue;
    try {
      const bytes = await getSample(clip.media_ref);
      if (!bytes) continue;
      const buffer = await ctx.decodeAudioData(bytes);
      registerSample(clip.sample_id, buffer, clip.media_ref);
      buffers.set(clip.id, buffer);
    } catch {
      // A missing or corrupt media file is skipped; the rest still bounces.
    }
  }
  return buffers;
}

/** Schedules playlist audio clips into the same offline destination as notes. */
function scheduleAudioClipWindows(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  clips: AudioClip[],
  buffers: Map<string, AudioBuffer>,
  bpm: number,
  horizonSec: number,
): void {
  const durations: Record<string, number> = {};
  for (const [clipId, buffer] of buffers) durations[clipId] = buffer.duration;
  const windows = scheduleWindows(
    clips,
    {
      bpm,
      fromTick: 0,
      horizonSec,
      loop: false,
      loopStartTick: 0,
      loopEndTick: 0,
    },
    durations,
  );
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  for (const window of windows) {
    const clip = byId.get(window.clipId);
    const buffer = buffers.get(window.clipId);
    if (!clip || !buffer) continue;
    try {
      const sourceBuffer = playbackBuffer(ctx, clip, buffer);
      const source = ctx.createBufferSource();
      source.buffer = sourceBuffer;
      if (window.loopWithinSource) {
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = sourceBuffer.duration;
      }
      const gain = ctx.createGain();
      applyClipGain(gain, clip, buffer.duration, window.whenSec, audioClipLevel(clip, buffer));
      let tail: AudioNode = gain;
      if (typeof ctx.createStereoPanner === 'function' && clip.pan !== 0) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, clip.pan));
        gain.connect(panner);
        tail = panner;
      }
      tail.connect(destination);
      source.connect(gain);
      source.start(
        window.whenSec,
        window.offsetSec,
        window.loopWithinSource ? undefined : window.durationSec,
      );
    } catch {
      // Keep exporting the rest of the song if one clip cannot be scheduled.
    }
  }
}

/**
 * Renders the whole playlist offline — pattern notes and audio clips — with the
 * same graph and voices used live, so what you hear is what you bounce.
 */
export async function renderSongToBuffer(
  project: Project,
  opts: { sampleRate?: number; tailSeconds?: number } = {},
): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? 44100;
  const audioEndSteps = Math.max(
    0,
    ...project.audioClips.map((clip) => ticksToSteps(clip.start_tick + clip.length_ticks)),
  );
  const length = Math.max(songLengthSteps(project), audioEndSteps);
  const stepSec = stepsToSeconds(1, project.bpm);
  const duration = length * stepSec + (opts.tailSeconds ?? 3);
  const OfflineCtor: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OfflineCtor(2, Math.ceil(duration * sampleRate), sampleRate);
  const graph = buildGraph(ctx as unknown as BaseAudioContext, project);
  // ENGINE: Web Audio only — the same automation used by live playback is
  // scheduled into the offline graph, so fader/pan moves are bounced.
  scheduleMixerAutomation(graph, project, { fromStep: 0, startAtSec: 0, stepSec });

  for (const event of songEvents(project)) {
    const channel = project.channels.find((c) => c.id === event.channelId);
    if (!channel || !isChannelAudible(project, channel.id)) continue;
    const input = graph.strips.get(channel.mixer)?.input;
    if (!input) continue;
    const when = event.step * stepSec + swingOffset(event.step, project.swing, stepSec);
    playVoice(ctx as unknown as BaseAudioContext, input, channel, event.pitch, event.vel, when, event.lenSteps * stepSec * 0.96);
  }

  if (project.audioClips.length) {
    const buffers = await hydrateAudioClipBuffers(ctx, project.audioClips);
    scheduleAudioClipWindows(ctx, graph.master, project.audioClips, buffers, project.bpm, duration);
  }

  return ctx.startRendering();
}

export async function renderSongToWav(
  project: Project,
  opts: { sampleRate?: number; tailSeconds?: number; master?: MasterTarget } = {},
): Promise<Blob> {
  const rendered = await renderSongToBuffer(project, opts);
  const target = opts.master && opts.master !== 'none' ? await masterBuffer(rendered, opts.master) : rendered;
  return encodeWav(target);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { masterProfile };
