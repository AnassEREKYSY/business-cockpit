import { useRef, useState } from 'react';
import { ColorPicker } from '../components/ColorPicker';
import { EntryModal, RecurringModal, catOptions, freqOptions, typeOptions } from '../components/MoneyForms';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { ClientModal } from '../components/ClientModal';
import { isOverdue } from '../lib/stats';
import { isTaxable, taxOf } from '../lib/tax';
import { removeClient, removeRow } from '../lib/undo';
import { DatePicker } from '../components/Calendar';
import { ClientSelect, ProjectSelect } from '../components/pickers';
import { Select } from '../components/Select';
import { Avatar, Field, IconPencil, Seg } from '../components/ui';
import { nextColor } from '../lib/colors';
import { CATEGORIES, CURRENCIES, LOCALE, TYPE_META, catLabel, soft } from '../lib/constants';
import { isActive, isFuture, monthlyEquivalent, parseAmount } from '../lib/finance';
import { fmtDate, isoDate, money, uid } from '../lib/format';
import { demoData, isDay, normalize } from '../lib/store';
import type { Account } from '../App';
import type { AppData, Client, Entry, EntryType, Recurring } from '../types';
import { t, tn } from '../lib/i18n';

type Update = (fn: (d: AppData) => AppData) => void;

const emptyEntry = (): Omit<Entry, 'id' | 'amount'> & { amount: string } => ({
  date: isoDate(), label: '', type: 'revenue', category: CATEGORIES.revenue[0], amount: '', projectId: '', paid: true, due: '', clientId: '',
});
const emptyRec = (): Omit<Recurring, 'id' | 'amount'> & { amount: string } => ({
  label: '', type: 'opex', category: 'Software & SaaS', amount: '', frequency: 'monthly', start: isoDate(), end: '', projectId: '', clientId: '',
});

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c.v, label: c.l }));

