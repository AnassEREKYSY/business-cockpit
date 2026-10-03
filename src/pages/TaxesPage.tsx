import { useState } from 'react';
import { DatePicker } from '../components/Calendar';
import { TaxCard } from '../components/TaxCard';
import { useToast } from '../components/Toast';
import { Field, IconPencil, Modal } from '../components/ui';
import { parseAmount } from '../lib/finance';
import { fmtDate, fmtMonth, isoDate, pct, uid } from '../lib/format';
import { locale, t, tn } from '../lib/i18n';
import { rateOn } from '../lib/tax';
import { periodRows, type PeriodRow } from '../lib/urssaf';
import { removeRow } from '../lib/undo';
import type { AppData, TaxPayment } from '../types';

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

export default function TaxesPage({ data, update }: { data: AppData; update: Update }) {
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
    <section className="section loose">
      <div className="head">
        <div className="head-title">
          <h1>{t('Taxes')}</h1>
          <span className="sub">{tax.period === 'month' ? t('URSSAF micro-entreprise, declared and paid every month') : t('URSSAF micro-entreprise, declared and paid every 3 months')}</span>
        </div>
        <a className="btn sm outline" href="https://autoentrepreneur.urssaf.fr" target="_blank" rel="noreferrer">{t('Open URSSAF website')}</a>
      </div>

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
        {rows[0]?.first && (
          <div className="small">
            {t('Your first declaration covers {period}, longer than the next ones. If URSSAF shows a different period, change it in the settings below.', { period: periodLabel(rows[0]) })}
          </div>
        )}
      </div>

      <TaxCard tax={tax} currency={cur} data={data} onChange={(next) => update((d) => ({ ...d, profile: { ...d.profile, tax: next } }))} />

      {editing && <PaymentModal row={editing} data={data} update={update} cur={cur} onClose={() => setEditing(null)} />}
    </section>
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
