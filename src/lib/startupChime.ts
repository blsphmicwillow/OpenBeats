/**
 * A short, warm three-note startup chime. Web Audio is used so the sound ships
 * without an audio asset and has no codec/decoder dependency.
 *
 * Browsers and WebKitGTK may suspend an AudioContext created without a user
 * gesture. In that case the chime waits for the first pointer or key event and
 * plays once then, instead of silently failing.
 */
let attempted = false;
let playOnGesture = false;

type AudioContextCtor = typeof AudioContext;

function scheduleChime(ctx: AudioContext): void {
  const start = ctx.currentTime + 0.035;
  const bus = ctx.createGain();
  bus.gain.value = 0.9;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 22;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.28;

  const dry = ctx.createGain();
  dry.gain.value = 0.92;

  // A tiny algorithmic room keeps the ringtone soft rather than dry and beepy.
  const convolver = ctx.createConvolver();
  const length = Math.floor(ctx.sampleRate * 1.05);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
  }
  convolver.buffer = impulse;
  const wet = ctx.createGain();
  wet.gain.value = 0.16;

  bus.connect(dry);
  dry.connect(compressor);
  bus.connect(convolver);
  convolver.connect(wet);
  wet.connect(compressor);
  compressor.connect(ctx.destination);

  const voices = [
    { frequency: 329.63, delay: 0, duration: 0.62, gain: 0.025, type: 'sine' as OscillatorType },
    { frequency: 659.25, delay: 0, duration: 0.86, gain: 0.085, type: 'sine' as OscillatorType },
    { frequency: 987.77, delay: 0.085, duration: 0.82, gain: 0.062, type: 'sine' as OscillatorType },
    { frequency: 1318.51, delay: 0.17, duration: 0.95, gain: 0.042, type: 'triangle' as OscillatorType },
    { frequency: 1975.53, delay: 0.24, duration: 0.58, gain: 0.018, type: 'sine' as OscillatorType },
  ];

  for (const voice of voices) {
    const at = start + voice.delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = voice.type;
    oscillator.frequency.setValueAtTime(voice.frequency, at);
    oscillator.detune.setValueAtTime(voice.type === 'sine' ? 2 : -2, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(voice.gain, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + voice.duration);
    oscillator.connect(gain);
    gain.connect(bus);
    oscillator.start(at);
    oscillator.stop(at + voice.duration + 0.05);
  }

  window.setTimeout(() => {
    void ctx.close().catch(() => undefined);
  }, 3200);
}

function detachGestureUnlock(onGesture: () => void): void {
  window.removeEventListener('pointerdown', onGesture, true);
  window.removeEventListener('keydown', onGesture, true);
}

function waitForGesture(ctx: AudioContext): void {
  if (playOnGesture) return;
  playOnGesture = true;

  const expire = window.setTimeout(() => detachGestureUnlock(onGesture), 8000);
  const onGesture = () => {
    window.clearTimeout(expire);
    detachGestureUnlock(onGesture);
    void ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running') scheduleChime(ctx);
      })
      .catch(() => undefined);
  };

  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
}

/** Best-effort startup ding. Safe to call more than once; only plays once. */
export function playStartupChime(): void {
  if (attempted) return;
  attempted = true;

  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return;

  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return;
  }

  void ctx
    .resume()
    .then(() => {
      if (ctx.state === 'running') scheduleChime(ctx);
      else waitForGesture(ctx);
    })
    .catch(() => waitForGesture(ctx));
}
