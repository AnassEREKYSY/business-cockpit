import type { AccountKey, AppData, Asset, AssetKind, Property, Trade } from '../types';
import { isoDate, monthKey, shiftMonth } from './format';
import type { Quote } from './quotes';

export const ACCOUNTS: Record<AccountKey, { label: string; currency: string; hint: string }> = {
  tr: { label: 'Trade Republic', currency: 'EUR', hint: 'ETFs, stocks and crypto, live prices' },
  ma: { label: 'Morocco', currency: 'MAD', hint: 'Bourse de Casablanca and OPCVM, prices typed by hand' },
  other: { label: 'Other', currency: 'EUR', hint: 'Any other account' },
};

export const KINDS: { key: AssetKind; label: string }[] = [
  { key: 'etf', label: 'ETF' },
  { key: 'stock', label: 'Stocks' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'opcvm', label: 'OPCVM' },
  { key: 'bond', label: 'Bonds' },
  { key: 'cash', label: 'Cash' },
  { key: 'other', label: 'Other' },
];
export const kindLabel = (k: AssetKind) => KINDS.find((x) => x.key === k)?.label ?? k;

/** 1 EUR = rates[CUR]. Live from the quote feed when available, else the saved fallback. */
export type Fx = Record<string, number>;
export function fxRates(data: AppData, quotes: Record<string, Quote>): Fx {
  return {
    EUR: 1,
    MAD: quotes['EURMAD=X']?.price || data.profile.wealth.eurMad,
    USD: quotes['EURUSD=X']?.price || data.profile.wealth.eurUsd,
  };
}
/** Convert between currencies through EUR. Unknown currencies are taken as EUR. */
export const convert = (amount: number, from: string, to: string, fx: Fx) => (from === to ? amount : (amount / (fx[from] ?? 1)) * (fx[to] ?? 1));

export type Position = {
  qty: number;
  /** Cost of what is still held (average cost method). */
  cost: number;
  realized: number;
  dividends: number;
  fees: number;
  /** Money put in minus money taken out (buys − sells), in the asset currency. */
  netInvested: number;
  firstDate: string;
};

export function position(trades: Trade[], until = '9999-12-31'): Position {
  const p: Position = { qty: 0, cost: 0, realized: 0, dividends: 0, fees: 0, netInvested: 0, firstDate: '' };
  for (const t of trades) {
    if (t.date > until) break;
    if (!p.firstDate) p.firstDate = t.date;
    p.fees += t.fees;
    if (t.side === 'buy') {
      p.qty += t.quantity;
      p.cost += t.quantity * t.price + t.fees;
      p.netInvested += t.quantity * t.price + t.fees;
    } else if (t.side === 'sell') {
      const q = Math.min(t.quantity, p.qty);
      const avg = p.qty ? p.cost / p.qty : 0;
      p.realized += q * (t.price - avg) - t.fees;
      p.cost -= avg * q;
      p.qty -= q;
      p.netInvested -= t.quantity * t.price - t.fees;
    } else {
      p.dividends += t.price - t.fees;
    }
  }
  if (p.qty < 1e-12) {
    p.qty = 0;
    p.cost = 0;
  }
  return p;
}

/** Current price: live quote for assets with a symbol, else the last price typed. */
export function priceNow(a: Asset, quotes: Record<string, Quote>): { price: number; live: boolean; at: string } {
  const q = a.symbol ? quotes[a.symbol] : undefined;
  if (q && q.price > 0) return { price: q.price, live: true, at: new Date(q.time).toISOString() };
  return { price: a.price, live: false, at: a.priceAt };
}

export type Holding = Position & { asset: Asset; price: number; live: boolean; value: number; gain: number; gainPct: number | null };

export function holdings(data: AppData, quotes: Record<string, Quote>, account?: AccountKey): Holding[] {
  return data.assets
    .filter((a) => !account || a.account === account)
    .map((asset) => {
      const pos = position(data.trades.filter((t) => t.assetId === asset.id));
      const { price, live } = priceNow(asset, quotes);
      const value = asset.kind === 'cash' ? pos.qty * (price || 1) : pos.qty * price;
      const gain = value - pos.cost + pos.realized + pos.dividends;
      const base = pos.cost || pos.netInvested;
      return { ...pos, asset, price, live, value, gain, gainPct: base > 0 ? (gain / base) * 100 : null };
    });
}

/** Totals of holdings, converted into `currency`. */
export function totalsOf(list: Holding[], currency: string, fx: Fx) {
  let value = 0;
  let invested = 0;
  let gain = 0;
  let income = 0;
  for (const h of list) {
    const c = h.asset.currency;
    value += convert(h.value, c, currency, fx);
    invested += convert(h.netInvested, c, currency, fx);
    gain += convert(h.gain, c, currency, fx);
    income += convert(h.dividends, c, currency, fx);
  }
  return { value, invested, gain, income, gainPct: invested > 0 ? (gain / invested) * 100 : null };
}

