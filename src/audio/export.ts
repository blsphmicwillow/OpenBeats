import type { BaseAudioContext } from './audio-context-types';
import { buildGraph, type Graph } from './engine';
import { playVoice } from './instruments';
import { songEvents, songLengthSteps, stepsToSeconds, swingOffset, isChannelAudible } from './sequencer';
import { masterBuffer, masterProfile, type MasterTarget } from '../lib/mastering';
import type { Project, Strip } from '../model/types';
import { ticksToSteps, TICKS_PER_BEAT, type AudioClip } from '../model/audioClip';
import { applyClipGain, scheduleWindows } from './audioClipScheduler';
import { audioClipLevel, playbackBuffer, sourceOffsetForWindow } from './audioClipProcessing';
import { buffersForClips, registerSample } from './sampleLibrary';
import { getSample } from './mediaStore';
import { scheduleMixerAutomation, scheduleStripAutomation } from './automation';
import { createEffectNode } from './effects';

export interface OfflinePluginProcessResult {
  pcm: Float32Array;
  latencyFrames: number;
}

export type OfflinePluginProcessor = (
  id: string,
  sampleRate: number,
  state: number[] | null | undefined,
  parameters: Record<number, number> | undefined,
  interleavedPcm: Float32Array,
) => Promise<OfflinePluginProcessResult | null>;

const MAX_OFFLINE_PLUGIN_LATENCY_SECONDS = 10;

function offlineContextConstructor(): typeof OfflineAudioContext {
  return (
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  );
}

function audioBufferFromInterleaved(
  ctx: OfflineAudioContext,
  interleaved: Float32Array,
): AudioBuffer {
  if (interleaved.length % 2 !== 0) {
    throw new Error('Offline mixer audio must contain stereo frames');
  }
  const buffer = ctx.createBuffer(2, interleaved.length / 2, ctx.sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let frame = 0; frame < left.length; frame += 1) {
    left[frame] = interleaved[frame * 2];
    right[frame] = interleaved[frame * 2 + 1];
  }
  return buffer;
}

function interleaveAudioBuffer(buffer: AudioBuffer): Float32Array {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const interleaved = new Float32Array(left.length * 2);
  for (let frame = 0; frame < left.length; frame += 1) {
    interleaved[frame * 2] = left[frame];
    interleaved[frame * 2 + 1] = right[frame];
  }
  return interleaved;
}

export function shiftInterleavedAudio(interleaved: Float32Array, delayFrames: number): Float32Array {
  if (delayFrames === 0) return interleaved;
  const shifted = new Float32Array(interleaved.length);
  const frameCount = interleaved.length / 2;
  for (let frame = 0; frame + delayFrames < frameCount; frame += 1) {
    shifted[(frame + delayFrames) * 2] = interleaved[frame * 2];
    shifted[(frame + delayFrames) * 2 + 1] = interleaved[frame * 2 + 1];
  }
  return shifted;
}

export function mixerRenderOrder(project: Project): Strip[] {
  const strips = new Map(project.strips.map((strip) => [strip.id, strip]));
  const indegree = new Map(project.strips.map((strip) => [strip.id, 0]));
  const edges = new Map(project.strips.map((strip) => [strip.id, [] as number[]]));
  for (const strip of project.strips) {
    const route = strip.id === 0 ? [] : [strips.has(strip.route) ? strip.route : 0];
    const sends =
      strip.id === 0 ? [] : strip.sends.map((send) => send.to).filter((id) => strips.has(id));
    const targets = [...route, ...sends];
    for (const target of targets) {
      if (target === strip.id) throw new Error(`Mixer strip ${strip.id} routes to itself`);
      edges.get(strip.id)!.push(target);
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }

  const ready = project.strips
    .filter((strip) => indegree.get(strip.id) === 0)
    .map((strip) => strip.id)
    .sort((a, b) => a - b);
  const order: number[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const target of edges.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        ready.push(target);
        ready.sort((a, b) => a - b);
      }
    }
  }
  if (order.length !== project.strips.length) {
    throw new Error('Mixer routing contains a cycle and cannot be rendered');
  }
  const master = order.indexOf(0);
  if (master < 0) throw new Error('Mixer master strip is missing');
  order.push(...order.splice(master, 1));
  return order.map((id) => strips.get(id)!);
}

