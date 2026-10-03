import { useState } from 'react';
import { CATEGORIES, TYPE_META, catLabel } from '../lib/constants';
import { parseAmount } from '../lib/finance';
import { isoDate, money } from '../lib/format';
import { isDay } from '../lib/store';
import type { AppData, Entry, EntryType, Recurring } from '../types';
import { DatePicker } from './Calendar';
import { useToast } from './Toast';
import { removeRow } from '../lib/undo';
import { uid } from '../lib/format';
import { ClientSelect, ProjectSelect } from './pickers';
import { isTaxable, rateOn } from '../lib/tax';
import { pct } from '../lib/format';
import { Select } from './Select';
import { Field, Modal, Seg } from './ui';

/* Edit forms for money rows, opened from Finances and from Data & profile. */

type Update = (fn: (d: AppData) => AppData) => void;

export const TYPES: EntryType[] = ['revenue', 'direct', 'opex'];
export const TYPE_OPTIONS = TYPES.map((t) => ({ value: t, label: TYPE_META[t].label, color: TYPE_META[t].color }));
export const FREQ_OPTIONS = [
  { value: 'monthly' as const, label: 'Monthly' },
  { value: 'yearly' as const, label: 'Yearly' },
];
export const catOptions = (t: EntryType) => CATEGORIES[t].map((c) => ({ value: c, label: catLabel(c) }));

/* ---------------- Edit a recurring item ---------------- */

