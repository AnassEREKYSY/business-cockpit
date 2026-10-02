import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** 'system' follows the device setting; 'light' and 'dark' force one theme. */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'cockpit-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** The theme actually shown right now. */
export const resolved = (pref: ThemePref): 'light' | 'dark' => (pref === 'system' ? (media().matches ? 'dark' : 'light') : pref);

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  // Browser chrome (mobile address bar) follows the page background.
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: the choice lasts for this visit only */
  }
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => unknown };

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);

  useEffect(() => {
    const m = media();
    const onChange = () => readPref() === 'system' && apply('system');
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, []);

  /** Switch theme; with an origin point, the new theme spreads from there as a circle. */
  const setTheme = useCallback((next: ThemePref, origin?: { x: number; y: number }) => {
    const doc = document as ViewTransitionDoc;
    const visible = resolved(next) !== resolved(readPref());
    const run = () => {
      apply(next);
      flushSync(() => setPref(next));
    };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || !visible || reduce) return run();
    const root = document.documentElement;
    root.style.setProperty('--vt-x', `${origin?.x ?? window.innerWidth / 2}px`);
    root.style.setProperty('--vt-y', `${origin?.y ?? window.innerHeight / 2}px`);
    doc.startViewTransition(run);
  }, []);

  return { pref, setTheme };
}
