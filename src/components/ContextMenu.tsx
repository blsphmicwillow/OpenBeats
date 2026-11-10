import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../store';

export function ContextMenu() {
  const menu = useApp((s) => s.ui.contextMenu);
  const closeMenu = useApp((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 220;
    setPos({
      x: Math.min(menu.x, window.innerWidth - w - 8),
      y: Math.min(menu.y, window.innerHeight - h - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, closeMenu]);

  if (!menu) return null;

  return (
    <>
      <div
        className="ctx-backdrop"
        onPointerDown={closeMenu}
        onContextMenu={(e) => {
          e.preventDefault();
          closeMenu();
        }}
      />
      <div className="ctxmenu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
        {menu.items.map((item, i) =>
          item.separator ? (
            <div key={`sep-${i}`} className="ctx-sep" />
          ) : item.label && !item.onClick && item.disabled && !item.checked ? (
            <div key={`label-${i}`} className="ctx-label">
              {item.label}
            </div>
          ) : (
            <button
              key={`${item.label}-${i}`}
              className={`ctx-item ${item.danger ? 'danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.();
                closeMenu();
              }}
              role="menuitem"
            >
              <span className="ctx-check">{item.checked ? '✓' : ''}</span>
              <span>{item.label}</span>
              {item.shortcut && <span className="ctx-key">{item.shortcut}</span>}
            </button>
          ),
        )}
      </div>
    </>
  );
}
