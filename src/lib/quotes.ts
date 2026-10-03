import { useCallback, useEffect, useRef, useState } from 'react';

/** Live price and weekly history for a market symbol, from /api/quote (Yahoo Finance). */
export type Quote = { price: number; currency: string; time: number; history: [number, number][] };
export type SymbolHit = { symbol: string; name: string; type: string; exchange: string };

const KEY = 'cockpit.quotes';
const FRESH = 15 * 60_000;

type Cache = { at: number; range: string; quotes: Record<string, Quote> };

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Cache) : null;
  } catch {
    return null;
  }
}
function writeCache(c: Cache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage full or blocked: prices are just fetched again next time */
  }
}

const RANK = ['1mo', '6mo', '1y', '2y', '5y', '10y', 'max'];

/**
 * Prices for `symbols`, refreshed every 15 minutes while the page is open. The last good answer is
 * kept in this browser, so the page shows prices at once and still works offline.
 */
export function useQuotes(symbols: string[], range: string) {
  const key = [...new Set(symbols)].sort().join(',');
  const [state, setState] = useState<{ quotes: Record<string, Quote>; at: number; status: 'idle' | 'loading' | 'ok' | 'error' }>(() => {
    const c = readCache();
    return { quotes: c?.quotes ?? {}, at: c?.at ?? 0, status: 'idle' };
  });
  const busy = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (!key || busy.current) return;
      const c = readCache();
      const covered = c && key.split(',').every((s) => c.quotes[s]) && RANK.indexOf(c.range) >= RANK.indexOf(range);
      if (!force && c && covered && Date.now() - c.at < FRESH) {
        setState({ quotes: c.quotes, at: c.at, status: 'ok' });
        return;
      }
      busy.current = true;
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const r = await fetch(`/api/quote?symbols=${encodeURIComponent(key)}&range=${range}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { quotes?: Record<string, Quote> };
        const quotes = { ...(c?.quotes ?? {}), ...(j.quotes ?? {}) };
        const at = Date.now();
        writeCache({ at, range, quotes });
        setState({ quotes, at, status: Object.keys(j.quotes ?? {}).length ? 'ok' : 'error' });
      } catch {
        setState((s) => ({ ...s, status: 'error' }));
      } finally {
        busy.current = false;
      }
    },
    [key, range],
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && void load(), FRESH);
    return () => window.clearInterval(id);
  }, [load]);

  return { ...state, refresh: () => void load(true) };
}

/** Find a market symbol from a name, ticker or ISIN. */
export async function searchSymbols(q: string): Promise<SymbolHit[]> {
  const r = await fetch(`/api/quote?search=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(String(r.status));
  const j = (await r.json()) as { results?: SymbolHit[] };
  return j.results ?? [];
}

/** Currency of a symbol, from a single quote (to fill in a new asset). */
export async function quoteOnce(symbol: string): Promise<Quote | null> {
  const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbol)}&range=5d`);
  if (!r.ok) return null;
  const j = (await r.json()) as { quotes?: Record<string, Quote> };
  return j.quotes?.[symbol] ?? null;
}
