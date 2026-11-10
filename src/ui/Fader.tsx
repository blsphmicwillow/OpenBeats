import { useRef, useState } from 'react';
import { useApp } from '../store';

export function Fader({
  value,
  onChange,
  onGestureStart,
  min = 0,
  max = 1.3,
  defaultValue = 0.8,
  color,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  onGestureStart?: () => void;
  min?: number;
  max?: number;
  defaultValue?: number;
  color?: string;
  label?: string;
}) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const cursorHints = useApp((s) => s.settings.cursorHints);
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const db = value <= 0.0001 ? '-inf' : (20 * Math.log10(value)).toFixed(1);

  const commit = (raw: number) => onChange(Math.max(min, Math.min(max, raw)));

  return (
    <div
      className="fader-wrap"
      title={`${label ?? 'Fader'}: ${db} dB`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, value };
        onGestureStart?.();
        setBubble({ x: e.clientX, y: e.clientY });
      }}
      onPointerMove={(e) => {
        if (cursorHints) setBubble({ x: e.clientX, y: e.clientY });
        if (!drag.current) return;
        const dy = drag.current.y - e.clientY;
        commit(drag.current.value + (dy / 150) * (max - min) * (e.shiftKey ? 0.25 : 1));
        setBubble({ x: e.clientX, y: e.clientY });
      }}
      onPointerUp={() => {
        drag.current = null;
        setBubble(null);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setBubble(null);
      }}
      onDoubleClick={() => {
        onGestureStart?.();
        commit(defaultValue);
      }}
      onWheel={(e) => {
        onGestureStart?.();
        commit(value + (e.deltaY < 0 ? 0.02 : -0.02) * (e.shiftKey ? 0.25 : 1));
      }}
    >
      <div className="fader-track">
        <div className="fader-fill" style={{ height: `calc(${norm * 100}% - 2px)`, background: color ?? 'var(--accent)' }} />
      </div>
      <div className="fader-cap" style={{ bottom: `${norm * 100}%`, ['--strip-color' as string]: color ?? 'var(--accent)' }} />
      <span
        className="strip-db"
        style={{ position: 'absolute', bottom: -12, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}
      >
        {db}
      </span>
      {bubble && (
        <span className="knob-bubble" style={{ left: bubble.x, top: bubble.y }}>
          {db} dB
        </span>
      )}
    </div>
  );
}
