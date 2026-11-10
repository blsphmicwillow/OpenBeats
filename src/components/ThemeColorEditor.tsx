import type { Theme } from '../model/types';

type ColorKey = 'bg' | 'panel' | 'panel2' | 'panel3' | 'border' | 'text' | 'dim' | 'accent' | 'playhead' | 'selection';

const FIELDS: { key: ColorKey; label: string }[] = [
  { key: 'bg', label: 'Window' },
  { key: 'panel', label: 'Panels' },
  { key: 'panel2', label: 'Bars & tools' },
  { key: 'panel3', label: 'Buttons' },
  { key: 'border', label: 'Borders' },
  { key: 'text', label: 'Text' },
  { key: 'dim', label: 'Dimmed text' },
  { key: 'accent', label: 'Accent' },
  { key: 'playhead', label: 'Playhead' },
  { key: 'selection', label: 'Selection' },
];

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)));
}

function parseHex(value: string): [number, number, number] | null {
  let hex = value.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => clamp255(n).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Per-token colour editor: native colour wheel, HEX field and RGB sliders.
 * Every edit is written into “My theme” so the built-in palettes stay pristine.
 */
export function ThemeColorEditor({ theme, onChange }: { theme: Theme; onChange: (patch: Partial<Theme>) => void }) {
  return (
    <div className="color-editor">
      {FIELDS.map((field) => {
        const current = String(theme[field.key] ?? '#000000');
        const rgb = parseHex(current) ?? [0, 0, 0];
        const set = (r: number, g: number, b: number) => onChange({ [field.key]: toHex(r, g, b) } as Partial<Theme>);
        return (
          <div className="color-row" key={field.key}>
            <div className="cr-name">{field.label}</div>
            <label className="cr-wheel" title="Open the colour wheel">
              <input type="color" value={parseHex(current) ? current : '#000000'} onChange={(e) => onChange({ [field.key]: e.target.value } as Partial<Theme>)} />
              <span style={{ background: current }} />
            </label>
            <input
              className="cr-hex"
              value={current.replace('#', '').toUpperCase()}
              spellCheck={false}
              maxLength={6}
              onChange={(e) => {
                const hex = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                if (hex.length === 6) onChange({ [field.key]: `#${hex.toLowerCase()}` } as Partial<Theme>);
              }}
              onBlur={(e) => {
                const parsed = parseHex(e.target.value);
                if (parsed) set(parsed[0], parsed[1], parsed[2]);
              }}
            />
            <div className="cr-rgb">
              {(['R', 'G', 'B'] as const).map((channel, i) => (
                <label key={channel}>
                  <span>{channel}</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgb[i]}
                    onChange={(e) => {
                      const next = [...rgb] as [number, number, number];
                      next[i] = clamp255(Number(e.target.value));
                      set(next[0], next[1], next[2]);
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
