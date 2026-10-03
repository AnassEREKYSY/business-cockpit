import { Fragment, useMemo, useState } from 'react';
import { ClientModal } from '../components/ClientModal';
import { Donut, HBars, StackedBars, compactMoney } from '../components/Charts';
import { Seg } from '../components/ui';
import { allTxns } from '../lib/finance';
import { fmtDate, fmtMonth, money, monthKey, pct, shiftMonth } from '../lib/format';
import { isUnpaid } from '../lib/stats';
import { taxOf } from '../lib/tax';
import { entryMinutes, fmtDuration } from '../lib/time';
import type { AppData, Client } from '../types';

type Update = (fn: (d: AppData) => AppData) => void;
type Period = '12m' | 'year' | 'all';

type Row = {
  id: string;
  name: string;
  color: string;
  client?: Client;
  revenue: number;
  costs: number;
  tax: number;
  minutes: number;
  unpaid: number;
  last: string;
  projects: Map<string, { revenue: number; costs: number; minutes: number }>;
};

const NONE = 'none';

export default function ClientsPage({ data, update, openProject }: { data: AppData; update: Update; openProject: (id: string) => void }) {
  const [period, setPeriod] = useState<Period>('12m');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const cur = data.profile.currency;
  const m = (n: number) => money(n, cur);
  const thisMonth = monthKey();
  const from = { '12m': shiftMonth(thisMonth, -11) + '-01', year: `${thisMonth.slice(0, 4)}-01-01`, all: '0000' }[period];

  const { rows, months, monthly, total } = useMemo(() => {
    const projectClient = new Map(data.projects.map((p) => [p.id, p.clientId]));
    const clientOf = (t: { clientId?: string; projectId: string }) => t.clientId || projectClient.get(t.projectId) || '';
    const byId = new Map<string, Row>();
    const row = (id: string) => {
      let r = byId.get(id || NONE);
      if (!r) {
        const c = data.clients.find((x) => x.id === id);
        r = {
          id: id || NONE, name: c?.name ?? 'No client', color: c?.color ?? 'var(--line-strong)', client: c,
          revenue: 0, costs: 0, tax: 0, minutes: 0, unpaid: 0, last: '', projects: new Map(),
        };
        byId.set(id || NONE, r);
      }
      return r;
    };
    const proj = (r: Row, id: string) => {
      let p = r.projects.get(id);
      if (!p) r.projects.set(id, (p = { revenue: 0, costs: 0, minutes: 0 }));
      return p;
    };
    const txns = allTxns(data).filter((t) => t.date >= from);
    for (const t of txns) {
      const cid = clientOf(t);
      // Costs without a client or project are overheads, not a client's cost.
      if (t.type !== 'revenue' && !cid && !t.projectId) continue;
      const r = row(cid);
      if (t.type === 'revenue') {
        r.revenue += t.amount;
        r.tax += taxOf(t, data.profile.tax);
        if (t.date > r.last) r.last = t.date;
        if (t.projectId) proj(r, t.projectId).revenue += t.amount;
      } else {
        r.costs += t.amount;
        if (t.projectId) proj(r, t.projectId).costs += t.amount;
      }
    }
    const now = Date.now();
    for (const e of data.timeEntries) {
      if (e.date < from) continue;
      const cid = projectClient.get(e.projectId) ?? '';
      if (!cid && !e.projectId) continue;
      const r = row(cid);
      const min = entryMinutes(e, now);
      r.minutes += min;
      if (e.projectId) proj(r, e.projectId).minutes += min;
    }
    for (const e of data.entries) if (isUnpaid(e)) row(clientOf(e)).unpaid += e.amount;
    const rows = [...byId.values()].filter((r) => r.revenue || r.costs || r.minutes || r.unpaid).sort((a, b) => b.revenue - a.revenue);
    // Monthly revenue per client, last 12 months: the 6 biggest clients, the rest as "Other".
    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, i - 11));
    const top = rows.filter((r) => r.revenue > 0).slice(0, 6);
    const topIds = new Set(top.map((r) => r.id));
    const all12 = allTxns(data).filter((t) => t.type === 'revenue' && t.date >= months[0] + '-01');
    const monthly = [
      ...top.map((r) => ({ id: r.id, label: r.name, color: r.color, values: months.map(() => 0) })),
      { id: 'other', label: 'Other', color: 'var(--c-exp)', values: months.map(() => 0) },
    ];
    for (const t of all12) {
      const k = months.indexOf(t.date.slice(0, 7));
      if (k < 0) continue;
      const cid = clientOf(t) || NONE;
      const s = monthly.find((x) => x.id === (topIds.has(cid) ? cid : 'other'))!;
      s.values[k] += t.amount;
    }
    const total = rows.reduce((a, r) => a + r.revenue, 0);
    return { rows, months, monthly: monthly.filter((s) => s.values.some((v) => v > 0)), total };
  }, [data, from, thisMonth]);

  const paying = rows.filter((r) => r.revenue > 0 && r.id !== NONE);
  const top = paying[0];
  const projectName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? 'Unknown project';
  const projectRows = rows
    .flatMap((r) => [...r.projects.entries()].map(([id, p]) => ({ id, ...p, color: r.color, client: r.name })))
    .filter((p) => p.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  return (
    <section className="section loose">
      <div className="head">
        <div className="head-title">
          <h1>Clients</h1>
          <span className="sub">What each client and project brings in</span>
        </div>
        <Seg label="Period" value={period} onChange={setPeriod} options={[['12m', '12 months'], ['year', 'This year'], ['all', 'All time']]} />
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-k">Revenue from clients</div>
          <div className="kpi-v">{m(total)}</div>
          <div className="kpi-s">{m(rows.reduce((a, r) => a + r.revenue - r.tax, 0))} after taxes</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Paying clients</div>
          <div className="kpi-v">{paying.length}</div>
          <div className="kpi-s">{paying.length ? `${m(total / paying.length)} on average` : 'No revenue in this period'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Biggest client</div>
          <div className="kpi-v ellipsis" style={{ fontSize: '1.125rem' }}>{top?.name ?? '—'}</div>
          <div className="kpi-s" style={{ color: top && total && top.revenue / total > 0.5 ? 'var(--amber)' : undefined }}>
            {top && total ? `${pct((top.revenue / total) * 100)} of your revenue${top.revenue / total > 0.5 ? ' · high dependency' : ''}` : '—'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Best rate</div>
          {(() => {
            const best = [...paying].filter((r) => r.minutes >= 60).sort((a, b) => (b.revenue - b.costs) / b.minutes - (a.revenue - a.costs) / a.minutes)[0];
            return best ? (
              <>
                <div className="kpi-v">{m((best.revenue - best.costs) / (best.minutes / 60))}<span className="small"> /h</span></div>
                <div className="kpi-s ellipsis">{best.name}</div>
              </>
            ) : (
              <>
                <div className="kpi-v">—</div>
                <div className="kpi-s">Track time to compare</div>
              </>
            );
          })()}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No client revenue in this period. Link your transactions to a project or a client to see them here.</div>
      ) : (
        <>
          <div className="grid-2 stretch">
            <div className="card" style={{ gap: '1rem' }}>
              <div className="head">
                <div className="card-title">Revenue by client</div>
                <span className="small">Click a client for its notes and contacts</span>
              </div>
              <HBars
                format={m}
                items={rows
                  .filter((r) => r.revenue > 0)
                  .map((r) => ({
                    id: r.id,
                    label: r.name,
                    value: r.revenue,
                    color: r.color,
                    onClick: r.client ? () => setEditing(r.client!) : undefined,
                    sub: (
                      <>
                        {r.projects.size} {r.projects.size === 1 ? 'project' : 'projects'}
                        {r.revenue ? ` · ${pct(((r.revenue - r.costs) / r.revenue) * 100)} margin` : ''}
                        {r.minutes >= 1 ? ` · ${fmtDuration(r.minutes)} · ${m((r.revenue - r.costs) / (r.minutes / 60))}/h` : ''}
                      </>
                    ),
                  }))}
              />
            </div>
            <div className="card" style={{ gap: '1rem' }}>
              <div className="card-title">Share of revenue</div>
              <Donut
                format={m}
                slices={rows.filter((r) => r.revenue > 0).slice(0, 7).concat(
                  rows.filter((r) => r.revenue > 0).length > 7
                    ? [{ ...rows[0], id: 'rest', name: 'Others', color: 'var(--c-exp)', revenue: rows.filter((r) => r.revenue > 0).slice(7).reduce((a, r) => a + r.revenue, 0) }]
                    : [],
                ).map((r) => ({ id: r.id, label: r.name, value: r.revenue, color: r.color }))}
                center={<><b>{paying.length}</b><span>clients</span></>}
              />
            </div>
          </div>

          <div className="card" style={{ gap: '1rem' }}>
            <div className="head">
              <div className="card-title">Monthly revenue by client</div>
              <span className="small">Last 12 months · hover a month for the detail</span>
            </div>
            <StackedBars labels={months.map((k) => fmtMonth(k))} series={monthly} format={(n) => compactMoney(n, cur)} />
            <div className="chart-legend">
              {monthly.map((s) => (
                <span key={s.id}><span className="swatch" style={{ background: s.color }} />{s.label}</span>
              ))}
            </div>
          </div>

          <div className="grid-2 stretch">
            <div className="card" style={{ gap: '1rem' }}>
              <div className="card-title">Top projects</div>
              {projectRows.length ? (
                <HBars
                  format={m}
                  items={projectRows.map((p) => ({
                    id: p.id,
                    label: projectName(p.id),
                    value: p.revenue,
                    color: p.color,
                    onClick: () => openProject(p.id),
                    sub: `${p.client} · ${pct(((p.revenue - p.costs) / p.revenue) * 100)} margin${p.minutes >= 1 ? ` · ${fmtDuration(p.minutes)}` : ''}`,
                  }))}
                />
              ) : (
                <div className="small">No revenue linked to a project in this period.</div>
              )}
            </div>
            <div className="card" style={{ gap: '1rem' }}>
              <div className="card-title">Margin by client</div>
              <HBars
                format={m}
                items={rows
                  .filter((r) => r.revenue || r.costs)
                  .map((r) => ({ ...r, margin: r.revenue - r.costs - r.tax }))
                  .sort((a, b) => b.margin - a.margin)
                  .map((r) => ({
                    id: r.id,
                    label: r.name,
                    value: Math.max(0, r.margin),
                    color: r.color,
                    sub: `${m(r.revenue)} revenue − ${m(r.costs)} costs − ${m(r.tax)} taxes`,
                  }))}
              />
            </div>
          </div>

          <div className="card" style={{ gap: '0.375rem' }}>
            <div className="head">
              <div className="card-title">All clients</div>
              <span className="small">Click a row to see its projects</span>
            </div>
            <div className="table-wrap">
              <div className="trow th t-clients">
                <span>Client</span><span className="r">Revenue</span><span className="r">Costs</span><span className="r">Taxes</span><span className="r">Net</span>
                <span className="r">Time</span><span className="r">Per hour</span><span className="r">To collect</span><span>Last payment</span>
              </div>
              {rows.map((r) => {
                const net = r.revenue - r.costs - r.tax;
                return (
                  <Fragment key={r.id}>
                    <button type="button" className={'trow t-clients t-click' + (open === r.id ? ' is-open' : '')} onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                      <span className="row ellipsis" style={{ gap: '0.5rem', flexWrap: 'nowrap', fontWeight: 600 }}>
                        <span className="swatch" style={{ background: r.color }} />
                        <span className="ellipsis">{r.name}</span>
                      </span>
                      <span className="r">{m(r.revenue)}</span>
                      <span className="r" style={{ color: 'var(--ink-2)' }}>{m(r.costs)}</span>
                      <span className="r" style={{ color: 'var(--ink-2)' }}>{m(r.tax)}</span>
                      <span className="r" style={{ fontWeight: 700, color: net < 0 ? 'var(--red)' : net > 0 ? 'var(--green)' : undefined }}>{m(net)}</span>
                      <span className="r" style={{ color: 'var(--ink-2)' }}>{r.minutes >= 1 ? fmtDuration(r.minutes) : '—'}</span>
                      <span className="r" style={{ fontWeight: 600 }}>{r.minutes >= 1 ? m((r.revenue - r.costs) / (r.minutes / 60)) : '—'}</span>
                      <span className="r" style={{ color: r.unpaid ? 'var(--amber)' : 'var(--faint)' }}>{r.unpaid ? m(r.unpaid) : '—'}</span>
                      <span className="small">{r.last ? fmtDate(r.last, true) : '—'}</span>
                    </button>
                    {open === r.id && (
                      <div className="client-detail">
                        {[...r.projects.entries()].map(([id, p]) => (
                          <button type="button" key={id} className="trow t-clients t-click sub" onClick={() => openProject(id)}>
                            <span className="ellipsis">↳ {projectName(id)}</span>
                            <span className="r">{m(p.revenue)}</span>
                            <span className="r">{m(p.costs)}</span>
                            <span className="r">—</span>
                            <span className="r">{m(p.revenue - p.costs)}</span>
                            <span className="r">{p.minutes >= 1 ? fmtDuration(p.minutes) : '—'}</span>
                            <span className="r">{p.minutes >= 1 ? m((p.revenue - p.costs) / (p.minutes / 60)) : '—'}</span>
                            <span /><span />
                          </button>
                        ))}
                        {r.projects.size === 0 && <div className="small" style={{ padding: '0.5rem 0.75rem' }}>No project linked: revenue entered directly for this client.</div>}
                        {r.client && (
                          <div className="row" style={{ padding: '0.5rem 0.75rem', gap: '0.5rem' }}>
                            <button className="btn sm outline" onClick={() => setEditing(r.client!)}>Notes &amp; contacts ({r.client.contacts.length})</button>
                          </div>
                        )}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </>
      )}
      {editing && <ClientModal client={editing} update={update} onClose={() => setEditing(null)} />}
    </section>
  );
}
