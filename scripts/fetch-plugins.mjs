#!/usr/bin/env node
/* Resolve the registry's GitHub Releases into plugins/registry.lock.json.
 *
 * Run with GITHUB_TOKEN to avoid the 60 requests/hour anonymous limit:
 *   GITHUB_TOKEN=... npm run plugins:fetch
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(await readFile(join(root, 'plugins', 'registry.json'), 'utf8'));
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenBeats-plugin-registry' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const entries = [];
const failures = [];

for (const plugin of registry.plugins) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(plugin.repo)) {
    failures.push(`${plugin.id}: invalid repo`);
    continue;
  }
  const endpoint = plugin.releaseTag
    ? `https://api.github.com/repos/${plugin.repo}/releases/tags/${encodeURIComponent(plugin.releaseTag)}`
    : `https://api.github.com/repos/${plugin.repo}/releases/latest`;
  try {
    const response = await fetch(endpoint, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json();
    let pattern = null;
    if (plugin.assetPattern) pattern = new RegExp(plugin.assetPattern);
    const assets = (release.assets ?? [])
      .filter((asset) => !pattern || pattern.test(asset.name))
      .map((asset) => ({
        name: asset.name,
        size: asset.size,
        downloadUrl: asset.browser_download_url,
      }));
    entries.push({
      id: plugin.id,
      repo: plugin.repo,
      tag: release.tag_name,
      name: release.name,
      url: release.html_url,
      publishedAt: release.published_at,
      draft: release.draft,
      prerelease: release.prerelease,
      assets,
    });
    console.log(`${plugin.id}: ${release.tag_name} (${assets.length} asset(s))`);
  } catch (error) {
    failures.push(`${plugin.id}: ${error.message}`);
  }
}

if (failures.length) {
  console.error('Plugin release fetch failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const lock = {
  schemaVersion: 1,
  fetchedAt: new Date().toISOString(),
  source: 'plugins/registry.json',
  entries,
};
await writeFile(join(root, 'plugins', 'registry.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
console.log('Wrote plugins/registry.lock.json');
