/*
 * Live market prices for the Wealth page, from Yahoo Finance's public chart and search endpoints.
 * Runs on Vercel as a serverless function (the browser can't call Yahoo directly: no CORS), and in
 * `npm run dev` through the small Vite plugin in vite.config.ts.
 *
 *   /api/quote?symbols=VWCE.DE,BTC-EUR&range=1y   -> { quotes: { SYMBOL: { price, currency, time, history } } }
 *   /api/quote?search=IE00BK5BQT80                 -> { results: [{ symbol, name, type, exchange }] }
 *
 * Only public market data goes through here: nothing about the user is sent.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const RANGES = new Set(['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']);
const SYMBOL = /^[A-Za-z0-9.^=\-]{1,24}$/;

type Quote = { price: number; currency: string; time: number; history: [number, number][] };

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
}

async function chart(symbol: string, range: string): Promise<Quote | null> {
  const interval = range === '5d' || range === '1mo' ? '1d' : '1wk';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div`;
  try {
    const j = (await getJson(url)) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number; currency?: string; regularMarketTime?: number }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const res = j.chart?.result?.[0];
    const price = res?.meta?.regularMarketPrice;
    if (!res || typeof price !== 'number') return null;
    const ts = res.timestamp ?? [];
    const closes = res.indicators?.quote?.[0]?.close ?? [];
    const history: [number, number][] = [];
    ts.forEach((t, i) => {
      const c = closes[i];
      if (typeof c === 'number' && Number.isFinite(c)) history.push([t * 1000, Math.round(c * 1e6) / 1e6]);
    });
    return { price, currency: res.meta?.currency ?? '', time: (res.meta?.regularMarketTime ?? Date.now() / 1000) * 1000, history };
  } catch {
    return null;
  }
}

export async function handle(url: URL): Promise<{ status: number; body: unknown }> {
  const search = url.searchParams.get('search')?.trim();
  if (search) {
    if (search.length > 40) return { status: 400, body: { error: 'query too long' } };
    try {
      const j = (await getJson(
        `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(search)}&quotesCount=8&newsCount=0&listsCount=0`,
      )) as { quotes?: { symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchDisp?: string; exchange?: string }[] };
      const results = (j.quotes ?? [])
        .filter((q) => q.symbol)
        .map((q) => ({ symbol: q.symbol, name: q.longname || q.shortname || q.symbol, type: q.quoteType ?? '', exchange: q.exchDisp || q.exchange || '' }));
      return { status: 200, body: { results } };
    } catch {
      return { status: 502, body: { error: 'search unavailable' } };
    }
  }
  const symbols = (url.searchParams.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SYMBOL.test(s))
    .slice(0, 40);
  if (!symbols.length) return { status: 400, body: { error: 'no symbols' } };
  const range = RANGES.has(url.searchParams.get('range') ?? '') ? (url.searchParams.get('range') as string) : '1y';
  const list = await Promise.all(symbols.map((s) => chart(s, range)));
  const quotes: Record<string, Quote> = {};
  symbols.forEach((s, i) => {
    const q = list[i];
    if (q) quotes[s] = q;
  });
  return { status: 200, body: { quotes } };
}

type Req = { url?: string };
type Res = { status: (n: number) => Res; setHeader: (k: string, v: string) => void; json: (b: unknown) => void };

export default async function handler(req: Req, res: Res) {
  const r = await handle(new URL(req.url ?? '/', 'http://localhost'));
  res.setHeader('Cache-Control', r.status === 200 ? 's-maxage=300, stale-while-revalidate=900' : 'no-store');
  res.status(r.status).json(r.body);
}
