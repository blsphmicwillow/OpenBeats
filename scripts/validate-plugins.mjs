#!/usr/bin/env node
/* Validate plugins/registry.json without dependencies. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(root, 'plugins', 'registry.json');
const allowedFormats = new Set(['vst3', 'clap', 'au']);
const repoPattern = /^[\w.-]+\/[\w.-]+$/;
const errors = [];

let doc;
try {
  doc = JSON.parse(await readFile(registryPath, 'utf8'));
} catch (error) {
  console.error(`Cannot read registry: ${error.message}`);
  process.exit(1);
}

if (doc.schemaVersion !== 1) errors.push('schemaVersion must be 1');
if (typeof doc.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.updatedAt)) {
  errors.push('updatedAt must be YYYY-MM-DD');
}
if (!Array.isArray(doc.plugins) || doc.plugins.length === 0) {
  errors.push('plugins must be a non-empty array');
}

const ids = new Set();
for (const [index, plugin] of (doc.plugins ?? []).entries()) {
  const label = `plugins[${index}]`;
  for (const field of ['id', 'name', 'author', 'description', 'homepage', 'repo', 'license']) {
    if (typeof plugin[field] !== 'string' || !plugin[field].trim()) {
      errors.push(`${label}.${field} must be a non-empty string`);
    }
  }
  if (typeof plugin.id === 'string') {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.id)) errors.push(`${label}.id must be kebab-case`);
    if (ids.has(plugin.id)) errors.push(`${label}.id is duplicated`);
    ids.add(plugin.id);
  }
  if (typeof plugin.repo === 'string' && !repoPattern.test(plugin.repo)) {
    errors.push(`${label}.repo must be owner/name`);
  }
  if (typeof plugin.homepage === 'string' && !/^https:\/\//.test(plugin.homepage)) {
    errors.push(`${label}.homepage must use https`);
  }
  if (typeof plugin.releaseTag === 'string' && !/^[\w./-]+$/.test(plugin.releaseTag)) {
    errors.push(`${label}.releaseTag contains unsupported characters`);
  }
  if (plugin.assetPattern !== undefined) {
    try {
      new RegExp(plugin.assetPattern);
    } catch {
      errors.push(`${label}.assetPattern is not a valid regular expression`);
    }
  }
  if (!Array.isArray(plugin.formats) || !plugin.formats.length) {
    errors.push(`${label}.formats must be a non-empty array`);
  } else {
    for (const format of plugin.formats) {
      if (!allowedFormats.has(format)) errors.push(`${label}.formats contains unsupported format ${format}`);
    }
  }
  if (!Array.isArray(plugin.platforms) || !plugin.platforms.length) {
    errors.push(`${label}.platforms must be a non-empty array`);
  }
  if (typeof plugin.verified !== 'boolean') errors.push(`${label}.verified must be boolean`);
}

if (errors.length) {
  console.error(`Plugin registry check failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Plugin registry OK — ${doc.plugins.length} plugin(s), ${ids.size} unique id(s).`);
