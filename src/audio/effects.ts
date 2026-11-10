import type { BaseAudioContext } from './audio-context-types';
import type { Effect, EffectType } from '../model/types';

export interface EffectNode {
  input: AudioNode;
  output: AudioNode;
  update(params: Record<string, number>): void;
  dispose(): void;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function impulse(ctx: BaseAudioContext, seconds: number, decay: number, damp: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    const dampCoef = clamp(damp, 0, 0.995);
    for (let i = 0; i < len; i += 1) {
      const t = i / len;
      const env = Math.pow(1 - t, 1.6 + decay * 4);
      const noise = Math.random() * 2 - 1;
      lp = lp * dampCoef + noise * (1 - dampCoef);
      data[i] = lp * env;
    }
  }
  return buf;
}

function softClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = Math.max(0.001, amount);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

/**
 * Native effects. They are plain Web Audio graphs so they run inside the DAW,
 * follow the theme in the UI and can be exported offline without plugins.
 */
export function createEffectNode(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const p = effect.params;
  const cleanups: Array<() => void> = [];

  const makeDryWet = (mix: number) => {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.gain.value = 1 - mix;
    wet.gain.value = mix;
    return { dry, wet };
  };

  switch (effect.type as EffectType) {
    case 'eq3': {
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 180;
      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.Q.value = 1.1;
      mid.frequency.value = p.freq ?? 1000;
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 4200;
      input.connect(low).connect(mid).connect(high).connect(output);
      return {
        input,
        output,
        update(next) {
          low.gain.setTargetAtTime(next.low ?? 0, ctx.currentTime, 0.01);
          mid.gain.setTargetAtTime(next.mid ?? 0, ctx.currentTime, 0.01);
          high.gain.setTargetAtTime(next.high ?? 0, ctx.currentTime, 0.01);
          mid.frequency.setTargetAtTime(next.freq ?? 1000, ctx.currentTime, 0.01);
        },
        dispose() {
          [low, mid, high].forEach((n) => n.disconnect());
        },
      };
    }
    case 'eq10': {
      const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      const bands = freqs.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = 'peaking';
        b.frequency.value = f;
        b.Q.value = 1.2;
        b.gain.value = p[`g${i}`] ?? 0;
        return b;
      });
      let node: AudioNode = input;
      bands.forEach((b) => {
        node.connect(b);
        node = b;
      });
      node.connect(output);
      return {
        input,
        output,
        update(next) {
          bands.forEach((b, i) => b.gain.setTargetAtTime(next[`g${i}`] ?? 0, ctx.currentTime, 0.01));
        },
        dispose() {
          bands.forEach((b) => b.disconnect());
        },
      };
    }
    case 'comp': {
      const comp = ctx.createDynamicsCompressor();
      const makeup = ctx.createGain();
      input.connect(comp).connect(makeup).connect(output);
      return {
        input,
        output,
        update(next) {
          comp.threshold.setTargetAtTime(next.threshold ?? -20, ctx.currentTime, 0.01);
          comp.ratio.setTargetAtTime(next.ratio ?? 4, ctx.currentTime, 0.01);
          comp.attack.setTargetAtTime(0.001 + (next.attack ?? 0.15) * 0.3, ctx.currentTime, 0.01);
          comp.release.setTargetAtTime(0.02 + (next.release ?? 0.35) * 0.8, ctx.currentTime, 0.01);
          comp.knee.setTargetAtTime(next.knee ?? 6, ctx.currentTime, 0.01);
          makeup.gain.setTargetAtTime(dbToGain(next.makeup ?? 0), ctx.currentTime, 0.01);
        },
        dispose() {
          comp.disconnect();
          makeup.disconnect();
        },
      };
    }
    case 'limiter': {
      const comp = ctx.createDynamicsCompressor();
      comp.ratio.value = 20;
      comp.attack.value = 0.001;
      comp.knee.value = 0;
      comp.threshold.value = p.threshold ?? -1;
      input.connect(comp).connect(output);
      return {
        input,
        output,
        update(next) {
          comp.threshold.setTargetAtTime(next.threshold ?? -1, ctx.currentTime, 0.02);
          comp.release.setTargetAtTime(0.02 + (next.release ?? 0.25) * 0.5, ctx.currentTime, 0.02);
        },
        dispose() {
          comp.disconnect();
        },
      };
    }
    case 'reverb': {
      const convolver = ctx.createConvolver();
      const mix = p.mix ?? 0.25;
      const { dry, wet } = makeDryWet(mix);
      input.connect(dry).connect(output);
      input.connect(convolver).connect(wet).connect(output);
      let lastKey = '';
      const build = (params: Record<string, number>) => {
        const key = `${params.size?.toFixed(2)}|${params.decay?.toFixed(2)}|${params.damp?.toFixed(2)}`;
        if (key === lastKey) return;
        lastKey = key;
        const size = params.size ?? 0.5;
        const decay = params.decay ?? 0.55;
        const damp = params.damp ?? 0.45;
        convolver.buffer = impulse(ctx, 0.35 + size * 3.6, decay, 0.15 + damp * 0.8);
      };
      build(p);
      return {
        input,
        output,
        update(next) {
          build(next);
          const m = next.mix ?? 0.25;
          dry.gain.setTargetAtTime(1 - m, ctx.currentTime, 0.02);
          wet.gain.setTargetAtTime(m, ctx.currentTime, 0.02);
        },
        dispose() {
          convolver.disconnect();
          dry.disconnect();
          wet.disconnect();
        },
      };
    }
    case 'delay': {
      const delayL = ctx.createDelay(2);
      const delayR = ctx.createDelay(2);
      const fb = ctx.createGain();
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      const merger = ctx.createChannelMerger(2);
      const { dry, wet } = makeDryWet(p.mix ?? 0.25);
      const splitter = ctx.createChannelSplitter(2);

      input.connect(dry).connect(output);
      input.connect(delayL);
      delayL.connect(delayR);
      delayR.connect(tone);
      tone.connect(fb);
      fb.connect(delayL);
      tone.connect(splitter);
      splitter.connect(merger, 0, 1);
      tone.connect(merger, 0, 0);
      merger.connect(wet).connect(output);

      delayL.delayTime.value = 0.05 + (p.time ?? 0.32) * 0.7;
      delayR.delayTime.value = 0.05 + (p.time ?? 0.32) * 0.7;
      fb.gain.value = p.feedback ?? 0.35;
      tone.frequency.value = 800 + (p.tone ?? 0.5) * 6000;
      return {
        input,
        output,
        update(next) {
          const t = 0.02 + (next.time ?? 0.32) * 0.72;
          delayL.delayTime.setTargetAtTime(t, ctx.currentTime, 0.05);
          delayR.delayTime.setTargetAtTime(t * 1.5, ctx.currentTime, 0.05);
          fb.gain.setTargetAtTime(clamp(next.feedback ?? 0.35, 0, 0.9), ctx.currentTime, 0.02);
          tone.frequency.setTargetAtTime(800 + (next.tone ?? 0.5) * 6000, ctx.currentTime, 0.02);
          const m = next.mix ?? 0.25;
          dry.gain.setTargetAtTime(1 - m, ctx.currentTime, 0.02);
          wet.gain.setTargetAtTime(m, ctx.currentTime, 0.02);
        },
        dispose() {
          [delayL, delayR, fb, tone, merger, dry, wet, splitter].forEach((n) => n.disconnect());
        },
      };
    }
    case 'drive': {
      const shaper = ctx.createWaveShaper();
      shaper.oversample = '4x';
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      const { dry, wet } = makeDryWet(p.mix ?? 1);
      input.connect(shaper).connect(tone).connect(wet).connect(output);
      input.connect(dry).connect(output);
      shaper.curve = softClipCurve(p.amount ?? 6);
      tone.frequency.value = 1200 + (p.tone ?? 0.5) * 8000;
      return {
        input,
        output,
        update(next) {
          shaper.curve = softClipCurve(next.amount ?? 6);
          tone.frequency.setTargetAtTime(1200 + (next.tone ?? 0.5) * 8000, ctx.currentTime, 0.02);
          const m = next.mix ?? 1;
          dry.gain.setTargetAtTime(1 - m, ctx.currentTime, 0.02);
          wet.gain.setTargetAtTime(m, ctx.currentTime, 0.02);
        },
        dispose() {
          [shaper, tone, dry, wet].forEach((n) => n.disconnect());
        },
      };
    }
    case 'filter': {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 80 * Math.pow(150, p.cutoff ?? 0.8);
      filter.Q.value = p.res ?? 1;
      const { dry, wet } = makeDryWet(p.mix ?? 1);
      input.connect(filter).connect(wet).connect(output);
      input.connect(dry).connect(output);
      return {
        input,
        output,
        update(next) {
          const cutoff = 80 * Math.pow(150, next.cutoff ?? 0.8);
          filter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.02);
          filter.Q.setTargetAtTime(next.res ?? 1, ctx.currentTime, 0.02);
          const m = next.mix ?? 1;
          dry.gain.setTargetAtTime(1 - m, ctx.currentTime, 0.02);
          wet.gain.setTargetAtTime(m, ctx.currentTime, 0.02);
        },
        dispose() {
          [filter, dry, wet].forEach((n) => n.disconnect());
          void cleanups;
        },
      };
    }
    default: {
      input.connect(output);
      return { input, output, update() {}, dispose() {} };
    }
  }
}
