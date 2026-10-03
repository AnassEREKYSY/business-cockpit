import type { TaxActivity, TaxSettings, Txn } from '../types';

/*
 * Micro-entreprise (France) contributions on revenue, 2026 rates, as % of what is cashed in:
 *   - social contributions (URSSAF), halved during ACRE for businesses started before 1 July 2026
 *     (ACRE runs to the end of the 3rd calendar quarter after the start quarter),
 *   - contribution à la formation professionnelle (CFP),
 *   - versement libératoire de l'impôt sur le revenu (optional).
 * Every value stays editable in Data & profile: rates change every year.
 */
export const TAX_PRESETS: Record<Exclude<TaxActivity, 'custom'>, { label: string; social: number; acre: number; cfp: number; vl: number }> = {
  bic_services: { label: 'BIC · services (prestations de services)', social: 21.2, acre: 10.6, cfp: 0.1, vl: 1.7 },
  bnc: { label: 'BNC · professions libérales (SSI)', social: 25.6, acre: 12.8, cfp: 0.2, vl: 2.2 },
  bic_sales: { label: 'BIC · sales of goods (vente)', social: 12.3, acre: 6.2, cfp: 0.1, vl: 1.0 },
};

/** Started in April 2026 with ACRE (50 %, to 31 March 2027) and the versement libératoire. */
export const DEFAULT_TAX: TaxSettings = {
  activity: 'bic_services', start: '2026-04-01', acreUntil: '2027-03-31', ...pick(TAX_PRESETS.bic_services), period: 'quarter', firstEnd: '',
};

function pick(p: { social: number; acre: number; cfp: number; vl: number }) {
  return { social: p.social, acre: p.acre, cfp: p.cfp, vl: p.vl };
}

/** Last day of ACRE for a start date: end of the 3rd calendar quarter after the start quarter. */
export function acreEnd(start: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return '';
  const [y, m] = start.split('-').map(Number);
  const q = Math.floor((m - 1) / 3); // 0..3
  const endQ = q + 3; // 3 full quarters after the start quarter
  const ey = y + Math.floor(endQ / 4);
  const eq = endQ % 4;
  const lastMonth = eq * 3 + 3;
  const lastDay = new Date(ey, lastMonth, 0).getDate();
  return `${ey}-${String(lastMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/** Revenue categories that are business turnover (taxed). Trading, investments and rents are not. */
const UNTAXED = new Set(['Trading', 'Investment', 'Real estate']);
export const isTaxable = (t: Pick<Txn, 'type' | 'category'>) => t.type === 'revenue' && !UNTAXED.has(t.category);

export type TaxRate = { social: number; cfp: number; vl: number; total: number; acre: boolean };

/** Rates that apply to revenue cashed in on `date`. */
export function rateOn(tax: TaxSettings, date: string): TaxRate {
  const acre = !!tax.acreUntil && date <= tax.acreUntil && (!tax.start || date >= tax.start);
  const social = acre ? tax.acre : tax.social;
  return { social, cfp: tax.cfp, vl: tax.vl, total: social + tax.cfp + tax.vl, acre };
}

export type TaxBreakdown = { gross: number; social: number; cfp: number; vl: number; total: number; net: number };

/** Taxes on a list of transactions: only taxable revenue counts. */
export function taxesOn(list: Txn[], tax: TaxSettings): TaxBreakdown {
  const out = { gross: 0, social: 0, cfp: 0, vl: 0, total: 0, net: 0 };
  for (const t of list) {
    if (!isTaxable(t)) continue;
    const r = rateOn(tax, t.date);
    out.gross += t.amount;
    out.social += (t.amount * r.social) / 100;
    out.cfp += (t.amount * r.cfp) / 100;
    out.vl += (t.amount * r.vl) / 100;
  }
  out.total = out.social + out.cfp + out.vl;
  out.net = out.gross - out.total;
  return out;
}

/** Tax on one revenue line (0 when not taxable). */
export const taxOf = (t: Pick<Txn, 'type' | 'category' | 'date' | 'amount'>, tax: TaxSettings) =>
  isTaxable(t) ? (t.amount * rateOn(tax, t.date).total) / 100 : 0;