/** History range to ask the feed for, from the first trade date. */
export function rangeFor(first: string): string {
  if (!first) return '1y';
  const days = (Date.now() - Date.parse(first + 'T12:00:00')) / 86_400_000;
  return days < 330 ? '1y' : days < 700 ? '2y' : days < 1800 ? '5y' : 'max';
}

/** Price of an asset on a day: from the live history, else from typed prices and trade prices. */
function priceSeries(a: Asset, data: AppData, quotes: Record<string, Quote>): [string, number][] {
  const q = a.symbol ? quotes[a.symbol] : undefined;
  const pts: [string, number][] = [];
  if (q?.history.length) {
    for (const [t, c] of q.history) pts.push([isoDate(new Date(t)), c]);
    pts.push([isoDate(), q.price]);
  } else {
    for (const p of data.assetPrices) if (p.assetId === a.id) pts.push([p.date, p.price]);
    for (const t of data.trades) if (t.assetId === a.id && t.side !== 'dividend' && t.price > 0) pts.push([t.date, t.price]);
    if (a.price > 0) pts.push([a.priceAt ? a.priceAt.slice(0, 10) : isoDate(), a.price]);
  }
  return pts.sort((x, y) => x[0].localeCompare(y[0]));
}

const at = (pts: [string, number][], day: string) => {
  let v = pts[0]?.[1] ?? 0;
  for (const [d, p] of pts) {
    if (d > day) break;
    v = p;
  }
  return v;
};

/** Weekly value and money invested, in `currency`, from the first trade to today. */
export function valueSeries(data: AppData, assets: Asset[], quotes: Record<string, Quote>, currency: string, fx: Fx): { t: string; values: number[] }[] {
  const ids = new Set(assets.map((a) => a.id));
  const trades = data.trades.filter((t) => ids.has(t.assetId));
  if (!trades.length) return [];
  const start = trades[0].date;
  const prices = new Map(assets.map((a) => [a.id, priceSeries(a, data, quotes)]));
  const byAsset = new Map(assets.map((a) => [a.id, trades.filter((t) => t.assetId === a.id)]));
  const days: string[] = [];
  const end = isoDate();
  const d = new Date(start + 'T12:00:00');
  const span = (Date.now() - d.getTime()) / 86_400_000;
  const step = span > 900 ? 14 : span > 120 ? 7 : span > 30 ? 2 : 1;
  for (; isoDate(d) < end; d.setDate(d.getDate() + step)) days.push(isoDate(d));
  days.push(end);
  return days.map((day) => {
    let value = 0;
    let invested = 0;
    for (const a of assets) {
      const pos = position(byAsset.get(a.id) ?? [], day);
      if (!pos.firstDate) continue;
      const price = a.kind === 'cash' ? 1 : at(prices.get(a.id) ?? [], day);
      value += convert(pos.qty * price, a.currency, currency, fx);
      invested += convert(pos.netInvested, a.currency, currency, fx);
    }
    return { t: day, values: [Math.round(value * 100) / 100, Math.round(invested * 100) / 100] };
  });
}

/* ---------------- Real estate ---------------- */

export type PropertyStats = {
  equity: number;
  cashflow: number;
  grossYield: number | null;
  netYield: number | null;
  appreciation: number;
  /** Net money generated per month, last 12 months (rent − expenses − loan), oldest first. */
  months: { k: string; rent: number; out: number; net: number }[];
  total12: number;
  totalAll: number;
};

export function propertyStats(data: AppData, p: Property): PropertyStats {
  const entries = data.propertyEntries.filter((e) => e.propertyId === p.id);
  const now = monthKey();
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(now, i - 11)).map((k) => {
    const mine = entries.filter((e) => e.date.startsWith(k));
    const rent = mine.filter((e) => e.kind === 'rent').reduce((a, e) => a + e.amount, 0);
    const out = mine.filter((e) => e.kind !== 'rent').reduce((a, e) => a + e.amount, 0);
    return { k, rent, out, net: rent - out };
  });
  const totalAll = entries.reduce((a, e) => a + (e.kind === 'rent' ? e.amount : -e.amount), 0);
  const base = p.purchasePrice || p.value;
  return {
    equity: p.value - p.debt,
    cashflow: p.rent - p.charges - p.loan,
    grossYield: base ? ((p.rent * 12) / base) * 100 : null,
    netYield: base ? (((p.rent - p.charges) * 12) / base) * 100 : null,
    appreciation: p.purchasePrice ? p.value - p.purchasePrice : 0,
    months,
    total12: months.reduce((a, x) => a + x.net, 0),
    totalAll,
  };
}