export function RecurringModal({ item, data, update, onClose }: { item: Recurring; data: AppData; update: Update; onClose: () => void }) {
  // Snapshot at opening: only the fields changed here are written back.
  const [orig] = useState(item);
  const [f, setF] = useState({ ...item, amount: String(item.amount) });
  const amount = parseAmount(f.amount);
  const endBeforeStart = !!f.end && isDay(f.end) && isDay(f.start) && f.end < f.start;
  const valid = !!f.label.trim() && !!amount && isDay(f.start) && (!f.end || isDay(f.end)) && !endBeforeStart;
  const projects = data.projects.filter((p) => p.status !== 'Done' || p.id === f.projectId);

  const save = () => {
    if (!valid || !amount) return;
    const next: Recurring = { ...f, label: f.label.trim(), amount };
    const changed = Object.fromEntries(
      (Object.keys(next) as (keyof Recurring)[]).filter((k) => next[k] !== orig[k]).map((k) => [k, next[k]]),
    ) as Partial<Recurring>;
    update((d) => ({ ...d, recurring: d.recurring.map((r) => (r.id === item.id ? { ...r, ...changed } : r)) }));
    onClose();
  };

  return (
    <Modal title="Edit recurring item" onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="form-grid">
          <Field label="Name"><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Type">
            <Select value={f.type} onChange={(t) => setF({ ...f, type: t, category: CATEGORIES[t].includes(f.category) ? f.category : CATEGORIES[t][0] })} options={TYPE_OPTIONS} ariaLabel="Type" />
          </Field>
          <Field label="Category">
            <Select value={f.category} onChange={(category) => setF({ ...f, category })} options={catOptions(f.type)} ariaLabel="Category" />
          </Field>
          <Field label={`Amount excl. tax (${data.profile.currency})`}>
            <input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Frequency">
            <Select value={f.frequency} onChange={(frequency) => setF({ ...f, frequency })} options={FREQ_OPTIONS} ariaLabel="Frequency" />
          </Field>
          <Field label="Project (optional)">
            <ProjectSelect projects={projects} clients={data.clients} value={f.projectId} onChange={(projectId) => setF({ ...f, projectId })} />
          </Field>
          <Field label="Client (optional)">
            <ClientSelect data={data} update={update} value={f.clientId} onChange={(clientId) => setF({ ...f, clientId })} inherited={data.clients.find((c) => c.id === data.projects.find((p) => p.id === f.projectId)?.clientId)} />
          </Field>
          <Field label="Start date">
            <DatePicker value={f.start} onChange={(start) => setF({ ...f, start })} clearable={false} ariaLabel="Start date" />
          </Field>
          <Field label="End date (optional)">
            <DatePicker value={f.end} onChange={(end) => setF({ ...f, end })} min={isDay(f.start) ? f.start : undefined} placeholder="No end date" ariaLabel="End date" />
          </Field>
        </div>
        {f.amount.trim() && !amount && <div className="small" style={{ color: 'var(--red)' }}>Invalid amount. Examples: 1200 · 1 200 · 1200.50</div>}
        {endBeforeStart && <div className="small" style={{ color: 'var(--red)' }}>The end date can't be before the start date.</div>}
        <div className="small">
          Every billing date between the start and the end counts in your finances, past months included. If the price changed at some point,
          set an end date here and add a new item from the change date, so the old months keep the old price.
        </div>
        <div className="modal-foot">
          <span />
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn sm" type="submit" disabled={!valid}>Save</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Edit a one-off transaction ---------------- */

/** A blank transaction, opened in EntryModal to create one. */
export const newEntry = (type: EntryType = 'revenue'): Entry => ({
  id: uid(), date: isoDate(), label: '', type, category: CATEGORIES[type][0], amount: 0, projectId: '', paid: true, due: '', clientId: '',
});

export function EntryModal({ entry, data, update, onClose }: { entry: Entry; data: AppData; update: Update; onClose: () => void }) {
  const [orig] = useState(entry);
  const [f, setF] = useState({ ...entry, amount: entry.amount ? String(entry.amount) : '' });
  const [creating] = useState(() => !data.entries.some((e) => e.id === entry.id));
  const toast = useToast();
  const amount = parseAmount(f.amount);
  const valid = !!amount && isDay(f.date) && (!f.due || isDay(f.due));
  const projects = data.projects.filter((p) => p.status !== 'Done' || p.id === f.projectId);
  const revenue = f.type === 'revenue';
  const projectClient = (id: string) => data.projects.find((p) => p.id === id)?.clientId ?? '';

  const save = () => {
    if (!valid || !amount) return;
    const next: Entry = { ...f, label: f.label.trim() || catLabel(f.category), amount, paid: !revenue || f.paid, due: revenue && !f.paid ? f.due : '' };
    if (creating) {
      update((d) => ({ ...d, entries: [...d.entries, next] }));
      toast(<>{TYPE_META[next.type].label} <b>{next.label}</b> added: {money(amount, data.profile.currency)}</>, {
        undo: () => update((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== next.id) })),
      });
      onClose();
      return;
    }
    const changed = Object.fromEntries(
      (Object.keys(next) as (keyof Entry)[]).filter((k) => next[k] !== orig[k]).map((k) => [k, next[k]]),
    ) as Partial<Entry>;
    update((d) => ({ ...d, entries: d.entries.map((e) => (e.id === entry.id ? { ...e, ...changed } : e)) }));
    onClose();
  };
  const remove = () => {
    const { restore } = removeRow(data, 'entries', entry.id);
    update((d) => removeRow(d, 'entries', entry.id).data);
    toast(<><b>{entry.label}</b> deleted</>, { undo: () => update(restore) });
    onClose();
  };

  return (
    <Modal title={creating ? 'New transaction' : 'Edit transaction'} onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="form-grid">
          <Field label="Date"><DatePicker value={f.date} onChange={(date) => setF({ ...f, date })} clearable={false} ariaLabel="Date" /></Field>
          <Field label="Label"><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Type">
            <Select value={f.type} onChange={(t) => setF({ ...f, type: t, category: CATEGORIES[t].includes(f.category) ? f.category : CATEGORIES[t][0] })} options={TYPE_OPTIONS} ariaLabel="Type" />
          </Field>
          <Field label="Category">
            <Select value={f.category} onChange={(category) => setF({ ...f, category })} options={catOptions(f.type)} ariaLabel="Category" />
          </Field>
          <Field label="Project (optional)">
            <ProjectSelect projects={projects} clients={data.clients} value={f.projectId} onChange={(projectId) => setF({ ...f, projectId, clientId: projectClient(projectId) === f.clientId ? '' : f.clientId })} />
          </Field>
          <Field label="Client (optional)">
            <ClientSelect data={data} update={update} value={f.clientId} onChange={(clientId) => setF({ ...f, clientId: clientId === projectClient(f.projectId) ? '' : clientId })} inherited={data.clients.find((c) => c.id === projectClient(f.projectId))} />
          </Field>
          <Field label={`Amount excl. tax (${data.profile.currency})`}>
            <input className="input" inputMode="decimal" autoFocus={creating} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0" />
          </Field>
          {revenue && (
            <Field label="Payment">
              <Seg label="Payment" value={f.paid ? 'paid' : 'unpaid'} onChange={(v) => setF({ ...f, paid: v === 'paid' })} options={[['paid', 'Paid'], ['unpaid', 'Waiting']]} />
            </Field>
          )}
          {revenue && !f.paid && (
            <Field label="Payment due">
              <DatePicker value={f.due} onChange={(due) => setF({ ...f, due })} min={isDay(f.date) ? f.date : undefined} placeholder="No due date" ariaLabel="Payment due" />
            </Field>
          )}
        </div>
        {f.amount.trim() && !amount && <div className="small" style={{ color: 'var(--red)' }}>Invalid amount. Examples: 1200 · 1 200 · 1200.50</div>}
        {amount && isTaxable(f) && isDay(f.date) && (() => {
          const r = rateOn(data.profile.tax, f.date);
          const t = (amount * r.total) / 100;
          return (
            <div className="tax-preview">
              <span>Taxes {pct(r.total)}{r.acre ? ' (ACRE)' : ''}</span>
              <b>− {money(t, data.profile.currency)}</b>
              <span>Net</span>
              <b>{money(amount - t, data.profile.currency)}</b>
            </div>
          );
        })()}
        {amount && f.type === 'revenue' && !isTaxable(f) && <div className="small">Not business turnover: no URSSAF contributions are counted on this category.</div>}
        <div className="modal-foot">
          {creating ? <span /> : <button className="btn sm danger" type="button" onClick={remove}>Delete</button>}
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn sm" type="submit" disabled={!valid}>{creating ? 'Add' : 'Save'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
