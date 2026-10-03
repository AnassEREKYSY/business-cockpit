import { useState } from 'react';
import { DatePicker } from '../components/Calendar';
import { TaxCard } from '../components/TaxCard';
import { useToast } from '../components/Toast';
import { Field, IconPencil, IconPlus, IconTrash, Modal, Seg } from '../components/ui';
import { Select } from '../components/Select';
import { useConfirm } from '../components/Confirm';
import { parseAmount } from '../lib/finance';
import { fmtDate, fmtMonth, isoDate, pct, uid } from '../lib/format';
import { locale, t, tn } from '../lib/i18n';
import { rateOn } from '../lib/tax';
import { periodRows, type PeriodRow } from '../lib/urssaf';
import { useQuotes } from '../lib/quotes';
import { fxRates, type Fx } from '../lib/wealth';
import { SOURCES, TAX_TEMPLATES, autoBase, figures, isAuto, sourceLabel } from '../lib/taxItems';
import { removeRow } from '../lib/undo';
import type { AppData, TaxItem, TaxPayment } from '../types';

type Update = (fn: (d: AppData) => AppData) => void;

const eur = (n: number, c: string) => {
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: c, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${c}`;
  }
};
const days = (iso: string, today: string) => Math.round((Date.parse(iso + 'T12:00:00') - Date.parse(today + 'T12:00:00')) / 86_400_000);

/** "Apr – Jun 2026", "Oct 2026", or "1 Apr – 30 Sep 2026" for an uneven first period. */
function periodLabel(p: { start: string; end: string }) {
  const sm = p.start.slice(0, 7);
  const em = p.end.slice(0, 7);
  const fullStart = p.start.endsWith('-01');
  if (sm === em && fullStart) return fmtMonth(sm, true);
  const y = p.end.slice(0, 4);
  const from = fullStart ? fmtMonth(sm) + (p.start.slice(0, 4) !== y ? ` ${p.start.slice(0, 4)}` : '') : fmtDate(p.start, p.start.slice(0, 4) === y);
  return `${from} – ${fmtMonth(em)} ${y}`;
}

const TAB_KEY = 'cockpit.taxesTab';
const FX_SYMBOLS = ['EURUSD=X', 'EURMAD=X', 'EURAED=X'];

export default function TaxesPage({ data, update }: { data: AppData; update: Update }) {
  const [tab, setTabState] = useState<'business' | 'personal'>(() => {
    try {
      return localStorage.getItem(TAB_KEY) === 'personal' ? 'personal' : 'business';
    } catch {
      return 'business';
    }
  });
  const setTab = (next: 'business' | 'personal') => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* not remembered */
    }
  };
  const feed = useQuotes(FX_SYMBOLS, '1mo');
  const fx = fxRates(data, feed.quotes);
  return (
    <section className="section loose">
      <div className="head">
        <div className="head-title">
          <h1>{t('Taxes')}</h1>
          <span className="sub">{tab === 'business' ? t('URSSAF and other business taxes') : t('Taxes on your investments, rents and other personal income')}</span>
        </div>
        {tab === 'business' && <a className="btn sm outline" href="https://autoentrepreneur.urssaf.fr" target="_blank" rel="noreferrer">{t('Open URSSAF website')}</a>}
        {tab === 'personal' && <a className="btn sm outline" href="https://www.impots.gouv.fr" target="_blank" rel="noreferrer">{t('Open impots.gouv.fr')}</a>}
      </div>
      <Seg label={t('Section')} value={tab} onChange={setTab} options={[['business', t('Business · URSSAF')], ['personal', t('Personal')]]} />
      <div className="page-tab section loose" key={tab}>
        {tab === 'business' ? (
          <>
            <UrssafSection data={data} update={update} />
            <TaxItems scope="business" data={data} update={update} fx={fx} />
          </>
        ) : (
          <TaxItems scope="personal" data={data} update={update} fx={fx} />
        )}
      </div>
    </section>
  );
}

function UrssafSection({ data, update }: { data: AppData; update: Update }) {
  const cur = data.profile.currency || 'EUR';
  const m = (n: number) => eur(n, cur);
  const today = isoDate();
  const tax = data.profile.tax;
  const rows = periodRows(data, today).filter((r) => r.status !== 'upcoming');
  const [editing, setEditing] = useState<PeriodRow | null>(null);
  const [showAll, setShowAll] = useState(false);

  const late = rows.filter((r) => r.status === 'late');
  // Next deadline: an unpaid period that has ended (late first), else the period running now.
  const next = late[0] ?? rows.find((r) => r.status === 'due') ?? rows.find((r) => r.status === 'open');
  const year = today.slice(0, 4);
  const paidYear = data.taxPayments.filter((p) => (p.paidOn || p.periodEnd).startsWith(year)).reduce((a, p) => a + p.amount, 0);
  const owed = rows.filter((r) => r.status === 'late' || r.status === 'due').reduce((a, r) => a + r.estimate.total, 0);
  const yearRows = rows.filter((r) => r.end.startsWith(year) || r.start.startsWith(year));
  const estYear = yearRows.reduce((a, r) => a + (r.payment ? r.payment.amount : r.estimate.total), 0);
  const now = rateOn(tax, today);
  const shown = showAll ? [...rows].reverse() : [...rows].reverse().slice(0, 6);

  return (
    <>
      <div className="small">{tax.period === 'month' ? t('URSSAF micro-entreprise, declared and paid every month') : t('URSSAF micro-entreprise, declared and paid every 3 months')}</div>

      {late.length > 0 && (
        <div className="banner">
          {tn(late.length, '{n} period is past its deadline and not marked as paid.', '{n} periods are past their deadline and not marked as paid.')}{' '}
          {t('If you already paid, record it so the figures stay right.')}
        </div>
      )}

      {next ? (
        <div className={'tax-next' + (next.status === 'late' ? ' is-late' : '')}>
          <div className="tax-next-main">
            <span className="tax-next-k">{next.status === 'late' ? t('Overdue URSSAF payment') : t('Next URSSAF payment')}</span>
            <b className="tax-next-date">{fmtDate(next.deadline)}</b>
            <span className="tax-next-s">
              {next.status === 'late'
                ? tn(-days(next.deadline, today), '{n} day late', '{n} days late')
                : tn(days(next.deadline, today), 'in {n} day', 'in {n} days')}
              {' · '}{t('declare and pay for {period}', { period: periodLabel(next) })}
              {next.status === 'open' ? ` · ${t('period still running, the amount will grow')}` : ''}
            </span>
          </div>
          <div className="tax-next-amount">
            <span className="tax-next-k">{t('Estimated amount')}</span>
            <b>{m(next.estimate.total)}</b>
            <span className="tax-next-s">{t('on {amount} cashed in', { amount: m(next.estimate.gross) })}</span>
          </div>
          <button className="btn tax-next-btn" onClick={() => setEditing(next)}>
            {t('I paid it')}
          </button>
        </div>
      ) : (
        <div className="empty wealth-empty">
          <b>{t('Set your business start date below to see your URSSAF calendar.')}</b>
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-k">{t('Paid in {year}', { year })}</div>
          <div className="kpi-v">{m(paidYear)}</div>
          <div className="kpi-s">{tn(data.taxPayments.filter((p) => (p.paidOn || p.periodEnd).startsWith(year)).length, '{n} payment recorded', '{n} payments recorded')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t('Still to pay')}</div>
          <div className="kpi-v" style={{ color: late.length ? 'var(--red)' : undefined }}>{m(owed)}</div>
          <div className="kpi-s">{t('Periods ended, not marked as paid')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t('Total {year}', { year })}</div>
          <div className="kpi-v">{m(estYear)}</div>
          <div className="kpi-s">{t('Paid + estimated, periods of the year so far')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t('Rate today')}</div>
          <div className="kpi-v">{pct(now.total)}</div>
          <div className="kpi-s">{now.acre ? t('With ACRE until {date}', { date: fmtDate(tax.acreUntil) }) : t('{social} URSSAF + {cfp} CFP', { social: pct(now.social), cfp: pct(now.cfp) }) + (tax.vl ? ' + ' + t('{p} income tax', { p: pct(now.vl) }) : '')}</div>
        </div>
      </div>

      <div className="card" style={{ gap: '0.5rem' }}>
        <div className="head">
          <div>
            <div className="card-title">{t('Periods')}</div>
            <div className="small">{t('Estimated from the revenue you cashed in. Record what you actually declared and paid.')}</div>
          </div>
        </div>
        <div className="table-wrap">
          <div className="trow th t-tax">
            <span>{t('Period')}</span><span>{t('Deadline')}</span><span className="r">{t('Revenue')}</span><span className="r">{t('Estimated')}</span>
            <span className="r">{t('Paid')}</span><span>{t('Status')}</span><span />
          </div>
          {shown.map((r) => <TaxRow key={r.start} r={r} cur={cur} today={today} onEdit={() => setEditing(r)} />)}
        </div>
        {rows.length > 6 && <button className="link-btn small" onClick={() => setShowAll(!showAll)}>{showAll ? t('Show fewer') : t('Show all {n} periods', { n: rows.length })}</button>}
        <div className="small">
          {tax.firstEnd
            ? t('Your first declaration covers {period}, as set in the settings below.', { period: periodLabel(rows[0] ?? { start: tax.start, end: tax.firstEnd }) })
            : t('Each quarter counts the revenue cashed in during its months, 0 when nothing came in.')}
        </div>
      </div>

      <TaxCard tax={tax} currency={cur} data={data} onChange={(next) => update((d) => ({ ...d, profile: { ...d.profile, tax: next } }))} />

      {editing && <PaymentModal row={editing} data={data} update={update} cur={cur} onClose={() => setEditing(null)} />}
    </>
  );
}

function TaxRow({ r, cur, today, onEdit }: { r: PeriodRow; cur: string; today: string; onEdit: () => void }) {
  const m = (n: number) => eur(n, cur);
  const d = days(r.deadline, today);
  const chip = {
    paid: <span className="pay-chip paid">{t('Paid')}</span>,
    due: <span className="pay-chip waiting">{tn(d, 'Due in {n} day', 'Due in {n} days')}</span>,
    late: <span className="pay-chip late">{tn(-d, '{n} day late', '{n} days late')}</span>,
    open: <span className="pay-chip">{t('In progress')}</span>,
    upcoming: <span className="pay-chip">{t('Not started')}</span>,
  }[r.status];
  const diff = r.payment ? r.payment.amount - r.estimate.total : 0;
  return (
    <div role="button" tabIndex={0} className="trow t-tax t-click" onClick={onEdit} onKeyDown={(e) => e.key === 'Enter' && onEdit()}>
      <span><b>{periodLabel(r)}</b>{r.first && <span className="small" style={{ display: 'block' }}>{t('First declaration')}</span>}</span>
      <span>{fmtDate(r.deadline, r.deadline.slice(0, 4) === today.slice(0, 4))}</span>
      <span className="r">{m(r.payment ? r.payment.revenue : r.estimate.gross)}{r.payment && Math.abs(r.payment.revenue - r.estimate.gross) >= 1 && <span className="small" style={{ display: 'block' }}>{t('{amount} in the app', { amount: m(r.estimate.gross) })}</span>}</span>
      <span className="r" style={{ color: 'var(--ink-2)' }}>{m(r.estimate.total)}</span>
      <span className="r">
        {r.payment ? <b>{m(r.payment.amount)}</b> : '—'}
        {r.payment && Math.abs(diff) >= 1 && <span className="small" style={{ display: 'block' }}>{diff > 0 ? '+' : '−'}{m(Math.abs(diff))} {t('vs estimate')}</span>}
      </span>
      <span>{chip}</span>
      <span className="row-actions"><span className="icon-btn" aria-hidden="true"><IconPencil /></span></span>
    </div>
  );
}

function PaymentModal({ row, data, update, cur, onClose }: { row: PeriodRow; data: AppData; update: Update; cur: string; onClose: () => void }) {
  const p = row.payment;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const [revenue, setRevenue] = useState(String(p ? p.revenue : round2(row.estimate.gross)));
  const [amount, setAmount] = useState(String(p ? p.amount : round2(row.estimate.total)));
  const [paidOn, setPaidOn] = useState(p?.paidOn || (row.deadline < isoDate() ? isoDate() : row.deadline));
  const [notes, setNotes] = useState(p?.notes ?? '');
  const toast = useToast();
  const rv = revenue.trim() ? parseAmount(revenue) : 0;
  const am = amount.trim() ? parseAmount(amount) : 0;
  const ok = rv !== null && am !== null;
  const m = (n: number) => eur(n, cur);
  const rate = rv ? ((am ?? 0) / rv) * 100 : 0;

  const save = () => {
    if (!ok) return;
    const next: TaxPayment = { id: p?.id ?? uid(), periodStart: row.start, periodEnd: row.end, revenue: rv ?? 0, amount: am ?? 0, paidOn, notes };
    update((d) => ({ ...d, taxPayments: [...d.taxPayments.filter((x) => x.id !== next.id), next].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)) }));
    toast(<>{t('Recorded for {period}:', { period: periodLabel(row) })} <b>{m(next.amount)}</b></>, { tone: 'success' });
    onClose();
  };
  const remove = () => {
    if (!p) return;
    const { restore } = removeRow(data, 'taxPayments', p.id);
    update((d) => removeRow(d, 'taxPayments', p.id).data);
    toast(t('Payment removed'), { undo: () => update(restore) });
    onClose();
  };

  return (
    <Modal title={t('URSSAF · {period}', { period: periodLabel(row) })} onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="tax-est">
          <div><span className="small">{t('Cashed in (app)')}</span><b>{m(row.estimate.gross)}</b></div>
          <div><span className="small">{t('Estimated')}</span><b>{m(row.estimate.total)}</b></div>
          <div><span className="small">{t('Deadline')}</span><b>{fmtDate(row.deadline)}</b></div>
        </div>
        <div className="small">
          {t('Social {a} · CFP {b}', { a: m(row.estimate.social), b: m(row.estimate.cfp) })}{row.estimate.vl ? ` · ${t('income tax {amount}', { amount: m(row.estimate.vl) })}` : ''}
        </div>
        <div className="form-grid">
          <Field label={t('Revenue declared ({currency})', { currency: cur })}><input className="input" inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} /></Field>
          <Field label={t('Amount paid ({currency})', { currency: cur })}><input className="input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={t('Paid on')}><DatePicker value={paidOn} onChange={setPaidOn} placeholder={t('Date')} ariaLabel={t('Paid on')} /></Field>
        </div>
        <Field label={t('Notes')}><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Declaration number, anything URSSAF said…')} /></Field>
        {!ok && <div className="small form-error">{t('Invalid amount. Examples: 1 250 · 139,50')}</div>}
        {ok && rv ? <div className="small">{t('That is {p} of the revenue declared.', { p: pct(rate) })}</div> : null}
        <div className="modal-foot">
          {p ? <button className="btn sm danger" type="button" onClick={remove}>{t('Remove payment')}</button> : <span />}
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>{t('Cancel')}</button>
            <button className="btn sm" type="submit" disabled={!ok}>{p ? t('Save') : t('Record payment')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Other taxes: CFE, investments, rents… ---------------- */

function TaxItems({ scope, data, update, fx }: { scope: TaxItem['scope']; data: AppData; update: Update; fx: Fx }) {
  const cur = data.profile.currency || 'EUR';
  const m = (n: number) => eur(n, cur);
  const today = isoDate();
  const thisYear = new Date().getFullYear();
  const mine = data.taxItems.filter((x) => x.scope === scope);
  const years = [...new Set([thisYear, ...mine.map((x) => x.year)])].sort((a, b) => b - a);
  const [year, setYear] = useState(scope === 'personal' ? thisYear : 0);
  const [editing, setEditing] = useState<TaxItem | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const list = mine.filter((x) => !year || x.year === year).map((x) => ({ x, f: figures(data, x, cur, fx) }));
  const sum = (k: 'due' | 'left') => list.reduce((a, r) => a + r.f[k], 0);
  const paid = list.reduce((a, r) => a + r.x.paid, 0);
  const next = list.filter((r) => r.f.left > 0 && r.x.dueDate).sort((a, b) => a.x.dueDate.localeCompare(b.x.dueDate))[0];

  const fromTemplate = (tp: (typeof TAX_TEMPLATES)[number] | null): TaxItem => {
    const y = year || thisYear;
    return {
      id: uid(), scope, year: y, name: tp ? tp.name : '', source: tp ? tp.source : 'manual', base: null, rate: tp ? tp.rate : 0, withheld: 0,
      dueAmount: null, dueDate: tp ? tp.due(y) : '', paid: 0, paidOn: '', notes: tp ? tp.notes : '',
    };
  };
  const remove = async (x: TaxItem) => {
    if (!(await confirm({ title: t('Delete this tax?'), message: t('"{name}" will be deleted.', { name: x.name }), confirmLabel: t('Delete'), danger: true }))) return;
    const { restore } = removeRow(data, 'taxItems', x.id);
    update((d) => removeRow(d, 'taxItems', x.id).data);
    toast(<>{t('Deleted:')} <b>{x.name}</b></>, { undo: () => update(restore) });
  };
  const templates = TAX_TEMPLATES.filter((tp) => tp.scope === scope);

  return (
    <div className="card" style={{ gap: '0.75rem' }}>
      <div className="head">
        <div>
          <div className="card-title">{scope === 'business' ? t('Other business taxes') : t('Personal taxes')}</div>
          <div className="small">{scope === 'business' ? t('CFE and anything else your business pays besides URSSAF.') : t('Investments in France and abroad, rents, income tax, property tax… Estimates come from your Wealth data.')}</div>
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          {scope === 'personal' && years.length > 1 && (
            <Seg label={t('Tax year')} value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => [String(y), String(y)] as [string, string])} />
          )}
          <button className="btn sm" onClick={() => setAdding(!adding)}><IconPlus size={12} /> {t('Add a tax')}</button>
        </div>
      </div>

      {adding && (
        <div className="tax-templates">
          {templates.map((tp) => (
            <button key={tp.name} className="sub-preset" onClick={() => { setAdding(false); setEditing(fromTemplate(tp)); }}>{t(tp.name)}</button>
          ))}
          <button className="sub-preset" onClick={() => { setAdding(false); setEditing(fromTemplate(null)); }}><IconPlus size={11} /> {t('Something else')}</button>
        </div>
      )}

      {scope === 'personal' && list.length > 0 && (
        <div className="tax-est">
          <div><span className="small">{t('Due for {year}', { year: year || thisYear })}</span><b>{m(sum('due'))}</b></div>
          <div><span className="small">{t('Paid')}</span><b>{m(paid)}</b></div>
          <div><span className="small">{next ? t('Next: {name}', { name: next.x.name }) : t('Left to pay')}</span><b>{next ? `${m(next.f.left)} · ${fmtDate(next.x.dueDate, true)}` : m(sum('left'))}</b></div>
        </div>
      )}

      <div className="table-wrap">
        {list.length > 0 && (
          <div className="trow th t-item">
            <span>{t('Tax')}</span><span className="r">{t('Taxable')}</span><span className="r">{t('Rate')}</span><span className="r">{t('Amount due')}</span>
            <span className="r">{t('Paid')}</span><span>{t('Status')}</span><span />
          </div>
        )}
        {list.map(({ x, f }) => {
          const late = f.left > 0 && x.dueDate && x.dueDate < today;
          const chip = f.due === 0 && !x.paid ? (!x.rate && f.base > 0 && !f.fromNotice ? <span className="pay-chip waiting">{t('To check')}</span> : <span className="pay-chip">{t('Nothing due')}</span>)
            : f.left <= 0 ? <span className="pay-chip paid">{t('Paid')}</span>
              : late ? <span className="pay-chip late">{t('Late')}</span>
                : x.paid > 0 ? <span className="pay-chip waiting">{t('Partly paid')}</span>
                  : x.dueDate ? <span className="pay-chip waiting">{t('Due {date}', { date: fmtDate(x.dueDate, x.dueDate.slice(0, 4) === today.slice(0, 4)) })}</span>
                    : <span className="pay-chip">{t('To check')}</span>;
          return (
            <div key={x.id} role="button" tabIndex={0} className="trow t-item t-click" onClick={(e) => !(e.target as HTMLElement).closest('.icon-btn') && setEditing(x)} onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && setEditing(x)}>
              <span>
                <b className="ellipsis" style={{ display: 'block' }}>{t(x.name)}</b>
                <span className="small">{[scope === 'business' || !year ? String(x.year) : '', t(sourceLabel(x.source)), x.withheld ? t('{amount} withheld', { amount: m(x.withheld) }) : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="r" style={{ color: f.base < 0 ? 'var(--red)' : undefined }}>{x.source === 'manual' && x.base === null ? '—' : m(f.base)}{f.base < 0 && <span className="small" style={{ display: 'block' }}>{t('loss')}</span>}</span>
              <span className="r">{x.rate ? pct(x.rate) : '—'}</span>
              <span className="r"><b>{m(f.due)}</b>{f.fromNotice && <span className="small" style={{ display: 'block' }}>{t('from notice')}</span>}</span>
              <span className="r">{x.paid ? m(x.paid) : '—'}</span>
              <span>{chip}</span>
              <span className="row-actions"><button className="icon-btn danger" onClick={() => void remove(x)} aria-label={t('Delete {name}', { name: x.name })}><IconTrash size={13} /></button></span>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="empty">
            {scope === 'business' ? t('Nothing yet. Add the CFE when you get its notice (none the year the business starts).') : t('Nothing for {year} yet. Add Trade Republic, Bourse de Casablanca or Stake: the taxable amount is worked out from your Wealth data.', { year: year || thisYear })}
          </div>
        )}
      </div>
      {scope === 'personal' && <div className="small">{t('Estimates only, to plan ahead: check each rate for your own situation (tax treaties, option for the progressive scale, losses carried forward).')}</div>}
      {editing && <TaxItemModal item={editing} data={data} update={update} fx={fx} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TaxItemModal({ item, data, update, fx, onClose }: { item: TaxItem; data: AppData; update: Update; fx: Fx; onClose: () => void }) {
  const creating = !data.taxItems.some((x) => x.id === item.id);
  const cur = data.profile.currency || 'EUR';
  const m = (n: number) => eur(n, cur);
  const [f, setF] = useState(item);
  const str = (n: number | null) => (n === null || n === 0 ? '' : String(n));
  const [v, setV] = useState({ base: str(item.base), rate: item.rate ? String(item.rate) : '', withheld: str(item.withheld), due: str(item.dueAmount), paid: str(item.paid) });
  const toast = useToast();
  const num = (s: string) => (s.trim() ? parseAmount(s) : null);
  const rateN = v.rate.trim() ? Number(v.rate.replace(',', '.')) : 0;
  const parsed = { base: num(v.base), withheld: num(v.withheld) ?? 0, due: num(v.due), paid: num(v.paid) ?? 0 };
  const bad = (v.base.trim() && parsed.base === null) || (v.withheld.trim() && num(v.withheld) === null) || (v.due.trim() && parsed.due === null) || (v.paid.trim() && num(v.paid) === null) || !Number.isFinite(rateN) || rateN < 0 || rateN > 100;
  const auto = isAuto(f.source) ? autoBase(data, f.source, f.year, cur, fx) : null;
  const draft: TaxItem = { ...f, base: parsed.base, rate: rateN, withheld: parsed.withheld, dueAmount: parsed.due, paid: parsed.paid };
  const fig = figures(data, draft, cur, fx);
  const ok = !!f.name.trim() && !bad && Number.isInteger(f.year);

  const save = () => {
    if (!ok) return;
    const next = { ...draft, name: f.name.trim() };
    update((d) => ({ ...d, taxItems: creating ? [...d.taxItems, next] : d.taxItems.map((x) => (x.id === next.id ? next : x)) }));
    toast(<>{creating ? t('Added:') : t('Saved:')} <b>{next.name}</b></>, { tone: 'success' });
    onClose();
  };
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i);

  return (
    <Modal title={creating ? t('New tax') : t(item.name)} onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="form-grid">
          <Field label={t('Name')}><input className="input" autoFocus={creating && !f.name} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('Income tax')} /></Field>
          <Field label={t('Tax year')}><Select value={String(f.year)} onChange={(y) => setF({ ...f, year: Number(y) })} options={years.map((y) => ({ value: String(y), label: String(y) }))} ariaLabel={t('Tax year')} /></Field>
          <Field label={t('Taxable amount from')}>
            <Select value={f.source} onChange={(source) => setF({ ...f, source })} options={SOURCES.filter((s) => f.scope === 'personal' || s.key === 'manual').map((s) => ({ value: s.key, label: t(s.label), hint: undefined }))} ariaLabel={t('Taxable amount from')} />
          </Field>
          <Field label={t('Taxable amount ({currency})', { currency: cur })}>
            <input className="input" inputMode="decimal" value={v.base} onChange={(e) => setV({ ...v, base: e.target.value })} placeholder={auto !== null ? t('Auto: {amount}', { amount: m(auto) }) : '0'} />
          </Field>
          <Field label={t('Rate (%)')}><input className="input" inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} placeholder="31.4" /></Field>
          <Field label={t('Already withheld or paid abroad')}><input className="input" inputMode="decimal" value={v.withheld} onChange={(e) => setV({ ...v, withheld: e.target.value })} placeholder="0" /></Field>
          <Field label={t('Amount due, from the tax notice (optional)')}><input className="input" inputMode="decimal" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} placeholder={t('Estimate: {amount}', { amount: m(fig.estimate) })} /></Field>
          <Field label={t('Due date')}><DatePicker value={f.dueDate} onChange={(dueDate) => setF({ ...f, dueDate })} placeholder={t('Unknown')} ariaLabel={t('Due date')} /></Field>
          <Field label={t('Amount paid ({currency})', { currency: cur })}><input className="input" inputMode="decimal" value={v.paid} onChange={(e) => setV({ ...v, paid: e.target.value })} placeholder="0" /></Field>
          <Field label={t('Paid on')}><DatePicker value={f.paidOn} onChange={(paidOn) => setF({ ...f, paidOn })} placeholder={t('Date')} ariaLabel={t('Paid on')} /></Field>
        </div>
        <Field label={t('Notes')}><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {isAuto(f.source) && <div className="small">{t(SOURCES.find((s) => s.key === f.source)?.hint ?? '')} · {f.year}. {t('Leave the taxable amount empty to keep it automatic.')}</div>}
        {bad && <div className="small form-error">{t('One of the amounts is not valid.')}</div>}
        {ok && (
          <div className="sub-preview small">
            {fig.base < 0 ? t('Loss of {amount}: nothing to pay on it.', { amount: m(-fig.base) }) + ' ' : ''}
            {t('Estimate {estimate} · due {due} · left to pay {left}', { estimate: m(fig.estimate), due: m(fig.due), left: m(fig.left) })}
          </div>
        )}
        <div className="modal-foot">
          <span />
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>{t('Cancel')}</button>
            <button className="btn sm" type="submit" disabled={!ok}>{creating ? t('Add') : t('Save')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
