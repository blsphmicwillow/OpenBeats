import { DEFAULT_UPDATE_REPO } from './version';

export interface UpdateInfo {
  version: string;
  notes: string;
  url: string;
  publishedAt?: string;
  repo: string;
}

/** Numeric semver comparison; ignores a leading "v". Returns >0 when a is newer. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function timeout(ms: number): AbortSignal {
  const ctrl = new AbortController();
  window.setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/**
 * Checks GitHub Releases for a build newer than `current`.
 * Returns null when offline, rate-limited, on a missing repo, or already current —
 * an update checker should never block or nag.
 */
export async function checkForUpdate(
  current: string,
  repo: string = DEFAULT_UPDATE_REPO,
): Promise<UpdateInfo | null> {
  const clean = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(clean)) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${clean}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      html_url?: string;
      published_at?: string;
      draft?: boolean;
      prerelease?: boolean;
    };
    if (data.draft || data.prerelease) return null;
    const version = (data.tag_name ?? data.name ?? '').replace(/^v/i, '').trim();
    if (!version || compareVersions(version, current) <= 0) return null;
    return {
      version,
      notes: (data.body ?? '').slice(0, 4000),
      url: data.html_url ?? `https://github.com/${clean}/releases`,
      publishedAt: data.published_at,
      repo: clean,
    };
  } catch {
    return null;
  }
}
