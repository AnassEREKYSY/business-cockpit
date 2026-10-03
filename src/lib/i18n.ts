import { useSyncExternalStore } from 'react';
import frApp from '../i18n/fr-app';
import frMoney from '../i18n/fr-money';
import frOverview from '../i18n/fr-overview';
import frProjects from '../i18n/fr-projects';
import frWealth from '../i18n/fr-wealth';

/*
 * Two languages: English (default) and French. Texts are written in English in the code and wrapped
 * in t(); the French version is looked up by that English text. A missing translation shows English.
 *   t('Add a task')                      -> 'Ajouter une tâche'
 *   t('{n} tasks due today', { n: 3 })   -> '3 tâches à faire aujourd’hui'
 *   tn(n, '{n} task', '{n} tasks')       -> picks singular / plural, then translates
 */
export type Lang = 'en' | 'fr';

const KEY = 'cockpit-lang';
const FR: Record<string, string> = { ...frApp, ...frOverview, ...frProjects, ...frMoney, ...frWealth };

function read(): Lang {
  try {
    return localStorage.getItem(KEY) === 'fr' ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = read();
const listeners = new Set<() => void>();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = () => current;

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** Current language; re-renders the component when it changes. */
export const useLang = () => useSyncExternalStore(subscribe, getLang, getLang);

export function t(en: string, vars?: Record<string, string | number>): string {
  let s = current === 'fr' ? (FR[en] ?? en) : en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Singular or plural English template (with {n}), translated. French uses the singular for 0 and 1. */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  const single = current === 'fr' ? Math.abs(n) < 2 : n === 1;
  return t(single ? one : many, { n, ...vars });
}

/** Locale for dates and numbers. */
export const locale = () => (current === 'fr' ? 'fr-FR' : 'en-GB');
