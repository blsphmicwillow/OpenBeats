# Glass critique: glassmorphism vs Liquid Glass

This note records what the two styles actually are, how OpenBeats' first glass pass measured up, and what changed.

## What the sources say

**Apple, Liquid Glass** (Human Interface Guidelines → Materials; WWDC25 "Meet Liquid Glass"):

- It is a **functional layer** for controls and navigation that floats above content. Apple explicitly says *don't use Liquid Glass in the content layer* and only use the clear variant over rich backgrounds.
- It is multi-layered and **adaptive**: it limits the range of background colour, shifts tint, shadow and dynamic range to keep foreground legible, and simulates thickness with lensing/refraction and deeper shadows as elements grow.
- Accessibility modifiers are part of the material: **Reduce Transparency**, **Increase Contrast** and **Reduce Motion**, plus scroll-edge effects so content passing underneath never destroys legibility.

**NN/g on glassmorphism**:

- Frosted translucency plus background blur creates depth, but text legibility is the main failure mode.
- Best practices: meet contrast requirements, keep backgrounds simple when you control them, and **let users adjust transparency**.

## Where the first implementation was flawed

1. **Applied to the content layer.** The rack, playlist, mixer and even the tab body were frosted. That flattens hierarchy: when everything floats, nothing does. Apple reserves the material for chrome.
2. **No adaptive luminosity.** A fixed 66% panel alpha over a three-stop radial gradient can put mid-grey text on a mid-grey blur. Contrast depended on what happened to be behind the panel.
3. **No refraction, rim or thickness.** It was `backdrop-filter` plus transparency — glassmorphism, not Liquid Glass. Real Liquid Glass has a specular top edge, a darker bottom edge, lensing at the boundary and layered shadow depth.
4. **No reduced-transparency path.** We shipped Reduce Motion and High Contrast, but blur could not be turned off. NN/g and Apple both call for exactly that control.
5. **Blur stacked on every surface.** Six or seven simultaneous 22 px backdrop filters is expensive on integrated GPUs, and blurring already-blurred-backdrop layers compounds cost with little visual gain.
6. **No no-blur fallback.** `background-color: color-mix(… 66%, transparent)` without `backdrop-filter` leaves text over the gradient.
7. **Uniform borders.** Every surface used the same 1 px line, so glass panels read as tinted rectangles rather than objects with an edge.

## What changed

- **Content is nearly opaque** (90%) with a light 14 px blur; **chrome** (top bar, tabs, modal) keeps a 20 px frost at 74–94% opacity. The tab body is no longer blurred at all.
- Added **specular rims and edge shadows**: `inset 0 1px 0` white, `inset 0 -1px 0` black and a deep drop shadow, so panels have a lit top edge and a weighted bottom.
- Active tabs get a stronger inner highlight and accent ring instead of another transparent layer.
- Added **Reduce transparency** in Settings → Accessibility: solid panels, all backdrop filters off.
- Added an explicit `@supports not (backdrop-filter…)` branch that renders solid panels.
- Documented the choice: the Glass themes are a *frosted chrome* treatment, not a claim to reproduce Apple's optical material. True refraction would require WebGL/shader work and would still need an opaque fallback.

## Remaining honest gaps

- No real refraction/lensing or dynamic tint sampling; CSS cannot sample the backdrop's luminance.
- Blur cost is reduced but not eliminated; very low-end GPUs should use Reduce transparency.
- Light glass at 74% over the brightest gradient stops is the weakest contrast case; High Contrast or Reduce transparency is the remedy.
