import { useMemo, useState } from 'react';
import { MonthPicker } from '../components/Calendar';
import { IconTrash, Seg } from '../components/ui';
import { removeRow } from '../lib/undo';
import { catLabel } from '../lib/constants';
import { allTxns, isActive, monthlyEquivalent, sumType, totals } from '../lib/finance';
import { fmtDate, fmtMonth, isoDate, money, monthEnd, monthKey, pct, shiftMonth } from '../lib/format';
import { EntryModal, RecurringModal, newEntry } from '../components/MoneyForms';
import { useToast } from '../components/Toast';
import { isOverdue, projectStats, unpaidInvoices } from '../lib/stats';
import { fmtDuration } from '../lib/time';
import { rateOn, taxesOn } from '../lib/tax';
import { HBars } from '../components/Charts';
import { t, tn } from '../lib/i18n';
import type { AppData, Entry, Recurring } from '../types';

type Update = (fn: (d: AppData) => AppData) => void;

type Period = '1m' | '3m' | '12m' | 'all';

export default function FinancesPage({ data, update, openProject, goToData }: { data: AppData; update: Update; openProject: (id: string) => void; goToData: () => void }) {
  const toast = useToast();
  // Clicking a recent transaction opens its edit form (a recurring line opens the subscription).
  const [editing, setEditing] = useState<{ entry?: Entry; recurring?: Recurring } | null>(null);
  const [period, setPeriod] = useState<Period>('1m');
  // The month the view ends on (this month by default); 3 and 12 months count back from it.
  const [anchor, setAnchor] = useState(monthKey());
  const P = data.profile;
  const cur = P.currency;
  const m = (n: number) => money(n, cur);
  // Green = the business made money, red = it lost money. No target to configure.
  const tone = (rate: number | null) => (rate === null ? 'var(--faint)' : rate >= 0 ? 'var(--green)' : 'var(--red)');

  const txns = useMemo(() => allTxns(data), [data]);
  const thisMonth = monthKey();
  const end = period === 'all' ? thisMonth : anchor;
  const cutoff = { '1m': end, '3m': shiftMonth(end, -2), '12m': shiftMonth(end, -11), all: '0000' }[period];
  // allTxns already leaves out anything dated after today (planned invoices, upcoming renewals).
  const inPeriod = txns.filter((e) => e.date.slice(0, 7) >= cutoff && e.date.slice(0, 7) <= end);
  // Fixed costs as they stood at the end of the viewed month (today for the current month).
  const asOf = end === thisMonth ? new Date() : new Date(monthEnd(end) + 'T12:00:00');
  const T = totals(inPeriod);

  // Fixed monthly burn: what recurring costs take out every month, whatever you sell.
  const activeRec = data.recurring.filter((r) => isActive(r, asOf));
  const fixedCost = activeRec.filter((r) => r.type !== 'revenue').reduce((a, r) => a + monthlyEquivalent(r), 0);
  const fixedRev = activeRec.filter((r) => r.type === 'revenue').reduce((a, r) => a + monthlyEquivalent(r), 0);

  const revCount = inPeriod.filter((e) => e.type === 'revenue').length;
  const unpaid = unpaidInvoices(data);
  const toCollect = unpaid.reduce((a, e) => a + e.amount, 0);
  const late = unpaid.filter((e) => isOverdue(e)).length;
  const markPaid = (e: Entry) => {
    update((d) => ({ ...d, entries: d.entries.map((x) => (x.id === e.id ? { ...x, paid: true, due: '' } : x)) }));
    toast(<>{t('Marked paid:')} <b>{e.label}</b> · {m(e.amount)}</>, {
      tone: 'success',
      undo: () => update((d) => ({ ...d, entries: d.entries.map((x) => (x.id === e.id ? { ...x, paid: false, due: e.due } : x)) })),
    });
  };
  const removeE = (e: Entry) => {
    const { restore } = removeRow(data, 'entries', e.id);
    update((d) => removeRow(d, 'entries', e.id).data);
    toast(<>{t('Deleted:')} <b>{e.label}</b></>, { undo: () => update(restore) });
  };
  const projectRows = data.projects
    .map((p) => ({ p, s: projectStats(data, p.id, txns) }))
    .filter((r) => r.s.revenue || r.s.costs || r.s.minutes || r.p.budget)
    .sort((a, b) => b.s.revenue - a.s.revenue);
  const subCount = activeRec.filter((r) => r.type !== 'revenue').length;
  const tax = taxesOn(inPeriod, P.tax);
  const afterTax = T.net - tax.total;
  const rateNow = rateOn(P.tax, isoDate());
  const untaxed = inPeriod.filter((t) => t.type === 'revenue').reduce((a, t) => a + t.amount, 0) - tax.gross;
  const kpis = [
    { label: t('Revenue'), value: m(T.rev), sub: tn(revCount, '{n} payment received', '{n} payments received'), color: 'var(--muted)', dot: 'var(--c-rev)' },
    { label: t('Expenses'), value: m(T.charges), sub: T.rev ? t('{p} of revenue', { p: pct((T.charges / T.rev) * 100) }) : t('No revenue in this period'), color: 'var(--muted)', dot: 'var(--c-exp)' },
    { label: t('Net profit'), value: m(T.net), sub: T.rev ? t('Net margin {p}', { p: pct(T.netRate) }) : '—', color: T.rev ? tone(T.net) : 'var(--muted)', dot: 'var(--c-pos)' },
    { label: t('After taxes'), value: m(afterTax), sub: tax.total ? t('{amount} of URSSAF & tax', { amount: m(tax.total) }) : t('No taxable revenue'), color: 'var(--muted)', dot: 'var(--c-pos)' },
    { label: t('To collect'), value: m(toCollect), sub: unpaid.length ? (late ? t('{n} unpaid · {late} late', { n: unpaid.length, late }) : t('{n} unpaid', { n: unpaid.length })) : t('All invoices paid'), color: late ? 'var(--red)' : 'var(--muted)', dot: 'var(--c-warn)' },
    { label: t('Fixed costs / month'), value: m(fixedCost), sub: tn(subCount, '{n} active subscription', '{n} active subscriptions') + (fixedRev ? ' · ' + t('recurring income {amount}', { amount: m(fixedRev) }) : ''), color: 'var(--muted)', dot: 'var(--c-warn)' },
  ];

  const cl = (x: number) => Math.max(0, Math.min(100, x)) + '%';
  const share = (x: number) => (T.rev ? (x / T.rev) * 100 : 0);

  const byCat = new Map<string, { name: string; type: string; amount: number }>();
  inPeriod.filter((e) => e.type !== 'revenue').forEach((e) => {
    const c = byCat.get(e.category) ?? { name: e.category, type: e.type, amount: 0 };
    c.amount += Number(e.amount || 0);
    byCat.set(e.category, c);
  });
  const cats = [...byCat.values()].sort((a, b) => b.amount - a.amount);
  const maxCat = Math.max(1, ...cats.map((c) => c.amount));

  // 6-month chart and 12-month table ending on the viewed month.
  const monthRows = (n: number) =>
    Array.from({ length: n }, (_, i) => shiftMonth(end, -(n - 1 - i))).map((k) => {
      const me = txns.filter((e) => e.date.slice(0, 7) === k);
      const r = sumType(me, 'revenue');
      const c = sumType(me, 'direct') + sumType(me, 'opex');
      return { k, r, c, net: r - c, rate: r ? ((r - c) / r) * 100 : null };
    });
  const chart = monthRows(6);
  const max = Math.max(1, ...chart.map((x) => Math.max(x.r, x.c)));
  // Hide the empty months before the first recorded transaction.
  const firstMonth = txns.reduce((a, e) => (e.date.slice(0, 7) < a ? e.date.slice(0, 7) : a), thisMonth);
  const table = monthRows(12).filter((x) => x.k >= firstMonth).reverse();
  const tableTot = table.reduce((a, x) => ({ r: a.r + x.r, c: a.c + x.c }), { r: 0, c: 0 });

  const insights: { dot: string; text: string }[] = [];
  if (T.rev) {
    insights.push(
      T.net >= 0
        ? { dot: 'var(--c-pos)', text: t('You keep {net} out of {rev} in revenue, a net margin of {p}.', { net: m(T.net), rev: m(T.rev), p: pct(T.netRate) }) }
        : { dot: 'var(--c-neg)', text: t('You’re losing {loss} over this period: expenses exceed revenue by {p}.', { loss: m(-T.net), p: pct(-T.netRate) }) },
    );
  }
  if (cats.length && T.rev) {
    const top = cats[0];
    insights.push({ dot: 'var(--c-warn)', text: t('Your biggest expense: {cat}, {amount} ({p} of revenue).', { cat: catLabel(top.name), amount: m(top.amount), p: pct((top.amount / T.rev) * 100) }) });
  }
  if (fixedCost) insights.push({ dot: 'var(--c-warn)', text: t('Your fixed costs are {month} a month, or {year} a year, before any project.', { month: m(fixedCost), year: m(fixedCost * 12) }) });
  // Compare two complete months: the current one is still filling up.
  const [prev, last] = end === thisMonth ? chart.slice(-3, -1) : chart.slice(-2);
  if (prev.c && last.c) {
    const d = ((last.c - prev.c) / prev.c) * 100;
    insights.push({ dot: d > 10 ? 'var(--c-warn)' : 'var(--c-pos)', text: t(d >= 0 ? 'Expenses in {month} went up {p} compared with {prev}.' : 'Expenses in {month} went down {p} compared with {prev}.', { month: fmtMonth(last.k, true), p: pct(Math.abs(d)), prev: fmtMonth(prev.k, true) }) });
  }
  if (!insights.length) insights.push({ dot: 'var(--faint)', text: t('Add transactions or subscriptions in "Data & profile" to see your numbers.') });

  const recent = [...inPeriod].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const range = (from: string) =>
    `${fmtMonth(from)}${from.slice(0, 4) !== end.slice(0, 4) ? ' ' + from.slice(0, 4) : ''} – ${fmtMonth(end)} ${end.slice(0, 4)}`;
  const periodLabel = { '1m': fmtMonth(end, true), '3m': range(cutoff), '12m': range(cutoff), all: t('All time') }[period];

  return (
    <section className="section loose">
      <div className="head">
        <div className="head-title">
          <h1>{t('Finances')}</h1>
          <span className="sub">{periodLabel}</span>
        </div>
        <div className="row">
          <Seg label={t('Period')} value={period} onChange={setPeriod} options={[['1m', t('Month')], ['3m', t('3 months')], ['12m', t('12 months')], ['all', t('All time')]]} />
          {period !== 'all' && <MonthPicker value={anchor} onChange={setAnchor} ariaLabel={t('Month shown')} />}
          <button className="btn" onClick={() => setEditing({ entry: newEntry() })}>+ {t('Add a transaction')}</button>
        </div>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <div className="kpi-k"><span className="dot" style={{ background: k.dot }} />{k.label}</div>
            <div className="kpi-v">{k.value}</div>
            <div className="kpi-s" style={{ color: k.color }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {unpaid.length > 0 && (
        <div className="card" style={{ gap: '0.5rem' }}>
          <div className="head">
            <div>
              <div className="card-title">{t('Waiting for payment')} <span className="small" style={{ fontWeight: 500 }}>{unpaid.length}</span></div>
              <div className="small">{t('Invoices sent but not paid yet. They count in your revenue; mark them paid when the money arrives.')}</div>
            </div>
            <div className="collect-total">{m(toCollect)}</div>
          </div>
          <div className="table-wrap">
            {unpaid.map((e) => {
              const lateDays = isOverdue(e) ? Math.round((Date.now() - Date.parse(e.due + 'T12:00:00')) / 86_400_000) : 0;
              const project = data.projects.find((p) => p.id === e.projectId);
              return (
                <div className="trow t-unpaid" key={e.id}>
                  <span className={'pay-chip' + (lateDays ? ' late' : ' waiting')}>{lateDays ? t('{n}d late', { n: lateDays }) : e.due ? t('Due {date}', { date: fmtDate(e.due, true) }) : t('No due date')}</span>
                  <button className="unpaid-label" onClick={() => setEditing({ entry: e })} title={t('Edit this invoice')}>
                    <span className="ellipsis" style={{ fontWeight: 600 }}>{e.label}</span>
                    <span className="small ellipsis">{t('Sent {date}', { date: fmtDate(e.date, true) })}{project ? ` · ${project.name}` : ''}</span>
                  </button>
                  <b className="r">{m(e.amount)}</b>
                  <span className="row-actions">
                    <button className="btn sm outline" onClick={() => markPaid(e)}>{t('Mark paid')}</button>
                    <button className="icon-btn danger" onClick={() => removeE(e)} title={t('Delete')} aria-label={t('Delete {name}', { name: e.label })}><IconTrash size={13} /></button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid-2 stretch">
        <div className="card" style={{ gap: '1.125rem' }}>
          <div className="head">
            <div className="card-title">{t('Revenue vs expenses, 6 months to {month}', { month: fmtMonth(end, true) })}</div>
            <div className="legend">
              <span><span className="dot" style={{ background: 'var(--c-rev)' }} />{t('Revenue')}</span>
              <span><span className="dot" style={{ background: 'var(--c-exp)' }} />{t('Expenses')}</span>
            </div>
          </div>
          <div className="bars">
            {chart.map((x) => (
              <div className="bar-pair" key={x.k} tabIndex={0} aria-label={t('{month}: revenue {rev}, expenses {exp}', { month: fmtMonth(x.k, true), rev: m(x.r), exp: m(x.c) })}>
                <div style={{ height: `${(x.r / max) * 100}%`, background: 'var(--c-rev)' }} />
                <div style={{ height: `${(x.c / max) * 100}%`, background: 'var(--c-exp)' }} />
                <span className="bar-tip">{t('Revenue {rev} · Expenses {exp}', { rev: m(x.r), exp: m(x.c) })}</span>
              </div>
            ))}
          </div>
          <div className="bar-labels">
            {chart.map((x) => (
              <div key={x.k}>
                <span className="m">{fmtMonth(x.k)}</span>
                <span className="n" style={{ color: tone(x.rate) }}>
                  {x.rate === null ? '—' : pct(x.rate)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{cur === 'EUR' ? t('Where each euro of revenue goes') : t('Where each unit of revenue goes')}</div>
          <div className="split">
            <div style={{ width: cl(share(T.direct)), background: 'var(--c-warn)' }} />
            <div style={{ width: cl(share(T.opex)), background: 'var(--c-exp)' }} />
            <div style={{ width: cl(T.netRate), background: 'var(--c-pos)' }} />
          </div>
          <div className="section" style={{ gap: '0.625rem' }}>
            <div className="split-row"><span><span className="dot" style={{ background: 'var(--c-warn)' }} />{t('Direct costs (subcontracting…)')}</span><span>{pct(share(T.direct))}</span></div>
            <div className="split-row"><span><span className="dot" style={{ background: 'var(--c-exp)' }} />{t('Operating expenses')}</span><span>{pct(share(T.opex))}</span></div>
            <div className="split-row"><span><span className="dot" style={{ background: 'var(--c-pos)' }} />{t('Net profit')}</span><span>{pct(T.netRate)}</span></div>
          </div>
          <div className="insights">
            {insights.map((i) => (
              <div className="insight" key={i.text}><span className="dot" style={{ background: i.dot }} /><span style={{ textWrap: 'pretty' }}>{i.text}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2 stretch">
        <div className="card" style={{ gap: '0.875rem' }}>
          <div className="head">
            <div>
              <div className="card-title">{t('Taxes & contributions')}</div>
              <div className="small">{t('Micro-entreprise, on business revenue of the period')} · {rateNow.acre ? t('ACRE until {date}', { date: fmtDate(P.tax.acreUntil) }) : t('normal rates')}</div>
            </div>
            <button className="pill" style={{ background: 'var(--chip)', color: 'var(--ink-2)' }} onClick={goToData} title={t('Edit the rates in Data & profile')}>
              {t('{p} today', { p: pct(rateNow.total) })}
            </button>
          </div>
          <div className="tax-grid">
            <div className="tax-row"><span>{t('Gross revenue (taxable)')}</span><b>{m(tax.gross)}</b></div>
            <div className="tax-row sub"><span>{t('Social contributions (URSSAF)')} · {pct(rateNow.social)}</span><span>− {m(tax.social)}</span></div>
            <div className="tax-row sub"><span>{t('Training contribution (CFP)')} · {pct(rateNow.cfp)}</span><span>− {m(tax.cfp)}</span></div>
            {P.tax.vl > 0 && <div className="tax-row sub"><span>{t('Income tax, versement libératoire')} · {pct(rateNow.vl)}</span><span>− {m(tax.vl)}</span></div>}
            <div className="tax-row total"><span>{t('Net income')}</span><b>{m(tax.net)}</b></div>
          </div>
          {tax.gross > 0 && (
            <div className="tax-split" aria-hidden="true">
              <span style={{ flexGrow: tax.net, background: 'var(--c-pos)' }} />
              <span style={{ flexGrow: tax.social, background: 'var(--c-warn)' }} />
              <span style={{ flexGrow: tax.cfp + tax.vl, background: 'var(--c-neg)' }} />
            </div>
          )}
          <div className="small">
            {untaxed > 0 ? t('{amount} of trading, investment or rental income is not counted here.', { amount: m(untaxed) }) + ' ' : ''}
            {t('Estimate on revenue dated in the period. URSSAF counts money when it is cashed in.')}
          </div>
        </div>

        <div className="card" style={{ gap: '1rem' }}>
          <div className="head">
            <div className="card-title">{t('Money by type')}</div>
            <div className="small">{periodLabel}</div>
          </div>
          <HBars
            format={m}
            items={[
              { id: 'revenue', label: t('Revenue'), value: T.rev, color: 'var(--c-rev)', sub: tn(revCount, '{n} line', '{n} lines') },
              { id: 'direct', label: t('Direct costs'), value: T.direct, color: 'var(--c-direct)', sub: T.rev ? t('{p} of revenue', { p: pct((T.direct / T.rev) * 100) }) : undefined },
              { id: 'opex', label: t('Operating expenses'), value: T.opex, color: 'var(--c-exp)', sub: T.rev ? t('{p} of revenue', { p: pct((T.opex / T.rev) * 100) }) : undefined },
            ]}
          />
          <div className="type-net">
            <span>{t('What’s left')}</span>
            <b style={{ color: T.net < 0 ? 'var(--red)' : undefined }}>{m(T.net)}</b>
            <span className="small">{t('{amount} after taxes', { amount: m(afterTax) })}</span>
          </div>
        </div>
      </div>

      <div className="grid-2 stretch">
        <div className="card" style={{ gap: '0.875rem' }}>
          <div className="head">
            <div className="card-title">{t('What eats your margin')}</div>
            <div className="small">{t('Amount and share of revenue in this period')}</div>
          </div>
          {cats.map((c) => {
            const p = share(c.amount);
            const color = 'var(--c-rev)';
            return (
              <div className="catbar" key={c.name}>
                <div className="catbar-top">
                  <span className="row" style={{ gap: '0.5rem' }}><b style={{ fontWeight: 600 }}>{catLabel(c.name)}</b><span className="mini-tag">{c.type === 'direct' ? t('Direct cost') : t('Operating')}</span></span>
                  <span className="row" style={{ gap: '0.625rem', flexWrap: 'nowrap' }}>
                    <span style={{ color: 'var(--ink-2)' }}>{m(c.amount)}</span>
                    <b style={{ minWidth: '3rem', textAlign: 'right', color }}>{T.rev ? pct(p) : '—'}</b>
                  </span>
                </div>
                <div className="catbar-track"><div style={{ width: cl((c.amount / maxCat) * 100), background: color }} /></div>
              </div>
            );
          })}
          {cats.length === 0 && <div className="small">{t('No expenses in this period.')}</div>}
        </div>

        <div className="card" style={{ gap: '0.375rem' }}>
          <div className="card-title" style={{ marginBottom: '0.5rem' }}>{t('Recent transactions')}</div>
          {recent.map((r) => (
            <button
              type="button"
              className="trow t-recent t-click"
              key={r.id}
              title={r.recurringId ? t('Edit this subscription') : t('Edit this transaction')}
              onClick={() => {
                if (r.recurringId) {
                  const rec = data.recurring.find((x) => x.id === r.recurringId);
                  if (rec) setEditing({ recurring: rec });
                } else {
                  const entry = data.entries.find((x) => x.id === r.id);
                  if (entry) setEditing({ entry });
                }
              }}
            >
              <span className="small">{fmtDate(r.date, r.date.slice(0, 4) === String(new Date().getFullYear()))}</span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="ellipsis" style={{ fontWeight: 600 }}>{r.label}{r.recurringId && <span className="auto-flag">{t('recurring')}</span>}</span>
                <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>{catLabel(r.category)}</span>
              </span>
              <b style={{ color: r.type === 'revenue' ? 'var(--green)' : 'var(--ink)', whiteSpace: 'nowrap' }}>
                {r.type === 'revenue' ? '+ ' : '− '}{m(r.amount)}
              </b>
            </button>
          ))}
          {recent.length === 0 && <div className="small">{t('No transactions in this period.')}</div>}
        </div>
      </div>

      {projectRows.length > 0 && (
        <div className="card" style={{ gap: '0.375rem' }}>
          <div className="head">
            <div className="card-title">{t('Project profitability')}</div>
            <div className="small">{t('All time, everything linked to each project · time from the tracker')}</div>
          </div>
          <div className="table-wrap">
            <div className="trow th t-profit"><span>{t('Project')}</span><span className="r">{t('Revenue')}</span><span className="r">{t('Costs')}</span><span className="r">{t('Margin')}</span><span>{t('Budget')}</span><span className="r">{t('Time')}</span><span className="r">{t('Per hour')}</span></div>
            {projectRows.map(({ p, s: st }) => {
              const client = data.clients.find((c) => c.id === p.clientId);
              return (
                <button type="button" className="trow t-profit t-click" key={p.id} onClick={() => openProject(p.id)} title={t('Open project')}>
                  <span className="row ellipsis" style={{ gap: '0.5rem', flexWrap: 'nowrap', fontWeight: 600 }}>
                    <span className="swatch" style={{ background: client?.color ?? 'var(--line-strong)' }} />
                    <span className="ellipsis">{p.name}</span>
                  </span>
                  <span className="r">{m(st.revenue)}</span>
                  <span className="r" style={{ color: 'var(--ink-2)' }}>{m(st.costs)}</span>
                  <span className="r" style={{ fontWeight: 700, color: st.margin < 0 ? 'var(--red)' : st.margin > 0 ? 'var(--green)' : undefined }}>
                    {m(st.margin)}{st.marginRate !== null && <span className="small" style={{ fontWeight: 500 }}> {pct(st.marginRate)}</span>}
                  </span>
                  <span>
                    {st.budgetUsed !== null ? (
                      <span className="progress" title={t('{p} of {budget} invoiced', { p: pct(st.budgetUsed), budget: m(st.budget) })}>
                        <span className="progress-bar"><div style={{ width: `${Math.min(100, st.budgetUsed)}%`, background: st.budgetUsed > 100 ? 'var(--amber)' : undefined }} /></span>
                        <span className="small" style={{ fontWeight: 600 }}>{Math.round(st.budgetUsed)}%</span>
                      </span>
                    ) : <span className="small">—</span>}
                  </span>
                  <span className="r" style={{ color: 'var(--ink-2)' }}>{st.minutes ? fmtDuration(st.minutes) : '—'}</span>
                  <span className="r" style={{ fontWeight: 600 }}>{st.perHour !== null ? m(st.perHour) : '—'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ gap: '0.375rem' }}>
        <div className="head">
          <div className="card-title">{t('Month by month')}</div>
          <div className="small">{t('What comes in, what goes out, what’s left · 12 months to {month}', { month: fmtMonth(end, true) })}</div>
        </div>
        <div className="table-wrap">
          <div className="trow th t-months"><span>{t('Month')}</span><span className="r">{t('Revenue')}</span><span className="r">{t('Expenses')}</span><span className="r">{t('Net')}</span><span className="r">{t('Margin')}</span></div>
          {table.map((x) => (
            <div className="trow t-months" key={x.k} style={{ color: x.r || x.c ? undefined : 'var(--faint)' }}>
              <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{fmtMonth(x.k, true)}</span>
              <span className="r">{m(x.r)}</span>
              <span className="r">{m(x.c)}</span>
              <span className="r" style={{ fontWeight: 700, color: x.net < 0 ? 'var(--red)' : x.net > 0 ? 'var(--green)' : undefined }}>{m(x.net)}</span>
              <span className="r" style={{ color: tone(x.rate) }}>{x.rate === null ? '—' : pct(x.rate)}</span>
            </div>
          ))}
          <div className="trow t-months total">
            <span>{table.length > 1 ? t('Total ({n} months)', { n: table.length }) : t('Total')}</span>
            <span className="r">{m(tableTot.r)}</span>
            <span className="r">{m(tableTot.c)}</span>
            <span className="r" style={{ color: tableTot.r - tableTot.c < 0 ? 'var(--red)' : 'var(--green)' }}>{m(tableTot.r - tableTot.c)}</span>
            <span className="r">{tableTot.r ? pct(((tableTot.r - tableTot.c) / tableTot.r) * 100) : '—'}</span>
          </div>
        </div>
      </div>
      {editing?.entry && <EntryModal entry={editing.entry} data={data} update={update} onClose={() => setEditing(null)} />}
      {editing?.recurring && <RecurringModal item={editing.recurring} data={data} update={update} onClose={() => setEditing(null)} />}
    </section>
  );
}
