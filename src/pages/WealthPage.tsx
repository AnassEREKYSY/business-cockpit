import { useEffect, useMemo, useState } from 'react';
import { DatePicker } from '../components/Calendar';
import { CAT, Donut, HBars, LineChart, compactMoney } from '../components/Charts';
import { Select } from '../components/Select';
import { useToast } from '../components/Toast';
import { Field, IconPencil, IconPlus, IconSearch, Modal, Seg } from '../components/ui';
import { parseAmount } from '../lib/finance';
import { fmtDate, fmtMonth, isoDate, money, monthKey, pct, uid } from '../lib/format';
import { quoteOnce, searchSymbols, useQuotes, type Quote, type SymbolHit } from '../lib/quotes';
import { isDay } from '../lib/store';
import { removeAsset, removeProperty, removeRow } from '../lib/undo';
import {
  ACCOUNTS, KINDS, convert, fxRates, holdings, kindLabel, propertyStats, rangeFor, totalsOf, valueSeries, type Fx, type Holding,
} from '../lib/wealth';
import type { AccountKey, AppData, Asset, AssetKind, Property, PropertyEntry, Trade } from '../types';

type Update = (fn: (d: AppData) => AppData) => void;
type Tab = 'overview' | AccountKey | 'estate';

const TAB_KEY = 'cockpit.wealthTab';
const KIND_COLOR: Record<AssetKind, string> = {
  etf: CAT[0], stock: CAT[1], crypto: CAT[3], opcvm: CAT[2], bond: CAT[6], cash: 'var(--c-exp)', other: CAT[4],
};
const fmtMoney = (n: number, c: string) => money(n, c);
const fmtQty = (n: number) => (Math.abs(n) >= 100 ? n.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : n.toLocaleString('en-GB', { maximumFractionDigits: 6 }));
const fmtPrice = (n: number, c: string) => {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c, maximumFractionDigits: n < 10 ? 4 : 2 }).format(n);
  } catch {
    return `${n} ${c}`;
  }
};
const signed = (n: number, c: string) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtMoney(Math.abs(n), c);
const tone = (n: number) => (n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : undefined);

export default function WealthPage({ data, update }: { data: AppData; update: Update }) {
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab) || 'overview';
    } catch {
      return 'overview';
    }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* not remembered */
    }
  };
  const first = data.trades[0]?.date ?? '';
  const symbols = useMemo(() => [...data.assets.filter((a) => a.symbol).map((a) => a.symbol), 'EURMAD=X', 'EURUSD=X'], [data.assets]);
  const feed = useQuotes(symbols, rangeFor(first));
  const fx = fxRates(data, feed.quotes);

  // Keep the last live price on the asset, once a day, so other devices and offline views stay recent.
  useEffect(() => {
    const stale = data.assets.filter((a) => {
      const q = a.symbol ? feed.quotes[a.symbol] : undefined;
      return q && q.price > 0 && (!a.priceAt || Date.now() - Date.parse(a.priceAt) > 12 * 3_600_000);
    });
    if (!stale.length) return;
    const ids = new Set(stale.map((a) => a.id));
    update((d) => ({
      ...d,
      assets: d.assets.map((a) => (ids.has(a.id) && feed.quotes[a.symbol] ? { ...a, price: feed.quotes[a.symbol].price, priceAt: new Date().toISOString() } : a)),
    }));
  }, [feed.quotes, data.assets, update]);

  const liveCount = data.assets.filter((a) => a.symbol && feed.quotes[a.symbol]).length;
  const autoCount = data.assets.filter((a) => a.symbol).length;

  return (
    <section className="section loose">
      <div className="head">
        <div className="head-title">
          <h1>Wealth</h1>
          <span className="sub">Investments and real estate</span>
        </div>
        <div className="row">
          {autoCount > 0 && (
            <span className={'feed-status' + (feed.status === 'error' ? ' is-error' : '')} title={feed.at ? `Updated ${new Date(feed.at).toLocaleTimeString()}` : undefined}>
              <span className="sync-dot" style={{ background: feed.status === 'error' ? 'var(--red-2)' : feed.status === 'loading' ? 'var(--amber)' : 'var(--green-2)' }} />
              {feed.status === 'loading' ? 'Updating prices…' : feed.status === 'error' ? 'Live prices unavailable' : `${liveCount}/${autoCount} live`}
            </span>
          )}
          {autoCount > 0 && <button className="btn sm outline" onClick={feed.refresh}>Refresh</button>}
        </div>
      </div>

      <Seg
        label="Section"
        value={tab}
        onChange={setTab}
        options={[['overview', 'Overview'], ['tr', 'Trade Republic'], ['ma', 'Morocco'], ['estate', 'Real estate'], ...(data.assets.some((a) => a.account === 'other') ? [['other', 'Other'] as [Tab, string]] : [])]}
      />

      <div className="page-tab" key={tab}>
        {tab === 'overview' && <Overview data={data} quotes={feed.quotes} fx={fx} setTab={setTab} />}
        {(tab === 'tr' || tab === 'ma' || tab === 'other') && <Account data={data} update={update} account={tab} quotes={feed.quotes} fx={fx} />}
        {tab === 'estate' && <RealEstate data={data} update={update} fx={fx} />}
      </div>
    </section>
  );
}

/* ---------------- Overview ---------------- */

