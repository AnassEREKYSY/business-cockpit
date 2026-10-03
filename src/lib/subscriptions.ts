import type { SubCycle, Subscription } from '../types';
import { isoDate } from './format';

export const SUB_CATEGORIES = [
  'AI tools', 'Software', 'Hosting & domains', 'Cloud storage', 'Streaming & music', 'Shopping',
  'Phone & internet', 'Sport & health', 'Insurance', 'Housing & bills', 'Transport', 'Education', 'Other',
];

export const CYCLES: { key: SubCycle; label: string; perMonth: number }[] = [
  { key: 'weekly', label: 'Weekly', perMonth: 52 / 12 },
  { key: 'monthly', label: 'Monthly', perMonth: 1 },
  { key: 'quarterly', label: 'Every 3 months', perMonth: 1 / 3 },
  { key: 'yearly', label: 'Yearly', perMonth: 1 / 12 },
];
export const cycleLabel = (c: SubCycle) => CYCLES.find((x) => x.key === c)?.label ?? c;
export const SUB_CURRENCIES = ['EUR', 'USD', 'MAD', 'AED'];

/** Well-known services: picking one fills the name, category, currency and colour (never the price). */
export const PRESETS: { name: string; category: string; currency: string; scope: Subscription['scope']; color: string }[] = [
  { name: 'ChatGPT Plus', category: 'AI tools', currency: 'USD', scope: 'business', color: '#10a37f' },
  { name: 'Claude Pro', category: 'AI tools', currency: 'USD', scope: 'business', color: '#d97757' },
  { name: 'GitHub Copilot', category: 'Software', currency: 'USD', scope: 'business', color: '#24292f' },
  { name: 'Cursor', category: 'Software', currency: 'USD', scope: 'business', color: '#3b3b3b' },
  { name: 'OVH', category: 'Hosting & domains', currency: 'EUR', scope: 'business', color: '#123f6d' },
  { name: 'Vercel', category: 'Hosting & domains', currency: 'USD', scope: 'business', color: '#111111' },
  { name: 'Google Workspace', category: 'Software', currency: 'EUR', scope: 'business', color: '#4285f4' },
  { name: 'Microsoft 365', category: 'Software', currency: 'EUR', scope: 'business', color: '#d83b01' },
  { name: 'Notion', category: 'Software', currency: 'USD', scope: 'business', color: '#2f2f2f' },
  { name: 'Canva', category: 'Software', currency: 'EUR', scope: 'business', color: '#00c4cc' },
  { name: 'Upwork Freelancer Plus', category: 'Software', currency: 'USD', scope: 'business', color: '#14a800' },
  { name: 'LinkedIn Premium', category: 'Software', currency: 'EUR', scope: 'business', color: '#0a66c2' },
  { name: 'Amazon Prime', category: 'Shopping', currency: 'EUR', scope: 'personal', color: '#ff9900' },
  { name: 'Netflix', category: 'Streaming & music', currency: 'EUR', scope: 'personal', color: '#e50914' },
  { name: 'Spotify', category: 'Streaming & music', currency: 'EUR', scope: 'personal', color: '#1db954' },
  { name: 'YouTube Premium', category: 'Streaming & music', currency: 'EUR', scope: 'personal', color: '#ff0000' },
  { name: 'Disney+', category: 'Streaming & music', currency: 'EUR', scope: 'personal', color: '#113ccf' },
  { name: 'Apple iCloud+', category: 'Cloud storage', currency: 'EUR', scope: 'personal', color: '#3693f3' },
  { name: 'Google One', category: 'Cloud storage', currency: 'EUR', scope: 'personal', color: '#34a853' },
  { name: 'Phone plan', category: 'Phone & internet', currency: 'EUR', scope: 'personal', color: '#7a5ea8' },
  { name: 'Internet box', category: 'Phone & internet', currency: 'EUR', scope: 'personal', color: '#5b6b7a' },
  { name: 'Gym', category: 'Sport & health', currency: 'EUR', scope: 'personal', color: '#c4626a' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

/** Every payment date from the start, up to `until` (and the cancel date). */
export function paymentDates(s: Subscription, until: string): string[] {
  const out: string[] = [];
  if (!s.start) return out;
  const stop = s.end && s.end < until ? s.end : until;
  const [y0, m0, d0] = s.start.split('-').map(Number);
  if (s.cycle === 'weekly') {
    const d = new Date(y0, m0 - 1, d0, 12);
    for (let i = 0; i < 2000; i++) {
      const iso = isoDate(d);
      if (iso > stop) break;
      out.push(iso);
      d.setDate(d.getDate() + 7);
    }
    return out;
  }
  const step = s.cycle === 'monthly' ? 1 : s.cycle === 'quarterly' ? 3 : 12;
  for (let i = 0; i < 1200; i++) {
    const total = m0 - 1 + i * step;
    const y = y0 + Math.floor(total / 12);
    const m = (total % 12) + 1;
    const iso = `${y}-${pad(m)}-${pad(Math.min(d0, daysIn(y, m)))}`;
    if (iso > stop) break;
    out.push(iso);
  }
  return out;
}

export const isActive = (s: Subscription, today = isoDate()) => !s.end || s.end >= today;
export const monthlyOf = (s: Subscription) => s.amount * (CYCLES.find((c) => c.key === s.cycle)?.perMonth ?? 1);

/** Next payment on or after today, or '' when cancelled. */
export function nextPayment(s: Subscription, today = isoDate()): string {
  if (!isActive(s, today)) return '';
  if (s.start >= today) return s.start;
  // Far enough ahead to always contain one more payment.
  const ahead = new Date(today + 'T12:00:00');
  ahead.setDate(ahead.getDate() + 400);
  return paymentDates(s, isoDate(ahead)).find((d) => d >= today) ?? '';
}

/** Money paid so far (payments up to today). */
export function paidSoFar(s: Subscription, today = isoDate()) {
  const n = paymentDates(s, today).length;
  return { count: n, total: n * s.amount };
}

export const daysUntil = (iso: string, today = isoDate()) => Math.round((Date.parse(iso + 'T12:00:00') - Date.parse(today + 'T12:00:00')) / 86_400_000);
