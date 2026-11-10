import bundledRegistry from '../../plugins/registry.json';

export type PluginFormat = 'vst3' | 'clap' | 'au';
export type RegistrySource = 'remote' | 'bundled';

export interface RegistryPlugin {
  id: string;
  name: string;
  author: string;
  description: string;
  homepage: string;
  repo: string;
  releaseTag?: string;
  assetPattern?: string;
  formats: PluginFormat[];
  platforms: string[];
  license: string;
  verified: boolean;
  featured?: boolean;
  notes?: string;
}

export interface RegistryDocument {
  schemaVersion: number;
  updatedAt: string;
  plugins: RegistryPlugin[];
}

export interface PluginAsset {
  name: string;
  size: number;
  downloadUrl: string;
}

export interface PluginRelease {
  tag: string;
  version: string;
  name: string;
  url: string;
  publishedAt: string;
  assets: PluginAsset[];
}

export interface PluginEntry extends RegistryPlugin {
  release: PluginRelease | null;
  error?: string;
}

export interface PluginCatalog {
  entries: PluginEntry[];
  source: RegistrySource;
  updatedAt: string;
  warning?: string;
}

const REGISTRY_URL =
  'https://raw.githubusercontent.com/blsphmicwillow/OpenBeats/main/plugins/registry.json';
const RELEASE_CACHE_KEY = 'openbeats.plugins.releases.v1';
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

type ReleaseCache = Record<string, { fetchedAt: number; release: PluginRelease | null }>;

function signalForTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function readCache(): ReleaseCache {
  try {
    const raw = localStorage.getItem(RELEASE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ReleaseCache) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: ReleaseCache): void {
  try {
    localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage is optional */
  }
}

function isRegistryPlugin(value: unknown): value is RegistryPlugin {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<RegistryPlugin>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.author === 'string' &&
    typeof p.description === 'string' &&
    typeof p.homepage === 'string' &&
    typeof p.repo === 'string' &&
    typeof p.license === 'string' &&
    typeof p.verified === 'boolean' &&
    Array.isArray(p.formats) &&
    p.formats.every((f) => f === 'vst3' || f === 'clap' || f === 'au') &&
    Array.isArray(p.platforms) &&
    p.platforms.every((x) => typeof x === 'string')
  );
}

function parseRegistry(value: unknown): RegistryDocument {
  if (!value || typeof value !== 'object') throw new Error('Registry is not an object');
  const doc = value as Partial<RegistryDocument>;
  if (doc.schemaVersion !== 1) throw new Error('Unsupported registry schema');
  if (typeof doc.updatedAt !== 'string' || !Array.isArray(doc.plugins)) {
    throw new Error('Registry is missing updatedAt/plugins');
  }
  const plugins = doc.plugins.filter(isRegistryPlugin);
  if (!plugins.length) throw new Error('Registry has no valid plugins');
  return { schemaVersion: 1, updatedAt: doc.updatedAt, plugins };
}

export function bundledRegistryDocument(): RegistryDocument {
  return parseRegistry(bundledRegistry);
}

