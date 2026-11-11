#!/usr/bin/env node
/**
 * Keep the public repository page honest:
 * - package.json, APP_VERSION, README, INSTALL and CHANGELOG agree on the version
 * - release tag/download URLs in the docs point at that version
 * - relative links and images in README and INSTALL resolve
 *
 * Run with `npm run docs:check`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function read(relative) {
  return readFileSync(resolve(root, relative), 'utf8');
}

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
const appVersion = read('src/lib/version.ts').match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  errors.push(`package.json has no valid version (got ${JSON.stringify(version)})`);
}
if (appVersion !== version) {
  errors.push(`src/lib/version.ts APP_VERSION is ${appVersion}, but package.json is ${version}`);
}

const changelog = read('CHANGELOG.md');
if (!changelog.includes(`## ${version}`)) {
  errors.push(`CHANGELOG.md has no "## ${version}" section`);
}

const docs = ['README.md', 'docs/INSTALL.md'];
for (const file of docs) {
  const text = read(file);

  for (const match of text.matchAll(/releases\/(?:tag|download)\/v(\d+\.\d+\.\d+)/g)) {
    if (match[1] !== version) {
      errors.push(`${file} links to release v${match[1]}, expected v${version}`);
    }
  }
  for (const match of text.matchAll(/OpenBeats[_-](\d+\.\d+\.\d+)/g)) {
    if (match[1] !== version) {
      errors.push(`${file} names an OpenBeats ${match[1]} asset, expected ${version}`);
    }
  }

  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    const path = target.split('#')[0].replace(/^<|>$/g, '');
    if (!path) continue;
    const decoded = decodeURI(path);
    const absolute = resolve(root, dirname(file), decoded);
    if (!existsSync(absolute)) {
      errors.push(`${file} links to missing path: ${target}`);
    }
  }
}

if (!read('README.md').includes(`Install OpenBeats ${version}`)) {
  errors.push(`README.md has no "Install OpenBeats ${version}" heading`);
}
if (!read('docs/INSTALL.md').includes(`Installing OpenBeats ${version}`)) {
  errors.push(`docs/INSTALL.md has no "Installing OpenBeats ${version}" heading`);
}

if (errors.length > 0) {
  console.error(`docs:check failed (${errors.length}):`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log(`docs:check passed — version ${version}, ${docs.length} files, relative links resolve.`);
