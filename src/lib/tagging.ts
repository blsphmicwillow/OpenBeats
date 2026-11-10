/**
 * One-shot sample tagging. Estimates tempo, brightness and instrument family
 * from the decoded buffer so the browser can label drops automatically.
 */

export interface SampleTags {
  bpm: number | null;
  brightness: number;
  duration: number;
  type: string;
  tags: string[];
}

function rmsWindows(buffer: AudioBuffer, windowSize: number): Float32Array {
  const data = buffer.getChannelData(0);
  const frames = Math.floor(data.length / windowSize);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const v = data[f * windowSize + i];
      sum += v * v;
    }
    out[f] = Math.sqrt(sum / windowSize);
  }
  return out;
}

/** Spectral centroid via a coarse zero-crossing-ish windowed estimate. */
function brightness(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const n = Math.min(data.length, buffer.sampleRate * 2);
  const step = Math.max(1, Math.floor(n / 20000));
  let zc = 0;
  let count = 0;
  for (let i = 1; i < n; i += step) {
    if ((data[i - 1] <= 0 && data[i] > 0) || (data[i - 1] > 0 && data[i] <= 0)) zc += 1;
    count += 1;
  }
  const rate = zc / Math.max(1, count);
  return Math.max(0, Math.min(1, rate * 1.8));
}

function estimateBpm(buffer: AudioBuffer): number | null {
  if (buffer.duration < 1) return null;
  const win = Math.floor(buffer.sampleRate * 0.0116); // ~86 Hz envelope
  const env = rmsWindows(buffer, Math.max(32, win));
  if (env.length < 64) return null;
  // Onset strength: positive difference of the envelope.
  const onset = new Float32Array(env.length);
  for (let i = 1; i < env.length; i += 1) onset[i] = Math.max(0, env[i] - env[i - 1]);
  const envRate = buffer.sampleRate / Math.max(32, win);
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.floor(envRate * 60 / 190); lag <= Math.floor(envRate * 60 / 60); lag += 1) {
    let corr = 0;
    for (let i = lag; i < onset.length; i += 1) corr += onset[i] * onset[i - lag];
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }
  if (!bestLag) return null;
  let bpm = (60 * envRate) / bestLag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 190) bpm /= 2;
  return Math.round(bpm);
}

export function analyzeSample(buffer: AudioBuffer): SampleTags {
  const data = buffer.getChannelData(0);
  let peak = 0;
  let sumSq = 0;
  let lowEnergy = 0;
  const stride = Math.max(1, Math.floor(data.length / 50000));
  for (let i = 0; i < data.length; i += stride) {
    const v = Math.abs(data[i]);
    peak = Math.max(peak, v);
    sumSq += v * v;
    if (i > 0) lowEnergy += Math.abs(data[i] - data[i - 1]);
  }
  const rms = Math.sqrt(sumSq / Math.max(1, Math.ceil(data.length / stride)));
  const bright = brightness(buffer);
  const bpm = estimateBpm(buffer);
  const dur = buffer.duration;
  const transient = lowEnergy / Math.max(1, data.length / stride);

  let type = 'one-shot';
  if (dur < 0.35 && bright < 0.45) type = 'kick';
  else if (dur < 0.45 && bright > 0.45) type = 'snare/clap';
  else if (dur < 0.25 && bright > 0.6) type = 'hi-hat';
  else if (dur > 1.2 && bright < 0.3) type = 'bass loop';
  else if (dur > 1.2) type = 'loop';
  else if (bright > 0.55) type = 'percussion';

  const tags: string[] = [type];
  if (bright < 0.3) tags.push('dark');
  else if (bright > 0.62) tags.push('bright');
  if (transient > 0.055) tags.push('punchy');
  if (rms > 0.28) tags.push('loud');
  if (peak < 0.2) tags.push('quiet');
  if (bpm) tags.push(`${bpm} bpm`);
  return { bpm, brightness: bright, duration: dur, type, tags };
}
