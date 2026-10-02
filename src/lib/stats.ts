import type { AppData, Entry, Txn } from '../types';
import { allTxns } from './finance';
import { isoDate } from './format';
import { sumMinutes } from './time';

/** An invoice still waiting for payment. */
export const isUnpaid = (e: Pick<Entry, 'type' | 'paid'>) => e.type === 'revenue' && !e.paid;
export const isOverdue = (e: Pick<Entry, 'type' | 'paid' | 'due'>, today = isoDate()) => isUnpaid(e) && !!e.due && e.due < today;

/** Unpaid invoices, the most urgent first (overdue, then by due date, then by date). */
export function unpaidInvoices(d: AppData): Entry[] {
  return d.entries
    .filter(isUnpaid)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.date.localeCompare(b.date));
}

export type ProjectStats = {
  revenue: number;
  costs: number;
  margin: number;
  marginRate: number | null;
  budget: number;
  /** Share of the budget already invoiced, null without a budget. */
  budgetUsed: number | null;
  unpaid: number;
  minutes: number;
  /** Margin per hour worked, null without tracked time. */
  perHour: number | null;
};

/** Money and time for one project, all time: everything linked to it (one-off and recurring). */
export function projectStats(d: AppData, projectId: string, txns: Txn[] = allTxns(d), now = Date.now()): ProjectStats {
  const mine = txns.filter((t) => t.projectId === projectId);
  const revenue = mine.filter((t) => t.type === 'revenue').reduce((a, t) => a + t.amount, 0);
  const costs = mine.filter((t) => t.type !== 'revenue').reduce((a, t) => a + t.amount, 0);
  const margin = revenue - costs;
  const budget = d.projects.find((p) => p.id === projectId)?.budget ?? 0;
  const minutes = sumMinutes(d.timeEntries.filter((x) => x.projectId === projectId), now);
  const unpaid = d.entries.filter((e) => e.projectId === projectId && isUnpaid(e)).reduce((a, e) => a + e.amount, 0);
  return {
    revenue, costs, margin, budget, unpaid, minutes,
    marginRate: revenue ? (margin / revenue) * 100 : null,
    budgetUsed: budget ? (revenue / budget) * 100 : null,
    perHour: minutes >= 1 ? margin / (minutes / 60) : null,
  };
}