function Overview({ data, quotes, fx, setTab }: { data: AppData; quotes: Record<string, Quote>; fx: Fx; setTab: (t: Tab) => void }) {
  const cur = data.profile.currency;
  const m = (n: number) => fmtMoney(n, cur);
  const all = holdings(data, quotes);
  const inv = totalsOf(all, cur, fx);
  const props = data.properties.map((p) => ({ p, s: propertyStats(data, p) }));
  const estateValue = props.reduce((a, x) => a + convert(x.p.value, x.p.currency, cur, fx), 0);
  const estateDebt = props.reduce((a, x) => a + convert(x.p.debt, x.p.currency, cur, fx), 0);
  const estateCash = props.reduce((a, x) => a + convert(x.s.cashflow, x.p.currency, cur, fx), 0);
  const net = inv.value + estateValue - estateDebt;
  const accounts = (Object.keys(ACCOUNTS) as AccountKey[])
    .map((k) => ({ k, t: totalsOf(all.filter((h) => h.asset.account === k), cur, fx) }))
    .filter((x) => x.t.value || x.t.invested);
  const byKind = KINDS.map((k) => ({
    id: k.key, label: k.label, color: KIND_COLOR[k.key],
    value: all.filter((h) => h.asset.kind === k.key).reduce((a, h) => a + convert(h.value, h.asset.currency, cur, fx), 0),
  })).filter((x) => x.value > 0);
  const slices = [...byKind, ...(estateValue - estateDebt > 0 ? [{ id: 'estate', label: 'Real estate (equity)', color: CAT[5], value: estateValue - estateDebt }] : [])];
  const series = valueSeries(data, data.assets, quotes, cur, fx);

  if (!data.assets.length && !data.properties.length) {
    return (
      <div className="empty wealth-empty">
        <b>Track everything you own in one place.</b>
        <span>Add your Trade Republic positions (live prices), your Moroccan stocks and OPCVM, and your rentals.</span>
        <div className="row" style={{ justifyContent: 'center', gap: '0.5rem' }}>
          <button className="btn sm" onClick={() => setTab('tr')}>Trade Republic</button>
          <button className="btn sm outline" onClick={() => setTab('ma')}>Morocco</button>
          <button className="btn sm outline" onClick={() => setTab('estate')}>Real estate</button>
        </div>
      </div>
    );
  }

  return (
    <div className="section loose">
      <div className="kpis">
        <div className="kpi kpi-accent">
          <div className="kpi-k">Net worth</div>
          <div className="kpi-v">{m(net)}</div>
          <div className="kpi-s">Investments + real estate − loans</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Investments</div>
          <div className="kpi-v">{m(inv.value)}</div>
          <div className="kpi-s" style={{ color: tone(inv.gain) }}>{signed(inv.gain, cur)}{inv.gainPct !== null ? ` · ${pct(inv.gainPct)}` : ''}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Real estate equity</div>
          <div className="kpi-v">{m(estateValue - estateDebt)}</div>
          <div className="kpi-s">{m(estateValue)} value · {m(estateDebt)} owed</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Passive income / month</div>
          <div className="kpi-v" style={{ color: tone(estateCash) }}>{m(estateCash)}</div>
          <div className="kpi-s">Rent cash flow{inv.income ? ` · ${m(inv.income)} dividends so far` : ''}</div>
        </div>
      </div>

      <div className="grid-2 stretch">
        <div className="card" style={{ gap: '1rem' }}>
          <div className="card-title">Allocation</div>
          <Donut slices={slices} format={m} center={<><b>{m(net)}</b><span>net worth</span></>} />
        </div>
        <div className="card" style={{ gap: '1rem' }}>
          <div className="card-title">By account</div>
          <HBars
            format={m}
            items={[
              ...accounts.map((a, i) => ({
                id: a.k, label: ACCOUNTS[a.k].label, value: a.t.value, color: CAT[i], onClick: () => setTab(a.k),
                sub: <span style={{ color: tone(a.t.gain) }}>{signed(a.t.gain, cur)}{a.t.gainPct !== null ? ` · ${pct(a.t.gainPct)}` : ''}</span>,
              })),
              ...(props.length
                ? [{ id: 'estate', label: 'Real estate (equity)', value: estateValue - estateDebt, color: CAT[5], onClick: () => setTab('estate'), sub: `${props.length} ${props.length === 1 ? 'property' : 'properties'}` }]
                : []),
            ]}
          />
          <div className="small">Moroccan dirhams converted at 1 € = {fx.MAD.toFixed(2)} MAD.</div>
        </div>
      </div>

      {series.length > 1 && (
        <div className="card" style={{ gap: '0.75rem' }}>
          <div className="head">
            <div className="card-title">Investments over time</div>
            <span className="small">All accounts, in {cur}</span>
          </div>
          <LineChart
            points={series}
            lines={[{ label: 'Value', color: 'var(--ink)', area: true }, { label: 'Invested', color: 'var(--muted)', dashed: true }]}
            format={(n) => compactMoney(n, cur)}
            formatT={(t) => fmtDate(t, false)}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------- One account (Trade Republic, Morocco) ---------------- */

function Account({ data, update, account, quotes, fx }: { data: AppData; update: Update; account: AccountKey; quotes: Record<string, Quote>; fx: Fx }) {
  const meta = ACCOUNTS[account];
  const cur = meta.currency;
  const m = (n: number) => fmtMoney(n, cur);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [pricing, setPricing] = useState(false);
  const list = holdings(data, quotes, account);
  const t = totalsOf(list, cur, fx);
  const assets = data.assets.filter((a) => a.account === account);
  const series = valueSeries(data, assets, quotes, cur, fx);
  const byKind = KINDS.map((k) => ({
    id: k.key, label: k.label, color: KIND_COLOR[k.key],
    value: list.filter((h) => h.asset.kind === k.key).reduce((a, h) => a + convert(h.value, h.asset.currency, cur, fx), 0),
  })).filter((x) => x.value > 0);
  const manual = assets.filter((a) => !a.symbol && a.kind !== 'cash');
  const held = list.filter((h) => h.qty > 0 || h.value > 0).sort((a, b) => convert(b.value, b.asset.currency, cur, fx) - convert(a.value, a.asset.currency, cur, fx));
  const closed = list.filter((h) => h.qty === 0 && h.value === 0);

  const newAsset = (): Asset => ({
    id: uid(), account, name: '', symbol: '', isin: '', kind: account === 'ma' ? 'stock' : 'etf', currency: cur, price: 0, priceAt: '',
    position: data.assets.reduce((a, x) => Math.max(a, x.position), -1) + 1,
  });

  return (
    <div className="section loose">
      <div className="head">
        <div>
          <h2>{meta.label}</h2>
          <span className="sub">{meta.hint}</span>
        </div>
        <div className="row">
          {manual.length > 0 && <button className="btn outline" onClick={() => setPricing(true)}>Update prices</button>}
          <button className="btn" onClick={() => setEditing(newAsset())}>+ Add an asset</button>
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="empty wealth-empty">
          <b>No {meta.label} assets yet.</b>
          <span>
            {account === 'tr'
              ? 'Add an ETF, a stock or a crypto: search it by name, ticker or ISIN to get live prices, then log your buys.'
              : 'Add your Moroccan stocks and OPCVM funds, log your buys, and type the latest price or NAV from time to time.'}
          </span>
          <button className="btn sm" style={{ alignSelf: 'center' }} onClick={() => setEditing(newAsset())}>+ Add an asset</button>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi kpi-accent">
              <div className="kpi-k">Value</div>
              <div className="kpi-v">{m(t.value)}</div>
              <div className="kpi-s">{cur !== data.profile.currency ? `≈ ${fmtMoney(convert(t.value, cur, data.profile.currency, fx), data.profile.currency)}` : `${held.length} positions`}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Invested</div>
              <div className="kpi-v">{m(t.invested)}</div>
              <div className="kpi-s">Buys − sells, fees included</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Total gain</div>
              <div className="kpi-v" style={{ color: tone(t.gain) }}>{signed(t.gain, cur)}</div>
              <div className="kpi-s" style={{ color: tone(t.gain) }}>{t.gainPct !== null ? pct(t.gainPct) : '—'} · gains + dividends</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Dividends</div>
              <div className="kpi-v">{m(t.income)}</div>
              <div className="kpi-s">Received so far</div>
            </div>
          </div>

          <div className="grid-2 stretch">
            <div className="card" style={{ gap: '0.75rem' }}>
              <div className="head">
                <div className="card-title">Performance</div>
                <span className="small">Value vs money invested</span>
              </div>
              <LineChart
                points={series}
                lines={[{ label: 'Value', color: 'var(--ink)', area: true }, { label: 'Invested', color: 'var(--muted)', dashed: true }]}
                format={(n) => compactMoney(n, cur)}
                formatT={(d) => fmtDate(d)}
              />
            </div>
            <div className="card" style={{ gap: '1rem' }}>
              <div className="card-title">Composition</div>
              <Donut slices={byKind} format={m} center={<><b>{byKind.length}</b><span>{byKind.length === 1 ? 'class' : 'classes'}</span></>} />
            </div>
          </div>

          <div className="card" style={{ gap: '0.375rem' }}>
            <div className="head">
              <div className="card-title">Positions</div>
              <span className="small">Click a line for its operations</span>
            </div>
            <div className="table-wrap">
              <div className="trow th t-hold">
                <span>Asset</span><span className="r">Quantity</span><span className="r">Avg. cost</span><span className="r">Price</span>
                <span className="r">Value</span><span className="r">Gain</span><span className="r">Weight</span>
              </div>
              {held.map((h) => <HoldingRow key={h.asset.id} h={h} total={t.value} cur={cur} fx={fx} onClick={() => setEditing(h.asset)} />)}
              {closed.length > 0 && <div className="trow-sep">Sold or empty</div>}
              {closed.map((h) => <HoldingRow key={h.asset.id} h={h} total={t.value} cur={cur} fx={fx} onClick={() => setEditing(h.asset)} />)}
            </div>
          </div>
        </>
      )}

      {editing && <AssetModal asset={editing} data={data} update={update} quotes={quotes} onClose={() => setEditing(null)} />}
      {pricing && <PricesModal assets={manual} data={data} update={update} onClose={() => setPricing(false)} />}
    </div>
  );
}

function HoldingRow({ h, total, cur, fx, onClick }: { h: Holding; total: number; cur: string; fx: Fx; onClick: () => void }) {
  const c = h.asset.currency;
  const w = total ? (convert(h.value, c, cur, fx) / total) * 100 : 0;
  return (
    <button type="button" className={'trow t-hold t-click' + (h.qty === 0 ? ' stopped' : '')} onClick={onClick}>
      <span className="hold-name">
        <span className="swatch" style={{ background: KIND_COLOR[h.asset.kind] }} />
        <span style={{ minWidth: 0 }}>
          <b className="ellipsis">{h.asset.name}</b>
          <span className="small ellipsis">
            {kindLabel(h.asset.kind)}{h.asset.symbol ? ` · ${h.asset.symbol}` : ''}{h.live ? ' · live' : h.asset.priceAt ? ` · price of ${fmtDate(h.asset.priceAt.slice(0, 10), true)}` : ''}
          </span>
        </span>
      </span>
      <span className="r">{fmtQty(h.qty)}</span>
      <span className="r" style={{ color: 'var(--ink-2)' }}>{h.qty ? fmtPrice(h.cost / h.qty, c) : '—'}</span>
      <span className="r">{h.price ? fmtPrice(h.price, c) : '—'}{h.live && <span className="live-dot small-dot" title="Live price" />}</span>
      <b className="r">{fmtMoney(h.value, c)}</b>
      <span className="r" style={{ color: tone(h.gain), fontWeight: 600 }}>
        {signed(h.gain, c)}
        {h.gainPct !== null && <span className="small" style={{ display: 'block', color: tone(h.gain) }}>{pct(h.gainPct)}</span>}
      </span>
      <span className="r">
        <span className="weight"><span style={{ width: `${Math.min(100, w)}%`, background: KIND_COLOR[h.asset.kind] }} /></span>
        <span className="small">{w.toFixed(1)}%</span>
      </span>
    </button>
  );
}

/* ---------------- Asset form, with its operations ---------------- */

const SIDE_OPTIONS = [
  { value: 'buy' as const, label: 'Buy' },
  { value: 'sell' as const, label: 'Sell' },
  { value: 'dividend' as const, label: 'Dividend' },
];
const KIND_OPTIONS = KINDS.map((k) => ({ value: k.key, label: k.label, color: KIND_COLOR[k.key] }));
const ACCOUNT_OPTIONS = (Object.keys(ACCOUNTS) as AccountKey[]).map((k) => ({ value: k, label: ACCOUNTS[k].label }));
const CURRENCY_OPTIONS = ['EUR', 'MAD', 'USD'].map((c) => ({ value: c, label: c }));

/** Positive number with up to 8 decimals ("0.025", "1 250,5"). */
function parseNum(raw: string): number | null {
  const s = raw.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,8})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function AssetModal({ asset, data, update, quotes, onClose }: { asset: Asset; data: AppData; update: Update; quotes: Record<string, Quote>; onClose: () => void }) {
  const creating = !data.assets.some((a) => a.id === asset.id);
  const [f, setF] = useState(asset);
  const [price, setPrice] = useState(asset.price ? String(asset.price) : '');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SymbolHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const toast = useToast();
  const trades = data.trades.filter((t) => t.assetId === asset.id).sort((a, b) => b.date.localeCompare(a.date));
  const priceValue = price.trim() ? parseNum(price) : 0;
  const live = f.symbol ? quotes[f.symbol] : undefined;

  const search = async () => {
    const query = q.trim() || f.isin || f.name;
    if (!query) return;
    setSearching(true);
    setSearchError('');
    try {
      setHits(await searchSymbols(query));
    } catch {
      setHits([]);
      setSearchError('Search is unavailable right now (it works once the site is online on Vercel). You can type the symbol yourself.');
    } finally {
      setSearching(false);
    }
  };
  const pick = async (h: SymbolHit) => {
    const kind: AssetKind = h.type === 'ETF' ? 'etf' : h.type === 'CRYPTOCURRENCY' ? 'crypto' : h.type === 'MUTUALFUND' ? 'opcvm' : h.type === 'EQUITY' ? 'stock' : f.kind;
    setF({ ...f, symbol: h.symbol, name: f.name || h.name, kind });
    setHits(null);
    const qq = await quoteOnce(h.symbol).catch(() => null);
    if (qq) {
      setF((x) => ({ ...x, currency: qq.currency || x.currency }));
      setPrice(String(qq.price));
    }
  };

  const save = () => {
    const name = f.name.trim();
    if (!name || priceValue === null) return;
    const next: Asset = {
      ...f, name, symbol: f.symbol.trim().toUpperCase(), isin: f.isin.trim().toUpperCase(),
      price: priceValue || f.price, priceAt: priceValue && priceValue !== asset.price ? new Date().toISOString() : f.priceAt,
    };
    // A new manual price also goes into the price history (one point per day), for the performance chart.
    const point = !next.symbol && priceValue && priceValue !== asset.price ? { id: uid(), assetId: next.id, date: isoDate(), price: priceValue } : null;
    update((d) => ({
      ...d,
      assets: creating ? [...d.assets, next] : d.assets.map((a) => (a.id === next.id ? next : a)),
      assetPrices: point ? [...d.assetPrices.filter((p) => !(p.assetId === next.id && p.date === point.date)), point] : d.assetPrices,
    }));
    toast(creating ? <><b>{name}</b> added. Now log your first buy.</> : <><b>{name}</b> saved</>, { tone: 'success' });
    if (!creating) onClose();
  };
  const remove = () => {
    const { restore } = removeAsset(data, asset.id);
    update((d) => removeAsset(d, asset.id).data);
    toast(<><b>{asset.name}</b> and its operations deleted</>, { undo: () => update(restore) });
    onClose();
  };
  const saved = data.assets.some((a) => a.id === asset.id);

  return (
    <Modal title={saved ? f.name || 'Asset' : 'New asset'} onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {f.account === 'tr' || f.account === 'other' ? (
          <div className="symbol-search">
            <div className="row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
              <label className="search" style={{ maxWidth: 'none' }}>
                <IconSearch />
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void search())} placeholder="Search by name, ticker or ISIN (e.g. IE00BK5BQT80)" aria-label="Search a market symbol" />
              </label>
              <button type="button" className="btn sm outline" onClick={() => void search()} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
            </div>
            {hits && (
              <div className="etf-hits">
                {hits.map((h) => (
                  <button type="button" key={h.symbol} className="etf-hit" onClick={() => void pick(h)}>
                    <span className="etf-hit-name">{h.name}</span>
                    <span className="small">{h.symbol} · {h.type} · {h.exchange}</span>
                  </button>
                ))}
                {hits.length === 0 && !searchError && <div className="small">Nothing found. Try the ISIN or the ticker.</div>}
              </div>
            )}
            {searchError && <div className="small" style={{ color: 'var(--amber)' }}>{searchError}</div>}
          </div>
        ) : (
          <div className="small">Moroccan prices aren't available from a free live feed: type the latest price (or NAV for an OPCVM) here or with "Update prices". Each update is kept to draw the performance.</div>
        )}

        <div className="form-grid">
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Vanguard FTSE All-World" /></Field>
          <Field label="Type"><Select value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={KIND_OPTIONS} ariaLabel="Type" /></Field>
          <Field label="Account"><Select value={f.account} onChange={(account) => setF({ ...f, account, currency: ACCOUNTS[account].currency })} options={ACCOUNT_OPTIONS} ariaLabel="Account" /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(currency) => setF({ ...f, currency })} options={CURRENCY_OPTIONS} ariaLabel="Currency" /></Field>
          <Field label="Live symbol (optional)"><input className="input" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} placeholder="VWCE.DE, BTC-EUR…" /></Field>
          <Field label="ISIN (optional)"><input className="input" value={f.isin} onChange={(e) => setF({ ...f, isin: e.target.value.toUpperCase() })} /></Field>
          <Field label={f.symbol ? `Last price (${f.currency}), auto` : `Current price (${f.currency})`}>
            <input className="input" inputMode="decimal" value={live ? String(live.price) : price} disabled={!!live} onChange={(e) => setPrice(e.target.value)} placeholder={f.kind === 'cash' ? '1' : '0'} />
          </Field>
        </div>
        {priceValue === null && <div className="small form-error">Invalid price. Example: 1640 or 0.5432</div>}

        <div className="modal-foot">
          {saved ? <button className="btn sm danger" type="button" onClick={remove}>Delete asset</button> : <span />}
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>{saved ? 'Close' : 'Cancel'}</button>
            <button className="btn sm" type="submit" disabled={!f.name.trim() || priceValue === null}>{saved ? 'Save' : 'Add asset'}</button>
          </div>
        </div>
      </form>

      {saved && <Operations asset={data.assets.find((a) => a.id === asset.id) ?? f} trades={trades} data={data} update={update} />}
    </Modal>
  );
}

