import { useEffect, useId, useRef } from 'react';
import { IconClose } from './icons';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  narrow,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  narrow?: boolean;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <div className="spacer" />
          <button ref={closeRef} className="tbtn flat" onClick={onClose} title="Close" aria-label={`Close ${title}`}>
            <IconClose />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
