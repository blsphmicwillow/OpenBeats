/**
 * Local mix analysis. No model, no network: an FFT pass over the rendered
 * master, band energy comparison and transient statistics. The UI presents the
 * result as concrete, reversible corrections rather than a black box.
 */

const BANDS = [
  { key: 'sub', label: 'Sub', lo: 20, hi: 60 },
  { key: 'bass', label: 'Bass', lo: 60, hi: 140 },
  { key: 'lowmid', label: 'Low-mid', lo: 140, hi: 400 },
  { key: 'mid', label: 'Mid', lo: 400, hi: 1500 },
  { key: 'highmid', label: 'High-mid', lo: 1500, hi: 5000 },
  { key: 'high', label: 'High', lo: 5000, hi: 10000 },
  { key: 'air', label: 'Air', lo: 10000, hi: 20000 },
] as const;

export type BandKey = (typeof BANDS)[number]['key'];

export interface MixFinding {
  id: string;
  severity: 'info' | 'warn' | 'fix';
  title: string;
  detail: string;
  /** Ten graphic-EQ gains in dB, matching the eq10 effect's 31 Hz … 16 kHz bands. */
  eq?: number[];
  /** Master limiter ceiling in dB. */
  ceiling?: number;
  /** Glue compressor threshold in dB. */
  threshold?: number;
}

export interface MixReport {
  peakDb: number;
  rmsDb: number;
  loudness: number;
  crest: number;
  stereo: number;
  clipPercent: number;
  bands: Record<BandKey, number>;
  eq: number[];
  findings: MixFinding[];
  suggestion: string;
}

