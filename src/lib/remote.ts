import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppData, Asset, AssetPrice, Client, Entry, Investment, Note, Project, Property, PropertyEntry, Recurring, Subscription, TaxItem, TaxPayment, Task, TimeEntry, Trade } from '../types';
import { normalize, type Repository } from './store';

/*
 * Supabase repository. The UI works on one AppData object; each save is turned into the
 * smallest set of writes by diffing against `base`, our record of what the database holds:
 *   - rows unknown to base are upserted whole (batched),
 *   - rows known to base only get the fields that changed (so a stale device cannot revert
 *     fields it did not touch, and cannot re-create a row deleted elsewhere),
 *   - ids that disappeared are deleted (in chunks).
 * base advances request by request. A failed partial update leaves base as it was, so the next
 * save resends the same partial update (idempotent, never re-creates a row); only rows whose
 * whole-row upsert failed are marked UNKNOWN and upserted again. Nothing else moves base.
 */

const PAGE = 1000; // PostgREST returns at most 1000 rows per request by default.
const CHUNK = 100; // ids per `in.(…)` delete, keeps the URL short.
const UNKNOWN = Symbol('unknown'); // the request carrying this row failed: state in DB unsure

type Row = Record<string, unknown>;
type Known = Row | typeof UNKNOWN;
type ListTable = 'clients' | 'projects' | 'recurring' | 'entries' | 'tasks' | 'notes' | 'investments' | 'time_entries' | 'assets' | 'trades' | 'asset_prices' | 'properties' | 'property_entries' | 'subscriptions' | 'tax_payments' | 'tax_items';
const LIST_TABLES: ListTable[] = ['clients', 'projects', 'recurring', 'entries', 'tasks', 'notes', 'investments', 'time_entries', 'assets', 'trades', 'asset_prices', 'properties', 'property_entries', 'subscriptions', 'tax_payments', 'tax_items'];
type Rows = { profile: Row } & Record<ListTable, Row[]>;
const emptyTables = () => Object.fromEntries(LIST_TABLES.map((t) => [t, new Map<string, Known>()])) as Record<ListTable, Map<string, Known>>;
type Stale = { projects: string[]; clients: string[]; assets?: string[]; properties?: string[] };
type Base = { profile: Known | null; tables: Record<ListTable, Map<string, Known>> };

const orNull = (s: string) => (s ? s : null);
/** Error message used when the database misses tables or columns this version needs. */
export const SCHEMA_OUTDATED = 'schema-outdated';
const str = (v: unknown) => (v == null ? '' : String(v));

/** A write the database refused for good (constraint, bad value): retrying the same payload is pointless. */
export class RejectedError extends Error {
  /** Parents deleted on another device that this device still links to. */
  readonly stale: Stale;
  constructor(message: string, stale: Stale = { projects: [], clients: [] }) {
    super(message);
    this.stale = stale;
  }
}

type DbError = { code?: string; message?: string };
// 42501 (permission denied) is left out: it is what an expired session looks like, and it heals on retry.
const isPermanent = (e: DbError) => e.code !== '42501' && /^(21|22|23|42)[0-9A-Z]{3}$/.test(e.code ?? '');

