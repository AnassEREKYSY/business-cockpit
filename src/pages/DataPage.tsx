import { useEffect, useRef, useState } from 'react';
import { ColorPicker } from '../components/ColorPicker';
import { EntryModal, FREQ_OPTIONS, RecurringModal, TYPE_OPTIONS, catOptions } from '../components/MoneyForms';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { ClientModal } from '../components/ClientModal';
import { isOverdue } from '../lib/stats';
import { TAX_PRESETS, acreEnd, isTaxable, rateOn, taxOf, taxesOn } from '../lib/tax';
import type { TaxSettings } from '../types';
import { removeClient, removeRow } from '../lib/undo';
import { DatePicker } from '../components/Calendar';
import { ClientSelect, ProjectSelect } from '../components/pickers';
import { Select } from '../components/Select';
import { Avatar, Field, IconPencil, Seg } from '../components/ui';
import { nextColor } from '../lib/colors';
import { CATEGORIES, CURRENCIES, LOCALE, TYPE_META, catLabel, soft } from '../lib/constants';
import { allTxns, isActive, isFuture, monthlyEquivalent, parseAmount } from '../lib/finance';
import { fmtDate, isoDate, money, pct, uid } from '../lib/format';
import { demoData, isDay, normalize } from '../lib/store';
import type { Account } from '../App';
import type { AppData, Client, Entry, EntryType, Recurring } from '../types';

type Update = (fn: (d: AppData) => AppData) => void;