export default function DataPage({ data, update, account }: { data: AppData; update: Update; account?: Account }) {
  const P = data.profile;
  const m = (n: number) => money(n, P.currency);
  const projectName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? '';

  const [ef, setEf] = useState(emptyEntry);
  const [rf, setRf] = useState(emptyRec);
  const toast = useToast();
  const [goal, setGoal] = useState(P.revenueGoal ? String(P.revenueGoal) : '');
  const [txFilter, setTxFilter] = useState<'all' | EntryType>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const [editingRec, setEditingRec] = useState<Recurring | null>(null);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const confirm = useConfirm();

  const setProfile = (k: 'name' | 'email' | 'company' | 'currency' | 'avatar', v: string) =>
    update((d) => ({ ...d, profile: { ...d.profile, [k]: v } }));
  const photoRef = useRef<HTMLInputElement>(null);
  const pickPhoto = async (file: File) => {
    try {
      setProfile('avatar', await squarePhoto(file));
    } catch {
      await confirm({ title: t('Photo not recognised'), message: t('Choose a JPEG, PNG or WebP image.'), cancelLabel: null });
    }
  };

  const addEntry = () => {
    const amount = parseAmount(ef.amount);
    if (!amount || !isDay(ef.date)) return;
    const label = ef.label.trim() || catLabel(ef.category);
    const id = uid();
    const revenue = ef.type === 'revenue';
    const clientId = ef.clientId && ef.clientId !== data.projects.find((p) => p.id === ef.projectId)?.clientId ? ef.clientId : '';
    update((d) => ({ ...d, entries: [...d.entries, { id, ...ef, clientId, label, amount, paid: !revenue || ef.paid, due: revenue && !ef.paid ? ef.due : '' }] }));
    setEf({ ...emptyEntry(), type: ef.type, category: ef.category, date: ef.date, projectId: ef.projectId, clientId: ef.clientId });
    toast(<>{t('Transaction added ({type}):', { type: t(TYPE_META[ef.type].label) })} <b>{label}</b> · {m(amount)}{revenue && !ef.paid ? ' ' + t('(unpaid)') : ''}</>, {
      undo: () => update((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== id) })),
    });
  };

  const addRec = () => {
    const amount = parseAmount(rf.amount);
    if (!amount || !rf.label.trim() || !isDay(rf.start)) return;
    const id = uid();
    update((d) => ({ ...d, recurring: [...d.recurring, { id, ...rf, label: rf.label.trim(), amount }] }));
    setRf({ ...emptyRec(), type: rf.type, category: rf.category });
    toast(<>{rf.frequency === 'monthly' ? t('Added, counted every month:') : t('Added, counted every year:')} <b>{rf.label.trim()}</b></>, {
      undo: () => update((d) => ({ ...d, recurring: d.recurring.filter((x) => x.id !== id) })),
    });
  };

  // Stopping keeps the history: charges up to today stay, nothing is charged after.
  const stopRec = (r: Recurring) =>
    update((d) => ({ ...d, recurring: d.recurring.map((x) => (x.id === r.id ? { ...x, end: isoDate() } : x)) }));
  // Restarting opens a new period from today, so the months while it was stopped stay uncharged.
  const restartRec = (r: Recurring) =>
    update((d) => ({ ...d, recurring: [...d.recurring, { ...r, id: uid(), start: isoDate(), end: '' }] }));
  // Deleting removes the whole history; Undo brings it back. "Stop" keeps the history.
  const removeRec = (r: Recurring) => {
    const { restore } = removeRow(data, 'recurring', r.id);
    update((d) => removeRow(d, 'recurring', r.id).data);
    toast(<>{t('Deleted with its history:')} <b>{r.label}</b></>, { undo: () => update(restore) });
  };
  const removeEntry = (e: Entry) => {
    const { restore } = removeRow(data, 'entries', e.id);
    update((d) => removeRow(d, 'entries', e.id).data);
    toast(<>{t('Deleted:')} <b>{e.label}</b></>, { undo: () => update(restore) });
  };
  const togglePaid = (e: Entry) => {
    update((d) => ({ ...d, entries: d.entries.map((x) => (x.id === e.id ? { ...x, paid: !x.paid } : x)) }));
    toast(e.paid ? <>{t('Marked unpaid:')} <b>{e.label}</b></> : <>{t('Marked paid:')} <b>{e.label}</b></>, {
      tone: e.paid ? 'default' : 'success',
      undo: () => update((d) => ({ ...d, entries: d.entries.map((x) => (x.id === e.id ? { ...x, paid: e.paid } : x)) })),
    });
  };
  const saveGoal = (raw: string) => {
    const v = raw.trim() ? parseAmount(raw) : 0;
    if (v === null) return setGoal(P.revenueGoal ? String(P.revenueGoal) : '');
    update((d) => ({ ...d, profile: { ...d.profile, revenueGoal: v } }));
  };

  const rank = (r: Recurring) => (isActive(r) ? 0 : isFuture(r) ? 1 : 2);
  const recSorted = [...data.recurring].sort((a, b) => rank(a) - rank(b) || monthlyEquivalent(b) - monthlyEquivalent(a));
  const efAmount = parseAmount(ef.amount);
  const rfAmount = parseAmount(rf.amount);
  const badAmount = t('Invalid amount. Examples: 1200 · 1 200 · 1200.50');
  const burn = data.recurring.filter((r) => isActive(r) && r.type !== 'revenue').reduce((a, r) => a + monthlyEquivalent(r), 0);

  const entries = [...data.entries]
    .filter((e) => txFilter === 'all' || e.type === txFilter)
    .sort((a, b) => b.date.localeCompare(a.date));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cockpit-backup-${isoDate()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async (file: File) => {
    let parsed: AppData | null = null;
    try {
      parsed = JSON.parse(await file.text()) as AppData;
      if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.entries)) parsed = null;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      await confirm({ title: t('File not recognised'), message: t('This file is not a valid Cockpit backup.'), cancelLabel: null });
      return;
    }
    const ok = await confirm({
      title: t('Import this backup?'),
      message: t('All your current data will be replaced by the data in this file.'),
      confirmLabel: t('Replace'),
      danger: true,
    });
    if (!ok) return;
    const before = data;
    update(() => normalize(parsed));
    toast(t('Backup imported'), { undo: () => update(() => before) });
  };
  const loadDemo = async () => {
    const ok = await confirm({
      title: t('Load demo data?'),
      message: t('Your current data will be replaced by demo data.'),
      confirmLabel: t('Replace'),
      danger: true,
    });
    if (!ok) return;
    const before = data;
    update((d) => demoData(d.profile));
    toast(t('Demo data loaded'), { undo: () => update(() => before) });
  };
  const clearAll = async () => {
    const ok = await confirm({
      title: t('Clear everything?'),
      message: t('Clients, projects (with their briefs and journals), tasks, transactions, recurring costs, tracked time, subscriptions, investments and real estate will be deleted. Your profile is kept.'),
      confirmLabel: t('Clear everything'),
      danger: true,
    });
    if (!ok) return;
    const before = data;
    update((d) => ({
      ...d, clients: [], projects: [], tasks: [], entries: [], recurring: [], notes: [], investments: [], timeEntries: [],
      assets: [], trades: [], assetPrices: [], properties: [], propertyEntries: [], subscriptions: [], taxPayments: [],
    }));
    toast(t('Everything cleared'), { undo: () => update(() => before) });
  };

  const openProjects = data.projects.filter((p) => p.status !== 'Done' || p.id === ef.projectId || p.id === rf.projectId);

  return (
    <section className="section loose">
      <h1>{t('Data & profile')}</h1>

      <div className="grid-2">
        <div className="card">
          <div className="row" style={{ gap: '0.875rem', flexWrap: 'nowrap' }}>
            <button type="button" className="avatar-edit" onClick={() => photoRef.current?.click()} title={t('Change photo')} aria-label={t('Change photo')}>
              <Avatar name={P.name} photo={P.avatar} large />
              <span className="avatar-edit-badge"><IconPencil /></span>
            </button>
            <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickPhoto(f); e.target.value = ''; }} />
            <div>
              <div className="card-title">{t('Profile')}</div>
              <div className="small">
                {t('Your details and currency.')}{' '}
                {P.avatar && <button type="button" className="link-btn" onClick={() => setProfile('avatar', '')}>{t('Remove photo')}</button>}
              </div>
            </div>
          </div>
          <div className="form-grid">
            <Field label={t('Name')}><input className="input" value={P.name} onChange={(e) => setProfile('name', e.target.value)} /></Field>
            <Field label={t('Email')}><input className="input" type="email" value={P.email} onChange={(e) => setProfile('email', e.target.value)} /></Field>
            <Field label={t('Company')}><input className="input" value={P.company} onChange={(e) => setProfile('company', e.target.value)} /></Field>
            <Field label={t('Currency')}>
              <Select value={P.currency} onChange={(v) => setProfile('currency', v)} options={CURRENCY_OPTIONS} ariaLabel={t('Currency')} />
            </Field>
            <Field label={t('Monthly revenue goal ({currency})', { currency: P.currency })}>
              <input
                className="input"
                inputMode="decimal"
                value={goal}
                placeholder={t('Optional')}
                onChange={(e) => setGoal(e.target.value)}
                onBlur={(e) => saveGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </Field>
          </div>
        </div>

        <div className="card">
          <div>
            <div className="card-title">{t('New transaction')}</div>
            <div className="small">{t('A paid invoice, a one-off expense. Direct cost = tied to a project (subcontracting…). Operating expense = what it takes to run the business.')}</div>
          </div>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); addEntry(); }}>
            <Field label={t('Date')}><DatePicker value={ef.date} onChange={(date) => setEf({ ...ef, date })} clearable={false} ariaLabel={t('Date')} /></Field>
            <Field label={t('Label')}><input className="input" value={ef.label} onChange={(e) => setEf({ ...ef, label: e.target.value })} placeholder={t('Invoice for client X')} /></Field>
            <Field label={t('Type')}>
              <Select value={ef.type} onChange={(t) => setEf({ ...ef, type: t, category: CATEGORIES[t][0] })} options={typeOptions()} ariaLabel={t('Type')} />
            </Field>
            <Field label={t('Category')}>
              <Select value={ef.category} onChange={(category) => setEf({ ...ef, category })} options={catOptions(ef.type)} ariaLabel={t('Category')} />
            </Field>
            <Field label={t('Project (optional)')}>
              <ProjectSelect projects={openProjects} clients={data.clients} value={ef.projectId} onChange={(projectId) => setEf({ ...ef, projectId })} />
            </Field>
            <Field label={t('Client (optional)')}>
              <ClientSelect data={data} update={update} value={ef.clientId} onChange={(clientId) => setEf({ ...ef, clientId })} inherited={data.clients.find((c) => c.id === data.projects.find((p) => p.id === ef.projectId)?.clientId)} />
            </Field>
            <Field label={t('Amount excl. tax ({currency})', { currency: P.currency })}><input className="input" inputMode="decimal" value={ef.amount} onChange={(e) => setEf({ ...ef, amount: e.target.value })} placeholder="0" /></Field>
            {ef.type === 'revenue' && (
              <Field label={t('Payment')}>
                <Seg label={t('Payment')} value={ef.paid ? 'paid' : 'unpaid'} onChange={(v) => setEf({ ...ef, paid: v === 'paid' })} options={[['paid', t('Paid')], ['unpaid', t('Waiting')]]} />
              </Field>
            )}
            {ef.type === 'revenue' && !ef.paid && (
              <Field label={t('Payment due')}>
                <DatePicker value={ef.due} onChange={(due) => setEf({ ...ef, due })} min={ef.date} placeholder={t('No due date')} ariaLabel={t('Payment due')} />
              </Field>
            )}
            <button className="btn tall" type="submit" disabled={!efAmount}>{t('Add')}</button>
          </form>
          {ef.amount.trim() && !efAmount && <div className="small" style={{ color: 'var(--red)' }}>{badAmount}</div>}
        </div>
      </div>

      <div className="card row" style={{ justifyContent: 'space-between', gap: '0.75rem' }}>
        <div>
          <div className="card-title">{t('Taxes · micro-entreprise')}</div>
          <div className="small">{t('Rates, ACRE and URSSAF payments are in the Taxes tab.')}</div>
        </div>
        <a className="btn sm outline" href="#/taxes">{t('Open Taxes')}</a>
      </div>

      <Clients data={data} update={update} />

      <div className="card" style={{ gap: '0.875rem' }}>
        <div className="head">
          <div>
            <div className="card-title">{t('Recurring business income & costs')} <span className="small" style={{ fontWeight: 500 }}>{data.recurring.length}</span></div>
            <div className="small">{t('Software, fixed subcontracting, rent, client retainers. Enter them once, they are counted automatically every month.')}</div>
          </div>
          {burn > 0 && <div className="pill" style={{ ...soft('#f59e0b'), fontSize: '0.75rem' }}>{t('{amount} / month in fixed costs', { amount: m(burn) })}</div>}
        </div>
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); addRec(); }}>
          <Field label={t('Name')}><input className="input" value={rf.label} onChange={(e) => setRf({ ...rf, label: e.target.value })} placeholder={t('Notion, freelancer, retainer…')} /></Field>
          <Field label={t('Type')}>
            <Select value={rf.type} onChange={(t) => setRf({ ...rf, type: t, category: CATEGORIES[t][0] })} options={typeOptions()} ariaLabel={t('Type')} />
          </Field>
          <Field label={t('Category')}>
            <Select value={rf.category} onChange={(category) => setRf({ ...rf, category })} options={catOptions(rf.type)} ariaLabel={t('Category')} />
          </Field>
          <Field label={t('Amount excl. tax ({currency})', { currency: P.currency })}><input className="input" inputMode="decimal" value={rf.amount} onChange={(e) => setRf({ ...rf, amount: e.target.value })} placeholder="0" /></Field>
          <Field label={t('Frequency')}>
            <Select value={rf.frequency} onChange={(frequency) => setRf({ ...rf, frequency })} options={freqOptions()} ariaLabel={t('Frequency')} />
          </Field>
          <Field label={t('Since')}><DatePicker value={rf.start} onChange={(start) => setRf({ ...rf, start })} clearable={false} ariaLabel={t('Since')} /></Field>
          <Field label={t('Project (optional)')}>
            <ProjectSelect projects={openProjects} clients={data.clients} value={rf.projectId} onChange={(projectId) => setRf({ ...rf, projectId })} />
          </Field>
          <button className="btn tall" type="submit" disabled={!rf.label.trim() || !rfAmount}>{t('Add')}</button>
        </form>
        {rf.amount.trim() && !rfAmount && <div className="small" style={{ color: 'var(--red)' }}>{badAmount}</div>}
        {data.recurring.length > 0 && (
          <div className="table-wrap">
            <div className="trow th t-recur"><span>{t('Name')}</span><span>{t('Type')}</span><span>{t('Category')}</span><span className="r">{t('Amount')}</span><span className="r">{t('Per month')}</span><span /><span /></div>
            {recSorted.map((r) => {
              const active = isActive(r);
              const future = isFuture(r);
              return (
                <div className={'trow t-recur' + (active || future ? '' : ' stopped')} key={r.id}>
                  <span style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>{r.label}</div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
                      {future
                        ? t('Starts {date}', { date: fmtDate(r.start) }) + (r.end ? ` → ${fmtDate(r.end)}` : '')
                        : active
                          ? t('Since {date}', { date: fmtDate(r.start) }) + (r.end ? ' · ' + t('ends {date}', { date: fmtDate(r.end) }) : '')
                          : t('Stopped · {start} → {end}', { start: fmtDate(r.start), end: fmtDate(r.end) })}
                      {r.projectId && projectName(r.projectId) ? ` · ${projectName(r.projectId)}` : ''}
                    </div>
                  </span>
                  <span className="tag" style={{ justifySelf: 'start', background: TYPE_META[r.type].bg, color: TYPE_META[r.type].color }}>{t(TYPE_META[r.type].short)}</span>
                  <span className="ellipsis" style={{ color: 'var(--ink-2)' }}>{catLabel(r.category)}</span>
                  <span className="r">{m(r.amount)}<span className="small"> {r.frequency === 'monthly' ? t('/month') : t('/year')}</span></span>
                  <span className="r" style={{ fontWeight: 700, color: r.type === 'revenue' ? 'var(--green)' : undefined }}>{m(monthlyEquivalent(r))}</span>
                  {future ? <span /> : (
                    <button className="btn sm ghost" style={{ padding: '0.25rem 0.375rem' }} onClick={() => (active ? stopRec(r) : restartRec(r))}>{active ? t('Stop') : t('Restart')}</button>
                  )}
                  <span className="row-actions">
                    <button className="icon-btn" onClick={() => setEditingRec(r)} title={t('Edit')} aria-label={t('Edit {name}', { name: r.label })}><IconPencil /></button>
                    <button className="icon-btn danger" onClick={() => removeRec(r)} title={t('Delete')} aria-label={t('Delete {name}', { name: r.label })}>
                      <span style={{ fontSize: '1.0625rem', lineHeight: 1 }}>×</span>
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>


      <div className="card" style={{ gap: '0.875rem' }}>
        <div className="head">
          <div>
            <div className="card-title">{t('Logged transactions')} <span className="small" style={{ fontWeight: 500 }}>{data.entries.length}</span></div>
            <div className="small">{t('Click a line to edit it. Revenue shows its gross amount, with the net after taxes below.')}</div>
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <Seg label={t('Filter by type')} value={txFilter} onChange={setTxFilter} options={[['all', t('All')], ['revenue', t('Revenue')], ['direct', t('Direct')], ['opex', t('Operating')]]} />
          </div>
        </div>
        <div className="table-wrap scroll">
          <div className="trow th t-entries"><span>{t('Date')}</span><span>{t('Label')}</span><span>{t('Type')}</span><span>{t('Category')}</span><span>{t('Client · project')}</span><span>{t('Status')}</span><span className="r">{t('Amount')}</span><span /></div>
          {entries.map((e) => (
            <div
              className="trow t-entries t-edit"
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={(ev) => !(ev.target as HTMLElement).closest('button') && setEditingEntry(e)}
              onKeyDown={(ev) => ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setEditingEntry(e))}
              title={t('Edit this transaction')}
            >
              <span style={{ color: 'var(--muted)' }}>{fmtDate(e.date, true)}{e.date.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${e.date.slice(0, 4)}` : ''}</span>
              <span className="ellipsis" style={{ fontWeight: 600 }}>{e.label}</span>
              <span className="tag" style={{ justifySelf: 'start', background: TYPE_META[e.type].bg, color: TYPE_META[e.type].color }}>{t(TYPE_META[e.type].short)}</span>
              <span className="ellipsis" style={{ color: 'var(--ink-2)' }}>{catLabel(e.category)}</span>
              <span className="ellipsis" style={{ color: 'var(--muted)' }}>
                {[clientName(e.clientId || data.projects.find((p) => p.id === e.projectId)?.clientId || ''), projectName(e.projectId)].filter(Boolean).join(' · ') || '—'}
              </span>
              {e.type === 'revenue' ? (
                <button
                  className={'pay-chip' + (e.paid ? ' paid' : isOverdue(e) ? ' late' : ' waiting')}
                  onClick={() => togglePaid(e)}
                  title={e.paid ? t('Mark as unpaid') : t('Mark as paid')}
                >
                  {e.paid ? t('Paid') : isOverdue(e) ? t('Late') : t('Waiting')}
                </button>
              ) : <span className="small">—</span>}
              <span className="r amount-cell">
                <b style={{ color: e.type === 'revenue' ? 'var(--green)' : 'var(--ink)' }}>{e.type === 'revenue' ? '+ ' : '− '}{m(e.amount)}</b>
                {isTaxable(e) && <span className="small">{t('net {amount}', { amount: m(e.amount - taxOf(e, P.tax)) })}</span>}
              </span>
              <span className="row-actions">
                <button className="icon-btn" onClick={() => setEditingEntry(e)} title={t('Edit')} aria-label={t('Edit {name}', { name: e.label })}><IconPencil /></button>
                <button className="icon-btn danger" title={t('Delete')} aria-label={t('Delete {name}', { name: e.label })} onClick={() => removeEntry(e)}>
                  <span style={{ fontSize: '1.0625rem', lineHeight: 1 }}>×</span>
                </button>
              </span>
            </div>
          ))}
          {entries.length === 0 && <div className="empty" style={{ marginTop: '0.75rem' }}>{t('No transactions logged yet. Subscriptions are counted separately, automatically.')}</div>}
        </div>
      </div>

      <div className="card" style={{ gap: '0.75rem' }}>
        <div>
          <div className="card-title">{account ? t('Account & backup') : t('Backup')}</div>
          <div className="small">
            {account
              ? t('Signed in as {email}. Everything is saved online automatically; the export is a spare copy.', { email: account.email })
              : t('Your data stays in this browser. Export a backup from time to time.')}
          </div>
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          <button className="btn sm outline" onClick={exportJson}>{t('Export (.json)')}</button>
          <button className="btn sm outline" onClick={() => fileRef.current?.click()}>{t('Import a backup')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} />
          <button className="btn sm outline" onClick={() => void loadDemo()}>{t('Load demo data')}</button>
          <button className="btn sm danger" onClick={() => void clearAll()}>{t('Clear everything')}</button>
          {account && <button className="btn sm ghost" onClick={account.signOut}>{t('Sign out')}</button>}
        </div>
      </div>
      {editingRec && <RecurringModal item={editingRec} data={data} update={update} onClose={() => setEditingRec(null)} />}
      {editingEntry && <EntryModal entry={editingEntry} data={data} update={update} onClose={() => setEditingEntry(null)} />}
    </section>
  );
}

/* ---------------- Clients ---------------- */

function Clients({ data, update }: { data: AppData; update: Update }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(() => nextColor(data.clients.map((c) => c.color)));
  const [dup, setDup] = useState('');
  const [details, setDetails] = useState<Client | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  // A task counts for the client it is tagged with, or else for its project's client (as on the board).
  const projectClient = new Map(data.projects.map((p) => [p.id, p.clientId]));
  const uses = (id: string) => ({
    projects: data.projects.filter((p) => p.clientId === id).length,
    tasks: data.tasks.filter((t) => (t.clientId || projectClient.get(t.projectId)) === id).length,
  });
  const edit = (id: string, patch: Partial<Client>) =>
    update((d) => ({ ...d, clients: d.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const existing = data.clients.find((c) => c.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      setDup(t('"{name}" already exists. Change its colour with its dot below.', { name: existing.name }));
      return;
    }
    update((d) => ({ ...d, clients: [...d.clients, { id: uid(), name: n, color, notes: '', contacts: [] }].sort((a, b) => a.name.localeCompare(b.name, LOCALE)) }));
    setDup('');
    setName('');
    setColor(nextColor([...data.clients.map((c) => c.color), color]));
  };
  const remove = async (c: Client) => {
    const u = uses(c.id);
    const ok = await confirm({
      title: t('Delete this client?'),
      message: (
        <>
          {t('"{name}" will be deleted.', { name: c.name })}{' '}
          {u.projects || u.tasks
            ? t('Its {projects} and {tasks} will stay, with no client.', { projects: tn(u.projects, '{n} project', '{n} projects'), tasks: tn(u.tasks, '{n} task', '{n} tasks') })
            : t('It is not linked to any project or task.')}
        </>
      ),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    const { restore } = removeClient(data, c.id);
    update((d) => removeClient(d, c.id).data);
    toast(<>{t('Client deleted:')} <b>{c.name}</b></>, { undo: () => update(restore) });
  };

  return (
    <div className="card" style={{ gap: '0.875rem' }}>
      <div>
        <div className="card-title">{t('Clients')} <span className="small" style={{ fontWeight: 500 }}>{data.clients.length}</span></div>
        <div className="small">{t('Each client has its own colour, shown on its projects and as a label on its tasks. Click a dot to change it.')}</div>
      </div>
      <form className="row" style={{ gap: '0.625rem', flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <ColorPicker value={color} onChange={setColor} label={t('New client colour')} />
        <input className="input" value={name} onChange={(e) => { setName(e.target.value); setDup(''); }} placeholder={t('Client name')} aria-label={t('Client name')} />
        <button className="btn tall" type="submit" disabled={!name.trim()}>{t('Add')}</button>
      </form>
      {dup && <div className="small" role="status" style={{ color: 'var(--red)' }}>{dup}</div>}
      {data.clients.length > 0 && (
        <div>
          {data.clients.map((c) => {
            const u = uses(c.id);
            return (
              <div className="client-row" key={c.id}>
                <ColorPicker value={c.color} onChange={(hex) => edit(c.id, { color: hex })} label={t('{name} colour', { name: c.name })} />
                <input
                  key={c.name}
                  className="input"
                  defaultValue={c.name}
                  aria-label={t('Client name: {name}', { name: c.name })}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== c.name) edit(c.id, { name: v });
                    else e.target.value = c.name;
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span className="client-use">{tn(u.projects, '{n} project', '{n} projects')} · {tn(u.tasks, '{n} task', '{n} tasks')}</span>
                <button className="btn sm ghost" onClick={() => setDetails(c)} title={t('Notes and contacts')}>{c.contacts.length ? tn(c.contacts.length, '{n} contact', '{n} contacts') : t('Contacts')}</button>
                <button className="x" onClick={() => void remove(c)} aria-label={t('Delete {name}', { name: c.name })}>×</button>
              </div>
            );
          })}
        </div>
      )}
      {details && <ClientModal client={details} update={update} onClose={() => setDetails(null)} />}
    </div>
  );
}

/** Center-crop an image to a square and shrink it to 256px JPEG, small enough to live in the profile row. */
function squarePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas'));
      // Portraits: keep a bit more of the top, where the face usually is.
      const sy = img.height > img.width ? Math.max(0, (img.height - side) * 0.3) : (img.height - side) / 2;
      ctx.fillStyle = '#fff'; // JPEG has no transparency: without this, transparent PNGs turn black
      ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(img, (img.width - side) / 2, sy, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    img.src = url;
  });
}
