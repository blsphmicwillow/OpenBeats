import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { isNative, nativePlatform } from '../lib/native';
import { audioBridgeStatus } from '../lib/nativeAudio';

const DISMISSED_KEY = 'openbeats:bridge-banner-dismissed';

/**
 * One-time strip for the silent Linux failure mode: PipeWire/PulseAudio is
 * running and every device looks fine, but ALSA has no `pulse`/`pipewire` PCM,
 * so the native engine opens something that cannot make sound.
 *
 * It only asks the backend once, only on Linux, and stays dismissed for good.
 */
export function BridgeBanner() {
  const [missing, setMissing] = useState(false);
  const { setUI } = useApp.getState();

  useEffect(() => {
    if (!isNative()) return;
    if (window.localStorage.getItem(DISMISSED_KEY)) return;
    let cancelled = false;
    void (async () => {
      const platform = await nativePlatform();
      if (platform !== 'linux') return;
      const status = await audioBridgeStatus();
      if (!cancelled && status === 'missing-bridge') setMissing(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!missing) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISSED_KEY, '1');
    setMissing(false);
  };

  return (
    <div className="update-banner bridge-banner" role="status">
      <span className="ub-dot" />
      <strong>Audio cannot reach PipeWire</strong>
      <span className="ub-note">
        the sound server is running, but ALSA has no pulse/pipewire device — install
        pipewire-alsa (or libasound2-plugins)
      </span>
      <div className="spacer" />
      <button className="btn ghost small" onClick={() => setUI({ settingsOpen: true })}>
        Audio settings
      </button>
      <button className="btn primary small" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