function Operations({ asset, trades, data, update }: { asset: Asset; trades: Trade[]; data: AppData; update: Update }) {
  const [side, setSide] = useState<Trade['side']>('buy');
  const [date, setDate] = useState(isoDate());
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState(asset.price ? String(asset.price) : '');
  const [fees, setFees] = useState('');
  const toast = useToast();
  const c = asset.currency;
  const q = side === 'dividend' ? 0 : parseNum(qty);
  const p = parseNum(price);
  const fe = fees.trim() ? parseNum(fees) : 0;
  const valid = isDay(date) && p !== null && p > 0 && fe !== null && (side === 'dividend' || (q !== null && q > 0));
  const held = trades.reduce((a, t) => a + (t.side === 'buy' ? t.quantity : t.side === 'sell' ? -t.quantity : 0), 0);

  const add = () => {
    if (!valid || p === null || fe === null) return;
    const t: Trade = { id: uid(), assetId: asset.id, date, side, quantity: side === 'dividend' ? 0 : q ?? 0, price: p, fees: fe };
    update((d) => ({ ...d, trades: [...d.trades, t].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) }));
    const total = side === 'dividend' ? p : (q ?? 0) * p;
    toast(<>{side === 'buy' ? 'Buy' : side === 'sell' ? 'Sell' : 'Dividend'} of <b>{fmtMoney(total, c)}</b> logged</>, {
      undo: () => update((d) => ({ ...d, trades: d.trades.filter((x) => x.id !== t.id) })),
    });
    setQty('');
    setFees('');
  };
  const remove = (t: Trade) => {
    const { restore } = removeRow(data, 'trades', t.id);
    update((d) => removeRow(d, 'trades', t.id).data);
    toast('Operation deleted', {
      undo: () => update((d) => {
        const r = restore(d);
        return { ...r, trades: [...r.trades].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) };
      }),
    });
  };

  return (
    <div className="ops">
      <div className="checklist-head">
        <span className="card-title">Operations</span>
        <span className="small">{fmtQty(held)} held · {trades.length} {trades.length === 1 ? 'operation' : 'operations'}</span>
      </div>
      <form className="op-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Seg label="Operation" value={side} onChange={setSide} options={SIDE_OPTIONS.map((o) => [o.value, o.label] as [Trade['side'], string])} />
        <div className="op-fields">
          <div className="op-date"><DatePicker value={date} onChange={setDate} clearable={false} size="sm" ariaLabel="Date" /></div>
          {side !== 'dividend' && <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Quantity" aria-label="Quantity" />}
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={side === 'dividend' ? `Amount (${c})` : `Price per unit (${c})`} aria-label="Price" />
          <input className="input" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="Fees" aria-label="Fees" />
          <button className="btn sm" type="submit" disabled={!valid}>Add</button>
        </div>
        {side !== 'dividend' && q && p ? <div className="small">Total {fmtMoney(q * p + (side === 'buy' ? fe ?? 0 : -(fe ?? 0)), c)}</div> : null}
      </form>
      <div className="op-list">
        {trades.map((t) => (
          <div className="op-row" key={t.id}>
            <span className="time-date">{fmtDate(t.date, t.date.slice(0, 4) === String(new Date().getFullYear()))}</span>
            <span className={'op-side ' + t.side}>{t.side === 'buy' ? 'Buy' : t.side === 'sell' ? 'Sell' : 'Dividend'}</span>
            <span className="ellipsis">{t.side === 'dividend' ? 'Paid out' : `${fmtQty(t.quantity)} × ${fmtPrice(t.price, c)}`}{t.fees ? <span className="small"> · fees {fmtMoney(t.fees, c)}</span> : null}</span>
            <b className="r">{fmtMoney(t.side === 'dividend' ? t.price : t.quantity * t.price, c)}</b>
            <button className="x" onClick={() => remove(t)} aria-label="Delete operation">×</button>
          </div>
        ))}
        {trades.length === 0 && <div className="empty">Log your first buy: date, quantity and price per unit.</div>}
      </div>
    </div>
  );
}

