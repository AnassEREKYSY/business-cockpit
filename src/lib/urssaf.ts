import type { AppData, TaxPayment, TaxSettings } from '../types';
import { allTxns } from './finance';
import { isoDate } from './format';
import { taxesOn, type TaxBreakdown } from './tax';

/*
 * URSSAF calendar for a micro-entreprise. Revenue cashed in during a period is declared, and the
 * contributions paid, by the last day of the following month:
 *   - quarterly: 30 April, 31 July, 31 October, 31 January;
 *   - monthly: the last day of the next month.
 * Periods follow the calendar: each quarter (or month) counts the revenue cashed in during it,
 * 0 when nothing came in. The first one starts on the business start date. If URSSAF asked for a
 * longer first declaration, its end can be set by hand in the settings.
 */

export type Period = { start: string; end: string; deadline: string; first: boolean };
export type PeriodStatus = 'paid' | 'due' | 'late' | 'open' | 'upcoming';
export type PeriodRow = Period & { status: PeriodStatus; estimate: TaxBreakdown; payment?: TaxPayment };

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];

/** Last day of the period (quarter or month) that contains `iso`. */
function endOfPeriod(iso: string, period: TaxSettings['period']): string {
  const [y, m] = parts(iso);
  const em = period === 'month' ? m : Math.ceil(m / 3) * 3;
  return lastDay(y, em);
}
/** Day after `iso`. */
const nextDay = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return isoDate(d);
};
/** Payment deadline of a period: last day of the month after it ends. */
export function deadlineOf(end: string): string {
  const [y, m] = parts(end);
  return m === 12 ? lastDay(y + 1, 1) : lastDay(y, m + 1);
}
/** Default end of the first period: end of the quarter (or month) the business started in. */
export function firstEndFor(start: string, period: TaxSettings['period']): string {
  return endOfPeriod(start, period);
}

/** Every period from the start date until the one after today. */
export function periods(tax: TaxSettings, fallbackStart: string, today = isoDate()): Period[] {
  const start = tax.start || fallbackStart;
  if (!start) return [];
  const out: Period[] = [];
  const firstEnd = tax.firstEnd && tax.firstEnd >= start ? tax.firstEnd : firstEndFor(start, tax.period);
  out.push({ start, end: firstEnd, deadline: deadlineOf(firstEnd), first: true });
  for (let i = 0; i < 400; i++) {
    const prev = out[out.length - 1];
    if (prev.start > today) break; // stop after the first period that has not started yet
    const s = nextDay(prev.end);
    const e = endOfPeriod(s, tax.period);
    out.push({ start: s, end: e, deadline: deadlineOf(e), first: false });
  }
  return out;
}

/** Periods with what is owed (from revenue cashed in) and what was paid. */
export function periodRows(data: AppData, today = isoDate()): PeriodRow[] {
  const tax = data.profile.tax;
  // Revenue counts when the money arrives: invoices still waiting are left out.
  const txns = allTxns(data).filter((x) => x.paid !== false);
  const firstRevenue = txns.filter((x) => x.type === 'revenue').map((x) => x.date).sort()[0] ?? '';
  const list = periods(tax, firstRevenue ? `${firstRevenue.slice(0, 4)}-01-01` : '', today);
  // A payment goes to the period it was recorded for. One recorded for other dates (settings changed
  // since) goes to the period holding its start date, if that one has none.
  const byPeriod = new Map<number, TaxPayment>();
  const used = new Set<string>();
  list.forEach((p, i) => {
    const hit = data.taxPayments.find((x) => x.periodEnd === p.end && x.periodStart >= p.start);
    if (hit) {
      byPeriod.set(i, hit);
      used.add(hit.id);
    }
  });
  for (const x of data.taxPayments) {
    if (used.has(x.id)) continue;
    const i = list.findIndex((p) => x.periodStart >= p.start && x.periodStart <= p.end);
    if (i >= 0 && !byPeriod.has(i)) {
      byPeriod.set(i, x);
      used.add(x.id);
    }
  }
  return list.map((p, i) => {
    const estimate = taxesOn(txns.filter((x) => x.date >= p.start && x.date <= p.end), tax);
    const payment = byPeriod.get(i);
    const status: PeriodStatus = payment ? 'paid'
      : p.start > today ? 'upcoming'
        : p.end >= today ? 'open'
          : p.deadline >= today ? 'due'
            : 'late';
    return { ...p, status, estimate, payment };
  });
}
