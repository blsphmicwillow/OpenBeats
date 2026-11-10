/**
 * Hum-to-Melody. Captures the microphone, tracks pitch with autocorrelation,
 * then quantises the contour into piano-roll notes. Entirely on-device.
 */

export interface HumFrame {
  time: number;
  hz: number;
  clarity: number;
  level: number;
}

export interface HumResult {
  frames: HumFrame[];
  averageHz: number;
  seconds: number;
}

function autoCorrelate(buf: Float32Array, sampleRate: number): { hz: number; clarity: number } {
  let rms = 0;
  for (let i = 0; i < buf.length; i += 1) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.008) return { hz: 0, clarity: 0 };

  // Trim near-silent edges.
  let start = 0;
  let end = buf.length - 1;
  const threshold = 0.2 * rms;
  while (start < end && Math.abs(buf[start]) < threshold) start += 1;
  while (end > start && Math.abs(buf[end]) < threshold) end -= 1;
  const slice = buf.subarray(start, end);
  if (slice.length < 128) return { hz: 0, clarity: 0 };

  const maxLag = Math.min(slice.length - 1, Math.floor(sampleRate / 65));
  const minLag = Math.max(2, Math.floor(sampleRate / 1000));
  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    for (let i = 0; i < slice.length - lag; i += 1) corr += slice[i] * slice[i + lag];
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return { hz: 0, clarity: 0 };

  // Parabolic interpolation around the peak for sub-sample accuracy.
  const shift = (lag: number) => {
    let corr = 0;
    for (let i = 0; i < slice.length - lag; i += 1) corr += slice[i] * slice[i + lag];
    return corr;
  };
  const y1 = shift(bestLag - 1);
  const y2 = bestCorr;
  const y3 = shift(bestLag + 1);
  const denom = 2 * (2 * y2 - y1 - y3);
  const offset = denom !== 0 ? (y3 - y1) / denom : 0;
  const lag = bestLag + Math.max(-1, Math.min(1, offset));

  let energy = 0;
  for (let i = 0; i < slice.length; i += 1) energy += slice[i] * slice[i];
  const clarity = Math.min(1, bestCorr / Math.max(1e-9, energy));
  return { hz: sampleRate / lag, clarity };
}

export class HumRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buffer = new Float32Array(2048);
  private frames: HumFrame[] = [];
  private raf = 0;
  private started = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.frames = [];
    this.started = performance.now();
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buffer);
      let level = 0;
      for (let i = 0; i < this.buffer.length; i += 1) level += this.buffer[i] * this.buffer[i];
      level = Math.sqrt(level / this.buffer.length);
      const { hz, clarity } = autoCorrelate(this.buffer, this.ctx?.sampleRate ?? 48000);
      this.frames.push({ time: (performance.now() - this.started) / 1000, hz, clarity, level });
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  stop(): HumResult {
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    const voiced = this.frames.filter((f) => f.hz > 0 && f.clarity > 0.55 && f.level > 0.01);
    const averageHz = voiced.length ? voiced.reduce((a, f) => a + f.hz, 0) / voiced.length : 0;
    return {
      frames: this.frames,
      averageHz,
      seconds: this.frames.length ? this.frames[this.frames.length - 1].time : 0,
    };
  }
}

function hzToMidi(hz: number): number {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

/**
 * Turns a pitch contour into notes. Consecutive frames within a semitone are
 * merged, short blips are dropped and starts are quantised to the grid.
 */
export function humToNotes(result: HumResult, bpm: number, snap = 1): { pitch: number; start: number; len: number; vel: number }[] {
  const stepSec = 60 / bpm / 4;
  const notes: { pitch: number; start: number; len: number; vel: number }[] = [];
  const usable = result.frames.filter((f) => f.hz > 60 && f.hz < 1200 && f.clarity > 0.5 && f.level > 0.008);

  let current: { midi: number; from: number; to: number; level: number } | null = null;
  for (const frame of usable) {
    const midi = hzToMidi(frame.hz);
    if (!current || Math.abs(midi - current.midi) > 1 || frame.time - current.to > 0.12) {
      if (current && current.to - current.from >= 0.1) {
        const start = Math.round(current.from / stepSec / snap) * snap;
        const end = Math.round(current.to / stepSec / snap) * snap;
        const len = Math.max(snap, end - start);
        notes.push({
          pitch: Math.max(24, Math.min(108, current.midi)),
          start,
          len,
          vel: Math.max(0.35, Math.min(1, 0.45 + current.level * 3)),
        });
      }
      current = { midi, from: frame.time, to: frame.time, level: frame.level };
    } else {
      current.to = frame.time;
      current.level = Math.max(current.level, frame.level);
    }
  }
  if (current && current.to - current.from >= 0.1) {
    const start = Math.round(current.from / stepSec / snap) * snap;
    const len = Math.max(snap, Math.round(current.to / stepSec / snap) * snap - start);
    notes.push({ pitch: Math.max(24, Math.min(108, current.midi)), start, len, vel: 0.8 });
  }
  return notes;
}