function scheduleStripInput(
  ctx: OfflineAudioContext,
  input: AudioNode,
  strip: Strip,
  project: Project,
  incoming: Float32Array | undefined,
  events: ReturnType<typeof songEvents>,
  stepSec: number,
): void {
  if (incoming) {
    const source = ctx.createBufferSource();
    source.buffer = audioBufferFromInterleaved(ctx, incoming);
    source.connect(input);
    source.start(0);
  }
  for (const event of events) {
    const channel = project.channels.find((candidate) => candidate.id === event.channelId);
    if (!channel || channel.mixer !== strip.id || !isChannelAudible(project, channel.id)) continue;
    const when = event.step * stepSec + swingOffset(event.step, project.swing, stepSec);
    playVoice(
      ctx as unknown as BaseAudioContext,
      input,
      channel,
      event.pitch,
      event.vel,
      when,
      event.lenSteps * stepSec * 0.96,
    );
  }
}

function connectFaderStage(
  ctx: OfflineAudioContext,
  source: AudioNode,
  strip: Strip,
  anySolo: boolean,
  stepSec: number,
): void {
  const fader = ctx.createGain();
  fader.gain.value = Math.pow(strip.gain, 1.5);
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, strip.pan));
  const mute = ctx.createGain();
  mute.gain.value = !strip.mute && (!anySolo || strip.solo || strip.id === 0) ? 1 : 0;
  source.connect(fader);
  fader.connect(panner);
  panner.connect(mute);
  mute.connect(ctx.destination);
  scheduleStripAutomation(fader.gain, panner.pan, strip, {
    fromStep: 0,
    startAtSec: 0,
    stepSec,
  });
}

async function renderMixerStrip(
  project: Project,
  strip: Strip,
  incoming: Float32Array | undefined,
  events: ReturnType<typeof songEvents>,
  sampleRate: number,
  frameCount: number,
  stepSec: number,
  delayFrames: number,
  pluginLatency: number | undefined,
  processPlugin: OfflinePluginProcessor,
  anySolo: boolean,
): Promise<AudioBuffer> {
  const OfflineCtor = offlineContextConstructor();
  const plugin = strip.clapPlugin ?? null;
  const needsSeparateFaderStage = plugin !== null || delayFrames > 0;
  const effectsContext = new OfflineCtor(2, frameCount, sampleRate);
  const input = effectsContext.createGain();
  scheduleStripInput(effectsContext, input, strip, project, incoming, events, stepSec);

  let node: AudioNode = input;
  const activeEffects = strip.effects.filter((effect) => !effect.bypass);
  const effectNodes = activeEffects.map((effect) => createEffectNode(effectsContext, effect));
  for (const effect of effectNodes) {
    node.connect(effect.input);
    node = effect.output;
  }

  if (!needsSeparateFaderStage) {
    connectFaderStage(effectsContext, node, strip, anySolo, stepSec);
    return effectsContext.startRendering();
  }

  node.connect(effectsContext.destination);
  const effected = await effectsContext.startRendering();
  for (const effect of effectNodes) effect.dispose();
  let interleaved = interleaveAudioBuffer(effected);
  if (plugin) {
    const processed = await processPlugin(
      plugin.id,
      sampleRate,
      plugin.state,
      plugin.parameters,
      interleaved,
    );
    if (!processed) throw new Error(`CLAP offline rendering is unavailable for ${plugin.name || plugin.id}`);
    if (processed.pcm.length !== interleaved.length) {
      throw new Error(`CLAP plugin ${plugin.id} returned an invalid offline audio length`);
    }
    if (processed.latencyFrames !== pluginLatency) {
      throw new Error(`CLAP plugin ${plugin.id} reported inconsistent latency during export`);
    }
    interleaved = processed.pcm;
  }
  interleaved = shiftInterleavedAudio(interleaved, delayFrames);

  const faderContext = new OfflineCtor(2, frameCount, sampleRate);
  const source = faderContext.createBufferSource();
  source.buffer = audioBufferFromInterleaved(faderContext, interleaved);
  connectFaderStage(faderContext, source, strip, anySolo, stepSec);
  source.start(0);
  return faderContext.startRendering();
}

function addStripOutput(
  incoming: Map<number, Float32Array>,
  target: number,
  output: AudioBuffer,
  amount: number,
): void {
  let destination = incoming.get(target);
  if (!destination) {
    destination = new Float32Array(output.length * 2);
    incoming.set(target, destination);
  }
  const left = output.getChannelData(0);
  const right = output.getChannelData(1);
  for (let frame = 0; frame < output.length; frame += 1) {
    destination[frame * 2] += left[frame] * amount;
    destination[frame * 2 + 1] += right[frame] * amount;
  }
}

/**
 * Renders the project strip-by-strip so hosted CLAP inserts run between strip
 * effects and faders, before routing and sends.
 */
