import { useState } from 'react';
import { DatePicker } from '../components/Calendar';
import { Donut, StackedBars, compactMoney } from '../components/Charts';
import { ColorPicker } from '../components/ColorPicker';
import { useConfirm } from '../components/Confirm';
import { Select } from '../components/Select';
import { useToast } from '../components/Toast';
import { Field, IconPencil, IconPlus, IconSearch, IconTrash, Modal, Seg } from '../components/ui';
import { parseAmount } from '../lib/finance';
import { fmtDate, fmtMonth, isoDate, monthKey, shiftMonth, uid } from '../lib/format';
import { locale, t, tn } from '../lib/i18n';
import { useQuotes } from '../lib/quotes';
import {
  CYCLES, PRESETS, SUB_CATEGORIES, SUB_CURRENCIES, cycleLabel, daysUntil, isActive, monthlyOf, nextPayment, paidSoFar, paymentDates,
} from '../lib/subscriptions';
import { removeRow } from '../lib/undo';
import { convert, fxRates } from '../lib/wealth';
import type { AppData, Subscription } from '../types';

type Update = (fn: (d: AppData) => AppData) => void;
type Filter = 'all' | 'business' | 'personal' | 'cancelled';
type Sort = 'next' | 'price' | 'name';

const FX_SYMBOLS = ['EURUSD=X', 'EURMAD=X', 'EURAED=X'];
const CAT_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