/** Type today's prices for every manual asset at once (Moroccan stocks, OPCVM). */
function PricesModal({ assets, data, update, onClose }: { assets: Asset[]; data: AppData; update: Update; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(assets.map((a) => [a.id, a.price ? String(a.price) : ''])));
  const [date, setDate] = useState(isoDate());
  const toast = useToast();
  const parsed = assets.map((a) => ({ a, v: vals[a.id]?.trim() ? parseNum(vals[a.id]) : null }));
  const bad = parsed.some((x) => vals[x.a.id]?.trim() && (x.v === null || x.v <= 0));
  const save = () => {
    const changes = parsed.filter((x) => x.v && x.v > 0);
    if (!changes.length || bad || !isDay(date)) return;
    const today = date === isoDate();
    update((d) => ({
      ...d,
      assets: today ? d.assets.map((a) => { const c = changes.find((x) => x.a.id === a.id); return c ? { ...a, price: c.v!, priceAt: new Date().toISOString() } : a; }) : d.assets,
      assetPrices: [
        ...d.assetPrices.filter((p) => !(p.date === date && changes.some((x) => x.a.id === p.assetId))),
        ...changes.map((x) => ({ id: uid(), assetId: x.a.id, date, price: x.v! })),
      ],
    }));
    toast(`${changes.length} ${changes.length === 1 ? 'price' : 'prices'} updated`, { tone: 'success' });
    onClose();
  };
  const last = (id: string) => data.assetPrices.filter((p) => p.assetId === id).at(-1);
  return (
    <Modal title="Update prices" onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="small">Type the closing price (or the fund's NAV) from the Bourse de Casablanca website or your bank app.</div>
        <Field label="Prices of"><DatePicker value={date} onChange={setDate} clearable={false} ariaLabel="Date" /></Field>
        <div className="price-list">
          {assets.map((a) => (
            <label className="price-row" key={a.id}>
              <span style={{ minWidth: 0 }}>
                <b className="ellipsis">{a.name}</b>
                <span className="small">{kindLabel(a.kind)}{last(a.id) ? ` · last ${fmtPrice(last(a.id)!.price, a.currency)} on ${fmtDate(last(a.id)!.date, true)}` : ''}</span>
              </span>
              <span className="pct-input">
                <input className="input" inputMode="decimal" value={vals[a.id] ?? ''} onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })} aria-label={`Price of ${a.name}`} />
                <span>{a.currency}</span>
              </span>
            </label>
          ))}
        </div>
        {bad && <div className="small form-error">One of the prices isn't a valid number.</div>}
        <div className="modal-foot">
          <span />
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn sm" type="submit" disabled={bad}>Save prices</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Real estate ---------------- */

function RealEstate({ data, update, fx }: { data: AppData; update: Update; fx: Fx }) {
  const cur = data.profile.currency;
  const [editing, setEditing] = useState<Property | null>(null);
  const [open, setOpen] = useState<string | null>(data.properties[0]?.id ?? null);
  const toast = useToast();
  const props = data.properties.map((p) => ({ p, s: propertyStats(data, p) }));
  const total = (f: (x: { p: Property; s: ReturnType<typeof propertyStats> }) => number) =>
    props.reduce((a, x) => a + convert(f(x), x.p.currency, cur, fx), 0);

  const newProperty = (): Property => ({
    id: uid(), name: '', city: '', currency: 'MAD', purchaseDate: '', purchasePrice: 0, value: 0, debt: 0, rent: 0, charges: 0, loan: 0, notes: '',
    position: data.properties.reduce((a, x) => Math.max(a, x.position), -1) + 1,
  });
  const logMonth = (p: Property) => {
    const k = monthKey();
    const have = data.propertyEntries.filter((e) => e.propertyId === p.id && e.date.startsWith(k));
    const add: PropertyEntry[] = [];
    if (p.rent && !have.some((e) => e.kind === 'rent')) add.push({ id: uid(), propertyId: p.id, date: isoDate(), kind: 'rent', amount: p.rent, label: 'Rent' });
    if (p.loan && !have.some((e) => e.kind === 'loan')) add.push({ id: uid(), propertyId: p.id, date: isoDate(), kind: 'loan', amount: p.loan, label: 'Mortgage' });
    if (p.charges && !have.some((e) => e.kind === 'expense' && e.label === 'Monthly charges')) add.push({ id: uid(), propertyId: p.id, date: isoDate(), kind: 'expense', amount: p.charges, label: 'Monthly charges' });
    if (!add.length) {
      toast(`${fmtMonth(k, true)} is already logged for ${p.name}`);
      return;
    }
    const ids = new Set(add.map((e) => e.id));
    update((d) => ({ ...d, propertyEntries: [...add, ...d.propertyEntries] }));
    toast(<><b>{fmtMonth(k, true)}</b> logged for {p.name}</>, { tone: 'success', undo: () => update((d) => ({ ...d, propertyEntries: d.propertyEntries.filter((e) => !ids.has(e.id)) })) });
  };

  return (
    <div className="section loose">
      <div className="head">
        <div>
          <h2>Real estate</h2>
          <span className="sub">Each property, what it's worth and what it brings in every month</span>
        </div>
        <button className="btn" onClick={() => setEditing(newProperty())}>+ Add a property</button>
      </div>

      {props.length === 0 ? (
        <div className="empty wealth-empty">
          <b>No property yet.</b>
          <span>Add a house or an apartment with its price, rent, charges and loan. Then log each month in one click.</span>
          <button className="btn sm" style={{ alignSelf: 'center' }} onClick={() => setEditing(newProperty())}>+ Add a property</button>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi kpi-accent">
              <div className="kpi-k">Total value</div>
              <div className="kpi-v">{fmtMoney(total((x) => x.p.value), cur)}</div>
              <div className="kpi-s">{props.length} {props.length === 1 ? 'property' : 'properties'}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Equity</div>
              <div className="kpi-v">{fmtMoney(total((x) => x.s.equity), cur)}</div>
              <div className="kpi-s">{fmtMoney(total((x) => x.p.debt), cur)} still owed</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Cash flow / month</div>
              <div className="kpi-v" style={{ color: tone(total((x) => x.s.cashflow)) }}>{fmtMoney(total((x) => x.s.cashflow), cur)}</div>
              <div className="kpi-s">Rent − charges − loan</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Last 12 months</div>
              <div className="kpi-v" style={{ color: tone(total((x) => x.s.total12)) }}>{fmtMoney(total((x) => x.s.total12), cur)}</div>
              <div className="kpi-s">Net, from what you logged</div>
            </div>
          </div>

          {props.length > 1 && (
            <div className="card" style={{ gap: '1rem' }}>
              <div className="head">
                <div className="card-title">Net generated, last 12 months</div>
                <span className="small">Rent − expenses − loan, from your logged months · in {cur}</span>
              </div>
              <HBars
                format={(n) => fmtMoney(n, cur)}
                items={props.map(({ p, s }, i) => ({
                  id: p.id, label: p.name, value: Math.max(0, convert(s.total12, p.currency, cur, fx)), color: CAT[i % CAT.length],
                  sub: `${fmtMoney(s.cashflow, p.currency)} expected per month${s.total12 < 0 ? ` · ${fmtMoney(s.total12, p.currency)} so far` : ''}`,
                }))}
              />
            </div>
          )}

          {props.map(({ p, s }, i) => (
            <PropertyCard key={p.id} p={p} s={s} color={CAT[i % CAT.length]} data={data} update={update} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onEdit={() => setEditing(p)} onLog={() => logMonth(p)} />
          ))}
        </>
      )}
      {editing && <PropertyModal property={editing} data={data} update={update} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PropertyCard({ p, s, color, data, update, open, onToggle, onEdit, onLog }: {
  p: Property;
  s: ReturnType<typeof propertyStats>;
  color: string;
  data: AppData;
  update: Update;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onLog: () => void;
}) {
  const c = p.currency;
  const m = (n: number) => fmtMoney(n, c);
  const [kind, setKind] = useState<PropertyEntry['kind']>('expense');
  const [date, setDate] = useState(isoDate());
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const toast = useToast();
  const entries = data.propertyEntries.filter((e) => e.propertyId === p.id);
  const a = parseAmount(amount);
  const add = () => {
    if (!a || !isDay(date)) return;
    const e: PropertyEntry = { id: uid(), propertyId: p.id, date, kind, amount: a, label: label.trim() || (kind === 'rent' ? 'Rent' : kind === 'loan' ? 'Mortgage' : 'Expense') };
    update((d) => ({ ...d, propertyEntries: [e, ...d.propertyEntries] }));
    toast(<>{e.label} · <b>{m(a)}</b> logged</>, { undo: () => update((d) => ({ ...d, propertyEntries: d.propertyEntries.filter((x) => x.id !== e.id) })) });
    setAmount('');
    setLabel('');
  };
  const remove = (e: PropertyEntry) => {
    const { restore } = removeRow(data, 'propertyEntries', e.id);
    update((d) => removeRow(d, 'propertyEntries', e.id).data);
    toast('Entry deleted', { undo: () => update(restore) });
  };
  const max = Math.max(1, ...s.months.map((x) => Math.max(x.rent, x.out)));
  return (
    <div className="card prop-card" style={{ borderLeftColor: color }}>
      <div className="head">
        <button className="fold" onClick={onToggle} aria-expanded={open}>
          <svg className="fold-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          <span>
            <span className="card-title" style={{ fontSize: '1rem' }}>{p.name}</span>
            <span className="small" style={{ display: 'block' }}>{[p.city, p.purchaseDate ? `bought ${fmtDate(p.purchaseDate)}` : '', c].filter(Boolean).join(' · ')}</span>
          </span>
        </button>
        <div className="row">
          <button className="btn sm outline" onClick={onLog}><IconPlus size={12} /> Log this month</button>
          <button className="icon-btn" onClick={onEdit} aria-label={`Edit ${p.name}`} title="Edit"><IconPencil /></button>
        </div>
      </div>
      <div className="prop-stats">
        <div><span className="small">Value</span><b>{m(p.value)}</b>{s.appreciation ? <span className="small" style={{ color: tone(s.appreciation) }}>{signed(s.appreciation, c)} since purchase</span> : null}</div>
        <div><span className="small">Equity</span><b>{m(s.equity)}</b><span className="small">{m(p.debt)} owed</span></div>
        <div><span className="small">Cash flow / month</span><b style={{ color: tone(s.cashflow) }}>{m(s.cashflow)}</b><span className="small">{m(p.rent)} rent</span></div>
        <div><span className="small">Yield</span><b>{s.grossYield !== null ? pct(s.grossYield) : '—'}</b><span className="small">gross · {s.netYield !== null ? pct(s.netYield) : '—'} net</span></div>
        <div><span className="small">Generated</span><b style={{ color: tone(s.totalAll) }}>{m(s.totalAll)}</b><span className="small">net, all logged months</span></div>
      </div>
      {open && (
        <>
          <div className="prop-months" aria-label="Rent and costs per month">
            {s.months.map((x) => (
              <div key={x.k} className="prop-month" title={`${fmtMonth(x.k, true)}: ${m(x.rent)} in · ${m(x.out)} out · ${m(x.net)} net`}>
                <div className="prop-bars">
                  <span className="in" style={{ height: `${(x.rent / max) * 100}%` }} />
                  <span className="out" style={{ height: `${(x.out / max) * 100}%` }} />
                </div>
                <span className={'prop-net' + (x.net < 0 ? ' neg' : '')}>{x.rent || x.out ? compactMoney(x.net, c) : '·'}</span>
                <span className="sbars-label">{fmtMonth(x.k)}</span>
              </div>
            ))}
          </div>
          <div className="chart-legend"><span><span className="swatch" style={{ background: 'var(--c-pos)' }} />Rent</span><span><span className="swatch" style={{ background: 'var(--c-exp)' }} />Expenses + loan</span></div>
          {p.notes && <div className="small client-notes">{p.notes}</div>}
          <form className="time-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Seg label="Kind" value={kind} onChange={setKind} options={[['rent', 'Rent'], ['expense', 'Expense'], ['loan', 'Loan']]} />
            <div className="note-ctl"><DatePicker value={date} onChange={setDate} clearable={false} size="sm" ariaLabel="Date" /></div>
            <input className="input time-dur" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Amount (${c})`} aria-label="Amount" />
            <input className="input time-note" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (repairs, tax, insurance…)" aria-label="Label" />
            <button className="btn sm" type="submit" disabled={!a}>Add</button>
          </form>
          <div className="time-list">
            {entries.slice(0, 12).map((e) => (
              <div className="time-row" key={e.id}>
                <span className="time-date">{fmtDate(e.date, true)} {e.date.slice(2, 4)}</span>
                <span className="ellipsis time-what"><span className={'op-side ' + (e.kind === 'rent' ? 'buy' : 'sell')}>{e.kind === 'rent' ? 'Rent' : e.kind === 'loan' ? 'Loan' : 'Expense'}</span>{e.label}</span>
                <b className="time-dur-v" style={{ color: e.kind === 'rent' ? 'var(--green)' : undefined }}>{e.kind === 'rent' ? '+' : '−'} {m(e.amount)}</b>
                <button className="x" onClick={() => remove(e)} aria-label="Delete entry">×</button>
              </div>
            ))}
            {entries.length === 0 && <div className="empty">Nothing logged yet. "Log this month" adds the rent, loan and charges from the property's settings.</div>}
          </div>
        </>
      )}
    </div>
  );
}

function PropertyModal({ property, data, update, onClose }: { property: Property; data: AppData; update: Update; onClose: () => void }) {
  const creating = !data.properties.some((p) => p.id === property.id);
  const [f, setF] = useState(property);
  const num = (k: keyof Property) => (f[k] ? String(f[k]) : '');
  const [vals, setVals] = useState({ purchasePrice: num('purchasePrice'), value: num('value'), debt: num('debt'), rent: num('rent'), charges: num('charges'), loan: num('loan') });
  const toast = useToast();
  const parsed = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim() ? parseAmount(v) : 0])) as Record<keyof typeof vals, number | null>;
  const bad = Object.values(parsed).some((v) => v === null);
  const save = () => {
    const name = f.name.trim();
    if (!name || bad) return;
    const next: Property = { ...f, name, city: f.city.trim(), ...(parsed as Record<keyof typeof vals, number>) };
    if (!next.value) next.value = next.purchasePrice;
    update((d) => ({ ...d, properties: creating ? [...d.properties, next] : d.properties.map((p) => (p.id === next.id ? next : p)) }));
    toast(<><b>{name}</b> {creating ? 'added' : 'saved'}</>, { tone: 'success' });
    onClose();
  };
  const remove = () => {
    const { restore } = removeProperty(data, property.id);
    update((d) => removeProperty(d, property.id).data);
    toast(<><b>{property.name}</b> deleted</>, { undo: () => update(restore) });
    onClose();
  };
  const field = (k: keyof typeof vals, label: string, ph?: string) => (
    <Field label={`${label} (${f.currency})`}>
      <input className="input" inputMode="decimal" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} placeholder={ph ?? '0'} />
    </Field>
  );
  return (
    <Modal title={creating ? 'New property' : 'Edit property'} onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="form-grid">
          <Field label="Name"><input className="input" autoFocus={creating} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Apartment Maarif" /></Field>
          <Field label="City"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Casablanca" /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(currency) => setF({ ...f, currency })} options={CURRENCY_OPTIONS} ariaLabel="Currency" /></Field>
          <Field label="Bought on"><DatePicker value={f.purchaseDate} onChange={(purchaseDate) => setF({ ...f, purchaseDate })} placeholder="Date" ariaLabel="Bought on" /></Field>
          {field('purchasePrice', 'Purchase price', 'With fees')}
          {field('value', 'Value today', 'Estimate')}
          {field('debt', 'Loan still owed')}
          {field('rent', 'Rent / month')}
          {field('charges', 'Charges / month', 'Syndic, tax, insurance…')}
          {field('loan', 'Loan payment / month')}
        </div>
        <Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Tenant, lease end, works planned…" /></Field>
        {bad && <div className="small form-error">One of the amounts isn't valid. Examples: 1200000 · 6 500 · 650.50</div>}
        <div className="modal-foot">
          {creating ? <span /> : <button className="btn sm danger" type="button" onClick={remove}>Delete property</button>}
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn sm" type="submit" disabled={!f.name.trim() || bad}>{creating ? 'Add property' : 'Save'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