export async function renderSongToBufferWithPlugins(
  project: Project,
  opts: { sampleRate?: number; tailSeconds?: number } = {},
  processPlugin: OfflinePluginProcessor,
): Promise<AudioBuffer> {
  const pluginStrips = project.strips.filter((strip) => strip.clapPlugin);
  if (!pluginStrips.length) return renderSongToBuffer(project, opts);

  const sampleRate = opts.sampleRate ?? 44100;
  const stepSec = stepsToSeconds(1, project.bpm);
  const audioEndSteps = Math.max(
    0,
    ...project.audioClips.map((clip) => ticksToSteps(clip.start_tick + clip.length_ticks)),
  );
  const songDuration =
    Math.max(songLengthSteps(project), audioEndSteps) * stepSec + (opts.tailSeconds ?? 3);
  const pluginLatencies = new Map<number, number>();
  let maxPluginLatency = 0;
  for (const strip of pluginStrips) {
    const plugin = strip.clapPlugin!;
    const result = await processPlugin(
      plugin.id,
      sampleRate,
      plugin.state,
      plugin.parameters,
      new Float32Array(0),
    );
    if (!result) throw new Error(`CLAP offline rendering is unavailable for ${plugin.name || plugin.id}`);
    if (
      !Number.isInteger(result.latencyFrames) ||
      result.latencyFrames < 0 ||
      result.latencyFrames > sampleRate * MAX_OFFLINE_PLUGIN_LATENCY_SECONDS
    ) {
      throw new Error(`CLAP plugin ${plugin.id} reported an unsupported latency`);
    }
    pluginLatencies.set(strip.id, result.latencyFrames);
    maxPluginLatency = Math.max(maxPluginLatency, result.latencyFrames);
  }

  const outputFrames = Math.ceil(songDuration * sampleRate);
  const frameCount = outputFrames + maxPluginLatency;
  const stepEvents = songEvents(project);
  const anySolo = project.strips.some((strip) => strip.solo);
  const incoming = new Map<number, Float32Array>();
  const channelMixers = new Set(project.channels.map((channel) => channel.mixer));
  let masterOutput: AudioBuffer | undefined;

  for (const strip of mixerRenderOrder(project)) {
    const stripInput = incoming.get(strip.id);
    incoming.delete(strip.id);
    const pluginLatency = pluginLatencies.get(strip.id);
    if (strip.id !== 0 && !channelMixers.has(strip.id) && !stripInput && pluginLatency === undefined) {
      continue;
    }
    const delayFrames =
      pluginLatency !== undefined || channelMixers.has(strip.id)
        ? maxPluginLatency - (pluginLatency ?? 0)
        : 0;
    const output = await renderMixerStrip(
      project,
      strip,
      stripInput,
      stepEvents,
      sampleRate,
      frameCount,
      stepSec,
      delayFrames,
      pluginLatency,
      processPlugin,
      anySolo,
    );
    if (strip.id === 0) {
      masterOutput = output;
      continue;
    }
    const route = project.strips.some((candidate) => candidate.id === strip.route)
      ? strip.route
      : 0;
    if (route !== strip.id) addStripOutput(incoming, route, output, 1);
    for (const send of strip.sends) {
      if (project.strips.some((candidate) => candidate.id === send.to)) {
        addStripOutput(incoming, send.to, output, send.amount);
      }
    }
  }

  if (!masterOutput) throw new Error('Mixer master strip is missing');
  const OfflineCtor = offlineContextConstructor();
  const ctx = new OfflineCtor(2, outputFrames, sampleRate);
  const masterGain = ctx.createGain();
  masterGain.gain.value = project.masterGain;
  masterGain.connect(ctx.destination);
  const masterSource = ctx.createBufferSource();
  masterSource.buffer = masterOutput;
  masterSource.connect(masterGain);
  masterSource.start(0, maxPluginLatency / sampleRate, outputFrames / sampleRate);

  if (project.audioClips.length) {
    const buffers = await hydrateAudioClipBuffers(ctx, project.audioClips);
    scheduleAudioClipWindows(ctx, masterGain, project.audioClips, buffers, project.bpm, songDuration);
  }
  return ctx.startRendering();
}

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
      const secPerTick = 60 / (Math.max(1, bpm) * TICKS_PER_BEAT);
      const sourceOffset = sourceOffsetForWindow(
        clip,
        sourceBuffer.duration,
        window.offsetSec,
        clip.length_ticks * secPerTick,
        secPerTick,
      );
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
        sourceOffset,
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

export async function renderSongToWavWithPlugins(
  project: Project,
  opts: { sampleRate?: number; tailSeconds?: number; master?: MasterTarget } = {},
  processPlugin: OfflinePluginProcessor,
): Promise<Blob> {
  const rendered = await renderSongToBufferWithPlugins(project, opts, processPlugin);
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
