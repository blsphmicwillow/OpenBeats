#!/usr/bin/env node
/**
 * Theme QA for OpenBeats 1.0.5 — 11 themes × 2 UI modes = 22 combinations.
 *
 * SCOPE, HONESTLY: this repository has no background-image feature. There is no
 * `wallpaper`, `bgImage`, `backgroundImage` or `customBackground` setting, and
 * the only file picker in Settings imports theme JSON. The requested
 * 6-theme × 4-mode × 4-image = 96 row matrix therefore cannot be produced from
 * this codebase without inventing screenshots of a feature that does not exist.
 * This harness measures what actually ships: every built-in theme in both
 * interface modes. The report says so in its own header.
 *
 * CONTRAST METHOD
 * - Foreground colours come from the *computed* CSS variables on the live page
 *   (`--text`, `--dim`, `--accent-text`), read through a probe element so any
 *   colour syntax resolves to rgb().
 * - Background colours are sampled from the rendered screenshot itself (median
 *   of an 11×11 patch at four fixed regions). That matters for the four glass
 *   themes, whose panels are translucent over a gradient: token math alone would
 *   be optimistic, sampling the real pixels is not.
 * - We never sample glyph pixels. Antialiasing, subpixel AA and font smoothing
 *   make text pixels meaningless for WCAG; fg from CSS + bg from pixels is the
 *   defensible pairing.
 * - WCAG 2.x relative luminance; 4.5:1 body text, 3:1 large text / UI accents.
 *
 * USAGE
 *   node scripts/qa-visual.mjs            # starts `npm run dev` if needed
 *   QA_URL=http://127.0.0.1:3000 node scripts/qa-visual.mjs
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const BASE_URL = process.env.QA_URL ?? 'http://127.0.0.1:3000';
const ROOT = process.cwd();
const SHOT_DIR = path.join(ROOT, 'artifacts', 'qa-1.0.5');
const REPORT = path.join(ROOT, 'docs', 'QA_THEMES_1.0.5.md');
const VIEWPORT = { width: 1440, height: 900 };
const MODES = ['classic', 'modern'];
const BODY_MIN = 4.5;
const LARGE_MIN = 3.0;

/** Reads theme ids and names from src/themes.ts so the list cannot drift. */
async function readThemes() {
  const source = await readFile(path.join(ROOT, 'src', 'themes.ts'), 'utf8');
  const found = [...source.matchAll(/\{\s*id:\s*'([a-z0-9-]+)',\s*name:\s*'([^']+)'/g)].map(
    (m) => ({ id: m[1], name: m[2] }),
  );
  if (found.length === 0) throw new Error('Could not parse any themes from src/themes.ts');
  return found;
}

/* ------------------------------------------------------------------ */
/* Colour maths                                                        */
/* ------------------------------------------------------------------ */

function parseRgb(text) {
  const rgb = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = text.trim().replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16));
  }
  throw new Error(`Unsupported colour: ${text}`);
}

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Median colour of a square patch, which resists text pixels and hairlines. */
function patchColor(png, cx, cy, size = 11) {
  const half = Math.floor(size / 2);
  const rs = [];
  const gs = [];
  const bs = [];
  for (let y = cy - half; y <= cy + half; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const i = (png.width * y + x) << 2;
      rs.push(png.data[i]);
      gs.push(png.data[i + 1]);
      bs.push(png.data[i + 2]);
    }
  }
  const median = (list) => list.sort((m, n) => m - n)[Math.floor(list.length / 2)];
  return [median(rs), median(gs), median(bs)];
}

/* ------------------------------------------------------------------ */
/* Dev server                                                          */
/* ------------------------------------------------------------------ */

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable(BASE_URL)) return null;
  const child = spawn('npm', ['run', 'dev'], { cwd: ROOT, stdio: 'ignore' });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await reachable(BASE_URL)) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`Dev server did not become reachable at ${BASE_URL} within 60 s`);
}

/* ------------------------------------------------------------------ */
/* Page inspection                                                     */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = 'openbeats.settings.v1';

