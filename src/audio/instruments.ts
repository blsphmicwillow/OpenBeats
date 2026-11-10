import type { BaseAudioContext } from './audio-context-types';
import type { Channel } from '../model/types';

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

/** Decoded user samples, keyed by sample id. Shared across live/offline contexts. */
export const SAMPLE_BANK = new Map<string, AudioBuffer>();

const mtof = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

type Tone = {
  attack: number;
  decay: number;
  release: number;
  tone: number;
  velocity: number;
};

function adsr(
  ctx: BaseAudioContext,
  peak: number,
  when: number,
  dur: number,
  env: Tone,
): GainNode {
  const g = ctx.createGain();
  const a = Math.max(0.001, env.attack);
  const d = Math.max(0.01, env.decay);
  const r = Math.max(0.01, env.release);
  const sustain = Math.max(0.05, 1 - d * 0.35);
  const end = when + Math.max(dur, a + 0.01);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * sustain), when + a + d);
  g.gain.setValueAtTime(Math.max(0.0002, peak * sustain), end);
  g.gain.exponentialRampToValueAtTime(0.0001, end + r);
  return g;
}

function noiseSource(ctx: BaseAudioContext, when: number, dur: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.start(when);
  src.stop(when + dur + 0.05);
  return src;
}

/**
 * Synthesise one note for a channel. Every preset is built from oscillators and
 * noise, so the whole instrument set ships inside the app with two dependencies
 * and renders identically online and in an offline bounce.
 */
