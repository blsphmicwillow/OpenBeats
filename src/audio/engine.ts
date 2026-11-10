import type { BaseAudioContext } from './audio-context-types';
import type { Channel, Project } from '../model/types';
import { createEffectNode, type EffectNode } from './effects';
import { playClick, playVoice } from './instruments';

export interface StripNodes {
  id: number;
  input: GainNode;
  fader: GainNode;
  panner: StereoPannerNode;
  mute: GainNode;
  analyser: AnalyserNode;
  post: GainNode;
  effects: Map<string, EffectNode>;
  sends: GainNode[];
  meter: Float32Array<ArrayBuffer>;
  level: number;
}

export interface Graph {
  ctx: BaseAudioContext;
  master: GainNode;
  strips: Map<number, StripNodes>;
  masterStrip: StripNodes;
}

/** Routes must never loop back into themselves. */
export function routeIsSafe(project: Project, stripId: number, target: number): boolean {
  if (target === stripId) return false;
  const byId = new Map(project.strips.map((s) => [s.id, s]));
  let cursor = target;
  let hops = 0;
  while (cursor !== 0 && hops < 64) {
    if (cursor === stripId) return false;
    const strip = byId.get(cursor);
    if (!strip) return true;
    cursor = strip.route;
    hops += 1;
  }
  return true;
}

export function buildGraph(ctx: BaseAudioContext, project: Project): Graph {
  const strips = new Map<number, StripNodes>();
  const master = ctx.createGain();
  master.gain.value = project.masterGain;

  for (const strip of project.strips) {
    const input = ctx.createGain();
    const fader = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const mute = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    const post = ctx.createGain();

    const effects = new Map<string, EffectNode>();
    let node: AudioNode = input;
    for (const fx of strip.effects) {
      if (fx.bypass) continue;
      const built = createEffectNode(ctx, fx);
      node.connect(built.input);
      node = built.output;
      effects.set(fx.id, built);
    }
    node.connect(fader);
    fader.connect(panner);
    panner.connect(mute);
    mute.connect(analyser);
    analyser.connect(post);

    strips.set(strip.id, {
      id: strip.id,
      input,
      fader,
      panner,
      mute,
      analyser,
      post,
      effects,
      sends: [],
      meter: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
      level: 0,
    });
  }

  for (const strip of project.strips) {
    const node = strips.get(strip.id);
    if (!node) continue;
    if (strip.id === 0) {
      node.post.connect(master);
      continue;
    }
    const target = strips.get(strip.route) ?? strips.get(0);
    node.post.connect((target ?? node).input);
    for (const send of strip.sends) {
      const sendTarget = strips.get(send.to);
      if (!sendTarget) continue;
      const g = ctx.createGain();
      g.gain.value = send.amount;
      node.post.connect(g);
      g.connect(sendTarget.input);
      node.sends.push(g);
    }
  }

  master.connect(ctx.destination);
  const masterStrip = strips.get(0)!;
  return { ctx, master, strips, masterStrip };
}

function topologyKey(project: Project): string {
  return project.strips
    .map(
      (s) =>
        `${s.id}>${s.route}:${s.effects
          .filter((e) => !e.bypass)
          .map((e) => `${e.id}/${e.type}`)
          .join('+')}:${s.sends.map((x) => x.to).join(',')}`,
    )
    .join('|');
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  graph: Graph | null = null;
  private project: Project | null = null;
  private key = '';
  error: string | null = null;

  async ensure(project: Project): Promise<boolean> {
    this.project = project;
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'Audio is unavailable in this browser.';
        return false;
      }
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* browsers may refuse without a gesture; the next click retries */
      }
    }
    if (!this.graph) this.rebuild(project);
    else this.sync(project);
    return true;
  }

  private rebuild(project: Project) {
    if (!this.ctx) return;
    this.disposeGraph();
    this.graph = buildGraph(this.ctx, project);
    this.key = topologyKey(project);
    this.sync(project);
  }

  private disposeGraph() {
    if (!this.graph) return;
    this.graph.strips.forEach((s) => {
      s.effects.forEach((fx) => fx.dispose());
      s.input.disconnect();
      s.fader.disconnect();
      s.panner.disconnect();
      s.mute.disconnect();
      s.analyser.disconnect();
      s.post.disconnect();
      s.sends.forEach((g) => g.disconnect());
    });
    this.graph.master.disconnect();
    this.graph = null;
  }

  /** Applies mixer state; rebuilds only when routing/insert topology changed. */
  sync(project: Project) {
    this.project = project;
    if (!this.ctx || !this.graph) return;
    const key = topologyKey(project);
    if (key !== this.key) {
      this.rebuild(project);
      return;
    }
    const anySolo = project.strips.some((s) => s.solo && s.id !== 0);
    const now = this.ctx.currentTime;
    for (const strip of project.strips) {
      const node = this.graph.strips.get(strip.id);
      if (!node) continue;
      const audible = !strip.mute && (!anySolo || strip.solo || strip.id === 0);
      node.fader.gain.setTargetAtTime(Math.pow(strip.gain, 1.5), now, 0.01);
      node.panner.pan.setTargetAtTime(strip.pan, now, 0.01);
      node.mute.gain.setTargetAtTime(audible ? 1 : 0, now, 0.008);
      strip.sends.forEach((send, i) => {
        const g = node.sends[i];
        if (g) g.gain.setTargetAtTime(send.amount, now, 0.01);
      });
      strip.effects.forEach((fx) => {
        const built = node.effects.get(fx.id);
        if (built) built.update(fx.params);
      });
    }
    this.graph.master.gain.setTargetAtTime(project.masterGain, now, 0.02);
  }

  setMasterGain(value: number) {
    if (this.ctx && this.graph) this.graph.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  /** RMS-ish level 0..1 for a strip, decayed so meters fall smoothly. */
  level(stripId: number): number {
    const node = this.graph?.strips.get(stripId);
    if (!node || !this.ctx) return 0;
    node.analyser.getFloatTimeDomainData(node.meter);
    let sum = 0;
    for (let i = 0; i < node.meter.length; i += 1) sum += node.meter[i] * node.meter[i];
    const rms = Math.sqrt(sum / node.meter.length);
    const target = Math.min(1, rms * 3.2);
    node.level = target > node.level ? target : node.level * 0.88;
    return node.level;
  }

  stripInput(stripId: number): AudioNode | null {
    return this.graph?.strips.get(stripId)?.input ?? null;
  }

  triggerChannel(channel: Channel, pitch: number, vel: number, when: number, durSec: number, stripId?: number) {
    if (!this.ctx || !this.graph) return;
    const target = this.stripInput(stripId ?? channel.mixer);
    if (!target) return;
    playVoice(this.ctx, target, channel, pitch, vel, when, durSec);
  }

  preview(channel: Channel, pitch?: number) {
    if (!this.ctx) return;
    this.triggerChannel(channel, pitch ?? channel.root, 0.9, this.ctx.currentTime + 0.02, 0.35);
  }

  click(when: number, accent: boolean) {
    if (!this.ctx || !this.graph) return;
    playClick(this.ctx, this.graph.master, when, accent);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  dispose() {
    this.disposeGraph();
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const engine = new AudioEngine();
