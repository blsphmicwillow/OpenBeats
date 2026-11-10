import { useApp } from '../store';
import { openExternal } from '../lib/native';
import { APP_VERSION } from '../lib/version';
import { IconDownload } from '../ui/icons';

/** Dismissible strip shown when GitHub Releases has a newer build. */
export function UpdateBanner() {
  const update = useApp((s) => s.ui.update);
  const dismissed = useApp((s) => s.settings.dismissedUpdate);
  const { patchSettings, setUI } = useApp.getState();

  if (!update || dismissed === update.version) return null;

  return (
    <div className="update-banner" role="status">
      <span className="ub-dot" />
      <strong>OpenBeats {update.version} is available</strong>
      <span className="ub-note">you are on {APP_VERSION}</span>
      <div className="spacer" />
      <button className="btn ghost small" onClick={() => setUI({ tab: 'changelog' })}>
        What's new
      </button>
      <button className="btn primary small" onClick={() => void openExternal(update.url)}>
        <IconDownload size={11} /> Update
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
