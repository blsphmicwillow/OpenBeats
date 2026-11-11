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
    case 'fmbass': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = freq;
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = freq * 2;
      const modGain = ctx.createGain();
      const index = 1.6 + env.tone * 5.4;
      modGain.gain.setValueAtTime(freq * index, t);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.12, t + 0.1 + env.decay * 0.4);
      mod.connect(modGain).connect(carrier.frequency);
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = freq * 0.5;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.28;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 1.4;
      filter.frequency.setValueAtTime(280 + env.tone * 1600, t);
      filter.frequency.exponentialRampToValueAtTime(120 + env.tone * 300, t + 0.14 + env.decay * 0.3);
      const g = adsr(ctx, vel * 0.9, t, dur, { ...env, decay: Math.max(0.12, env.decay * 0.55), release: Math.max(0.12, env.release) });
      carrier.connect(filter);
      sub.connect(subGain).connect(filter);
      filter.connect(g).connect(out);
      carrier.start(t);
      mod.start(t);
      sub.start(t);
      stopAt([carrier, mod, sub], t + Math.max(dur + env.release + 0.2, 0.4));
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
    case 'glass': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const partials = [
        { ratio: 1, level: 0.55 },
        { ratio: 2.01, level: 0.24 },
        { ratio: 3.99, level: 0.13 },
        { ratio: 5.02, level: 0.07 },
      ];
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.7;
      filter.frequency.setValueAtTime(2400 + env.tone * 9000, t);
      filter.frequency.exponentialRampToValueAtTime(700 + env.tone * 1800, t + 0.35 + env.decay * 0.7);
      const g = adsr(ctx, vel * 0.52, t, dur, env);
      filter.connect(g).connect(out);
      const oscs: OscillatorNode[] = [];
      partials.forEach((partial, index) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * partial.ratio;
        osc.detune.value = index % 2 === 0 ? 3 : -3;
        const level = ctx.createGain();
        level.gain.value = partial.level * (index === 0 ? 1 : 0.55 + env.tone * 0.8);
        osc.connect(level).connect(filter);
        osc.start(t);
        oscs.push(osc);
      });
      stopAt(oscs, t + Math.max(dur + env.release + 0.25, 0.5));
      break;
    }
    case 'choir': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const g = adsr(ctx, vel * 0.4, t, dur, {
        ...env,
        attack: Math.max(0.25, env.attack),
        release: Math.max(0.4, env.release),
      });
      g.connect(out);
      // Three soft formant bands over two detuned saws read as a vowel-ish pad
      // without sampling anyone else's choir.
      const formants = [
        { hz: 620, q: 5.5, level: 0.5 },
        { hz: 1180, q: 6.5, level: 0.32 },
        { hz: 2650, q: 8, level: 0.14 },
      ];
      const oscs: OscillatorNode[] = [];
      [-7, 7].forEach((cents) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = cents;
        osc.start(t);
        oscs.push(osc);
        formants.forEach((formant) => {
          const band = ctx.createBiquadFilter();
          band.type = 'bandpass';
          band.frequency.value = formant.hz * (0.85 + env.tone * 0.45);
          band.Q.value = formant.q;
          const level = ctx.createGain();
          level.gain.value = formant.level;
          osc.connect(band).connect(level).connect(g);
        });
      });
      const breath = noiseSource(ctx, t, dur + env.release + 0.2);
      const air = ctx.createBiquadFilter();
      air.type = 'bandpass';
      air.frequency.value = 3000 + env.tone * 2000;
      air.Q.value = 1.1;
      const airGain = ctx.createGain();
      airGain.gain.value = vel * 0.06;
      breath.connect(air).connect(airGain).connect(out);
      stopAt(oscs, t + Math.max(dur + env.release + 0.3, 0.6));
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
    case 'anvil': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.setValueAtTime(freq * 2.6, t);
      body.frequency.exponentialRampToValueAtTime(Math.max(38, freq * 0.72), t + 0.06 + env.tone * 0.03);
      const bodyGain = adsr(ctx, vel * 1.05, t, 0.02, { ...env, decay: 0.06 + env.decay * 0.12, release: 0.05 });
      body.connect(bodyGain).connect(out);
      body.start(t);
      stopAt([body], t + 0.7);
      // A short inharmonic ring turns the shell into a struck metal drum.
      [2.7, 4.13, 5.9].forEach((ratio, index) => {
        const ring = ctx.createOscillator();
        ring.type = 'square';
        ring.frequency.value = freq * ratio;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = freq * ratio;
        band.Q.value = 7;
        const len = 0.04 + env.decay * (0.16 - index * 0.03);
        const level = ctx.createGain();
        level.gain.setValueAtTime(Math.max(0.0002, (vel * 0.12) / (index + 1)), t);
        level.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, len));
        ring.connect(band).connect(level).connect(out);
        ring.start(t);
        stopAt([ring], t + len + 0.03);
      });
      const strike = noiseSource(ctx, t, 0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1600 + env.tone * 2600;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(vel * 0.32, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
      strike.connect(hp).connect(ng).connect(out);
      break;
    }
    case 'prism': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const ratios = [1, 2.01, 3.02, 4.05, 5.12, 7.06, 9.1];
      const master = adsr(ctx, vel * 0.5, t, dur, { ...env, release: Math.max(0.3, env.release) });
      master.connect(out);
      const oscs: OscillatorNode[] = [];
      ratios.forEach((ratio, index) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        // Higher partials stretch further out of tune as Tone rises, which is
        // what makes the spectrum feel metallic rather than organ-like.
        osc.frequency.value = freq * (ratio + index * 0.004 * env.tone);
        osc.detune.value = (index % 2 === 0 ? 5 : -5) * env.tone;
        const level = ctx.createGain();
        const peak = (0.62 / (index + 1.4)) * (0.55 + env.tone * 0.6);
        const decay = Math.max(0.08, 0.9 / (index * 0.55 + 1) + env.decay * 0.4);
        level.gain.setValueAtTime(0.0001, t);
        level.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.004, env.attack));
        level.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.32), t + decay);
        osc.connect(level).connect(master);
        osc.start(t);
        oscs.push(osc);
      });
      stopAt(oscs, t + Math.max(dur, 0.3) + env.release + 0.2);
      break;
    }
    case 'sundial': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2.4 + env.tone * 5;
      const open = 700 + env.tone * 5200;
      filter.frequency.setValueAtTime(open, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(180, open * (0.25 + env.decay * 0.3)), t + 0.2 + env.decay * 0.6);
      const g = adsr(ctx, vel * 0.48, t, dur, env);
      filter.connect(g).connect(out);
      const oscs: OscillatorNode[] = [];
      [-9, 0, 9].forEach((cents, index) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = cents;
        const level = ctx.createGain();
        level.gain.value = index === 1 ? 0.55 : 0.4;
        osc.connect(level).connect(filter);
        osc.start(t);
        oscs.push(osc);
      });
      const sub = ctx.createOscillator();
      sub.type = 'square';
      sub.frequency.value = freq / 2;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.18;
      sub.connect(subGain).connect(filter);
      sub.start(t);
      oscs.push(sub);
      stopAt(oscs, t + Math.max(dur, 0.2) + env.release + 0.15);
      break;
    }
    case 'cordwood': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const delay = ctx.createDelay(0.2);
      delay.delayTime.value = Math.min(0.05, Math.max(0.0015, 1 / freq));
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 1200 + env.tone * 6800;
      const feedback = ctx.createGain();
      feedback.gain.value = Math.min(0.985, 0.92 + env.tone * 0.06);
      delay.connect(damp).connect(feedback).connect(delay);
      // A noise burst is the plectrum; the delay loop is the string.
      const burst = noiseSource(ctx, t, 0.06);
      const excitation = ctx.createGain();
      excitation.gain.setValueAtTime(vel * 0.8, t);
      excitation.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      burst.connect(excitation).connect(delay);
      const g = adsr(ctx, vel * 0.65, t, Math.max(dur, 0.1), {
        ...env,
        decay: Math.min(0.35, env.decay),
        release: Math.max(0.2, env.release),
      });
      damp.connect(g).connect(out);
      break;
    }
    case 'vector9': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = freq;
      const modA = ctx.createOscillator();
      modA.type = 'sine';
      modA.frequency.value = freq * 2;
      const modB = ctx.createOscillator();
      modB.type = 'sine';
      modB.frequency.value = freq * 3.01;
      const indexA = ctx.createGain();
      indexA.gain.setValueAtTime(freq * (1.2 + env.tone * 4.5), t);
      indexA.gain.exponentialRampToValueAtTime(freq * 0.12, t + 0.16 + env.decay * 0.5);
      const indexB = ctx.createGain();
      indexB.gain.setValueAtTime(freq * (0.4 + env.tone * 1.6), t);
      indexB.gain.exponentialRampToValueAtTime(freq * 0.04, t + 0.22 + env.decay * 0.4);
      modA.connect(indexA).connect(carrier.frequency);
      modB.connect(indexB).connect(carrier.frequency);
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = freq;
      const sawGain = ctx.createGain();
      sawGain.gain.value = 0.18;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2.2;
      filter.frequency.setValueAtTime(900 + env.tone * 5200, t);
      filter.frequency.exponentialRampToValueAtTime(320 + env.tone * 600, t + 0.25 + env.decay * 0.4);
      const g = adsr(ctx, vel * 0.55, t, dur, env);
      carrier.connect(filter);
      saw.connect(sawGain).connect(filter);
      filter.connect(g).connect(out);
      carrier.start(t);
      modA.start(t);
      modB.start(t);
      saw.start(t);
      stopAt([carrier, modA, modB, saw], t + Math.max(dur, 0.2) + env.release + 0.2);
      break;
    }
    case 'acidwell': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const square = ctx.createOscillator();
      square.type = 'square';
      square.frequency.value = freq;
      square.detune.value = -1200;
      const squareGain = ctx.createGain();
      squareGain.gain.value = 0.22;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      // Keep Q in a stable range: a very high resonance plus a fast exponential
      // sweep makes some browsers report an unstable BiquadFilter.
      filter.Q.value = 7 + env.tone * 7;
      const accent = velocity > 0.8 ? 1.35 : 1;
      filter.frequency.setValueAtTime((280 + env.tone * 2400) * accent, t);
      filter.frequency.linearRampToValueAtTime(Math.max(120, 160 + env.tone * 340), t + 0.12 + env.decay * 0.35);
      const curve = new Float32Array(256);
      for (let i = 0; i < curve.length; i += 1) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * (1.4 + env.tone * 3));
      }
      const shaper = ctx.createWaveShaper();
      shaper.curve = curve;
      shaper.oversample = '2x';
      const g = adsr(ctx, vel * 0.72, t, dur, { ...env, release: Math.max(0.1, env.release) });
      osc.connect(filter);
      square.connect(squareGain).connect(filter);
      filter.connect(shaper).connect(g).connect(out);
      osc.start(t);
      square.start(t);
      stopAt([osc, square], t + Math.max(dur, 0.15) + env.release + 0.15);
      break;
    }
    case 'dice': {
      // The channel seeds the patch, so the instrument is stable across notes
      // and bounces but different on every new channel.
      let seed = 2166136261;
      const text = `${channel.id}:${channel.name}`;
      for (let i = 0; i < text.length; i += 1) {
        seed ^= text.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
      }
      const rand = () => {
        seed = Math.imul(seed ^ (seed >>> 15), 2246822507);
        seed ^= seed >>> 13;
        return (seed >>> 0) / 4294967296;
      };
      const waves: OscillatorType[] = ['sawtooth', 'square', 'triangle', 'sine'];
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 1.5 + rand() * 8;
      const cutoff = 380 + rand() * 4200;
      filter.frequency.setValueAtTime(cutoff + env.tone * 3000, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(160, cutoff * (0.3 + rand() * 0.4)), t + 0.18 + env.decay * 0.5);
      const g = adsr(ctx, vel * 0.5, t, dur, env);
      filter.connect(g).connect(out);
      const oscs: OscillatorNode[] = [];
      const count = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < count; i += 1) {
        const osc = ctx.createOscillator();
        osc.type = waves[Math.floor(rand() * waves.length)];
        osc.frequency.value = freq * (i === 0 ? 1 : rand() > 0.6 ? 2 : 1.005);
        osc.detune.value = -20 + rand() * 40;
        const level = ctx.createGain();
        level.gain.value = 0.45 / (i + 1);
        osc.connect(level).connect(filter);
        osc.start(t);
        oscs.push(osc);
      }
      if (rand() > 0.5) {
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = freq / 2;
        const subGain = ctx.createGain();
        subGain.gain.value = 0.25;
        sub.connect(subGain).connect(filter);
        sub.start(t);
        oscs.push(sub);
      }
      stopAt(oscs, t + Math.max(dur, 0.2) + env.release + 0.2);
      break;
    }
    case 'dustdevil': {
      const sampleBuffer = channel.sample ? SAMPLE_BANK.get(channel.sample.id) : undefined;
      const sourceBuffer = sampleBuffer ?? noiseBuffer(ctx);
      const usable = Math.max(0.05, Math.min(1, sourceBuffer.duration));
      const grainCount = Math.max(6, Math.min(24, Math.ceil(Math.max(dur, 0.15) / 0.03)));
      const rate = Math.pow(2, pitchShift / 12);
      for (let i = 0; i < grainCount; i += 1) {
        const src = ctx.createBufferSource();
        src.buffer = sourceBuffer;
        src.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
        const start = t + i * 0.018;
        const offset = sampleBuffer
          ? Math.random() * Math.max(0, sourceBuffer.duration - 0.12)
          : Math.random() * Math.max(0, usable - 0.12);
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 500 + Math.random() * (1200 + env.tone * 5200);
        band.Q.value = 1.2 + Math.random() * 2.4;
        const g = ctx.createGain();
        const peak = (vel * 0.5) / Math.sqrt(grainCount);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
        src.connect(band).connect(g).connect(out);
        src.start(start, offset, 0.1);
        try {
          src.stop(start + 0.12);
        } catch {
          /* already stopped */
        }
      }
      break;
    }
    case 'chatter': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const g = adsr(ctx, vel * 0.5, t, dur, { ...env, release: Math.max(0.2, env.release) });
      g.connect(out);
      const vowel = 0.75 + env.tone * 0.7;
      const formants = [
        { hz: 700, q: 7, level: 0.55 },
        { hz: 1150, q: 9, level: 0.36 },
        { hz: 2600, q: 12, level: 0.16 },
      ];
      const oscs: OscillatorNode[] = [];
      [-6, 6].forEach((cents) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = cents;
        // A slow pitch wobble keeps the voice from sounding like a static saw.
        const vibrato = ctx.createOscillator();
        vibrato.frequency.value = 5.2;
        const vibratoDepth = ctx.createGain();
        vibratoDepth.gain.value = 4 + env.tone * 8;
        vibrato.connect(vibratoDepth).connect(osc.detune);
        vibrato.start(t);
        oscs.push(vibrato);
        formants.forEach((formant) => {
          const band = ctx.createBiquadFilter();
          band.type = 'bandpass';
          band.frequency.value = formant.hz * vowel;
          band.Q.value = formant.q;
          const level = ctx.createGain();
          level.gain.value = formant.level;
          osc.connect(band).connect(level).connect(g);
        });
        osc.start(t);
        oscs.push(osc);
      });
      // Consonant-like noise at the onset, plus breath through the vowel.
      const onset = noiseSource(ctx, t, 0.06);
      const onsetBand = ctx.createBiquadFilter();
      onsetBand.type = 'bandpass';
      onsetBand.frequency.value = 2400 + env.tone * 3000;
      onsetBand.Q.value = 1.4;
      const onsetGain = ctx.createGain();
      onsetGain.gain.setValueAtTime(vel * 0.25, t);
      onsetGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      onset.connect(onsetBand).connect(onsetGain).connect(out);
      const air = noiseSource(ctx, t, Math.max(dur, 0.2) + env.release);
      const airBand = ctx.createBiquadFilter();
      airBand.type = 'bandpass';
      airBand.frequency.value = 1800 + env.tone * 2000;
      airBand.Q.value = 0.8;
      const airGain = ctx.createGain();
      airGain.gain.value = vel * 0.05;
      air.connect(airBand).connect(airGain).connect(g);
      stopAt(oscs, t + Math.max(dur, 0.2) + env.release + 0.2);
      break;
    }
    case 'hammerfelt': {
      const freq = mtof(pitch + (channel.transpose ?? 0));
      const ratios = [1, 2, 3, 4.02, 5.05, 6.08, 7.16];
      const master = adsr(ctx, vel * 0.55, t, dur, { ...env, release: Math.max(0.25, env.release) });
      master.connect(out);
      const oscs: OscillatorNode[] = [];
      ratios.forEach((ratio, index) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * ratio * (1 + index * 0.0006 * env.tone);
        osc.detune.value = (index % 2 === 0 ? 2 : -2) * env.tone;
        const level = ctx.createGain();
        const peak = 0.7 / Math.pow(index + 1, 1.35);
        const decay = Math.max(0.12, 0.7 / (index * 0.7 + 1) + env.decay * 0.3);
        level.gain.setValueAtTime(0.0001, t);
        level.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.004 + index * 0.0015);
        level.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.25), t + decay);
        osc.connect(level).connect(master);
        osc.start(t);
        oscs.push(osc);
      });
      const hammer = noiseSource(ctx, t, 0.04);
      const hammerBand = ctx.createBiquadFilter();
      hammerBand.type = 'bandpass';
      hammerBand.frequency.value = 1200 + env.tone * 2200;
      hammerBand.Q.value = 0.9;
      const hammerGain = ctx.createGain();
      hammerGain.gain.setValueAtTime(vel * 0.18, t);
      hammerGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
      hammer.connect(hammerBand).connect(hammerGain).connect(out);
      stopAt(oscs, t + Math.max(dur, 0.25) + env.release + 0.2);
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
