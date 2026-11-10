import { useState } from 'react';
import { useApp } from '../store';
import { isNative, openExternal } from '../lib/native';
import { nativePerformUpdate } from '../lib/nativeAudio';
import { APP_VERSION } from '../lib/version';
import { IconDownload } from '../ui/icons';

/** Dismissible strip shown when GitHub Releases has a newer build. */
export function UpdateBanner() {
  const update = useApp((s) => s.ui.update);
  const dismissed = useApp((s) => s.settings.dismissedUpdate);
  const { patchSettings, setUI, toast } = useApp.getState();
  const [installing, setInstalling] = useState(false);

  if (!update || dismissed === update.version) return null;

  const install = async () => {
    if (installing) return;
    // Without a native installer (web demo, missing asset) the release page is
    // still the correct destination.
    if (!isNative() || !update.downloadUrl) {
      void openExternal(update.url);
      return;
    }
    setInstalling(true);
    const message = await nativePerformUpdate(update.downloadUrl);
    if (message) {
      toast(message);
    } else {
      setInstalling(false);
      toast('The update could not be installed — opening the release page');
      void openExternal(update.url);
    }
  };

  return (
    <div className="update-banner" role="status">
      <span className="ub-dot" />
      <strong>OpenBeats {update.version} is available</strong>
      <span className="ub-note">you are on {APP_VERSION}</span>
      <div className="spacer" />
      <button className="btn ghost small" onClick={() => setUI({ tab: 'changelog' })}>
        What's new
      </button>
      <button className="btn primary small" onClick={() => void install()} disabled={installing}>
        <IconDownload size={11} /> {installing ? 'Downloading…' : 'Update'}
      </button>
      <button
        className="tbtn flat"
        title="Dismiss until the next version"
        onClick={() => patchSettings({ dismissedUpdate: update.version })}
      >
        ×
      </button>
    </div>
  );
}
