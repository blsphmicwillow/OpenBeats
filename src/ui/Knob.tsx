import { useRef, useState } from 'react';
import { useApp } from '../store';

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onGestureStart?: () => void;
  label?: string;
  size?: number;
  unit?: string;
  format?: (value: number) => string;
  defaultValue?: number;
  color?: string;
  hintText?: string;
}

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
};

const arcPath = (cx: number, cy: number, r: number, from: number, to: number) => {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

export function Knob({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  onGestureStart,
  label,
  size = 28,
  unit = '',
  format,
  defaultValue,
  color,
  hintText,
}: KnobProps) {
  const cursorHints = useApp((s) => s.settings.cursorHints);
  const setHint = useApp((s) => s.hint);
  const drag = useRef<{ y: number; value: number } | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);

  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const text = format ? format(value) : `${value.toFixed(decimals)}${unit}`;
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const angle = -135 + norm * 270;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;

  const commit = (raw: number) => {
    const snapped = Math.round(raw / step) * step;
    onChange(Math.max(min, Math.min(max, Number(snapped.toFixed(6)))));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, value };
    onGestureStart?.();
    if (hintText) setHint(hintText);
    setBubble({ x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cursorHints) setBubble({ x: e.clientX, y: e.clientY });
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    const fine = e.shiftKey ? 0.2 : 1;
    commit(drag.current.value + (dy / 160) * (max - min) * fine);
    setBubble({ x: e.clientX, y: e.clientY });
  };

  const onPointerUp = () => {
    drag.current = null;
    setBubble(null);
  };

  const reset = () => {
    if (defaultValue === undefined) return;
    onGestureStart?.();
    commit(defaultValue);
  };

  return (
    <div
      className="knob"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (!drag.current) setBubble(null);
      }}
      onDoubleClick={reset}
      onWheel={(e) => {
        if (!e.deltaY) return;
        onGestureStart?.();
        commit(value + (e.deltaY < 0 ? step : -step) * (e.shiftKey ? 1 : 4));
      }}
      title={hintText ?? `${label ?? 'Value'}: ${text}`}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <path d={arcPath(cx, cy, r, -135, 135)} stroke="var(--border)" strokeWidth={3} fill="none" strokeLinecap="round" />
        <path
          d={arcPath(cx, cy, r, -135, angle)}
          stroke={color ?? 'var(--accent)'}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={r - 5} fill="var(--panel3)" stroke="var(--border)" strokeWidth={1} />
        <line
          x1={polar(cx, cy, 2, angle)[0]}
          y1={polar(cx, cy, 2, angle)[1]}
          x2={polar(cx, cy, r - 5.5, angle)[0]}
          y2={polar(cx, cy, r - 5.5, angle)[1]}
          stroke={color ?? 'var(--accent)'}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      </svg>
      {label && <span className="knob-label">{label}</span>}
      {size >= 34 && <span className="knob-value">{text}</span>}
      {bubble && <span className="knob-bubble" style={{ left: bubble.x, top: bubble.y }}>{text}</span>}
    </div>
  );
}