/** Amount with cents: subscriptions are small sums. */
const price = (n: number, c: string) => {
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${c}`;
  }
};
const initials = (name: string) => name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const inDays = (d: number) => (d === 0 ? t('today') : d === 1 ? t('tomorrow') : tn(d, 'in {n} day', 'in {n} days'));

export default function SubscriptionsPage({ data, update }: { data: AppData; update: Update }) {
  const cur = data.profile.currency || 'EUR';
  const feed = useQuotes(FX_SYMBOLS, '1mo');
  const fx = fxRates(data, feed.quotes);
  const toEur = (s: Subscription, n: number) => convert(n, s.currency, cur, fx);
  const today = isoDate();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('next');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Subscription | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const subs = data.subscriptions;
  const active = subs.filter((s) => isActive(s, today));
  const perMonth = (list: Subscription[]) => list.reduce((a, s) => a + toEur(s, monthlyOf(s)), 0);
  const monthly = perMonth(active);
  const business = perMonth(active.filter((s) => s.scope === 'business'));
  const personal = monthly - business;
  const upcoming = active
    .map((s) => ({ s, next: nextPayment(s, today) }))
    .filter((x) => x.next)
    .sort((a, b) => a.next.localeCompare(b.next));
  const soon = upcoming[0];

  // Every payment of the next 30 days (a weekly one can come up several times).
  const end30 = new Date(today + 'T12:00:00');
  end30.setDate(end30.getDate() + 30);
  const in30 = active
    .flatMap((s) => paymentDates(s, isoDate(end30)).filter((d) => d >= today).map((d) => ({ s, d })))
    .sort((a, b) => a.d.localeCompare(b.d));
  const in30Total = in30.reduce((a, x) => a + toEur(x.s, x.s.amount), 0);

  // What was actually paid, month by month, last 12 months.
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(monthKey(), i - 11));
  const paidBy = (scope: Subscription['scope']) =>
    months.map((k) => subs.filter((s) => s.scope === scope).reduce((a, s) => a + paymentDates(s, today).filter((d) => d.startsWith(k)).length * toEur(s, s.amount), 0));
  const paid12 = { business: paidBy('business'), personal: paidBy('personal') };
  const paid12Total = [...paid12.business, ...paid12.personal].reduce((a, n) => a + n, 0);

  const cats = [...new Set(active.map((s) => s.category))]
    .map((c, i) => ({ id: c, label: t(c), color: CAT_COLORS[i % CAT_COLORS.length], value: perMonth(active.filter((s) => s.category === c)) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((x, i) => ({ ...x, color: CAT_COLORS[i % CAT_COLORS.length] }));

  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const shown = subs
    .filter((s) => (filter === 'cancelled' ? !isActive(s, today) : isActive(s, today) && (filter === 'all' || s.scope === filter)))
    .filter((s) => !q.trim() || norm(`${s.name} ${s.category} ${t(s.category)} ${s.payment}`).includes(norm(q.trim())))
    .sort((a, b) =>
      sort === 'price' ? toEur(b, monthlyOf(b)) - toEur(a, monthlyOf(a))
        : sort === 'name' ? a.name.localeCompare(b.name, locale())
          : (nextPayment(a, today) || a.end || '9').localeCompare(nextPayment(b, today) || b.end || '9'));
  const cancelledCount = subs.length - active.length;

  const newSub = (): Subscription => ({
    id: uid(), name: '', category: 'Other', scope: 'personal', amount: 0, currency: cur, cycle: 'monthly', start: today, end: '',
    payment: '', notes: '', color: '', position: subs.reduce((a, x) => Math.max(a, x.position), -1) + 1,
  });
  const setEnd = (s: Subscription, end: string) => update((d) => ({ ...d, subscriptions: d.subscriptions.map((x) => (x.id === s.id ? { ...x, end } : x)) }));
  const cancel = (s: Subscription) => {
    setEnd(s, today);
    toast(<>{t('Cancelled:')} <b>{s.name}</b></>, { undo: () => setEnd(s, s.end) });
  };
  const resume = (s: Subscription) => {
    setEnd(s, '');
    toast(<>{t('Active again:')} <b>{s.name}</b></>, { tone: 'success', undo: () => setEnd(s, s.end) });
  };
  const remove = async (s: Subscription) => {
    if (!(await confirm({ title: t('Delete this subscription?'), message: t('"{name}" and its history will be deleted. To keep the history, cancel it instead.', { name: s.name }), confirmLabel: t('Delete'), danger: true }))) return;
    const { restore } = removeRow(data, 'subscriptions', s.id);
    update((d) => removeRow(d, 'subscriptions', s.id).data);
    toast(<>{t('Deleted:')} <b>{s.name}</b></>, { undo: () => update(restore) });
  };

  return (
    <section className="section loose">
      <div className="head">
        <div className="head-title">
          <h1>{t('Subscriptions')}</h1>
          <span className="sub">{t('Everything you pay for again and again, business and personal')}</span>
        </div>
        <button className="btn" onClick={() => setEditing(newSub())}><IconPlus size={13} /> {t('Add a subscription')}</button>
      </div>

      {subs.length === 0 ? (
        <div className="empty wealth-empty">
          <b>{t('No subscription yet.')}</b>
          <span>{t('Add ChatGPT, Claude, OVH, Netflix, Amazon Prime… with their price and payment day. You will see what they cost per month and per year, and what is due next.')}</span>
          <button className="btn sm" style={{ alignSelf: 'center' }} onClick={() => setEditing(newSub())}>{t('Add a subscription')}</button>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi kpi-accent">
              <div className="kpi-k">{t('Per month')}</div>
              <div className="kpi-v">{price(monthly, cur)}</div>
              <div className="kpi-s">{t('{amount} per year', { amount: price(monthly * 12, cur) })} · {tn(active.length, '{n} active', '{n} active')}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k"><span className="dot" style={{ background: 'var(--accent)' }} />{t('Business')}</div>
              <div className="kpi-v">{price(business, cur)}</div>
              <div className="kpi-s">{t('per month · {amount} per year', { amount: price(business * 12, cur) })}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k"><span className="dot" style={{ background: 'var(--mauve)' }} />{t('Personal')}</div>
              <div className="kpi-v">{price(personal, cur)}</div>
              <div className="kpi-s">{t('per month · {amount} per year', { amount: price(personal * 12, cur) })}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">{t('Next payment')}</div>
              <div className="kpi-v">{soon ? price(soon.s.amount, soon.s.currency) : '—'}</div>
              <div className="kpi-s">{soon ? `${soon.s.name} · ${inDays(daysUntil(soon.next, today))}` : t('Nothing due')}</div>
            </div>
          </div>

          <div className="grid-2 stretch">
            <div className="card" style={{ gap: '0.75rem' }}>
              <div className="head">
                <div className="card-title">{t('Coming up, next 30 days')}</div>
                <span className="small">{in30.length ? t('{amount} in total', { amount: price(in30Total, cur) }) : ''}</span>
              </div>
              <div className="sub-upcoming">
                {in30.slice(0, 8).map(({ s, d }) => {
                  const n = daysUntil(d, today);
                  return (
                    <button key={s.id + d} className="sub-up" onClick={() => setEditing(s)}>
                      <span className={'up-date' + (n <= 3 ? ' today' : '')}>{n <= 1 ? inDays(n) : fmtDate(d, true)}</span>
                      <span className="sub-up-name ellipsis"><span className="swatch" style={{ background: s.color || 'var(--faint)' }} />{s.name}</span>
                      <b>{price(s.amount, s.currency)}</b>
                    </button>
                  );
                })}
                {in30.length > 8 && <div className="small">{t('+ {n} more', { n: in30.length - 8 })}</div>}
                {in30.length === 0 && <div className="empty">{t('No payment in the next 30 days.')}</div>}
              </div>
            </div>
            <div className="card" style={{ gap: '1rem' }}>
              <div className="head">
                <div className="card-title">{t('Per month, by category')}</div>
                <span className="small">{t('Active only, in {currency}', { currency: cur })}</span>
              </div>
              {cats.length ? (
                <Donut slices={cats} format={(n) => price(n, cur)} center={<><b>{price(monthly, cur)}</b><span>{t('per month')}</span></>} />
              ) : (
                <div className="empty">{t('No active subscription.')}</div>
              )}
            </div>
          </div>

          {paid12Total > 0 && (
            <div className="card" style={{ gap: '0.75rem' }}>
              <div className="head">
                <div className="card-title">{t('Paid, last 12 months')}</div>
                <span className="small">{t('{amount} in total · in {currency}', { amount: price(paid12Total, cur), currency: cur })}</span>
              </div>
              <StackedBars
                labels={months.map((k) => fmtMonth(k))}
                series={[
                  { id: 'business', label: t('Business'), color: 'var(--accent)', values: paid12.business },
                  { id: 'personal', label: t('Personal'), color: 'var(--mauve)', values: paid12.personal },
                ]}
                format={(n) => compactMoney(n, cur)}
                height={180}
              />
            </div>
          )}

          <div className="card" style={{ gap: '0.75rem' }}>
            <div className="sub-tools">
              <Seg
                label={t('Show')}
                value={filter}
                onChange={setFilter}
                options={[
                  ['all', t('All')],
                  ['business', t('Business')],
                  ['personal', t('Personal')],
                  ...(cancelledCount ? [['cancelled', `${t('Cancelled')} · ${cancelledCount}`] as [Filter, string]] : []),
                ]}
              />
              <label className="search">
                <IconSearch />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search a subscription')} aria-label={t('Search a subscription')} />
              </label>
              <Select<Sort>
                value={sort}
                onChange={setSort}
                size="sm"
                ariaLabel={t('Sort')}
                options={[{ value: 'next', label: t('Next payment first') }, { value: 'price', label: t('Most expensive first') }, { value: 'name', label: t('By name') }]}
              />
            </div>
            <div className="sub-list">
              {shown.map((s) => {
                const next = nextPayment(s, today);
                const n = next ? daysUntil(next, today) : 0;
                const paid = paidSoFar(s, today);
                return (
                  <div key={s.id} className={'sub-row' + (isActive(s, today) ? '' : ' stopped')} role="button" tabIndex={0}
                    onClick={(e) => !(e.target as HTMLElement).closest('button') && setEditing(s)}
                    onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && setEditing(s)}>
                    <span className="sub-logo" style={{ background: s.color || 'var(--chip)', color: s.color ? '#fff' : 'var(--ink-2)' }}>{initials(s.name)}</span>
                    <span className="sub-main">
                      <b className="ellipsis">{s.name}</b>
                      <span className="small ellipsis">{[t(s.category), t(cycleLabel(s.cycle)), s.payment].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className={'sub-scope ' + s.scope}>{s.scope === 'business' ? t('Business') : t('Personal')}</span>
                    <span className="sub-next">
                      {next ? <><b>{fmtDate(next, next.slice(0, 4) === today.slice(0, 4))}</b><span className={'small' + (n <= 3 ? ' soon' : '')}>{inDays(n)}</span></>
                        : <><b>{t('Cancelled')}</b><span className="small">{s.end ? fmtDate(s.end, s.end.slice(0, 4) === today.slice(0, 4)) : ''}</span></>}
                    </span>
                    <span className="sub-price">
                      <b>{price(s.amount, s.currency)}</b>
                      <span className="small">{s.cycle === 'monthly' ? (s.currency !== cur ? `≈ ${price(toEur(s, s.amount), cur)}` : t('per month')) : t('≈ {amount} / month', { amount: price(toEur(s, monthlyOf(s)), cur) })}</span>
                    </span>
                    <span className="sub-paid small" title={tn(paid.count, '{n} payment so far', '{n} payments so far')}>{t('{amount} paid', { amount: price(toEur(s, paid.total), cur) })}</span>
                    <span className="sub-actions">
                      {isActive(s, today)
                        ? <button className="btn sm ghost" onClick={() => cancel(s)}>{t('Cancel')}</button>
                        : <button className="btn sm ghost" onClick={() => resume(s)}>{t('Resume')}</button>}
                      <button className="icon-btn" onClick={() => setEditing(s)} aria-label={t('Edit {name}', { name: s.name })} title={t('Edit')}><IconPencil /></button>
                      <button className="icon-btn danger" onClick={() => void remove(s)} aria-label={t('Delete {name}', { name: s.name })} title={t('Delete')}><IconTrash size={13} /></button>
                    </span>
                  </div>
                );
              })}
              {shown.length === 0 && <div className="empty">{q ? t('Nothing matches "{q}".', { q }) : t('Nothing here.')}</div>}
            </div>
            {fx.USD !== 1 && subs.some((s) => s.currency !== cur) && (
              <div className="small">{t('Other currencies converted at 1 € = {usd} USD · {mad} MAD · {aed} AED.', {
                usd: fx.USD.toFixed(2), mad: fx.MAD.toFixed(2), aed: fx.AED.toFixed(2),
              })}</div>
            )}
          </div>
        </>
      )}

      {editing && <SubscriptionModal sub={editing} data={data} update={update} cur={cur} toEur={(s, n) => toEur(s, n)} onClose={() => setEditing(null)} />}
    </section>
  );
}

function SubscriptionModal({ sub, data, update, cur, toEur, onClose }: {
  sub: Subscription; data: AppData; update: Update; cur: string; toEur: (s: Subscription, n: number) => number; onClose: () => void;
}) {
  const creating = !data.subscriptions.some((s) => s.id === sub.id);
  const [f, setF] = useState(sub);
  const [amount, setAmount] = useState(sub.amount ? String(sub.amount) : '');
  const toast = useToast();
  const a = amount.trim() ? parseAmount(amount) : null;
  const ok = !!f.name.trim() && a !== null && a > 0 && !!f.start && (!f.end || f.end >= f.start);
  const draft: Subscription = { ...f, amount: a ?? 0 };
  const next = ok ? nextPayment(draft) : '';
  const categories = [...new Set([...SUB_CATEGORIES, ...data.subscriptions.map((s) => s.category), f.category])];

  const save = () => {
    if (!ok || a === null) return;
    const next: Subscription = { ...f, name: f.name.trim(), payment: f.payment.trim(), amount: a };
    update((d) => ({ ...d, subscriptions: creating ? [...d.subscriptions, next] : d.subscriptions.map((s) => (s.id === next.id ? next : s)) }));
    toast(<>{creating ? t('Added:') : t('Saved:')} <b>{next.name}</b></>, { tone: 'success' });
    onClose();
  };
  const pick = (p: (typeof PRESETS)[number]) => setF({ ...f, name: p.name, category: p.category, currency: p.currency, scope: p.scope, color: p.color });

  return (
    <Modal title={creating ? t('New subscription') : t('Edit subscription')} onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {creating && (
          <div className="sub-presets" aria-label={t('Quick pick')}>
            {PRESETS.map((p) => (
              <button type="button" key={p.name} className={'sub-preset' + (f.name === p.name ? ' on' : '')} onClick={() => pick(p)}>
                <span className="swatch" style={{ background: p.color }} />{p.name}
              </button>
            ))}
          </div>
        )}
        <div className="form-grid">
          <Field label={t('Name')}><input className="input" autoFocus={!creating} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ChatGPT Plus" /></Field>
          <Field label={t('Category')}>
            <Select value={f.category} onChange={(category) => setF({ ...f, category })} options={categories.map((c) => ({ value: c, label: t(c) }))} onCreate={(c) => c.trim()} ariaLabel={t('Category')} />
          </Field>
          <Field label={t('Amount per payment')}><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="20" /></Field>
          <Field label={t('Currency')}><Select value={f.currency} onChange={(currency) => setF({ ...f, currency })} options={SUB_CURRENCIES.map((c) => ({ value: c, label: c }))} ariaLabel={t('Currency')} /></Field>
          <Field label={t('Billed')}><Select value={f.cycle} onChange={(cycle) => setF({ ...f, cycle })} options={CYCLES.map((c) => ({ value: c.key, label: t(c.label) }))} ariaLabel={t('Billed')} /></Field>
          <Field label={t('For')}><Seg label={t('For')} value={f.scope} onChange={(scope) => setF({ ...f, scope })} options={[['business', t('Business')], ['personal', t('Personal')]]} /></Field>
          <Field label={t('First payment')}><DatePicker value={f.start} onChange={(start) => setF({ ...f, start })} clearable={false} ariaLabel={t('First payment')} /></Field>
          <Field label={t('Cancelled on (optional)')}><DatePicker value={f.end} onChange={(end) => setF({ ...f, end })} placeholder={t('Still active')} ariaLabel={t('Cancelled on')} /></Field>
          <Field label={t('Paid with (optional)')}><input className="input" value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value })} placeholder={t('Card, PayPal…')} /></Field>
          <Field label={t('Colour')}><ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} /></Field>
        </div>
        <Field label={t('Notes')}><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t('Account email, plan, when to cancel…')} /></Field>
        {amount.trim() && a === null && <div className="small form-error">{t('Invalid price. Examples: 20 · 6,99 · 119.88')}</div>}
        {f.end && f.end < f.start && <div className="small form-error">{t('The cancel date is before the first payment.')}</div>}
        {ok && (
          <div className="sub-preview small">
            {t('≈ {month} per month · {year} per year', { month: price(toEur(draft, monthlyOf(draft)), cur), year: price(toEur(draft, monthlyOf(draft) * 12), cur) })}
            {next ? ` · ${t('next payment {date}', { date: fmtDate(next) })}` : ''}
          </div>
        )}
        <div className="modal-foot">
          <span />
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>{t('Cancel')}</button>
            <button className="btn sm" type="submit" disabled={!ok}>{creating ? t('Add subscription') : t('Save')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
