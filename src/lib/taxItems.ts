import type { AppData, TaxItem, TaxSource } from '../types';
import { convert, position, type Fx } from './wealth';

/*
 * Other taxes. The taxable amount of a personal tax item can come from Wealth:
 *   - an investment account: gains realised on sales + dividends received during the year;
 *   - Stake or real estate: rent received − expenses logged during the year.
 * Everything is converted to the profile currency. The tax is taxable amount × rate − tax already
 * withheld or paid abroad, unless the amount due was typed from the tax notice.
 */

export const SOURCES: { key: TaxSource; label: string; hint: string }[] = [
  { key: 'manual', label: 'Typed by hand', hint: 'You enter the taxable amount, or directly the amount due' },
  { key: 'tr', label: 'Trade Republic', hint: 'Gains on sales + dividends of the year' },
  { key: 'ma', label: 'Bourse de Casablanca', hint: 'Gains on sales + dividends of the year' },
  { key: 'other', label: 'Other investment account', hint: 'Gains on sales + dividends of the year' },
  { key: 'stake', label: 'Stake (Dubai)', hint: 'Rent received − fees of the year' },
  { key: 'estate', label: 'Real estate', hint: 'Rent received − expenses and loan of the year' },
];
export const sourceLabel = (s: TaxSource) => SOURCES.find((x) => x.key === s)?.label ?? s;

/** Ready-made items: they fill the name, source and usual rate (always check the rate). */
export const TAX_TEMPLATES: { scope: TaxItem['scope']; name: string; source: TaxSource; rate: number; due: (y: number) => string; notes: string }[] = [
  { scope: 'personal', name: 'Trade Republic · gains and dividends', source: 'tr', rate: 31.4, due: (y) => `${y + 1}-09-15`, notes: 'Flat tax (PFU) 31.4 % on 2026 income. Declared in spring with the IFU from Trade Republic; account declared on form 3916.' },
  { scope: 'personal', name: 'Bourse de Casablanca · gains and dividends', source: 'ma', rate: 31.4, due: (y) => `${y + 1}-09-15`, notes: 'Put tax already withheld in Morocco in "Already withheld". Foreign account declared on form 3916.' },
  { scope: 'personal', name: 'Stake · rent in Dubai', source: 'stake', rate: 0, due: () => '', notes: 'Check how foreign rental income is taxed for you, then set the rate.' },
  { scope: 'personal', name: 'Real estate · rent', source: 'estate', rate: 0, due: () => '', notes: '' },
  { scope: 'personal', name: 'Income tax', source: 'manual', rate: 0, due: (y) => `${y + 1}-09-15`, notes: 'Type the amount from your tax notice.' },
  { scope: 'personal', name: 'Property tax (taxe foncière)', source: 'manual', rate: 0, due: (y) => `${y}-10-15`, notes: '' },
  { scope: 'business', name: 'CFE', source: 'manual', rate: 0, due: (y) => `${y}-12-15`, notes: 'No CFE the year the business starts.' },
];

export const isAuto = (s: TaxSource) => s !== 'manual';

/** Taxable amount worked out from Wealth for one source and year, in `cur`. */
export function autoBase(data: AppData, source: TaxSource, year: number, cur: string, fx: Fx): number {
  const end = `${year}-12-31`;
  const before = `${year - 1}-12-31`;
  if (source === 'tr' || source === 'ma' || source === 'other') {
    return data.assets
      .filter((a) => a.account === source)
      .reduce((sum, a) => {
        const trades = data.trades.filter((t) => t.assetId === a.id).sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
        const now = position(trades, end);
        const then = position(trades, before);
        const income = now.realized - then.realized + (now.dividends - then.dividends);
        return sum + convert(income, a.currency, cur, fx);
      }, 0);
  }
  if (source === 'stake' || source === 'estate') {
    const platform = source === 'stake' ? 'stake' : 'direct';
    return data.properties
      .filter((p) => p.platform === platform)
      .reduce((sum, p) => {
        const net = data.propertyEntries
          .filter((e) => e.propertyId === p.id && e.date.startsWith(String(year)))
          .reduce((a, e) => a + (e.kind === 'rent' ? e.amount : -e.amount), 0);
        return sum + convert(net, p.currency, cur, fx);
      }, 0);
  }
  return 0;
}

export type ItemFigures = { base: number; estimate: number; due: number; left: number; fromNotice: boolean };

/** Taxable amount, estimate, amount due and what is left to pay for one item. */
export function figures(data: AppData, item: TaxItem, cur: string, fx: Fx): ItemFigures {
  const base = item.base ?? (isAuto(item.source) ? autoBase(data, item.source, item.year, cur, fx) : 0);
  const estimate = Math.max(0, (Math.max(0, base) * item.rate) / 100 - item.withheld);
  const fromNotice = item.dueAmount !== null;
  const due = fromNotice ? (item.dueAmount ?? 0) : estimate;
  return { base, estimate, due, left: Math.max(0, due - item.paid), fromNotice };
}
