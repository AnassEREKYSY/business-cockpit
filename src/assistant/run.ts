import type { z } from 'zod';
import { CATEGORIES } from '../lib/constants';
import { allTxns, totals } from '../lib/finance';
import { isoDate, monthKey, uid } from '../lib/format';
import { locale, t } from '../lib/i18n';
import { projectStats, isOverdue, unpaidInvoices } from '../lib/stats';
import { withCol } from '../lib/store';
import { SUB_CATEGORIES, isActive as subActive, monthlyOf, nextPayment, paidSoFar } from '../lib/subscriptions';
import { entryMinutes, sumMinutes, weekStart } from '../lib/time';
import type { AppData, Entry, Note, Subscription, Task, TimeEntry, Txn } from '../types';
import { actionTools, readTools, type ActionToolName, type ReadToolName } from './schema';

/*
 * The tools, run in the browser on the data Cockpit already has loaded. Read tools answer straight
 * away. Action tools are prepared first (checked, described in plain words) and only applied once
 * the user clicks Confirm, through the same update() as the rest of the app, so the change shows
 * at once, saves like any other edit, and can't touch another account's data.
 */

type Input<T extends { inputSchema: z.ZodType }> = z.infer<T['inputSchema']>;
const r2 = (n: number) => Math.round(n * 100) / 100;
const hours = (min: number) => Math.round((min / 60) * 100) / 100;
const lower = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const inRange = (d: string, from?: string, to?: string) => (!from || d >= from) && (!to || d <= to);

/* ------------------------------------------------------------------ lookups */

class ToolError extends Error {}

/** Find one record by id, then exact name, then partial name. Several partial matches is an error the model can recover from. */
function pick<T extends { id: string }>(list: T[], key: string, nameOf: (x: T) => string, what: string): T {
  const byId = list.find((x) => x.id === key);
  if (byId) return byId;
  const k = lower(key.trim());
  const exact = list.filter((x) => lower(nameOf(x)) === k);
  if (exact.length === 1) return exact[0];
  const partial = list.filter((x) => lower(nameOf(x)).includes(k));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new ToolError(`Several ${what}s match "${key}": ${partial.slice(0, 8).map(nameOf).join(', ')}. Ask the user which one.`);
  throw new ToolError(`No ${what} matches "${key}".`);
}
const findClient = (d: AppData, key: string) => pick(d.clients, key, (c) => c.name, 'client');
const findProject = (d: AppData, key: string) => pick(d.projects, key, (p) => p.name, 'project');

const clientName = (d: AppData, id: string) => d.clients.find((c) => c.id === id)?.name ?? '';
const projectName = (d: AppData, id: string) => d.projects.find((p) => p.id === id)?.name ?? '';
/** A transaction's client: its own, or its project's. */
const txnClient = (d: AppData, t: Pick<Txn, 'clientId' | 'projectId'>) => t.clientId || d.projects.find((p) => p.id === t.projectId)?.clientId || '';

/* ------------------------------------------------------------------ read tools */

function money(d: AppData, list: Txn[]) {
  const s = totals(list);
  return {
    revenue: r2(s.rev),
    directCosts: r2(s.direct),
    runningCosts: r2(s.opex),
    profit: r2(s.net),
    marginPct: s.rev ? r2(s.netRate) : null,
    currency: d.profile.currency,
  };
}

function txnRow(d: AppData, t: Txn | Entry) {
  const e = t as Partial<Entry> & Txn;
  return {
    id: e.recurringId ? undefined : e.id,
    date: e.date,
    label: e.label,
    type: e.type,
    category: e.category,
    amount: r2(e.amount),
    client: clientName(d, txnClient(d, e)) || undefined,
    project: projectName(d, e.projectId) || undefined,
    paid: e.type === 'revenue' ? e.paid !== false : undefined,
    due: e.due || undefined,
    recurring: e.recurringId ? true : undefined,
  };
}

function taskRow(d: AppData, t: Task) {
  return {
    id: t.id,
    title: t.title,
    status: t.col,
    priority: t.priority === 'none' ? undefined : t.priority,
    due: t.due || undefined,
    project: projectName(d, t.projectId) || undefined,
    client: clientName(d, t.clientId) || undefined,
    doneOn: t.doneAt ? t.doneAt.slice(0, 10) : undefined,
    checklist: t.checklist.length ? `${t.checklist.filter((c) => c.done).length}/${t.checklist.length} done` : undefined,
  };
}

