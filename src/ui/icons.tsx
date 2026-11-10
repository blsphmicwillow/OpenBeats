import React from 'react';

type Props = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

const base = (size: number, children: React.ReactNode, extra?: React.SVGProps<SVGSVGElement>) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...extra}
  >
    {children}
  </svg>
);

export function IconPlay({ size = 14 }: Props) {
  return base(size, <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />);
}

export function IconStop({ size = 14 }: Props) {
  return base(size, <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor" stroke="none" />);
}

export function IconRecord({ size = 14 }: Props) {
  return base(size, <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />);
}

export function IconGear({ size = 14 }: Props) {
  return base(
    size,
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v3M12 18.4v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.6 12h3M18.4 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>,
  );
}

export function IconLoop({ size = 14 }: Props) {
  return base(
    size,
    <>
      <path d="M17 2.5l3 3-3 3" />
      <path d="M20 5.5H8.5A5.5 5.5 0 0 0 3 11v.5" />
      <path d="M7 21.5l-3-3 3-3" />
      <path d="M4 18.5h11.5A5.5 5.5 0 0 0 21 13v-.5" />
    </>,
  );
}

export function IconMetro({ size = 14 }: Props) {
  return base(
    size,
    <>
      <path d="M9 3h6l3 18H6z" />
      <path d="M12 6l-4 10" />
      <circle cx="12" cy="17.5" r="1.3" fill="currentColor" />
    </>,
  );
}

export function IconFolder({ size = 14 }: Props) {
  return base(size, <path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
}

export function IconWave({ size = 14 }: Props) {
  return base(size, <path d="M2 12h2l2-6 3 13 3-16 3 12 2-5h5" />);
}

export function IconSearch({ size = 14 }: Props) {
  return base(
    size,
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>,
  );
}

export function IconPlus({ size = 14 }: Props) {
  return base(size, <path d="M12 5v14M5 12h14" />);
}

export function IconTrash({ size = 14 }: Props) {
  return base(
    size,
    <>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" />
    </>,
  );
}

export function IconClose({ size = 14 }: Props) {
  return base(size, <path d="M6 6l12 12M18 6L6 18" />);
}

export function IconChevron({ size = 14 }: Props) {
  return base(size, <path d="M9 5l7 7-7 7" />);
}

export function IconDownload({ size = 14 }: Props) {
  return base(
    size,
    <>
      <path d="M12 3v12M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 19h16" />
    </>,
  );
}

export function IconSave({ size = 14 }: Props) {
  return base(
    size,
    <>
      <path d="M4 4h12l4 4v12H4z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </>,
  );
}

export function IconUndo({ size = 14 }: Props) {
  return base(size, <path d="M9 5L4 10l5 5M4 10h9a6 6 0 0 1 0 12h-2" />);
}

export function IconRedo({ size = 14 }: Props) {
  return base(size, <path d="M15 5l5 5-5 5M20 10h-9a6 6 0 0 0 0 12h2" />);
}

export function IconHelp({ size = 14 }: Props) {
  return base(
    size,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.2a2.6 2.6 0 1 1 3.4 2.5c-.7.3-1 .9-1 1.6v.3" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </>,
  );
}

export function IconPiano({ size = 14 }: Props) {
  return base(
    size,
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.6" />
      <path d="M8 5v9M12 5v9M16 5v9M3 14h18" />
    </>,
  );
}

export function IconMixer({ size = 14 }: Props) {
  return base(
    size,
    <>
      <path d="M5 3v18M12 3v18M19 3v18" />
      <rect x="3.4" y="7" width="3.2" height="4" rx="1" fill="currentColor" />
      <rect x="10.4" y="12" width="3.2" height="4" rx="1" fill="currentColor" />
      <rect x="17.4" y="5.5" width="3.2" height="4" rx="1" fill="currentColor" />
    </>,
  );
}

export function IconGrid({ size = 14 }: Props) {
  return base(
    size,
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.6" />
      <path d="M3 10h18M9 4v16M15 4v16" />
    </>,
  );
}

export function IconSliders({ size = 14 }: Props) {
  return base(
    size,
    <>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </>,
  );
}

export function IconPower({ size = 14 }: Props) {
  return base(
    size,
    <>
      <path d="M12 3v8" />
      <path d="M6.4 6.4a8 8 0 1 0 11.2 0" />
    </>,
  );
}

export function IconCopy({ size = 14 }: Props) {
  return base(
    size,
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>,
  );
}

export function IconLogo({ size = 18 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
      <path d="M6 13.5l2.4-5 2.4 8 2.4-11 2.4 8 2.4-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
