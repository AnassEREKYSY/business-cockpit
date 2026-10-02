import { useEffect, type ReactNode } from 'react';
import { initials } from '../lib/format';
import type { ThemePref } from '../lib/theme';

export function Seg<T extends string>({ options, value, onChange, label }: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}

// Open modals, innermost last: Escape only closes the one on top (e.g. a confirm over a form).
const stack: symbol[] = [];

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const me = Symbol(title);
    stack.push(me);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stack[stack.length - 1] === me && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      stack.splice(stack.indexOf(me), 1);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, title]);
  return (
    // pointerdown fires before the popover's own outside-click handling, so a click meant to
    // dismiss an open dropdown never closes the form behind it.
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && !document.querySelector('.pop') && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="card-title">{title}</div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Brand mark, drawn inline so it follows the theme (ink square, background-coloured gauge). */
export const BrandMark = ({ size = 32 }: { size?: number }) => (
  <svg viewBox="0 0 1250 1408" className="brand-logo" style={{ height: `${size / 16}rem`, width: `${(size * 1250) / 1408 / 16}rem` }} aria-hidden="true">
    <rect x="0" y="79" width="1250" height="1250" rx="300" fill="var(--ink)" />
    <g fill="none" stroke="var(--bg)" strokeLinecap="round">
      <path d="M370 959 A360 360 0 1 1 880 959" strokeWidth="110" />
      <path className="brand-needle" d="M625 704 L816 513" strokeWidth="90" />
    </g>
    <circle cx="625" cy="704" r="85" fill="var(--bg)" />
  </svg>
);

/** Profile photo, or the initials when there is none. */
export const Avatar = ({ name, photo, large = false }: { name: string; photo: string; large?: boolean }) =>
  photo ? (
    <img className={'avatar avatar-img' + (large ? ' lg' : '')} src={photo} alt={name} />
  ) : (
    <div className={'avatar' + (large ? ' lg' : '')}>{initials(name)}</div>
  );

export const IconPencil = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconOverview = () => (
  <Svg>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Svg>
);

export const IconProjects = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </Svg>
);

export const IconFinance = () => (
  <Svg>
    <path d="M3 3v18h18" />
    <path d="m7 15 4-4 3 3 5-6" />
  </Svg>
);

export const IconData = () => (
  <Svg>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
);

const IconSun = () => (
  <Svg size={15}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </Svg>
);
const IconMoon = () => (
  <Svg size={15}>
    <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
  </Svg>
);
const IconSystem = () => (
  <Svg size={15}>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Svg>
);

const THEMES: [ThemePref, string, () => React.JSX.Element][] = [
  ['light', 'Light', IconSun],
  ['dark', 'Dark', IconMoon],
  ['system', 'System', IconSystem],
];
const center = (e: React.MouseEvent) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Light / Dark / System, with a sliding thumb. */
export function ThemeSwitch({ pref, onChange }: { pref: ThemePref; onChange: (p: ThemePref, origin: { x: number; y: number }) => void }) {
  const i = THEMES.findIndex(([v]) => v === pref);
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme" style={{ '--i': i } as React.CSSProperties}>
      {THEMES.map(([v, label, Icon]) => (
        <button key={v} role="radio" aria-checked={pref === v} title={label} aria-label={label} onClick={(e) => onChange(v, center(e))}>
          <Icon />
        </button>
      ))}
    </div>
  );
}

/** Compact version for phones: one button that toggles light and dark. */
export function ThemeMini({ dark, onToggle }: { dark: boolean; onToggle: (origin: { x: number; y: number }) => void }) {
  return (
    <button className="theme-mini" onClick={(e) => onToggle(center(e))} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