/** Cooley-Tukey radix-2 FFT, in place. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function db(v: number): number {
  return 20 * Math.log10(Math.max(1e-9, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function analyzeBuffer(buffer: AudioBuffer): MixReport {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const n = left.length;

  let peak = 0;
  let sumSq = 0;
  let clipped = 0;
  let lr = 0;
  let ll = 0;
  let rr = 0;
  // Skip the silent head/tail so intros do not skew the numbers.
  const stride = Math.max(1, Math.floor(n / 400000));
  for (let i = 0; i < n; i += stride) {
    const l = left[i];
    const r = right[i];
    const m = Math.max(Math.abs(l), Math.abs(r));
    if (m > peak) peak = m;
    if (m > 0.999) clipped += 1;
    sumSq += (l * l + r * r) / 2;
    lr += l * r;
    ll += l * l;
    rr += r * r;
  }
  const count = Math.ceil(n / stride);
  const rms = Math.sqrt(sumSq / Math.max(1, count));
  const peakDb = db(peak);
  const rmsDb = db(rms);
  const loudness = Math.max(-60, rmsDb - 0.7);
  const crest = peakDb - rmsDb;
  const stereo = ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;

  // Average spectrum over up to 48 evenly spaced windows.
  const size = 2048;
  const frames = Math.min(48, Math.max(1, Math.floor(n / size)));
  const energy = new Float64Array(size / 2);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const binHz = buffer.sampleRate / size;
  for (let f = 0; f < frames; f += 1) {
    const start = Math.floor((f / frames) * (n - size));
    for (let i = 0; i < size; i += 1) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      re[i] = ((left[start + i] ?? 0) + (right[start + i] ?? 0)) * 0.5 * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 1; b < size / 2; b += 1) {
      energy[b] += Math.hypot(re[b], im[b]);
    }
  }

  // Share of total energy per band, in dB (always ≤ 0). This is a stable
  // balance measure that does not explode with magnitude.
  const bandEnergy = {} as Record<BandKey, number>;
  const bandDb = {} as Record<BandKey, number>;
  let totalEnergy = 0;
  for (const band of BANDS) {
    let sum = 0;
    for (let b = 1; b < size / 2; b += 1) {
      const hz = b * binHz;
      if (hz >= band.lo && hz < band.hi) sum += energy[b];
    }
    bandEnergy[band.key] = sum;
    totalEnergy += sum;
  }
  for (const band of BANDS) {
    bandDb[band.key] = 10 * Math.log10((bandEnergy[band.key] + 1e-12) / (totalEnergy + 1e-12));
  }

  // Corrective curve on the 10 graphic-EQ bands (31 … 16k). Targets are
  // typical energy shares for a balanced mix; a band above target is cut,
  // never boosted in the same direction as the problem.
  const bandTargets: Record<BandKey, number> = {
    sub: -14,
    bass: -13,
    lowmid: -9.5,
    mid: -6.5,
    highmid: -9,
    high: -13,
    air: -18,
  };
  const centers = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  let eq = centers.map((hz) => {
    const band = BANDS.find((b) => hz >= b.lo && hz < b.hi) ?? BANDS[BANDS.length - 1];
    const delta = bandDb[band.key] - bandTargets[band.key];
    // A ±2 dB deadband keeps a healthy mix at 0 dB instead of chasing noise.
    const shaped = Math.abs(delta) < 2 ? 0 : delta;
    return Math.round(clamp(-shaped * 0.45, -6, 6) * 10) / 10;
  });

  const findings: MixFinding[] = [];
  if (peakDb > -0.2) {
    findings.push({
      id: 'clip',
      severity: 'fix',
      title: 'The master is clipping',
      detail: `Peak is ${peakDb.toFixed(1)} dBFS with ${clipped} samples over full scale. I would pull the master back 1.5 dB and set the limiter ceiling to −1 dB.`,
      ceiling: -1,
    });
  }
  if (crest < 8 && rmsDb > -12) {
    findings.push({
      id: 'squash',
      severity: 'warn',
      title: 'The mix is over-compressed',
      detail: `Crest factor is ${crest.toFixed(1)} dB, which is dense even for club music. Try easing the bus compressor threshold by 3 dB before adding more limiting.`,
      threshold: -18,
    });
  }
  const ratioDb = (a: number, b: number) => 10 * Math.log10((a + 1e-12) / (b + 1e-12));
  const lowRatio = ratioDb(bandEnergy.sub + bandEnergy.bass, bandEnergy.mid + bandEnergy.highmid);
  const highRatio = ratioDb(bandEnergy.highmid + bandEnergy.high, bandEnergy.lowmid + bandEnergy.mid);
  if (lowRatio > 5) {
    findings.push({
      id: 'lowend',
      severity: 'fix',
      title: 'Kick and bass are fighting in the low end',
      detail: `Low end is ${lowRatio.toFixed(1)} dB above the midrange. I would trim 60–120 Hz and give the kick a short sidechain dip on the bass bus.`,
      eq,
    });
  }
  if (highRatio > 2) {
    findings.push({
      id: 'harsh',
      severity: 'fix',
      title: 'The highs are harsh',
      detail: `High-mid and top are ${highRatio.toFixed(1)} dB above the body of the mix. A cut over 1.5–5 kHz smooths it without dulling the air band.`,
      eq,
    });
  }
  if (Math.abs(stereo) < 0.15 && rmsDb > -30) {
    findings.push({
      id: 'mono',
      severity: 'warn',
      title: 'The mix is nearly mono',
      detail: 'Left and right are almost identical. Wider pads or a short stereo delay on the lead opens the image without touching the low end.',
    });
  }
  if (rmsDb < -20) {
    findings.push({
      id: 'quiet',
      severity: 'warn',
      title: 'The master is quiet',
      detail: `Integrated level is about ${loudness.toFixed(0)} LUFS. A mastering target will bring it up without crushing transients.`,
    });
  }
  if (!findings.length) {
    // Nothing to correct, so the proposed curve is flat too — never offer
    // cuts while claiming the mix is balanced.
    eq = eq.map(() => 0);
    findings.push({
      id: 'clean',
      severity: 'info',
      title: 'Nothing is fighting for space',
      detail: 'Balance, crest factor and stereo width all look healthy. No corrective EQ is needed; a 0.5 dB high shelf is optional for air.',
      eq,
    });
  }

  const weighted = eq.reduce((a, b) => a + Math.abs(b), 0);
  const suggestion =
    weighted < 1
      ? 'The mix is balanced — no corrective EQ needed.'
      : `I would apply a ${eq
          .map((g, i) => (Math.abs(g) >= 0.5 ? `${g > 0 ? '+' : ''}${g.toFixed(1)} dB at ${centers[i]} Hz` : null))
          .filter(Boolean)
          .slice(0, 4)
          .join(', ')}.`;

  return { peakDb, rmsDb, loudness, crest, stereo, clipPercent: (clipped / count) * 100, bands: bandDb, eq, findings, suggestion };
}