export function playVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  channel: Channel,
  pitch: number,
  velocity: number,
  when: number,
  dur: number,
): void {
  if (channel.unloaded) return;
  const t = Math.max(when, ctx.currentTime);
  const pitchShift = pitch - channel.root + (channel.transpose ?? 0);
  const vel = Math.max(0.02, Math.min(1, velocity)) * (channel.gain ?? 0.8);
  const env: Tone = {
    attack: Math.max(0.001, channel.attack),
    decay: Math.max(0.02, channel.decay),
    release: Math.max(0.02, channel.release),
    tone: channel.tone,
    velocity: vel,
  };
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(dest);

  const stopAt = (nodes: AudioScheduledSourceNode[], end: number) => {
    nodes.forEach((n) => {
      try {
        n.stop(end);
      } catch {
        /* already stopped */
      }
    });
  };

  switch (channel.preset) {
    case 'kick': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const start = 150 + env.tone * 90;
      osc.frequency.setValueAtTime(start, t);
      osc.frequency.exponentialRampToValueAtTime(44 + env.tone * 16, t + 0.085);
      const g = adsr(ctx, vel * 1.15, t, 0.03, { ...env, decay: 0.1 + env.decay * 0.5, release: 0.08 });
      osc.connect(g).connect(out);
      osc.start(t);
      stopAt([osc], t + 0.8);
      const click = noiseSource(ctx, t, 0.02);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2200;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(vel * 0.35, t);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
      click.connect(hp).connect(cg).connect(out);
      break;
    }
    case 'snare': {
      const n = noiseSource(ctx, t, 0.4);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700 + env.tone * 1200;
      bp.Q.value = 0.9;
      const ng = adsr(ctx, vel * 0.7, t, 0.02, { ...env, decay: 0.08 + env.decay * 0.25, release: 0.1 });
      n.connect(bp).connect(ng).connect(out);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, t);
      osc.frequency.exponentialRampToValueAtTime(150, t + 0.08);
      const og = adsr(ctx, vel * 0.55, t, 0.02, { ...env, decay: 0.07, release: 0.08 });
      osc.connect(og).connect(out);
      osc.start(t);
      stopAt([osc], t + 0.4);
      break;
    }
    case 'hat': {
      const n = noiseSource(ctx, t, 0.2);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6500 + env.tone * 3000;
      const g = ctx.createGain();
      const len = 0.03 + env.decay * 0.09;
      g.gain.setValueAtTime(vel * 0.6, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      n.connect(hp).connect(g).connect(out);
      break;
    }
    case 'openhat': {
      const n = noiseSource(ctx, t, 0.6);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 5800 + env.tone * 2000;
      const g = ctx.createGain();
      const len = 0.2 + env.decay * 0.5;
      g.gain.setValueAtTime(vel * 0.55, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      n.connect(hp).connect(g).connect(out);
      break;
    }
    case 'clap': {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + env.tone * 900;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.connect(out);
      bp.connect(g);
      [0, 0.011, 0.023].forEach((offset, i) => {
        const n = noiseSource(ctx, t + offset, 0.06);
        const burst = ctx.createGain();
        burst.gain.setValueAtTime(vel * (0.55 - i * 0.08), t + offset);
        burst.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.045);
        n.connect(burst).connect(bp);
        n.stop(t + offset + 0.06);
      });
      const tail = noiseSource(ctx, t + 0.03, 0.2);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(vel * 0.22, t + 0.03);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + 0.08 + env.decay * 0.2);
      tail.connect(tg).connect(bp);
      break;
    }
    case 'tom': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = mtof(pitch);
      osc.frequency.setValueAtTime(f * 1.6, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.75, t + 0.14);
      const g = adsr(ctx, vel * 0.9, t, 0.06, { ...env, decay: 0.09 + env.decay * 0.3, release: 0.12 });
      osc.connect(g).connect(out);
      osc.start(t);
      stopAt([osc], t + 0.9);
      break;
    }
    case 'rim': {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 420 + env.tone * 380;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      osc.connect(bp).connect(g).connect(out);
      osc.start(t);
      stopAt([osc], t + 0.1);
      break;
    }
    case 'bass':
    case 'sub': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const osc = ctx.createOscillator();
      osc.type = channel.preset === 'sub' ? 'sine' : env.tone > 0.55 ? 'square' : 'sawtooth';
      osc.frequency.value = freq;
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = freq / 2;
      const subGain = ctx.createGain();
      subGain.gain.value = channel.preset === 'sub' ? 0.35 : 0.3;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6 + env.tone * 6;
      const base = channel.preset === 'sub' ? 400 : 180 + env.tone * 900;
      filter.frequency.setValueAtTime(base + 900 * env.tone, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(90, base * 0.5), t + 0.18 + env.decay * 0.5);
      const g = adsr(ctx, vel * 0.85, t, dur, env);
      osc.connect(filter);
      sub.connect(subGain).connect(filter);
      filter.connect(g).connect(out);
      osc.start(t);
      sub.start(t);
      stopAt([osc, sub], t + Math.max(dur + env.release + 0.2, 0.5));
      break;
    }
    case 'lead':
    case 'chords':
    case 'pad': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const detunes = channel.preset === 'pad' ? [-9, 0, 9] : channel.preset === 'chords' ? [-11, 0, 11] : [-7, 7];
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = channel.preset === 'lead' ? 5 : 1.2;
      const open = (channel.preset === 'pad' ? 900 : 1500) + env.tone * 5000;
      filter.frequency.setValueAtTime(open, t);
      if (channel.preset === 'lead') {
        filter.frequency.exponentialRampToValueAtTime(Math.max(300, open * 0.4), t + 0.22);
      }
      const level = channel.preset === 'chords' ? 0.32 : channel.preset === 'pad' ? 0.3 : 0.42;
      const g = adsr(ctx, vel * level, t, dur, {
        ...env,
        attack: channel.preset === 'pad' ? Math.max(0.3, env.attack) : env.attack,
        release: Math.max(env.release, channel.preset === 'pad' ? 0.6 : env.release),
      });
      filter.connect(g).connect(out);
      const oscs: OscillatorNode[] = [];
      detunes.forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = channel.preset === 'lead' ? 'sawtooth' : 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = cents;
        o.connect(filter);
        o.start(t);
        oscs.push(o);
      });
      if (channel.preset === 'lead') {
        const sq = ctx.createOscillator();
        sq.type = 'square';
        sq.frequency.value = freq;
        sq.detune.value = -1200;
        const sqg = ctx.createGain();
        sqg.gain.value = 0.35;
        sq.connect(sqg).connect(filter);
        sq.start(t);
        oscs.push(sq);
      }
      stopAt(oscs, t + Math.max(dur + env.release + 0.25, 0.4));
      break;
    }
    case 'keys': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = freq;
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = freq * 2.01;
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(freq * (1.2 + env.tone * 2.4), t);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.08, t + 0.25 + env.decay * 0.6);
      mod.connect(modGain).connect(carrier.frequency);
      const g = adsr(ctx, vel * 0.5, t, dur, env);
      carrier.connect(g).connect(out);
      const shimmer = ctx.createOscillator();
      shimmer.type = 'triangle';
      shimmer.frequency.value = freq * 2;
      const sg = ctx.createGain();
      sg.gain.value = 0.12;
      shimmer.connect(sg).connect(g);
      carrier.start(t);
      mod.start(t);
      shimmer.start(t);
      stopAt([carrier, mod, shimmer], t + Math.max(dur + env.release + 0.2, 0.4));
      break;
    }
    case 'pluck': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = freq * 2;
      const sawG = ctx.createGain();
      sawG.gain.value = 0.2;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      filter.frequency.setValueAtTime(1200 + env.tone * 6000, t);
      filter.frequency.exponentialRampToValueAtTime(400 + env.tone * 600, t + 0.12 + env.decay * 0.3);
      const g = adsr(ctx, vel * 0.6, t, Math.min(dur, 0.18), { ...env, decay: 0.1 + env.decay * 0.3, release: Math.max(env.release, 0.18) });
      osc.connect(filter);
      saw.connect(sawG).connect(filter);
      filter.connect(g).connect(out);
      osc.start(t);
      saw.start(t);
      stopAt([osc, saw], t + 1.2);
      break;
    }
    case 'fx': {
      const n = noiseSource(ctx, t, Math.max(dur, 0.3) + 0.6);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.4;
      const len = Math.max(0.3, dur);
      bp.frequency.setValueAtTime(300 + env.tone * 400, t);
      bp.frequency.exponentialRampToValueAtTime(5000 + env.tone * 6000, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vel * 0.5, t + Math.min(len, 0.4));
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.1);
      n.connect(bp).connect(g).connect(out);
      break;
    }
    case 'sample': {
      const buf = channel.sample ? SAMPLE_BANK.get(channel.sample.id) : undefined;
      if (!buf) {
        playVoice(ctx, dest, { ...channel, preset: 'pluck' }, pitch, velocity, when, dur);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = channel.sample ? Math.pow(2, pitchShift / 12) : 1;
      const g = ctx.createGain();
      const a = Math.max(0.001, env.attack);
      const r = Math.max(0.02, env.release);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * 0.95), t + a);
      g.gain.setValueAtTime(Math.max(0.0002, vel * 0.95), t + Math.max(dur, a + 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + 0.02) + r);
      src.connect(g).connect(out);
      src.start(t);
      src.stop(t + Math.max(dur, a) + r + 0.05);
      break;
    }
    default: {
      const osc = ctx.createOscillator();
      osc.frequency.value = mtof(pitch);
      const g = adsr(ctx, vel * 0.4, t, dur, env);
      osc.connect(g).connect(out);
      osc.start(t);
      stopAt([osc], t + dur + env.release + 0.1);
    }
  }
}

/** Metronome click, generated live. */
export function playClick(ctx: BaseAudioContext, dest: AudioNode, when: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = accent ? 1600 : 1000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(accent ? 0.3 : 0.16, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  osc.connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + 0.06);
}
