import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { de } from './locales/de';
import { es } from './locales/es';
import { fr } from './locales/fr';

const ROOT = join(process.cwd(), 'src');
const LOCALES = { de, es, fr };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

/** Every English key passed to `t()` in the UI, wherever it is written. */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  const pattern = /\bt\(\s*(?:'([^'\\\n]+)'|"([^"\\\n]+)")/g;
  for (const file of walk(ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) keys.add(match[1] ?? match[2]);
  }
  return keys;
}

describe('locale coverage', () => {
  const keys = usedKeys();

  it('finds a useful number of hooked strings', () => {
    expect(keys.size).toBeGreaterThan(200);
  });

  for (const [name, dictionary] of Object.entries(LOCALES)) {
    it(`translates every hooked string in ${name}`, () => {
      const missing = [...keys].filter((key) => !(key in dictionary)).sort();
      expect(missing).toEqual([]);
    });
  }
});
