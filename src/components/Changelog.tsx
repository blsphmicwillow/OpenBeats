import { useApp } from '../store';
import { APP_VERSION, APP_TAGLINE } from '../lib/version';
import { CHANGELOG } from '../lib/changelog';
import { openExternal } from '../lib/native';
import { IconDownload, IconWave } from '../ui/icons';

/**
 * In-app release notes. The list lives in src/lib/changelog.ts and is bundled
 * with the build, so it works offline; the “latest release” card is the only
 * part that needs the network.
 */
export function Changelog() {
  const update = useApp((s) => s.ui.update);
  const checking = useApp((s) => s.ui.updateChecking);
  const repo = useApp((s) => s.settings.updateRepo);
  const { checkUpdates } = useApp.getState();
  const releasesUrl = `https://github.com/${repo}/releases`;

  return (
    <div className="changelog">
      <div className="cl-head">
        <div>
          <div className="cl-eyebrow">Release notes</div>
          <h2>What's new in OpenBeats</h2>
          <p className="cl-sub">
            {APP_TAGLINE} · you are running <b>{APP_VERSION}</b>
          </p>
        </div>
        <div className="cl-actions">
          <button className="btn ghost" onClick={() => void checkUpdates()} disabled={checking}>
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          <button className="btn ghost" onClick={() => void openExternal(releasesUrl)}>
            <IconDownload size={12} /> Releases
          </button>
        </div>
      </div>

      {update && (
        <div className="cl-update">
          <span className="cl-badge">Update available</span>
          <strong>{update.version}</strong>
          <span className="cl-sub">published {update.publishedAt ? new Date(update.publishedAt).toLocaleDateString() : 'recently'}</span>
          <div className="spacer" />
          <button className="btn primary" onClick={() => void openExternal(update.url)}>
            Download {update.version}
          </button>
        </div>
      )}

      <div className="cl-list">
        {CHANGELOG.map((entry, index) => (
          <article className={`cl-entry ${index === 0 ? 'latest' : ''}`} key={entry.version}>
            <div className="cl-entry-head">
              <div className="cl-version">
                <IconWave size={13} />
                {entry.version}
              </div>
              <div className="cl-date">{new Date(entry.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
              {index === 0 && <span className="cl-badge">current</span>}
            </div>
            <h3>{entry.headline}</h3>
            <div className="cl-groups">
              {entry.groups.map((group) => (
                <div className="cl-group" key={group.title}>
                  <div className="cl-group-title">{group.title}</div>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="cl-foot">
        Updates are checked against <code>github.com/{repo}/releases</code> when the app starts. Change the repository in
        Settings → Workflow. The desktop builds use the same release feed, so a pushed tag publishes Linux, Windows and
        macOS installers together.
      </div>
    </div>
  );
}