function settingsFor(themeId, mode) {
  return {
    themeId,
    uiMode: mode,
    tutorialDone: true,
    startupChime: false,
    autoCheckUpdates: false,
    discordRpc: false,
    // Reduced motion shortens the splash hold from 1600 ms to 650 ms. It does
    // not change any colour token, so contrast measurements are unaffected.
    reduceMotion: true,
    autosaveMinutes: 0,
    updateRepo: 'blsphmicwillow/OpenBeats',
  };
}

const REGIONS = [
  { label: 'workspace', x: 0.5, y: 0.55 },
  { label: 'browser panel', x: 0.13, y: 0.45 },
  { label: 'top bar', x: 0.9, y: 0.05 },
  { label: 'hint bar', x: 0.5, y: 0.965 },
];

async function inspect(page) {
  return page.evaluate(() => {
    // The theme tokens are inline custom properties on `.app` (see
    // themeVars() in App.tsx), NOT on :root. A probe appended to <body> would
    // silently read the stylesheet's default tokens for every theme — which is
    // exactly how a harness reports light text on a light theme. Probe inside
    // the element that actually carries the variables.
    const app = document.querySelector('.app');
    if (!app) throw new Error('No .app element found — cannot read theme tokens');
    const probe = (name) => {
      const el = document.createElement('span');
      el.style.color = `var(${name})`;
      el.textContent = 'probe';
      el.style.position = 'absolute';
      el.style.visibility = 'hidden';
      app.appendChild(el);
      const value = getComputedStyle(el).color;
      el.remove();
      return value;
    };
    const text = probe('--text');
    const dim = probe('--dim');
    const accentText = probe('--accent-text');
    const accent = probe('--accent');
    // Prove the tokens are used by real text, not merely defined.
    let textNodes = 0;
    for (const el of app.querySelectorAll('*')) {
      if (!el.textContent || !el.textContent.trim()) continue;
      if (getComputedStyle(el).color === text) textNodes += 1;
    }
    return { text, dim, accentText, accent, textNodes, title: document.title };
  });
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const themes = await readThemes();
await mkdir(SHOT_DIR, { recursive: true });
const server = await ensureServer();
const browser = await chromium.launch();
const rows = [];

try {
  for (const theme of themes) {
    for (const mode of MODES) {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      await context.addInitScript(
        ([key, value]) => localStorage.setItem(key, value),
        [SETTINGS_KEY, JSON.stringify(settingsFor(theme.id, mode))],
      );
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForSelector('.app', { timeout: 45_000 });
      // The in-app splash is a full-viewport overlay on top of the studio
      // (App.tsx: 650 ms hold with reduceMotion, then a 380 ms fade, then it
      // unmounts). Capturing before it unmounts grades the splash — which is
      // exactly what an earlier 450 ms wait did.
      await page.waitForFunction(() => !document.querySelector('.splash-screen'), null, {
        timeout: 20_000,
      });
      await page.waitForSelector('.workspace', { state: 'visible', timeout: 20_000 });
      await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
      await page.waitForTimeout(250);

      const file = `${theme.id}-${mode}.png`;
      const shotPath = path.join(SHOT_DIR, file);
      await page.screenshot({ path: shotPath, fullPage: false });

      if (await page.evaluate(() => Boolean(document.querySelector('.splash-screen')))) {
        throw new Error(`${theme.id}/${mode}: splash overlay reappeared; refusing to measure it`);
      }

      const tokens = await inspect(page);
      const png = PNG.sync.read(await readFile(shotPath));

      const backgrounds = REGIONS.map((region) => ({
        label: region.label,
        color: patchColor(
          png,
          Math.round(region.x * VIEWPORT.width),
          Math.round(region.y * VIEWPORT.height),
        ),
      }));

      const textRgb = parseRgb(tokens.text);
      const dimRgb = parseRgb(tokens.dim);
      const accentRgb = parseRgb(tokens.accent);
      const accentTextRgb = parseRgb(tokens.accentText);

      // `--text` is used across content and chrome, so it is checked on every
      // sampled surface. `--dim` is chrome/status text (browser hints, tab
      // labels, the status bar); the clip lane draws clip labels with
      // `--clip-text` over per-clip colours, so checking dim against a clip
      // fill would invent a pairing that never renders.
      const CHROME_SURFACES = new Set(['browser panel', 'top bar', 'hint bar']);
      const checks = [];
      for (const bg of backgrounds) {
        checks.push({ pair: `text on ${bg.label}`, ratio: contrast(textRgb, bg.color), min: BODY_MIN });
        if (CHROME_SURFACES.has(bg.label)) {
          checks.push({ pair: `dim on ${bg.label}`, ratio: contrast(dimRgb, bg.color), min: BODY_MIN });
        }
      }
      checks.push({ pair: 'accent button text', ratio: contrast(accentTextRgb, accentRgb), min: LARGE_MIN });

      if (tokens.textNodes === 0) {
        throw new Error(
          `${theme.id}/${mode}: no rendered text uses the resolved --text colour (${tokens.text}); ` +
            'the probe is reading the wrong scope and the row would be meaningless',
        );
      }

      const worst = checks.reduce((a, b) => (b.ratio < a.ratio ? b : a));
      const failures = checks.filter((c) => c.ratio < c.min);
      const pass = failures.length === 0;
      // Report the weakest pair that actually breaches its threshold; otherwise
      // the weakest pair overall. Showing a passing 3.5:1 accent as "worst"
      // while four dim pairs fail 4.5:1 would mislead the reader.
      const reported = failures.length
        ? failures.reduce((a, b) => (b.ratio < a.ratio ? b : a))
        : worst;

      rows.push({
        theme: theme.id,
        themeName: theme.name,
        mode,
        worst: reported.ratio,
        pair: reported.pair,
        pass,
        failures,
        textNodes: tokens.textNodes,
        file,
        errors: errors.slice(0, 2),
      });

      const flag = pass ? 'PASS' : 'FAIL';
      console.log(
        `${flag} ${theme.id}/${mode}: ${reported.ratio.toFixed(2)}:1 (${reported.pair})` +
          (failures.length ? ` — ${failures.length} failing pair(s)` : ''),
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (server) server.kill();
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

function proposedFix(row) {
  if (row.pass) return '—';
  const worstPair = row.failures.reduce((a, b) => (b.ratio < a.ratio ? b : a)).pair;
  if (worstPair.startsWith('dim')) {
    return 'Raise `--dim` toward `--text` until it reaches 4.5:1 on that surface.';
  }
  if (worstPair.startsWith('accent')) {
    return 'Pick a darker/lighter `--accent-text` or adjust `--accent` for 3:1.';
  }
  return 'Increase panel opacity or darken/lighten the surface behind this text.';
}

const passed = rows.filter((r) => r.pass).length;
const failed = rows.length - passed;
const worstRow = rows.reduce((a, b) => (b.worst < a.worst ? b : a));

const lines = [];
lines.push('# Theme QA — OpenBeats 1.0.5');
lines.push('');
lines.push('Generated by `scripts/qa-visual.mjs`. **Scope: 22 combinations** — the 11 built-in');
lines.push('themes in both interface modes (`classic`, `modern`), captured from the Vite web');
lines.push('build at 1440×900.');
lines.push('');
lines.push('> **Why 22 rows, not 96.** The requested matrix was 6 themes × 4 modes × 4 background');
lines.push('> images. This build has **11 themes**, **2 interface modes** and **no background-image');
lines.push('> feature at all** — there is no wallpaper/bgImage setting and the only file picker in');
lines.push('> Settings imports theme JSON. A 96-row table would have shown screenshots of a');
lines.push('> feature that does not exist, so it was not produced. See `docs/AUDIO_CLIPS.md` and');
lines.push('> the 1.0.5 release notes for what does ship.');
lines.push('');
lines.push('## Method');
lines.push('');
lines.push('- Foreground colours are read from the live page via a probe element using the');
lines.push('  theme tokens (`--text`, `--dim`, `--accent-text`, `--accent`).');
lines.push('- Background colours are sampled from each screenshot (median of an 11×11 patch)');
lines.push(`  at four regions: ${REGIONS.map((r) => `*${r.label}*`).join(', ')}.`);
lines.push('  Sampling the real pixels is what makes the four translucent glass themes honest.');
lines.push('- `--text` is checked against all four surfaces. `--dim` is checked only against');
lines.push('  chrome (browser panel, top bar, hint bar) because that is where secondary text');
lines.push('  renders; clip labels use `--clip-text` over per-clip colours instead.');
lines.push('- No glyph pixels are sampled: antialiased text cannot yield a WCAG ratio. WCAG 2.x');
lines.push(`  relative luminance is applied; body text needs ${BODY_MIN}:1, large/UI ${LARGE_MIN}:1.`);
lines.push('- The in-app splash overlay is waited out before capture. It is a full-viewport');
lines.push('  branded screen; measuring it would grade the splash instead of the studio.');
lines.push('- This drives Chromium against the web build, not the Tauri WebKitGTK window, so it');
lines.push('  validates shared CSS only. Native window chrome and native-only surfaces are out');
lines.push('  of scope and are not claimed here.');
lines.push('');
lines.push('## Result');
lines.push('');
lines.push(`**${passed} passed, ${failed} failed** of ${rows.length} combinations.`);
lines.push('');
lines.push(
  `Worst case overall: **${worstRow.theme} / ${worstRow.mode}** at ${worstRow.worst.toFixed(2)}:1 (${worstRow.pair}).`,
);
lines.push('');
lines.push('| Theme | Mode | Image | Contrast (worst pair) | Pass/Fail | Screenshot | Proposed Fix |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) {
  lines.push(
    `| ${row.themeName} (\`${row.theme}\`) | ${row.mode} | n/a — no image feature | ` +
      `${row.worst.toFixed(2)}:1 (${row.pair}) | ${row.pass ? 'Pass' : '**Fail**'} | ` +
      `[${row.file}](../artifacts/qa-1.0.5/${row.file}) | ${proposedFix(row)} |`,
  );
}
lines.push('');
lines.push('## Failing combinations');
lines.push('');
if (failed === 0) {
  lines.push('None.');
} else {
  for (const row of rows.filter((r) => !r.pass)) {
    lines.push(`### ${row.themeName} / ${row.mode}`);
    lines.push('');
    for (const f of row.failures) {
      lines.push(`- \`${f.pair}\`: **${f.ratio.toFixed(2)}:1** (needs ${f.min}:1)`);
    }
    lines.push(`- Proposed fix: ${proposedFix(row)}`);
    lines.push('');
  }
}
lines.push('## Limitations');
lines.push('');
lines.push('- Background patches are four fixed points; a text element sitting on an unusual');
lines.push('  surface is not individually measured. The token pairs cover body, dim and accent text.');
lines.push('- Glass themes are measured with their real translucency, but only at the default');
lines.push('  window size and with no content behind the panels beyond the app’s own gradient.');
lines.push('- Screenshots use the seeded Tutorial project, so clip colours are present; changing');
lines.push('  project content does not change the theme tokens being measured.');
lines.push('- Pixel patches include any text that falls inside the 11×11 window at that point;');
lines.push('  the median suppresses it but a very dense region can shift the sampled colour.');
lines.push('');
lines.push('## Reproduce');
lines.push('');
lines.push('```bash');
lines.push('npm run dev            # or let the script start it');
lines.push('node scripts/qa-visual.mjs');
lines.push('```');
lines.push('');

await writeFile(REPORT, lines.join('\n'), 'utf8');

console.log('');
console.log(`${passed}/${rows.length} passed, ${failed} failed`);
console.log(`Report: ${path.relative(ROOT, REPORT)}`);
console.log(`Screenshots: ${path.relative(ROOT, SHOT_DIR)}/`);
if (failed > 0) {
  for (const row of rows.filter((r) => !r.pass)) {
    console.log(
      `  FAIL ${row.theme}/${row.mode}: ${row.failures
        .map((f) => `${f.pair} ${f.ratio.toFixed(2)}:1 < ${f.min}`)
        .join('; ')}`,
    );
  }
}