const emptyEntry = (): Omit<Entry, 'id' | 'amount'> & { amount: string } => ({
  date: isoDate(), label: '', type: 'revenue', category: CATEGORIES.revenue[0], amount: '', projectId: '', paid: true, due: '', clientId: '',
});
const emptyRec = (): Omit<Recurring, 'id' | 'amount'> & { amount: string } => ({
  label: '', type: 'opex', category: 'Software & SaaS', amount: '', frequency: 'monthly', start: isoDate(), end: '', projectId: '', clientId: '',
});

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c.v, label: c.l }));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
      await confirm({ title: 'Photo not recognised', message: 'Choose a JPEG, PNG or WebP image.', cancelLabel: null });
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
    toast(<>{TYPE_META[ef.type].label} <b>{label}</b> added: {m(amount)}{revenue && !ef.paid ? ' (unpaid)' : ''}</>, {
      undo: () => update((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== id) })),
    });
  };

  const addRec = () => {
    const amount = parseAmount(rf.amount);
    if (!amount || !rf.label.trim() || !isDay(rf.start)) return;
    const id = uid();
    update((d) => ({ ...d, recurring: [...d.recurring, { id, ...rf, label: rf.label.trim(), amount }] }));
    setRf({ ...emptyRec(), type: rf.type, category: rf.category });
    toast(<><b>{rf.label.trim()}</b> added, counted every {rf.frequency === 'monthly' ? 'month' : 'year'}</>, {
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
    toast(<><b>{r.label}</b> and its history deleted</>, { undo: () => update(restore) });
  };
  const removeEntry = (e: Entry) => {
    const { restore } = removeRow(data, 'entries', e.id);
    update((d) => removeRow(d, 'entries', e.id).data);
    toast(<><b>{e.label}</b> deleted</>, { undo: () => update(restore) });
  };
  const togglePaid = (e: Entry) => {
    update((d) => ({ ...d, entries: d.entries.map((x) => (x.id === e.id ? { ...x, paid: !x.paid } : x)) }));
    toast(e.paid ? <><b>{e.label}</b> marked unpaid</> : <><b>{e.label}</b> marked paid</>, {
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
  const badAmount = 'Invalid amount. Examples: 1200 · 1 200 · 1200.50';
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
      await confirm({ title: 'File not recognised', message: 'This file is not a valid Cockpit backup.', cancelLabel: null });
      return;
    }
    const ok = await confirm({
      title: 'Import this backup?',
      message: 'All your current data will be replaced by the data in this file.',
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!ok) return;
    const before = data;
    update(() => normalize(parsed));
    toast('Backup imported', { undo: () => update(() => before) });
  };
  const loadDemo = async () => {
    const ok = await confirm({
      title: 'Load demo data?',
      message: 'Your current data will be replaced by demo data.',
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!ok) return;
    const before = data;
    update((d) => demoData(d.profile));
    toast('Demo data loaded', { undo: () => update(() => before) });
  };
  const clearAll = async () => {
    const ok = await confirm({
      title: 'Clear everything?',
      message: 'Clients, projects (with their briefs and journals), tasks, transactions, subscriptions and tracked time will be deleted. Your profile is kept.',
      confirmLabel: 'Clear everything',
      danger: true,
    });
    if (!ok) return;
    const before = data;
    update((d) => ({ ...d, clients: [], projects: [], tasks: [], entries: [], recurring: [], notes: [], investments: [], timeEntries: [] }));
    toast('Everything cleared', { undo: () => update(() => before) });
  };

  const openProjects = data.projects.filter((p) => p.status !== 'Done' || p.id === ef.projectId || p.id === rf.projectId);

  return (
    <section className="section loose">
      <h1>Data &amp; profile</h1>

      <div className="grid-2">
        <div className="card">
          <div className="row" style={{ gap: '0.875rem', flexWrap: 'nowrap' }}>
            <button type="button" className="avatar-edit" onClick={() => photoRef.current?.click()} title="Change photo" aria-label="Change photo">
              <Avatar name={P.name} photo={P.avatar} large />
              <span className="avatar-edit-badge"><IconPencil /></span>
            </button>
            <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickPhoto(f); e.target.value = ''; }} />
            <div>
              <div className="card-title">Profile</div>
              <div className="small">
                Your details and currency.{' '}
                {P.avatar && <button type="button" className="link-btn" onClick={() => setProfile('avatar', '')}>Remove photo</button>}
              </div>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Name"><input className="input" value={P.name} onChange={(e) => setProfile('name', e.target.value)} /></Field>
            <Field label="Email"><input className="input" type="email" value={P.email} onChange={(e) => setProfile('email', e.target.value)} /></Field>
            <Field label="Company"><input className="input" value={P.company} onChange={(e) => setProfile('company', e.target.value)} /></Field>
            <Field label="Currency">
              <Select value={P.currency} onChange={(v) => setProfile('currency', v)} options={CURRENCY_OPTIONS} ariaLabel="Currency" />
            </Field>
            <Field label={`Monthly revenue goal (${P.currency})`}>
              <input
                className="input"
                inputMode="decimal"
                value={goal}
                placeholder="Optional"
                onChange={(e) => setGoal(e.target.value)}
                onBlur={(e) => saveGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </Field>
          </div>
        </div>

        <div className="card">
          <div>
            <div className="card-title">New transaction</div>
            <div className="small">A paid invoice, a one-off expense. Direct cost = tied to a project (subcontracting…). Operating expense = what it takes to run the business.</div>
          </div>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); addEntry(); }}>
            <Field label="Date"><DatePicker value={ef.date} onChange={(date) => setEf({ ...ef, date })} clearable={false} ariaLabel="Date" /></Field>
            <Field label="Label"><input className="input" value={ef.label} onChange={(e) => setEf({ ...ef, label: e.target.value })} placeholder="Invoice for client X" /></Field>
            <Field label="Type">
              <Select value={ef.type} onChange={(t) => setEf({ ...ef, type: t, category: CATEGORIES[t][0] })} options={TYPE_OPTIONS} ariaLabel="Type" />
            </Field>
            <Field label="Category">
              <Select value={ef.category} onChange={(category) => setEf({ ...ef, category })} options={catOptions(ef.type)} ariaLabel="Category" />
            </Field>
            <Field label="Project (optional)">
              <ProjectSelect projects={openProjects} clients={data.clients} value={ef.projectId} onChange={(projectId) => setEf({ ...ef, projectId })} />
            </Field>
            <Field label="Client (optional)">
              <ClientSelect data={data} update={update} value={ef.clientId} onChange={(clientId) => setEf({ ...ef, clientId })} inherited={data.clients.find((c) => c.id === data.projects.find((p) => p.id === ef.projectId)?.clientId)} />
            </Field>
            <Field label={`Amount excl. tax (${P.currency})`}><input className="input" inputMode="decimal" value={ef.amount} onChange={(e) => setEf({ ...ef, amount: e.target.value })} placeholder="0" /></Field>
            {ef.type === 'revenue' && (
              <Field label="Payment">
                <Seg label="Payment" value={ef.paid ? 'paid' : 'unpaid'} onChange={(v) => setEf({ ...ef, paid: v === 'paid' })} options={[['paid', 'Paid'], ['unpaid', 'Waiting']]} />
              </Field>
            )}
            {ef.type === 'revenue' && !ef.paid && (
              <Field label="Payment due">
                <DatePicker value={ef.due} onChange={(due) => setEf({ ...ef, due })} min={ef.date} placeholder="No due date" ariaLabel="Payment due" />
              </Field>
            )}
            <button className="btn tall" type="submit" disabled={!efAmount}>Add</button>
          </form>
          {ef.amount.trim() && !efAmount && <div className="small" style={{ color: 'var(--red)' }}>{badAmount}</div>}
        </div>
      </div>

      <TaxCard tax={P.tax} currency={P.currency} data={data} onChange={(tax) => update((d) => ({ ...d, profile: { ...d.profile, tax } }))} />

      <Clients data={data} update={update} />

      <div className="card" style={{ gap: '0.875rem' }}>
        <div className="head">
          <div>
            <div className="card-title">Subscriptions &amp; recurring <span className="small" style={{ fontWeight: 500 }}>{data.recurring.length}</span></div>
            <div className="small">Software, fixed subcontracting, rent, client retainers. Enter them once, they are counted automatically every month.</div>
          </div>
          {burn > 0 && <div className="pill" style={{ ...soft('#f59e0b'), fontSize: '0.75rem' }}>{m(burn)} / month in fixed costs</div>}
        </div>
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); addRec(); }}>
          <Field label="Name"><input className="input" value={rf.label} onChange={(e) => setRf({ ...rf, label: e.target.value })} placeholder="Notion, freelancer, retainer…" /></Field>
          <Field label="Type">
            <Select value={rf.type} onChange={(t) => setRf({ ...rf, type: t, category: CATEGORIES[t][0] })} options={TYPE_OPTIONS} ariaLabel="Type" />
          </Field>
          <Field label="Category">
            <Select value={rf.category} onChange={(category) => setRf({ ...rf, category })} options={catOptions(rf.type)} ariaLabel="Category" />
          </Field>
          <Field label={`Amount excl. tax (${P.currency})`}><input className="input" inputMode="decimal" value={rf.amount} onChange={(e) => setRf({ ...rf, amount: e.target.value })} placeholder="0" /></Field>
          <Field label="Frequency">
            <Select value={rf.frequency} onChange={(frequency) => setRf({ ...rf, frequency })} options={FREQ_OPTIONS} ariaLabel="Frequency" />
          </Field>
          <Field label="Since"><DatePicker value={rf.start} onChange={(start) => setRf({ ...rf, start })} clearable={false} ariaLabel="Since" /></Field>
          <Field label="Project (optional)">
            <ProjectSelect projects={openProjects} clients={data.clients} value={rf.projectId} onChange={(projectId) => setRf({ ...rf, projectId })} />
          </Field>
          <button className="btn tall" type="submit" disabled={!rf.label.trim() || !rfAmount}>Add</button>
        </form>
        {rf.amount.trim() && !rfAmount && <div className="small" style={{ color: 'var(--red)' }}>{badAmount}</div>}
        {data.recurring.length > 0 && (
          <div className="table-wrap">
            <div className="trow th t-recur"><span>Name</span><span>Type</span><span>Category</span><span className="r">Amount</span><span className="r">Per month</span><span /><span /></div>
            {recSorted.map((r) => {
              const active = isActive(r);
              const future = isFuture(r);
              return (
                <div className={'trow t-recur' + (active || future ? '' : ' stopped')} key={r.id}>
                  <span style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>{r.label}</div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
                      {future
                        ? `Starts ${fmtDate(r.start)}${r.end ? ` → ${fmtDate(r.end)}` : ''}`
                        : active
                          ? `Since ${fmtDate(r.start)}${r.end ? ` · ends ${fmtDate(r.end)}` : ''}`
                          : `Stopped · ${fmtDate(r.start)} → ${fmtDate(r.end)}`}
                      {r.projectId && projectName(r.projectId) ? ` · ${projectName(r.projectId)}` : ''}
                    </div>
                  </span>
                  <span className="tag" style={{ justifySelf: 'start', background: TYPE_META[r.type].bg, color: TYPE_META[r.type].color }}>{TYPE_META[r.type].short}</span>
                  <span className="ellipsis" style={{ color: 'var(--ink-2)' }}>{catLabel(r.category)}</span>
                  <span className="r">{m(r.amount)}<span className="small"> /{r.frequency === 'monthly' ? 'month' : 'year'}</span></span>
                  <span className="r" style={{ fontWeight: 700, color: r.type === 'revenue' ? 'var(--green)' : undefined }}>{m(monthlyEquivalent(r))}</span>
                  {future ? <span /> : (
                    <button className="btn sm ghost" style={{ padding: '0.25rem 0.375rem' }} onClick={() => (active ? stopRec(r) : restartRec(r))}>{active ? 'Stop' : 'Restart'}</button>
                  )}
                  <span className="row-actions">
                    <button className="icon-btn" onClick={() => setEditingRec(r)} title="Edit" aria-label={`Edit ${r.label}`}><IconPencil /></button>
                    <button className="icon-btn danger" onClick={() => removeRec(r)} title="Delete" aria-label={`Delete ${r.label}`}>
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
            <div className="card-title">Logged transactions <span className="small" style={{ fontWeight: 500 }}>{data.entries.length}</span></div>
            <div className="small">Click a line to edit it. Revenue shows its gross amount, with the net after taxes below.</div>
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <Seg label="Filter by type" value={txFilter} onChange={setTxFilter} options={[['all', 'All'], ['revenue', 'Revenue'], ['direct', 'Direct'], ['opex', 'Operating']]} />
          </div>
        </div>
        <div className="table-wrap scroll">
          <div className="trow th t-entries"><span>Date</span><span>Label</span><span>Type</span><span>Category</span><span>Client · project</span><span>Status</span><span className="r">Amount</span><span /></div>
          {entries.map((e) => (
            <div
              className="trow t-entries t-edit"
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={(ev) => !(ev.target as HTMLElement).closest('button') && setEditingEntry(e)}
              onKeyDown={(ev) => ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setEditingEntry(e))}
              title="Edit this transaction"
            >
              <span style={{ color: 'var(--muted)' }}>{fmtDate(e.date, true)}{e.date.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${e.date.slice(0, 4)}` : ''}</span>
              <span className="ellipsis" style={{ fontWeight: 600 }}>{e.label}</span>
              <span className="tag" style={{ justifySelf: 'start', background: TYPE_META[e.type].bg, color: TYPE_META[e.type].color }}>{TYPE_META[e.type].short}</span>
              <span className="ellipsis" style={{ color: 'var(--ink-2)' }}>{catLabel(e.category)}</span>
              <span className="ellipsis" style={{ color: 'var(--muted)' }}>
                {[clientName(e.clientId || data.projects.find((p) => p.id === e.projectId)?.clientId || ''), projectName(e.projectId)].filter(Boolean).join(' · ') || '—'}
              </span>
              {e.type === 'revenue' ? (
                <button
                  className={'pay-chip' + (e.paid ? ' paid' : isOverdue(e) ? ' late' : ' waiting')}
                  onClick={() => togglePaid(e)}
                  title={e.paid ? 'Mark as unpaid' : 'Mark as paid'}
                >
                  {e.paid ? 'Paid' : isOverdue(e) ? 'Late' : 'Waiting'}
                </button>
              ) : <span className="small">—</span>}
              <span className="r amount-cell">
                <b style={{ color: e.type === 'revenue' ? 'var(--green)' : 'var(--ink)' }}>{e.type === 'revenue' ? '+ ' : '− '}{m(e.amount)}</b>
                {isTaxable(e) && <span className="small">net {m(e.amount - taxOf(e, P.tax))}</span>}
              </span>
              <span className="row-actions">
                <button className="icon-btn" onClick={() => setEditingEntry(e)} title="Edit" aria-label={`Edit ${e.label}`}><IconPencil /></button>
                <button className="icon-btn danger" title="Delete" aria-label={`Delete ${e.label}`} onClick={() => removeEntry(e)}>
                  <span style={{ fontSize: '1.0625rem', lineHeight: 1 }}>×</span>
                </button>
              </span>
            </div>
          ))}
          {entries.length === 0 && <div className="empty" style={{ marginTop: '0.75rem' }}>No transactions logged yet. Subscriptions are counted separately, automatically.</div>}
        </div>
      </div>

      <div className="card" style={{ gap: '0.75rem' }}>
        <div>
          <div className="card-title">{account ? 'Account & backup' : 'Backup'}</div>
          <div className="small">
            {account
              ? `Signed in as ${account.email}. Everything is saved online automatically; the export is a spare copy.`
              : 'Your data stays in this browser. Export a backup from time to time.'}
          </div>
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          <button className="btn sm outline" onClick={exportJson}>Export (.json)</button>
          <button className="btn sm outline" onClick={() => fileRef.current?.click()}>Import a backup</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} />
          <button className="btn sm outline" onClick={() => void loadDemo()}>Load demo data</button>
          <button className="btn sm danger" onClick={() => void clearAll()}>Clear everything</button>
          {account && <button className="btn sm ghost" onClick={account.signOut}>Sign out</button>}
        </div>
      </div>
      {editingRec && <RecurringModal item={editingRec} data={data} update={update} onClose={() => setEditingRec(null)} />}
      {editingEntry && <EntryModal entry={editingEntry} data={data} update={update} onClose={() => setEditingEntry(null)} />}
    </section>
  );
}

/* ---------------- Taxes ---------------- */

const ACTIVITY_OPTIONS = [
  ...(Object.keys(TAX_PRESETS) as (keyof typeof TAX_PRESETS)[]).map((k) => ({ value: k as TaxSettings['activity'], label: TAX_PRESETS[k].label })),
  { value: 'custom' as const, label: 'Custom rates' },
];

function RateInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);
  return (
    <Field label={label}>
      <span className="pct-input">
        <input
          className="input"
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => {
            const n = Number(raw.replace(',', '.'));
            if (Number.isFinite(n) && n >= 0 && n <= 100) onChange(Math.round(n * 1000) / 1000);
            else setRaw(String(value));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span>%</span>
      </span>
    </Field>
  );
}

function TaxCard({ tax, currency, data, onChange }: { tax: TaxSettings; currency: string; data: AppData; onChange: (t: TaxSettings) => void }) {
  const today = isoDate();
  const now = rateOn(tax, today);
  const after = { ...tax, acreUntil: '' };
  const later = rateOn(after, today);
  const year = String(new Date().getFullYear());
  const yearTax = taxesOn(allTxns(data).filter((e) => e.date.startsWith(year)), tax);
  const set = (patch: Partial<TaxSettings>) => onChange({ ...tax, ...patch, activity: patch.activity ?? ('social' in patch || 'acre' in patch || 'cfp' in patch || 'vl' in patch ? 'custom' : tax.activity) });
  const pickActivity = (activity: TaxSettings['activity']) => {
    if (activity === 'custom') return onChange({ ...tax, activity });
    const p = TAX_PRESETS[activity];
    onChange({ ...tax, activity, social: p.social, acre: p.acre, cfp: p.cfp, vl: tax.vl ? p.vl : 0 });
  };
  return (
    <div className="card" style={{ gap: '0.875rem' }}>
      <div className="head">
        <div>
          <div className="card-title">Taxes · micro-entreprise</div>
          <div className="small">Used to show gross and net revenue everywhere. Rates are 2026 values: check them each January, and when ACRE ends.</div>
        </div>
        <div className="tax-now">
          <span className="small">Today</span>
          <b>{pct(now.total)}</b>
          {now.acre ? <span className="pay-chip waiting">ACRE</span> : null}
        </div>
      </div>
      <div className="form-grid">
        <Field label="Activity">
          <Select value={tax.activity} onChange={pickActivity} options={ACTIVITY_OPTIONS} ariaLabel="Activity" />
        </Field>
        <Field label="Business started">
          <DatePicker value={tax.start} onChange={(start) => onChange({ ...tax, start, acreUntil: tax.acreUntil ? acreEnd(start) || tax.acreUntil : '' })} placeholder="Unknown" ariaLabel="Business started" />
        </Field>
        <Field label="ACRE until">
          <DatePicker value={tax.acreUntil} onChange={(acreUntil) => onChange({ ...tax, acreUntil })} placeholder="No ACRE" ariaLabel="ACRE until" />
        </Field>
        <Field label="Versement libératoire">
          <Seg label="Versement libératoire" value={tax.vl > 0 ? 'yes' : 'no'} onChange={(v) => set({ vl: v === 'yes' ? (tax.activity !== 'custom' ? TAX_PRESETS[tax.activity].vl : 1.7) : 0, activity: tax.activity })} options={[['yes', 'Yes'], ['no', 'No']]} />
        </Field>
      </div>
      <div className="form-grid">
        <RateInput label="Social contributions" value={tax.social} onChange={(social) => set({ social })} />
        <RateInput label="Social, during ACRE" value={tax.acre} onChange={(acre) => set({ acre })} />
        <RateInput label="Training (CFP)" value={tax.cfp} onChange={(cfp) => set({ cfp })} />
        <RateInput label="Income tax (VL)" value={tax.vl} onChange={(vl) => set({ vl })} />
      </div>
      <div className="tax-summary">
        <div>
          <span className="small">{now.acre ? `Now, with ACRE (until ${fmtDate(tax.acreUntil)})` : 'Now'}</span>
          <b>{pct(now.total)}</b>
          <span className="small">{pct(now.social)} URSSAF + {pct(now.cfp)} CFP{tax.vl ? ` + ${pct(now.vl)} income tax` : ''}</span>
        </div>
        {now.acre && (
          <div>
            <span className="small">After ACRE</span>
            <b>{pct(later.total)}</b>
            <span className="small">{pct(later.social)} URSSAF + {pct(later.cfp)} CFP{tax.vl ? ` + ${pct(later.vl)} income tax` : ''}</span>
          </div>
        )}
        <div>
          <span className="small">This year so far</span>
          <b>{money(yearTax.total, currency)}</b>
          <span className="small">on {money(yearTax.gross, currency)} gross · {money(yearTax.net, currency)} net</span>
        </div>
      </div>
      <div className="small">Trading, investment and real estate income are not business turnover: no contributions are counted on them.</div>
    </div>
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
      setDup(`"${existing.name}" already exists. Change its colour with its dot below.`);
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
      title: 'Delete this client?',
      message: (
        <>
          "{c.name}" will be deleted.{' '}
          {u.projects || u.tasks ? `Its ${plural(u.projects, 'project')} and ${plural(u.tasks, 'task')} will stay, with no client.` : 'It is not linked to any project or task.'}
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const { restore } = removeClient(data, c.id);
    update((d) => removeClient(d, c.id).data);
    toast(<>Client <b>{c.name}</b> deleted</>, { undo: () => update(restore) });
  };

  return (
    <div className="card" style={{ gap: '0.875rem' }}>
      <div>
        <div className="card-title">Clients <span className="small" style={{ fontWeight: 500 }}>{data.clients.length}</span></div>
        <div className="small">Each client has its own colour, shown on its projects and as a label on its tasks. Click a dot to change it.</div>
      </div>
      <form className="row" style={{ gap: '0.625rem', flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <ColorPicker value={color} onChange={setColor} label="New client colour" />
        <input className="input" value={name} onChange={(e) => { setName(e.target.value); setDup(''); }} placeholder="Client name" aria-label="Client name" />
        <button className="btn tall" type="submit" disabled={!name.trim()}>Add</button>
      </form>
      {dup && <div className="small" role="status" style={{ color: 'var(--red)' }}>{dup}</div>}
      {data.clients.length > 0 && (
        <div>
          {data.clients.map((c) => {
            const u = uses(c.id);
            return (
              <div className="client-row" key={c.id}>
                <ColorPicker value={c.color} onChange={(hex) => edit(c.id, { color: hex })} label={`${c.name} colour`} />
                <input
                  key={c.name}
                  className="input"
                  defaultValue={c.name}
                  aria-label={`Client name: ${c.name}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== c.name) edit(c.id, { name: v });
                    else e.target.value = c.name;
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span className="client-use">{plural(u.projects, 'project')} · {plural(u.tasks, 'task')}</span>
                <button className="btn sm ghost" onClick={() => setDetails(c)} title="Notes and contacts">{c.contacts.length ? plural(c.contacts.length, 'contact') : 'Contacts'}</button>
                <button className="x" onClick={() => void remove(c)} aria-label={`Delete ${c.name}`}>×</button>
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