/** Fetch the live registry; fall back to the copy bundled with this build on any failure. */
export async function loadRegistry(): Promise<{
  registry: RegistryDocument;
  source: RegistrySource;
  warning?: string;
}> {
  try {
    const response = await fetch(REGISTRY_URL, {
      headers: { Accept: 'application/json' },
      signal: signalForTimeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Registry HTTP ${response.status}`);
    return { registry: parseRegistry(await response.json()), source: 'remote' };
  } catch (error) {
    return {
      registry: bundledRegistryDocument(),
      source: 'bundled',
      warning: error instanceof Error ? error.message : 'Registry unavailable',
    };
  }
}

function releaseVersion(tag: string): string {
  return tag
    .replace(/^v/i, '')
    .replace(/^openbeats-gain-v/i, '');
}

function timeoutError(): Error {
  return new Error('GitHub request timed out');
}

async function fetchRelease(plugin: RegistryPlugin, force: boolean): Promise<PluginRelease | null> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(plugin.repo)) throw new Error('Invalid GitHub repository');
  const cache = readCache();
  const cacheKey = `${plugin.repo}@${plugin.releaseTag ?? 'latest'}`;
  const cached = cache[cacheKey];
  // Never treat a cached miss as a successful empty release: releases are
  // published after the registry entry, and a miss should be retried.
  if (!force && cached?.release && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.release;
  }

  const endpoint = plugin.releaseTag
    ? `https://api.github.com/repos/${plugin.repo}/releases/tags/${encodeURIComponent(plugin.releaseTag)}`
    : `https://api.github.com/repos/${plugin.repo}/releases/latest`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: signalForTimeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw timeoutError();
  }

  if (response.status === 404) {
    throw new Error(plugin.releaseTag ? `Release ${plugin.releaseTag} is not published yet` : 'No public release yet');
  }
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? 'GitHub rate limit reached — try again later'
        : `GitHub returned HTTP ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    tag_name?: string;
    name?: string;
    html_url?: string;
    published_at?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: { name?: string; size?: number; browser_download_url?: string }[];
  };
  if (data.draft || data.prerelease) throw new Error('That release is a draft or prerelease');
  const tag = data.tag_name?.trim();
  if (!tag) throw new Error('Release has no tag');

  let pattern: RegExp | null = null;
  if (plugin.assetPattern) {
    try {
      pattern = new RegExp(plugin.assetPattern);
    } catch {
      pattern = null;
    }
  }
  const assets = (data.assets ?? [])
    .filter(
      (a): a is { name: string; size: number; browser_download_url: string } =>
        typeof a.name === 'string' &&
        typeof a.size === 'number' &&
        typeof a.browser_download_url === 'string' &&
        (!pattern || pattern.test(a.name)),
    )
    .map((a) => ({ name: a.name, size: a.size, downloadUrl: a.browser_download_url }));

  const release: PluginRelease = {
    tag,
    version: releaseVersion(tag),
    name: data.name ?? tag,
    url: data.html_url ?? `https://github.com/${plugin.repo}/releases/tag/${tag}`,
    publishedAt: data.published_at ?? '',
    assets,
  };
  cache[cacheKey] = { fetchedAt: Date.now(), release };
  writeCache(cache);
  return release;
}

let cachedCatalog: PluginCatalog | null = null;

/**
 * Load the registry and resolve every plugin's GitHub Release. A failed GitHub
 * request is isolated to that plugin so one dead project does not hide the rest.
 */
export async function loadPluginCatalog(force = false): Promise<PluginCatalog> {
  if (cachedCatalog && !force) return cachedCatalog;
  const { registry, source, warning } = await loadRegistry();
  const entries = await Promise.all(
    registry.plugins.map(async (plugin): Promise<PluginEntry> => {
      try {
        return { ...plugin, release: await fetchRelease(plugin, force) };
      } catch (error) {
        return {
          ...plugin,
          release: null,
          error: error instanceof Error ? error.message : 'Release lookup failed',
        };
      }
    }),
  );
  cachedCatalog = { entries, source, updatedAt: registry.updatedAt, warning };
  return cachedCatalog;
}

export function recommendedAsset(entry: PluginEntry): PluginAsset | null {
  if (!entry.release?.assets.length) return null;
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  const isLinux = platform.includes('linux');
  const isMac = platform.includes('mac');
  const isWindows = platform.includes('win');
  return (
    entry.release.assets.find((asset) => {
      const name = asset.name.toLowerCase();
      if (isWindows) return name.includes('win');
      if (isMac) return name.includes('mac') || name.includes('darwin');
      if (isLinux) return name.includes('linux') || (!name.includes('win') && !name.includes('mac'));
      return false;
    }) ??
    entry.release.assets[0] ??
    null
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pluginPlatformLabel(platforms: string[]): string {
  return platforms
    .map((p) => {
      if (p.startsWith('linux')) return 'Linux';
      if (p.startsWith('mac')) return 'macOS';
      if (p.startsWith('win')) return 'Windows';
      return p;
    })
    .join(' · ');
}