function subRow(s: Subscription, today: string) {
  return {
    id: s.id,
    name: s.name,
    scope: s.scope,
    category: s.category,
    amount: s.amount,
    currency: s.currency,
    cycle: s.cycle,
    perMonth: r2(monthlyOf(s)),
    perYear: r2(monthlyOf(s) * 12),
    started: s.start,
    cancelledOn: s.end || undefined,
    nextPayment: nextPayment(s, today) || undefined,
    paidSoFar: r2(paidSoFar(s, today).total),
  };
}

const readers: { [K in ReadToolName]: (d: AppData, input: Input<(typeof readTools)[K]>) => unknown } = {
  search: (d, { query, limit }) => {
    const q = lower(query);
    const has = (...s: (string | undefined)[]) => s.some((x) => x && lower(x).includes(q));
    const out: Record<string, unknown>[] = [];
    for (const c of d.clients) if (has(c.name, c.notes)) out.push({ kind: 'client', id: c.id, name: c.name });
    for (const c of d.clients)
      for (const p of c.contacts)
        if (has(p.name, p.role, p.email, p.notes)) out.push({ kind: 'contact', name: p.name, role: p.role || undefined, email: p.email || undefined, phone: p.phone || undefined, client: c.name });
    for (const p of d.projects)
      if (has(p.name, p.brief.context, p.brief.goal, p.brief.deliverables))
        out.push({ kind: 'project', id: p.id, name: p.name, status: p.status, client: clientName(d, p.clientId) || undefined, start: p.start || undefined, deadline: p.deadline || undefined });
    for (const t of d.tasks) if (has(t.title, t.note, ...t.checklist.map((c) => c.text))) out.push({ kind: 'task', ...taskRow(d, t) });
    for (const n of d.notes)
      if (has(n.body)) out.push({ kind: 'journal note', date: n.date, type: n.kind, project: projectName(d, n.projectId), text: n.body.slice(0, 240) });
    for (const e of d.entries) if (has(e.label, e.category)) out.push({ kind: 'transaction', ...txnRow(d, e) });
    for (const r of d.recurring) if (has(r.label)) out.push({ kind: 'recurring transaction', label: r.label, type: r.type, amount: r.amount, frequency: r.frequency, start: r.start, end: r.end || undefined });
    for (const s of d.subscriptions) if (has(s.name, s.category, s.notes)) out.push({ kind: 'subscription', ...subRow(s, isoDate()) });
    for (const t of d.timeEntries)
      if (has(t.note)) out.push({ kind: 'time entry', date: t.date, hours: hours(entryMinutes(t)), project: projectName(d, t.projectId), note: t.note });
    const dated = (x: Record<string, unknown>) => String(x.date ?? x.doneOn ?? x.start ?? '');
    out.sort((a, b) => dated(b).localeCompare(dated(a)));
    return { query, found: out.length, results: out.slice(0, limit) };
  },

  get_overview: (d, { from, to }) => {
    const today = isoDate();
    const f = from ?? `${monthKey()}-01`;
    const t = to ?? today;
    const txns = allTxns(d).filter((x) => inRange(x.date, f, t));
    const unpaid = unpaidInvoices(d);
    const open = d.tasks.filter((x) => x.col !== 'done');
    const subs = d.subscriptions.filter((s) => subActive(s, today));
    const subsPerMonth: Record<string, number> = {};
    for (const s of subs) subsPerMonth[s.currency] = r2((subsPerMonth[s.currency] ?? 0) + monthlyOf(s));
    return {
      period: { from: f, to: t },
      ...money(d, txns),
      hoursWorked: hours(sumMinutes(d.timeEntries.filter((x) => inRange(x.date, f, t)))),
      unpaidInvoices: { count: unpaid.length, total: r2(unpaid.reduce((a, e) => a + e.amount, 0)), overdue: unpaid.filter((e) => isOverdue(e, today)).length },
      tasks: {
        open: open.length,
        overdue: open.filter((x) => x.due && x.due < today).length,
        dueToday: open.filter((x) => x.due === today).length,
        doneInPeriod: d.tasks.filter((x) => x.doneAt && inRange(x.doneAt.slice(0, 10), f, t)).length,
      },
      activeProjects: d.projects.filter((p) => p.status === 'In progress').map((p) => p.name),
      subscriptionsPerMonth: subsPerMonth,
      monthlyRevenueGoal: d.profile.revenueGoal || undefined,
    };
  },

  get_finances: (d, { from, to, groupBy }) => {
    const txns = allTxns(d).filter((x) => inRange(x.date, from, to));
    const keyOf = (x: Txn) =>
      groupBy === 'month' ? x.date.slice(0, 7)
        : groupBy === 'category' ? x.category
          : groupBy === 'client' ? clientName(d, txnClient(d, x)) || 'no client'
            : projectName(d, x.projectId) || 'no project';
    const groups = new Map<string, Txn[]>();
    for (const x of txns) groups.set(keyOf(x), [...(groups.get(keyOf(x)) ?? []), x]);
    const rows = [...groups.entries()].map(([key, list]) => ({ group: key, ...money(d, list), transactions: list.length }));
    rows.sort((a, b) => (groupBy === 'month' ? a.group.localeCompare(b.group) : b.revenue + b.directCosts + b.runningCosts - (a.revenue + a.directCosts + a.runningCosts)));
    return { period: { from: from ?? 'start', to: to ?? 'today' }, groupBy, total: money(d, txns), groups: rows };
  },

  list_transactions: (d, { from, to, type, unpaidOnly, client, project, limit }) => {
    const c = client ? findClient(d, client) : null;
    const p = project ? findProject(d, project) : null;
    const list = (unpaidOnly ? unpaidInvoices(d) : allTxns(d))
      .filter((x) => inRange(x.date, from, to))
      .filter((x) => type === 'any' || x.type === type)
      .filter((x) => !c || txnClient(d, x) === c.id)
      .filter((x) => !p || x.projectId === p.id)
      .sort((a, b) => b.date.localeCompare(a.date));
    return { matching: list.length, currency: d.profile.currency, transactions: list.slice(0, limit).map((x) => txnRow(d, x)) };
  },

  get_client: (d, { client }) => {
    const c = findClient(d, client);
    const projects = d.projects.filter((p) => p.clientId === c.id);
    const ids = new Set(projects.map((p) => p.id));
    const txns = allTxns(d).filter((x) => txnClient(d, x) === c.id);
    const time = d.timeEntries.filter((x) => ids.has(x.projectId));
    const dates = [...txns.map((x) => x.date), ...time.map((x) => x.date), ...projects.map((p) => p.start)].filter(Boolean).sort();
    return {
      id: c.id,
      name: c.name,
      notes: c.notes || undefined,
      contacts: c.contacts.map((x) => ({ name: x.name, role: x.role || undefined, email: x.email || undefined, phone: x.phone || undefined, notes: x.notes || undefined })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status, start: p.start || undefined, deadline: p.deadline || undefined, budget: p.budget || undefined })),
      ...money(d, txns),
      unpaid: r2(d.entries.filter((e) => txnClient(d, e) === c.id && e.type === 'revenue' && !e.paid).reduce((a, e) => a + e.amount, 0)),
      hoursWorked: hours(sumMinutes(time)),
      firstActivity: dates[0],
      lastActivity: dates.at(-1),
    };
  },

  get_project: (d, { project }) => {
    const p = findProject(d, project);
    const s = projectStats(d, p.id);
    const time = d.timeEntries.filter((x) => x.projectId === p.id).map((x) => x.date).sort();
    const notes = d.notes.filter((n) => n.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date));
    return {
      id: p.id,
      name: p.name,
      client: clientName(d, p.clientId) || undefined,
      status: p.status,
      start: p.start || undefined,
      deadline: p.deadline || undefined,
      brief: Object.fromEntries(Object.entries(p.brief).filter(([, v]) => v)),
      currency: d.profile.currency,
      budget: s.budget || undefined,
      revenue: r2(s.revenue),
      costs: r2(s.costs),
      margin: r2(s.margin),
      marginPct: s.marginRate == null ? null : r2(s.marginRate),
      budgetInvoicedPct: s.budgetUsed == null ? null : r2(s.budgetUsed),
      unpaid: r2(s.unpaid),
      hoursWorked: hours(s.minutes),
      marginPerHour: s.perHour == null ? null : r2(s.perHour),
      firstTimeLogged: time[0],
      lastTimeLogged: time.at(-1),
      openTasks: d.tasks.filter((t) => t.projectId === p.id && t.col !== 'done').map((t) => taskRow(d, t)),
      tasksDone: d.tasks.filter((t) => t.projectId === p.id && t.col === 'done').length,
      recentJournal: notes.slice(0, 10).map((n) => ({ date: n.date, type: n.kind, text: n.body.slice(0, 300) })),
    };
  },

  list_tasks: (d, { status, project, dueBefore, limit }) => {
    const p = project ? findProject(d, project) : null;
    const list = d.tasks
      .filter((t) => (status === 'any' ? true : status === 'open' ? t.col !== 'done' : t.col === status))
      .filter((t) => !p || t.projectId === p.id)
      .filter((t) => !dueBefore || (t.due && t.due <= dueBefore))
      .sort((a, b) => (status === 'done' ? b.doneAt.localeCompare(a.doneAt) : (a.due || '9').localeCompare(b.due || '9')));
    return { matching: list.length, tasks: list.slice(0, limit).map((t) => taskRow(d, t)) };
  },

  get_time: (d, { from, to, project, groupBy }) => {
    const p = project ? findProject(d, project) : null;
    const list = d.timeEntries.filter((x) => inRange(x.date, from, to) && (!p || x.projectId === p.id));
    const keyOf = (x: TimeEntry) =>
      groupBy === 'project' ? projectName(d, x.projectId) || 'no project' : groupBy === 'day' ? x.date : `week of ${weekStart(new Date(x.date + 'T12:00:00'))}`;
    const groups = new Map<string, number>();
    for (const x of list) groups.set(keyOf(x), (groups.get(keyOf(x)) ?? 0) + entryMinutes(x));
    const rows = [...groups.entries()].map(([group, min]) => ({ group, hours: hours(min) }));
    rows.sort((a, b) => (groupBy === 'project' ? b.hours - a.hours : a.group.localeCompare(b.group)));
    return { period: { from: from ?? 'start', to: to ?? 'today' }, totalHours: hours(sumMinutes(list)), groups: rows };
  },

  list_subscriptions: (d, { includeCancelled, scope }) => {
    const today = isoDate();
    const list = d.subscriptions
      .filter((s) => includeCancelled || subActive(s, today))
      .filter((s) => scope === 'any' || s.scope === scope)
      .sort((a, b) => (nextPayment(a, today) || '9').localeCompare(nextPayment(b, today) || '9'));
    const perMonth: Record<string, number> = {};
    for (const s of list.filter((x) => subActive(x, today))) perMonth[s.currency] = r2((perMonth[s.currency] ?? 0) + monthlyOf(s));
    return { count: list.length, activeCostPerMonth: perMonth, subscriptions: list.map((s) => subRow(s, today)) };
  },

  calculate: (_d, { expression }) => ({ expression, result: evaluate(expression) }),
};