async function fetchAll(db: SupabaseClient, table: string, order: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select('*').order(order).order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/* ---------- row mapping (camelCase in the app, snake_case in Postgres) ---------- */

export function toRows(d: AppData, userId: string): Rows {
  const ids = new Set(d.projects.map((p) => p.id));
  const pid = (id: string) => (ids.has(id) ? id : null);
  const cids = new Set(d.clients.map((c) => c.id));
  const cid = (id: string) => (cids.has(id) ? id : null);
  const aids = new Set(d.assets.map((a) => a.id));
  const hids = new Set(d.properties.map((x) => x.id));
  return {
    profile: {
      user_id: userId, name: d.profile.name, email: d.profile.email, company: d.profile.company,
      currency: d.profile.currency, target_pct: d.profile.targetPct, alert_pct: d.profile.alertPct,
      avatar: d.profile.avatar, invest_isin: d.profile.investIsin, invest_mic: d.profile.investMic, invest_name: d.profile.investName,
      revenue_goal: d.profile.revenueGoal, tax: d.profile.tax, wealth: d.profile.wealth,
    },
    clients: d.clients.map((c: Client) => ({ id: c.id, name: c.name, color: c.color, notes: c.notes, contacts: c.contacts })),
    projects: d.projects.map((p: Project) => ({
      id: p.id, name: p.name, client_id: cid(p.clientId), start: orNull(p.start), deadline: orNull(p.deadline),
      status: p.status, position: p.position, brief_context: p.brief.context, brief_goal: p.brief.goal,
      brief_deliverables: p.brief.deliverables, brief_out: p.brief.out, budget: p.budget,
    })),
    investments: d.investments.map((x: Investment) => ({
      id: x.id, date: x.date, amount: x.amount, price: x.price > 0 ? x.price : null, close: x.close > 0 ? x.close : null,
    })),
    // Notes live and die with their project (FK on delete cascade): no project, no row.
    notes: d.notes.filter((n) => ids.has(n.projectId)).map((n: Note) => ({
      id: n.id, project_id: n.projectId, date: n.date, kind: n.kind, body: n.body,
      ...(n.createdAt ? { created_at: n.createdAt } : {}),
    })),
    recurring: d.recurring.map((r: Recurring) => ({
      id: r.id, label: r.label, type: r.type, category: r.category, amount: r.amount, frequency: r.frequency,
      start: r.start, end: orNull(r.end), project_id: pid(r.projectId), client_id: cid(r.clientId),
    })),
    entries: d.entries.map((e: Entry) => ({
      id: e.id, date: e.date, label: e.label, type: e.type, category: e.category, amount: e.amount,
      project_id: pid(e.projectId), paid: e.paid, due: orNull(e.due), client_id: cid(e.clientId),
    })),
    assets: d.assets.map((a: Asset) => ({
      id: a.id, account: a.account, name: a.name, symbol: a.symbol, isin: a.isin, kind: a.kind, currency: a.currency,
      price: a.price, price_at: orNull(a.priceAt), position: a.position,
    })),
    trades: d.trades.filter((t) => aids.has(t.assetId)).map((t: Trade) => ({
      id: t.id, asset_id: t.assetId, date: t.date, side: t.side, quantity: t.quantity, price: t.price, fees: t.fees,
    })),
    asset_prices: d.assetPrices.filter((x) => aids.has(x.assetId)).map((x: AssetPrice) => ({ id: x.id, asset_id: x.assetId, date: x.date, price: x.price })),
    properties: d.properties.map((x: Property) => ({
      id: x.id, name: x.name, platform: x.platform, city: x.city, currency: x.currency, purchase_date: orNull(x.purchaseDate), purchase_price: x.purchasePrice,
      value: x.value, debt: x.debt, rent: x.rent, charges: x.charges, loan: x.loan, notes: x.notes, position: x.position,
    })),
    property_entries: d.propertyEntries.filter((x) => hids.has(x.propertyId)).map((x: PropertyEntry) => ({
      id: x.id, property_id: x.propertyId, date: x.date, kind: x.kind, amount: x.amount, label: x.label,
    })),
    subscriptions: d.subscriptions.map((x: Subscription) => ({
      id: x.id, name: x.name, category: x.category, scope: x.scope, amount: x.amount, currency: x.currency, cycle: x.cycle,
      start: x.start, end: orNull(x.end), payment: x.payment, notes: x.notes, color: x.color, position: x.position,
    })),
    tax_payments: d.taxPayments.map((x: TaxPayment) => ({
      id: x.id, period_start: x.periodStart, period_end: x.periodEnd, revenue: x.revenue, amount: x.amount, paid_on: orNull(x.paidOn), notes: x.notes,
    })),
    tax_items: d.taxItems.map((x: TaxItem) => ({
      id: x.id, scope: x.scope, year: x.year, name: x.name, source: x.source, base: x.base, rate: x.rate, withheld: x.withheld,
      due_amount: x.dueAmount, due_date: orNull(x.dueDate), paid: x.paid, paid_on: orNull(x.paidOn), notes: x.notes,
    })),
    time_entries: d.timeEntries.map((x: TimeEntry) => ({
      id: x.id, project_id: pid(x.projectId), task_id: orNull(x.taskId), date: x.date, minutes: x.minutes, note: x.note,
      started_at: orNull(x.startedAt),
    })),
    tasks: d.tasks.map((t: Task) => ({
      id: t.id, title: t.title, col: t.col, client_id: cid(t.clientId), project_id: pid(t.projectId),
      due: orNull(t.due), note: t.note, position: t.position, done_at: orNull(t.doneAt), priority: t.priority,
      checklist: t.checklist,
    })),
  };
}

export function fromRows(r: { profile: Row | null } & Record<ListTable, Row[]>): Partial<AppData> {
  const p = r.profile;
  return {
    profile: p
      ? {
          name: str(p.name), email: str(p.email), company: str(p.company), currency: str(p.currency) || 'EUR',
          targetPct: Number(p.target_pct ?? 30), alertPct: Number(p.alert_pct ?? 12), avatar: str(p.avatar),
          investIsin: str(p.invest_isin), investMic: str(p.invest_mic), investName: str(p.invest_name),
          revenueGoal: Number(p.revenue_goal ?? 0),
          tax: (p.tax ?? {}) as AppData['profile']['tax'],
          wealth: (p.wealth ?? {}) as AppData['profile']['wealth'],
        }
      : undefined,
    clients: r.clients.map((x) => ({
      id: str(x.id), name: str(x.name), color: str(x.color), notes: str(x.notes),
      contacts: Array.isArray(x.contacts) ? (x.contacts as Client['contacts']) : [],
    })),
    projects: r.projects.map((x) => ({
      id: str(x.id), name: str(x.name), clientId: str(x.client_id), start: str(x.start), deadline: str(x.deadline),
      status: str(x.status) as Project['status'], position: Number(x.position),
      brief: { context: str(x.brief_context), goal: str(x.brief_goal), deliverables: str(x.brief_deliverables), out: str(x.brief_out) },
      budget: Number(x.budget ?? 0),
    })),
    investments: r.investments.map((x) => ({
      id: str(x.id), date: str(x.date), amount: Number(x.amount), price: Number(x.price ?? 0), close: Number(x.close ?? 0),
    })),
    notes: r.notes.map((x) => ({
      id: str(x.id), projectId: str(x.project_id), date: str(x.date), kind: str(x.kind) as Note['kind'], body: str(x.body),
      createdAt: x.created_at ? new Date(str(x.created_at)).toISOString() : '',
    })),
    tasks: r.tasks.map((x) => ({
      id: str(x.id), title: str(x.title), col: str(x.col) as Task['col'], clientId: str(x.client_id), projectId: str(x.project_id),
      due: str(x.due), note: str(x.note), position: Number(x.position),
      doneAt: x.done_at ? new Date(str(x.done_at)).toISOString() : '',
      priority: (str(x.priority) || 'none') as Task['priority'],
      checklist: Array.isArray(x.checklist) ? (x.checklist as Task['checklist']) : [],
    })),
    entries: r.entries.map((x) => ({
      id: str(x.id), date: str(x.date), label: str(x.label), type: str(x.type) as Entry['type'],
      category: str(x.category), amount: Number(x.amount), projectId: str(x.project_id),
      paid: x.paid !== false, due: str(x.due), clientId: str(x.client_id),
    })),
    timeEntries: r.time_entries.map((x) => ({
      id: str(x.id), projectId: str(x.project_id), taskId: str(x.task_id), date: str(x.date), minutes: Number(x.minutes ?? 0),
      note: str(x.note), startedAt: x.started_at ? new Date(str(x.started_at)).toISOString() : '',
    })),
    recurring: r.recurring.map((x) => ({
      id: str(x.id), label: str(x.label), type: str(x.type) as Recurring['type'], category: str(x.category),
      amount: Number(x.amount), frequency: str(x.frequency) as Recurring['frequency'], start: str(x.start),
      end: str(x.end), projectId: str(x.project_id), clientId: str(x.client_id),
    })),
    assets: r.assets.map((x) => ({
      id: str(x.id), account: str(x.account) as Asset['account'], name: str(x.name), symbol: str(x.symbol), isin: str(x.isin),
      kind: str(x.kind) as Asset['kind'], currency: str(x.currency), price: Number(x.price ?? 0),
      priceAt: x.price_at ? new Date(str(x.price_at)).toISOString() : '', position: Number(x.position ?? 0),
    })),
    trades: r.trades.map((x) => ({
      id: str(x.id), assetId: str(x.asset_id), date: str(x.date), side: str(x.side) as Trade['side'],
      quantity: Number(x.quantity ?? 0), price: Number(x.price ?? 0), fees: Number(x.fees ?? 0),
    })),
    assetPrices: r.asset_prices.map((x) => ({ id: str(x.id), assetId: str(x.asset_id), date: str(x.date), price: Number(x.price) })),
    properties: r.properties.map((x) => ({
      id: str(x.id), name: str(x.name), platform: (str(x.platform) === 'stake' ? 'stake' : 'direct') as Property['platform'], city: str(x.city), currency: str(x.currency), purchaseDate: str(x.purchase_date),
      purchasePrice: Number(x.purchase_price ?? 0), value: Number(x.value ?? 0), debt: Number(x.debt ?? 0), rent: Number(x.rent ?? 0),
      charges: Number(x.charges ?? 0), loan: Number(x.loan ?? 0), notes: str(x.notes), position: Number(x.position ?? 0),
    })),
    subscriptions: r.subscriptions.map((x) => ({
      id: str(x.id), name: str(x.name), category: str(x.category), scope: (str(x.scope) === 'business' ? 'business' : 'personal') as Subscription['scope'],
      amount: Number(x.amount ?? 0), currency: str(x.currency), cycle: str(x.cycle) as Subscription['cycle'], start: str(x.start), end: str(x.end),
      payment: str(x.payment), notes: str(x.notes), color: str(x.color), position: Number(x.position ?? 0),
    })),
    taxItems: r.tax_items.map((x) => ({
      id: str(x.id), scope: (str(x.scope) === 'business' ? 'business' : 'personal') as TaxItem['scope'], year: Number(x.year), name: str(x.name),
      source: str(x.source) as TaxItem['source'], base: x.base == null ? null : Number(x.base), rate: Number(x.rate ?? 0), withheld: Number(x.withheld ?? 0),
      dueAmount: x.due_amount == null ? null : Number(x.due_amount), dueDate: str(x.due_date), paid: Number(x.paid ?? 0), paidOn: str(x.paid_on), notes: str(x.notes),
    })),
    taxPayments: r.tax_payments.map((x) => ({
      id: str(x.id), periodStart: str(x.period_start), periodEnd: str(x.period_end), revenue: Number(x.revenue ?? 0), amount: Number(x.amount ?? 0),
      paidOn: str(x.paid_on), notes: str(x.notes),
    })),
    propertyEntries: r.property_entries.map((x) => ({
      id: str(x.id), propertyId: str(x.property_id), date: str(x.date), kind: str(x.kind) as PropertyEntry['kind'],
      amount: Number(x.amount ?? 0), label: str(x.label),
    })),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Fields of `next` that differ from `prev` (keys are identical: both come from toRows). */
function changedFields(prev: Row, next: Row): Row | null {
  const out: Row = {};
  for (const k of Object.keys(next)) if (!same(prev[k], next[k])) out[k] = next[k];
  return Object.keys(out).length ? out : null;
}

export function createSupabaseRepository(db: SupabaseClient, userId: string): Repository {
  let base: Base | null = null;
  let saves = 0; // bumped at the start of every save, so a refresh can tell a save happened meanwhile

  /** Read everything. Pure: does not touch base. */
  async function read() {
    const ORDER: Record<ListTable, string> = {
      clients: 'name', projects: 'position', tasks: 'position', entries: 'date', recurring: 'created_at', notes: 'created_at',
      investments: 'date', time_entries: 'date', assets: 'position', trades: 'date', asset_prices: 'date', properties: 'position',
      property_entries: 'date', subscriptions: 'position', tax_payments: 'period_end', tax_items: 'year',
    };
    const [profile, ...lists] = await Promise.all([
      db.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      ...LIST_TABLES.map((t) =>
        fetchAll(db, t, ORDER[t]).catch((e: DbError) => {
          // Table missing: the database was set up before this version and needs its update.
          throw e?.code === 'PGRST205' || e?.code === '42P01' ? new Error(SCHEMA_OUTDATED) : e;
        }),
      ),
    ]);
    if (profile.error) throw profile.error;
    const raw = Object.fromEntries(LIST_TABLES.map((t, i) => [t, lists[i]])) as Record<ListTable, Row[]>;
    const empty = !profile.data && LIST_TABLES.every((t) => !raw[t].length);
    // Base comes from exactly what the UI will hold: a row normalize() drops is left alone in the DB.
    const data = normalize(fromRows({ profile: profile.data, ...raw }));
    const rows = toRows(data, userId);
    const nextBase: Base = {
      profile: profile.data ? rows.profile : null,
      tables: Object.fromEntries(LIST_TABLES.map((t) => [t, new Map(rows[t].map((r) => [r.id as string, r as Known]))])) as Record<ListTable, Map<string, Known>>,
    };
    return { data: empty ? null : data, base: nextBase };
  }

  async function save(data: AppData) {
    saves += 1;
    // Never write without a session: the request would go out as anonymous and be refused.
    const { data: auth } = await db.auth.getSession();
    if (!auth.session) throw new Error('No active session');
    const b: Base = base ?? {
      profile: null,
      tables: emptyTables(),
    };
    base = b;
    const next = toRows(data, userId);
    let failure: DbError | null = null;
    const note = (e: DbError) => {
      failure ??= e;
    };

    /** Run requests together, keep base in step with each one, report the first failure. */
    const run = async (jobs: { go: () => PromiseLike<{ error: DbError | null }>; ok: () => void; ko: () => void }[]) => {
      const res = await Promise.allSettled(jobs.map((j) => j.go()));
      res.forEach((r, i) => {
        const err = r.status === 'rejected' ? (r.reason as DbError) : r.value.error;
        if (err) {
          jobs[i].ko();
          note(err);
        } else jobs[i].ok();
      });
      return !failure;
    };

    const tableJobs = (t: ListTable) => {
      const known = b.tables[t];
      const fresh: Row[] = [];
      const jobs: Parameters<typeof run>[0] = [];
      for (const row of next[t]) {
        const id = row.id as string;
        const prev = known.get(id);
        if (prev === undefined || prev === UNKNOWN) {
          fresh.push(row);
          continue;
        }
        const diff = changedFields(prev, row);
        if (!diff) continue;
        jobs.push({
          go: () => db.from(t).update(diff).eq('id', id),
          ok: () => known.set(id, row),
          ko: () => {},
        });
      }
      if (fresh.length) {
        jobs.push({
          go: () => db.from(t).upsert(fresh),
          ok: () => fresh.forEach((r) => known.set(r.id as string, r)),
          ko: () => fresh.forEach((r) => known.set(r.id as string, UNKNOWN)),
        });
      }
      return jobs;
    };

    const deleteJobs = (t: ListTable) => {
      const known = b.tables[t];
      const keep = new Set(next[t].map((r) => r.id as string));
      const gone = [...known.keys()].filter((id) => !keep.has(id));
      const jobs: Parameters<typeof run>[0] = [];
      for (let i = 0; i < gone.length; i += CHUNK) {
        const ids = gone.slice(i, i + CHUNK);
        jobs.push({ go: () => db.from(t).delete().in('id', ids), ok: () => ids.forEach((id) => known.delete(id)), ko: () => {} });
      }
      return jobs;
    };

    // Foreign keys set the order: clients, then projects (point to clients), then the rows that point
    // to both; deletes go the other way round.
    const profileJobs: Parameters<typeof run>[0] = [];
    const prevProfile = b.profile;
    if (prevProfile === null || prevProfile === UNKNOWN) {
      profileJobs.push({
        go: () => db.from('profiles').upsert(next.profile, { onConflict: 'user_id' }),
        ok: () => (b.profile = next.profile),
        ko: () => (b.profile = UNKNOWN),
      });
    } else {
      const diff = changedFields(prevProfile, next.profile);
      if (diff) {
        profileJobs.push({
          go: () => db.from('profiles').update(diff).eq('user_id', userId),
          ok: () => (b.profile = next.profile),
          ko: () => {},
        });
      }
    }

    const ok =
      (await run([...profileJobs, ...tableJobs('clients'), ...tableJobs('assets'), ...tableJobs('properties'), ...tableJobs('subscriptions'), ...tableJobs('tax_payments'), ...tableJobs('tax_items')])) &&
      (await run(tableJobs('projects'))) &&
      (await run([...tableJobs('recurring'), ...tableJobs('entries'), ...tableJobs('tasks'), ...tableJobs('notes'), ...tableJobs('investments'), ...tableJobs('time_entries'), ...tableJobs('trades'), ...tableJobs('asset_prices'), ...tableJobs('property_entries')])) &&
      (await run([...deleteJobs('tasks'), ...deleteJobs('entries'), ...deleteJobs('recurring'), ...deleteJobs('notes'), ...deleteJobs('investments'), ...deleteJobs('time_entries'), ...deleteJobs('trades'), ...deleteJobs('asset_prices'), ...deleteJobs('property_entries')])) &&
      (await run(deleteJobs('projects'))) &&
      (await run([...deleteJobs('clients'), ...deleteJobs('assets'), ...deleteJobs('properties'), ...deleteJobs('subscriptions'), ...deleteJobs('tax_payments'), ...deleteJobs('tax_items')]));
    if (ok) return;

    const err = failure as DbError | null;
    if (err && err.code === '23503') {
      // A project or client was deleted on another device: tell the UI which ones are gone.
      const gone = async (t: 'projects' | 'clients' | 'assets' | 'properties', ids: string[]) => {
        const { data: live, error } = await db.from(t).select('id');
        if (error || !live) return [];
        const alive = new Set(live.map((r: Row) => r.id as string));
        // Only rows we know were in the DB: a new row whose insert just failed is not "deleted elsewhere".
        const stale = ids.filter((id) => !alive.has(id) && typeof b.tables[t].get(id) === 'object');
        stale.forEach((id) => b.tables[t].delete(id));
        return stale;
      };
      const stale: Stale = {
        projects: await gone('projects', data.projects.map((p) => p.id)),
        clients: await gone('clients', data.clients.map((c) => c.id)),
        assets: await gone('assets', data.assets.map((a) => a.id)),
        properties: await gone('properties', data.properties.map((x) => x.id)),
      };
      if (stale.projects.length || stale.clients.length || stale.assets?.length || stale.properties?.length) {
        throw new RejectedError('Deleted on another device', stale);
      }
    }
    if (err && err.code === 'PGRST204') throw new RejectedError('The database needs an update (see "Updating" in the README)');
    if (err && isPermanent(err)) throw new RejectedError(err.message ?? 'Change rejected');
    throw err ?? new Error('Could not save');
  }

  return {
    async load() {
      const r = await read();
      base = r.base;
      return r.data;
    },

    save,

    subscribe(onChange, generation) {
      let last = 0;
      // Another device may have changed things: re-read when this tab comes back to the front.
      const refresh = async () => {
        if (document.visibilityState !== 'visible' || Date.now() - last < 15_000) return;
        const gen = generation();
        if (gen === null) return; // local edits waiting: never overwrite them
        last = Date.now();
        const seq = saves;
        let r: Awaited<ReturnType<typeof read>>;
        try {
          r = await read();
        } catch {
          return; // offline: keep what we have
        }
        // Adopt the result only if nothing happened locally while reading; base and UI move together.
        if (seq !== saves || generation() !== gen || !r.data) return;
        base = r.base;
        onChange(r.data);
      };
      document.addEventListener('visibilitychange', refresh);
      window.addEventListener('focus', refresh);
      window.addEventListener('online', refresh);
      return () => {
        document.removeEventListener('visibilitychange', refresh);
        window.removeEventListener('focus', refresh);
        window.removeEventListener('online', refresh);
      };
    },
  };
}
