import { useEffect, useRef } from 'react';
import { engine } from '../audio/engine';

export function Meter({ stripId, horizontal = false, className = '' }: { stripId: number; horizontal?: boolean; className?: string }) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const level = engine.level(stripId);
        if (horizontal) el.style.width = `${Math.min(100, level * 100)}%`;
        else el.style.height = `${Math.min(100, level * 100)}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stripId, horizontal]);

  return (
    <div className={`meter ${className}`}>
      <i ref={ref as React.RefObject<HTMLElement>} />
    </div>
  );
}

export function MasterMeter() {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) el.style.width = `${Math.min(100, engine.level(0) * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="master-meter" title="Master output level">
      <i
        ref={ref as React.RefObject<HTMLElement>}
        style={{
          display: 'block',
          height: '100%',
          width: '0%',
          background: 'linear-gradient(90deg,#22c55e,#eab308 76%,#ef4444)',
          transition: 'width 60ms linear',
        }}
      />
    </div>
  );
}
