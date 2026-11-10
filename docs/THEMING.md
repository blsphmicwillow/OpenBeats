# Theming and the colour editor

Every surface in OpenBeats reads CSS custom properties written from a single theme object, so one palette restyles the rack, piano roll, playlist, mixer, dialogs and native effect editors at once.

## The theme object

`Theme` is defined in `src/model/types.ts`:

| Field | Used for |
| --- | --- |
| `bg` | window background |
| `panel` | primary panels (rack, playlist, browser) |
| `panel2` | toolbars, headers, ruler |
| `panel3` | buttons, steps, inputs |
| `border` | separators and outlines |
| `text` | primary text |
| `dim` | secondary text, labels |
| `accent` | selection, active tool, primary buttons |
| `accentText` | text on accent fills |
| `playhead` | playhead, recording indicators |
| `selection` | marquee and clip selection fill |
| `channelColors` | 12 channel colours, assigned round-robin |
| `dark` | tells native controls and scrollbars which way to bias |
| `glass` | enables the glassmorphism surface treatment |

Built-in palettes live in `src/themes.ts`. `themeVars()` converts a theme to CSS variables (`--bg`, `--panel`, `--accent`, …) and the root element also gets `theme-dark` / `theme-glass` classes.

## Glass and Liquid Glass

Four presets exercise the glass treatment, one per theme in each light/dark pairing:

- **Glass (dark)** — deep indigo background, translucent panels, 22 px backdrop blur, violet accent.
- **Glass (light)** — pale indigo background, translucent white panels, violet accent and cyan playhead.
- **Liquid Glass (light)** — pale blue-white background, translucent white panels, saturated blur, blue accent and pink playhead.
- **Liquid Glass (dark)** — near-black navy background, cyan accent and pink playhead.

The implementation is deliberately dependency-free: `backdrop-filter: blur() saturate()`, `color-mix()` for translucency, and a soft radial gradient behind the window. Content panels are 90% opaque and only chrome keeps a heavy frost; `@supports not (backdrop-filter…)` and the **Reduce transparency** setting both fall back to solid panels. See [GLASS.md](GLASS.md) for the comparison with Apple's Liquid Glass and the flaws that were corrected.

To make a custom palette glassy, tick **Glass surfaces** in the colour editor (stored as `customTheme.glass`). The class is applied from the *active* theme, including the custom one.

Glass is a **chrome treatment**, not a content effect: rack, playlist and mixer stay near-opaque so text contrast does not depend on what is behind them. Users who need flat surfaces can enable **Reduce transparency** in Accessibility.

## Editing colours

**Settings → Appearance → My theme**

Each token row offers three synced controls:

1. the native **colour wheel** (`<input type="color">`),
2. a **HEX** field (accepts `#RRGGBB` or `RRGGBB`, three-digit shorthand),
3. **R / G / B** number inputs (0–255).

Any edit writes into *My theme* and selects it, so built-in palettes are never mutated. Editing while a built-in theme is active first copies that palette, then applies the change.

Other appearance controls:

- **Interface mode** — Classic (bevelled, denser chrome) or Modern (flatter, rounded, more spacing). Both use the same tokens.
- **Accent override** — one colour pushed across any theme without editing it.
- **Interface scale** — 80–130%.
- **Density** — comfortable or compact.
- **Reduce motion** — disables pulses and transitions.
- **Reduce transparency** — solid panels, no backdrop blur.

## Import and export

`Export theme JSON` downloads the active theme; `Import theme` accepts a JSON file with at least `bg` and `accent`. Invalid files are rejected with a toast. The format is the plain `Theme` object:

```json
{
  "id": "custom",
  "name": "My Theme",
  "dark": true,
  "glass": true,
  "bg": "#0b0d17",
  "panel": "#151a2b",
  "panel2": "#1b2238",
  "panel3": "#242d49",
  "border": "#2a3350",
  "text": "#e8ecff",
  "dim": "#93a0c4",
  "accent": "#7c5cff",
  "accentText": "#ffffff",
  "playhead": "#59e1ff",
  "selection": "#7c5cff55",
  "channelColors": ["#7c5cff", "#59e1ff", "#ff6bd6"]
}
```

Missing `channelColors` entries fall back to the built-in set. Themes are stored inside the project's settings, so a theme travels with a saved project; use export/import to share one.
