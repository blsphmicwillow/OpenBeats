import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../lib/version';
import { IconLogo } from '../ui/icons';

/** Short branded startup screen. It is decorative and never blocks input. */
export function SplashScreen({ leaving }: { leaving: boolean }) {
  return (
    <div
      className={`splash-screen ${leaving ? 'leaving' : ''}`}
      role="status"
      aria-label={`${APP_NAME} ${APP_VERSION} is opening`}
    >
      <div className="splash-glow" aria-hidden="true" />
      <div className="splash-inner">
        <div className="splash-mark">
          <IconLogo size={40} />
        </div>
        <h1 className="splash-title">
          Open<span>Beats</span>
        </h1>
        <p className="splash-tagline">{APP_TAGLINE}</p>
        <div className="splash-eq" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${i * 85}ms` }} />
          ))}
        </div>
        <div className="splash-foot">
          <span>v{APP_VERSION}</span>
          <span>GPL-3.0 · local-first</span>
        </div>
      </div>
    </div>
  );
}