/** Small arithmetic parser (no eval): numbers, + - * / %, parentheses, unary minus. */
export function evaluate(src: string): number {
  const s = src.replace(/[\s  ]/g, '').replace(/(\d),(\d)/g, '$1.$2');
  let i = 0;
  const peek = () => s[i];
  const num = (): number => {
    if (peek() === '(') {
      i++;
      const v = add();
      if (peek() !== ')') throw new ToolError('Missing closing parenthesis.');
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -num();
    }
    if (peek() === '+') {
      i++;
      return num();
    }
    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (!m) throw new ToolError(`Unexpected "${peek() ?? 'end'}" in the expression.`);
    i += m[0].length;
    return Number(m[0]);
  };
  const mul = (): number => {
    let v = num();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[i++];
      const r = num();
      if (op !== '*' && r === 0) throw new ToolError('Division by zero.');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === '+' || peek() === '-') v = s[i++] === '+' ? v + mul() : v - mul();
    return v;
  };
  const v = add();
  if (i < s.length) throw new ToolError(`Unexpected "${s[i]}" in the expression.`);
  return Math.round(v * 1e6) / 1e6;
}

/** Run a read tool. Errors come back as { error } so the model can explain or ask. */
export function runReadTool(name: ReadToolName, input: unknown, data: AppData): unknown {
  try {
    const parsed = readTools[name].inputSchema.parse(input);
    return (readers[name] as (d: AppData, i: unknown) => unknown)(data, parsed);
  } catch (e) {
    return { error: e instanceof ToolError ? e.message : e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ action tools */

export type Line = [label: string, value: string];
/** A checked action, ready to show and to apply once the user confirms. */
export interface Prepared {
  title: string;
  lines: Line[];
  apply: (d: AppData) => AppData;
  /** What the model is told once it is saved. */
  result: Record<string, unknown>;
}

const fmtAmount = (n: number, cur: string) => `${r2(n).toLocaleString(locale())} ${cur}`;
const typeLabel = { revenue: 'Revenue', direct: 'Direct cost', opex: 'Running cost' } as const;
const closest = (list: string[], v: string | undefined, fallback: string) =>
  (v && list.find((x) => lower(x) === lower(v))) || (v && list.find((x) => lower(x).includes(lower(v)))) || fallback;

const preparers: { [K in ActionToolName]: (d: AppData, input: Input<(typeof actionTools)[K]>) => Prepared } = {
  add_transaction: (d, i) => {
    const p = i.project ? findProject(d, i.project) : null;
    const c = i.client ? findClient(d, i.client) : null;
    const revenue = i.type === 'revenue';
    const e: Entry = {
      id: uid(),
      date: i.date ?? isoDate(),
      label: i.label.trim(),
      type: i.type,
      category: closest(CATEGORIES[i.type], i.category, CATEGORIES[i.type][0]),
      amount: r2(i.amount),
      projectId: p?.id ?? '',
      clientId: c && c.id !== p?.clientId ? c.id : '',
      paid: !revenue || i.paid,
      due: revenue && !i.paid ? (i.due ?? '') : '',
    };
    const lines: Line[] = [
      ['Type', typeLabel[e.type]],
      ['Label', e.label],
      ['Amount', fmtAmount(e.amount, d.profile.currency)],
      ['Date', e.date],
      ['Category', e.category],
    ];
    if (p) lines.push(['Project', p.name]);
    if (c || p?.clientId) lines.push(['Client', c?.name ?? clientName(d, p!.clientId)]);
    if (revenue) lines.push(['Paid', e.paid ? 'Yes' : e.due ? t('No, due {date}', { date: e.due }) : 'No']);
    return {
      title: revenue ? 'Add revenue' : 'Add a cost',
      lines,
      apply: (x) => ({ ...x, entries: [...x.entries, e] }),
      result: { saved: true, id: e.id },
    };
  },

  mark_invoice_paid: (d, { transactionId }) => {
    const e = d.entries.find((x) => x.id === transactionId);
    if (!e) throw new ToolError('No transaction with this id. Use list_transactions with unpaidOnly to find it.');
    if (e.type !== 'revenue') throw new ToolError('This transaction is a cost, not an invoice.');
    if (e.paid) throw new ToolError(`"${e.label}" is already marked as paid.`);
    const lines: Line[] = [['Invoice', e.label], ['Amount', fmtAmount(e.amount, d.profile.currency)], ['Date', e.date]];
    const cl = clientName(d, txnClient(d, e));
    if (cl) lines.push(['Client', cl]);
    if (e.due) lines.push(['Was due', e.due]);
    return {
      title: 'Mark as paid',
      lines,
      apply: (x) => ({ ...x, entries: x.entries.map((y) => (y.id === e.id ? { ...y, paid: true, due: '' } : y)) }),
      result: { saved: true, label: e.label },
    };
  },

  add_subscription: (d, i) => {
    const s: Subscription = {
      id: uid(),
      name: i.name.trim(),
      category: closest(SUB_CATEGORIES, i.category, 'Other'),
      scope: i.scope,
      amount: r2(i.amount),
      currency: (i.currency ?? d.profile.currency).toUpperCase(),
      cycle: i.cycle,
      start: i.start ?? isoDate(),
      end: '',
      payment: '',
      notes: '',
      color: '',
      position: d.subscriptions.reduce((a, x) => Math.max(a, x.position), -1) + 1,
    };
    return {
      title: 'Add a subscription',
      lines: [
        ['Name', s.name],
        ['Cost', `${fmtAmount(s.amount, s.currency)} / ${t(s.cycle)}`],
        ['First payment', s.start],
        ['Type', s.scope === 'business' ? 'Business' : 'Personal'],
        ['Category', s.category],
      ],
      apply: (x) => ({ ...x, subscriptions: [...x.subscriptions, s] }),
      result: { saved: true, id: s.id },
    };
  },

  cancel_subscription: (d, { subscriptionId, end }) => {
    const s = d.subscriptions.find((x) => x.id === subscriptionId);
    if (!s) throw new ToolError('No subscription with this id. Use list_subscriptions to find it.');
    const day = end ?? isoDate();
    if (s.end && s.end <= day) throw new ToolError(`"${s.name}" is already cancelled (${s.end}).`);
    return {
      title: 'Cancel a subscription',
      lines: [['Subscription', s.name], ['Cost', `${fmtAmount(s.amount, s.currency)} / ${t(s.cycle)}`], ['Cancelled from', day]],
      apply: (x) => ({ ...x, subscriptions: x.subscriptions.map((y) => (y.id === s.id ? { ...y, end: day } : y)) }),
      result: { saved: true, name: s.name },
    };
  },

  add_task: (d, i) => {
    const p = i.project ? findProject(d, i.project) : null;
    const top = d.tasks.filter((t) => t.col === i.status).reduce((m, t) => Math.max(m, t.position), -1) + 1;
    const task: Task = {
      id: uid(), title: i.title.trim(), col: i.status, clientId: '', projectId: p?.id ?? '', due: i.due ?? '', note: '',
      position: top, doneAt: '', priority: i.priority, checklist: [],
    };
    const lines: Line[] = [['Task', task.title], ['Column', task.col]];
    if (p) lines.push(['Project', p.name]);
    if (task.due) lines.push(['Due', task.due]);
    if (task.priority !== 'none') lines.push(['Priority', task.priority]);
    return { title: 'Add a task', lines, apply: (x) => ({ ...x, tasks: [...x.tasks, task] }), result: { saved: true, id: task.id } };
  },

  set_task_status: (d, { taskId, status }) => {
    const t = d.tasks.find((x) => x.id === taskId);
    if (!t) throw new ToolError('No task with this id. Use list_tasks or search to find it.');
    if (t.col === status) throw new ToolError(`"${t.title}" is already in ${status}.`);
    const lines: Line[] = [['Task', t.title], ['From', t.col], ['To', status]];
    const pn = projectName(d, t.projectId);
    if (pn) lines.push(['Project', pn]);
    return {
      title: status === 'done' ? 'Mark task as done' : 'Move a task',
      lines,
      apply: (x) => ({ ...x, tasks: x.tasks.map((y) => (y.id === t.id ? withCol(y, status) : y)) }),
      result: { saved: true, title: t.title, status },
    };
  },

  log_time: (d, i) => {
    const p = findProject(d, i.project);
    const e: TimeEntry = { id: uid(), projectId: p.id, taskId: '', date: i.date ?? isoDate(), minutes: i.minutes, note: i.note?.trim() ?? '', startedAt: '' };
    const lines: Line[] = [['Project', p.name], ['Time', `${Math.floor(i.minutes / 60)}h ${String(i.minutes % 60).padStart(2, '0')}m`], ['Date', e.date]];
    if (e.note) lines.push(['Note', e.note]);
    return { title: 'Log time worked', lines, apply: (x) => ({ ...x, timeEntries: [e, ...x.timeEntries] }), result: { saved: true, id: e.id } };
  },

  add_project_note: (d, i) => {
    const p = findProject(d, i.project);
    const n: Note = { id: uid(), projectId: p.id, date: i.date ?? isoDate(), kind: i.kind, body: i.body.trim(), createdAt: new Date().toISOString() };
    return {
      title: 'Add to the project journal',
      lines: [['Project', p.name], ['Type', n.kind], ['Date', n.date], ['Text', n.body.length > 160 ? n.body.slice(0, 160) + '…' : n.body]],
      apply: (x) => ({ ...x, notes: [...x.notes, n] }),
      result: { saved: true, id: n.id },
    };
  },
};

/** Check an action and describe it, without changing anything. */
export function prepareAction(name: ActionToolName, input: unknown, data: AppData): Prepared | { error: string } {
  try {
    const parsed = actionTools[name].inputSchema.parse(input);
    return (preparers[name] as (d: AppData, i: unknown) => Prepared)(data, parsed);
  } catch (e) {
    return { error: e instanceof ToolError ? e.message : e instanceof Error ? e.message : String(e) };
  }
}

