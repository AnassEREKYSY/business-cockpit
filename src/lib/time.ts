import { useEffect, useState } from 'react';
import type { AppData, TimeEntry } from '../types';
import { isoDate, uid } from './format';

/** The timer running now (the most recent one if two devices started one). */
export const runningEntry = (d: AppData): TimeEntry | undefined =>
  d.timeEntries.filter((x) => x.startedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

/** Minutes logged on an entry, counting a running timer up to `now`. */
export const entryMinutes = (e: TimeEntry, now = Date.now()) =>
  e.minutes + (e.startedAt ? Math.max(0, (now - Date.parse(e.startedAt)) / 60_000) : 0);

export const sumMinutes = (list: TimeEntry[], now = Date.now()) => list.reduce((a, e) => a + entryMinutes(e, now), 0);

/** "2h 05m", "45m", "0m". */
export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
}

/** "1:02:03" for a running timer. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1h30", "1h 30m", "1:30", "90m", "90", "1.5h", "1,5" -> minutes. Bare numbers up to 12 are hours, above that minutes. */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
  if (!s) return null;
  let m: RegExpMatchArray | null;
  let minutes: number | null = null;
  if ((m = s.match(/^(\d+):([0-5]\d)$/))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = s.match(/^(\d+(?:\.\d+)?)h(?:(\d{1,2})m?)?$/))) minutes = Number(m[1]) * 60 + Number(m[2] ?? 0);
  else if ((m = s.match(/^(\d+)(?:m|min)$/))) minutes = Number(m[1]);
  else if ((m = s.match(/^\d+(?:\.\d+)?$/))) {
    const n = Number(s);
    minutes = n <= 12 ? n * 60 : n;
  }
  if (minutes === null || !Number.isFinite(minutes)) return null;
  minutes = Math.round(minutes);
  return minutes > 0 && minutes <= 100_000 ? minutes : null;
}

/** Stop every running timer, adding the time since it started. Under 20 seconds, the entry is dropped. */
export function stopTimers(d: AppData, now = Date.now()): { data: AppData; stopped?: TimeEntry; added: number } {
  const latest = runningEntry(d);
  if (!latest) return { data: d, added: 0 };
  let stopped: TimeEntry | undefined;
  let added = 0;
  const timeEntries: TimeEntry[] = [];
  for (const x of d.timeEntries) {
    if (!x.startedAt) {
      timeEntries.push(x);
      continue;
    }
    const secs = (now - Date.parse(x.startedAt)) / 1000;
    const plus = secs >= 20 ? Math.max(1, Math.round(secs / 60)) : 0;
    const next = { ...x, minutes: Math.min(100_000, x.minutes + plus), startedAt: '' };
    if (x.id === latest.id) {
      stopped = next;
      added = plus;
    }
    if (next.minutes > 0) timeEntries.push(next);
  }
  return { data: { ...d, timeEntries }, stopped, added };
}

/** Start a timer on a project and/or task (any running one is stopped first). */
export function startTimer(d: AppData, target: { projectId: string; taskId?: string; note?: string }): AppData {
  const base = stopTimers(d).data;
  const entry: TimeEntry = {
    id: uid(), projectId: target.projectId, taskId: target.taskId ?? '', date: isoDate(), minutes: 0,
    note: target.note ?? '', startedAt: new Date().toISOString(),
  };
  return { ...base, timeEntries: [entry, ...base.timeEntries] };
}

/** Monday of the week of `d`, as YYYY-MM-DD. */
export function weekStart(d = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return isoDate(x);
}

/** Current time, refreshed every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return now;
}
