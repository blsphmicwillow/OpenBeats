import type { BaseAudioContext } from './audio-context-types';
import { buildGraph } from './engine';
import { playVoice } from './instruments';
import { songEvents, songLengthSteps, stepsToSeconds, swingOffset, isChannelAudible } from './sequencer';
import { masterBuffer, masterProfile, type MasterTarget } from '../lib/mastering';
import type { Project } from '../model/types';

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
 * Renders the whole playlist offline — the same graph and voices used live, so
 * what you hear is what you bounce.
 */
export async function renderSongToBuffer(
  project: Project,
  opts: { sampleRate?: number; tailSeconds?: number } = {},
): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? 44100;
  const length = songLengthSteps(project);
  const stepSec = stepsToSeconds(1, project.bpm);
  const duration = length * stepSec + (opts.tailSeconds ?? 3);
  const OfflineCtor: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OfflineCtor(2, Math.ceil(duration * sampleRate), sampleRate);
  const graph = buildGraph(ctx as unknown as BaseAudioContext, project);

  for (const event of songEvents(project)) {
    const channel = project.channels.find((c) => c.id === event.channelId);
    if (!channel || !isChannelAudible(project, channel.id)) continue;
    const input = graph.strips.get(channel.mixer)?.input;
    if (!input) continue;
    const when = event.step * stepSec + swingOffset(event.step, project.swing, stepSec);
    playVoice(ctx as unknown as BaseAudioContext, input, channel, event.pitch, event.vel, when, event.lenSteps * stepSec * 0.96);
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
