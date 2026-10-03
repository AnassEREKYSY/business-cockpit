import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useConfirm } from '../components/Confirm';
import { DatePicker } from '../components/Calendar';
import { ClientChip, ClientDot, ClientSelect } from '../components/pickers';
import { Select } from '../components/Select';
import { TaskModal, newTask } from '../components/TaskModal';
import { useToast } from '../components/Toast';
import { Field, IconArrow, IconChecks, IconClock, IconFlag, IconPencil, IconPlay, IconSearch, IconStop, Modal, Seg } from '../components/ui';
import { COLUMNS, PROJECT_STATUSES, STATUS_META, priorityMeta, statusLabel } from '../lib/constants';
import { allTxns, parseAmount, totals } from '../lib/finance';
import { fmtDate, fmtMonth, isoDate, money, monthKey, pct, shiftMonth, uid } from '../lib/format';
import { isOverdue, unpaidInvoices } from '../lib/stats';
import { ARCHIVE_AFTER_DAYS, isArchived, isDay, nextPosition, placeTask, topPosition } from '../lib/store';
import { entryMinutes, fmtClock, fmtDuration, runningEntry, startTimer, stopTimers, sumMinutes, useNow, weekStart } from '../lib/time';
import { removeProject, removeRow } from '../lib/undo';
import { locale, t, tn } from '../lib/i18n';
import type { AppData, Project, Task, TaskColumn } from '../types';

type Update = (fn: (d: AppData) => AppData) => void;

const dueBeforeStart = (p: { start: string; deadline: string }) => !!p.start && !!p.deadline && p.deadline < p.start;

/** Fields of `edited` that differ from `original`. */
function changedFields<T extends object>(original: T, edited: T): Partial<T> {
  return Object.fromEntries(Object.entries(edited).filter(([k, v]) => v !== original[k as keyof T])) as Partial<T>;
}

const emptyProject = (): Omit<Project, 'id' | 'position'> => ({
  name: '', clientId: '', start: isoDate(), deadline: '', status: 'Not started',
  brief: { context: '', goal: '', deliverables: '', out: '' }, budget: 0,
});
const statusOptions = () => PROJECT_STATUSES.map((s) => ({ value: s, label: statusLabel(s), color: STATUS_META[s].color }));

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => isoDate(new Date(new Date(iso + 'T12:00:00').getTime() + n * DAY_MS));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / DAY_MS);

/** "Today", "Tomorrow", "3d overdue", "Fri", "12 Oct". */
export function dueLabel(due: string, today = isoDate()): string {
  const n = daysBetween(today, due);
  if (n === 0) return t('Today');
  if (n === 1) return t('Tomorrow');
  if (n < 0) return n === -1 ? t('Yesterday') : t('{n}d overdue', { n: -n });
  if (n < 7) return new Date(due + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short' });
  return fmtDate(due, true);
}

export type BoardFilter = {
  q: string;
  clientId: string;
  projectId: string;
  due: 'all' | 'overdue' | 'today' | 'week';
  priority: 'any' | 'high' | 'medium';
};
const NO_FILTER: BoardFilter = { q: '', clientId: '', projectId: '', due: 'all', priority: 'any' };

export default function OverviewPage({ data, update, openProject, goFinances }: {
  data: AppData;
  update: Update;
  openProject: (id: string) => void;
  goFinances: () => void;
}) {
  const [filter, setFilter] = useState<BoardFilter>(NO_FILTER);
  const [editing, setEditing] = useState<Task | null>(null);
  const boardRef = useRef<HTMLElement>(null);
  const showOnBoard = (patch: Partial<BoardFilter>) => {
    setFilter({ ...NO_FILTER, ...patch });
    boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <>
      <Dashboard data={data} openTask={setEditing} openProject={openProject} showOnBoard={showOnBoard} goFinances={goFinances} />
      <Projects data={data} update={update} openProject={openProject} />
      <Board data={data} update={update} filter={filter} setFilter={setFilter} onEdit={setEditing} sectionRef={boardRef} />
      {editing && <TaskModal task={editing} data={data} onClose={() => setEditing(null)} update={update} />}
    </>
  );
}

/* ---------------- Dashboard ---------------- */

function greeting(hour = new Date().getHours()) {
  return hour < 5 ? t('Good night') : hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening');
}

function Dashboard({ data, openTask, openProject, showOnBoard, goFinances }: {
  data: AppData;
  openTask: (t: Task) => void;
  openProject: (id: string) => void;
  showOnBoard: (f: Partial<BoardFilter>) => void;
  goFinances: () => void;
}) {
  const running = runningEntry(data);
  const now = useNow(!!running);
  const today = isoDate();
  const m = (n: number) => money(n, data.profile.currency);
  const first = data.profile.name.trim().split(/\s+/)[0];

  const open = data.tasks.filter((t) => t.col !== 'done');
  const dueToday = open.filter((t) => t.due === today).length;
  const overdue = open.filter((t) => t.due && t.due < today).length;

  const { thisRev, lastRev, lastKey } = useMemo(() => {
    const txns = allTxns(data);
    const k = monthKey();
    const lk = shiftMonth(k, -1);
    return {
      thisRev: totals(txns.filter((t) => t.date.startsWith(k))).rev,
      lastRev: totals(txns.filter((t) => t.date.startsWith(lk))).rev,
      lastKey: lk,
    };
  }, [data]);
  const delta = lastRev ? ((thisRev - lastRev) / lastRev) * 100 : null;
  const goal = data.profile.revenueGoal;

  const unpaid = unpaidInvoices(data);
  const toCollect = unpaid.reduce((a, e) => a + e.amount, 0);
  const late = unpaid.filter((e) => isOverdue(e, today)).length;

  const mon = weekStart();
  const week = data.timeEntries.filter((x) => x.date >= mon);
  const weekMin = sumMinutes(week, now);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(mon, i);
    return { d, min: sumMinutes(week.filter((x) => x.date === d), now) };
  });
  const maxDay = Math.max(60, ...days.map((x) => x.min));

  // Next deadlines: tasks and projects due in the next two weeks, plus anything late.
  const horizon = addDays(today, 14);
  const upcoming = [
    ...open.filter((t) => t.due && t.due <= horizon).map((t) => ({ kind: 'task' as const, id: t.id, date: t.due, title: t.title, projectId: t.projectId, clientId: t.clientId })),
    ...data.projects
      .filter((p) => p.status !== 'Done' && p.deadline && p.deadline <= horizon)
      .map((p) => ({ kind: 'project' as const, id: p.id, date: p.deadline, title: p.name, projectId: p.id, clientId: p.clientId })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);
  const projectOf = (id: string) => data.projects.find((p) => p.id === id);
  const clientOf = (id: string) => data.clients.find((c) => c.id === id);

  const summary =
    dueToday && overdue
      ? tn(dueToday, '{n} task due today, {late} overdue.', '{n} tasks due today, {late} overdue.', { late: overdue })
      : dueToday
        ? tn(dueToday, '{n} task due today.', '{n} tasks due today.')
        : overdue
          ? t('Nothing due today, {n} overdue.', { n: overdue })
          : open.length
            ? tn(open.length, 'Nothing due today. {n} open task on the board.', 'Nothing due today. {n} open tasks on the board.')
            : t('Your board is clear.');

  return (
    <section className="dash">
      <div className="dash-hello">
        <div>
          <h1>{greeting()}{first ? `, ${first}` : ''}</h1>
          <p className="sub">{summary}</p>
        </div>
      </div>

      <div className="dash-grid">
        <div className="tiles">
          <button className="tile" onClick={() => showOnBoard({ due: 'today' })}>
            <span className="tile-k">{t('Due today')}</span>
            <span className="tile-v">{dueToday}</span>
            <span className="tile-s">
              {overdue ? (
                <span className="neg" role="link" tabIndex={-1} onClick={(e) => { e.stopPropagation(); showOnBoard({ due: 'overdue' }); }}>
                  {t('{n} overdue · show', { n: overdue })}
                </span>
              ) : t('Nothing overdue')}
            </span>
          </button>

          <button className="tile" onClick={goFinances}>
            <span className="tile-k">{t('Revenue in {month}', { month: fmtMonth(monthKey()) })}</span>
            <span className="tile-v">{m(thisRev)}</span>
            {goal > 0 ? (
              <span className="tile-goal">
                <span className="goal-bar"><span style={{ width: `${Math.min(100, (thisRev / goal) * 100)}%` }} /></span>
                <span className="tile-s">{t('{p} of {goal} goal', { p: pct((thisRev / goal) * 100), goal: m(goal) })}</span>
              </span>
            ) : (
              <span className="tile-s">
                {lastRev ? <>{fmtMonth(lastKey)}: {m(lastRev)}{delta !== null && delta > 0 ? <span className="pos"> · {t('already ▲ {p}', { p: pct(delta) })}</span> : null}</> : t('Nothing last month')}
              </span>
            )}
          </button>

          <button className="tile" onClick={goFinances}>
            <span className="tile-k">{t('To collect')}</span>
            <span className="tile-v">{m(toCollect)}</span>
            <span className="tile-s">
              {unpaid.length ? (
                <>{tn(unpaid.length, '{n} unpaid invoice', '{n} unpaid invoices')}{late ? <span className="neg"> · {t('{n} late', { n: late })}</span> : ''}</>
              ) : t('All invoices paid')}
            </span>
          </button>

          <div className="tile tile-static">
            <span className="tile-k">{t('This week')}</span>
            <span className="tile-v">{fmtDuration(weekMin)}</span>
            <span className="week-bars" aria-label={t('Hours tracked per day this week')}>
              {days.map((x) => (
                <span key={x.d} className={'week-bar' + (x.d === today ? ' is-today' : '')} title={`${fmtDate(x.d, true)}: ${fmtDuration(x.min)}`}>
                  <span style={{ height: `${Math.max(x.min ? 8 : 3, (x.min / maxDay) * 100)}%` }} />
                  <i>{t('MTWTFSS')[daysBetween(mon, x.d)]}</i>
                </span>
              ))}
            </span>
          </div>
        </div>

        <div className="card upcoming">
          <div className="head">
            <div className="card-title">{t('Coming up')}</div>
            <span className="small">{t('Next 14 days')}</span>
          </div>
          {upcoming.length === 0 && <div className="small upcoming-empty">{t('No deadlines in the next two weeks.')}</div>}
          {upcoming.map((u) => {
            const client = clientOf(u.clientId) ?? clientOf(projectOf(u.projectId)?.clientId ?? '');
            const n = daysBetween(today, u.date);
            return (
              <button
                key={u.kind + u.id}
                className="up-row"
                onClick={() => {
                  if (u.kind === 'project') openProject(u.id);
                  else {
                    const t = data.tasks.find((x) => x.id === u.id);
                    if (t) openTask(t);
                  }
                }}
              >
                <span className={'up-date' + (n < 0 ? ' late' : n === 0 ? ' today' : '')}>{dueLabel(u.date, today)}</span>
                <span className="up-main">
                  <span className="ellipsis up-title">{u.title}</span>
                  <span className="up-sub ellipsis">
                    {u.kind === 'project' ? t('Project deadline') : projectOf(u.projectId)?.name ?? t('Task')}
                  </span>
                </span>
                {client && <span className="swatch" style={{ background: client.color }} title={client.name} />}
                <IconArrow size={13} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Projects ---------------- */

function Projects({ data, update, openProject }: { data: AppData; update: Update; openProject: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('active');
  const [showForm, setShowForm] = useState(false);
  const [pf, setPf] = useState(emptyProject);
  const [editing, setEditing] = useState<Project | null>(null);
  // Folded by default so the task planner is what you see first; remembered in this browser.
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem('cockpit.projectsOpen') === '1';
    } catch {
      return false;
    }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem('cockpit.projectsOpen', v ? '1' : '0');
    } catch {
      /* private mode: just not remembered */
    }
  };
  const confirm = useConfirm();
  const toast = useToast();
  const today = isoDate();
  const clientOf = (id: string) => data.clients.find((c) => c.id === id);

  const list = data.projects.filter((p) => filter === 'all' || (filter === 'active' ? p.status !== 'Done' : p.status === 'Done'));
  const activeCount = data.projects.filter((p) => p.status !== 'Done').length;

  const add = () => {
    if (!pf.name.trim() || (pf.start && !isDay(pf.start)) || (pf.deadline && !isDay(pf.deadline)) || dueBeforeStart(pf)) return;
    update((d) => ({
      ...d,
      projects: [{ id: uid(), ...pf, name: pf.name.trim(), position: topPosition(d.projects) }, ...d.projects],
    }));
    toast(<>{t('Project created:')} <b>{pf.name.trim()}</b></>, { tone: 'success' });
    setPf(emptyProject());
    setShowForm(false);
  };
  const cycle = (id: string) =>
    update((d) => ({
      ...d,
      projects: d.projects.map((x) =>
        x.id === id ? { ...x, status: PROJECT_STATUSES[(PROJECT_STATUSES.indexOf(x.status) + 1) % PROJECT_STATUSES.length] } : x,
      ),
    }));
  const remove = async (p: Project) => {
    const ok = await confirm({
      title: t('Delete this project?'),
      message: t('"{name}" will be deleted, along with its brief and journal. Its tasks, transactions and tracked time are kept, with no project.', { name: p.name }),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    const { restore } = removeProject(data, p.id);
    update((d) => removeProject(d, p.id).data);
    toast(<>{t('Project deleted:')} <b>{p.name}</b></>, { undo: () => update(restore) });
  };

  return (
    <section className="section">
      <div className="head">
        <button className="fold" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="projects-panel">
          <svg className="fold-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
          <h2>{t('Active projects')}</h2>
          <span className="sub">{t('{a} active · {n} in total', { a: activeCount, n: data.projects.length })}</span>
        </button>
        {open && (
          <div className="row">
            <Seg label={t('Filter projects')} value={filter} onChange={setFilter} options={[['active', t('Active')], ['all', t('All')], ['done', t('Done')]]} />
            <button className="btn" onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>+ {t('New project')}</button>
          </div>
        )}
      </div>

      {open && showForm && (
        <form className="proj-form form-grid" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Field label={t('Project name')}>
            <input className="input" autoFocus value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} placeholder={t('Website redesign…')} />
          </Field>
          <Field label={t('Client')}>
            <ClientSelect data={data} update={update} value={pf.clientId} onChange={(clientId) => setPf({ ...pf, clientId })} />
          </Field>
          <Field label={t('Start')}>
            <DatePicker value={pf.start} onChange={(start) => setPf({ ...pf, start })} placeholder={t('No start date')} ariaLabel={t('Start')} />
          </Field>
          <Field label={t('Due')}>
            <DatePicker value={pf.deadline} onChange={(deadline) => setPf({ ...pf, deadline })} min={pf.start || undefined} placeholder={t('No due date')} ariaLabel={t('Due')} />
          </Field>
          <Field label={t('Status')}>
            <Select value={pf.status} onChange={(status) => setPf({ ...pf, status })} options={statusOptions()} ariaLabel={t('Status')} />
          </Field>
          <button className="btn dark tall" type="submit" disabled={!pf.name.trim() || dueBeforeStart(pf)}>{t('Add')}</button>
          {dueBeforeStart(pf) && <div className="small form-error">{t("The due date can't be before the start date.")}</div>}
        </form>
      )}

      {open && <div className="proj-list" id="projects-panel">
        {list.map((p) => {
          const tasks = data.tasks.filter((t) => t.projectId === p.id);
          const done = tasks.filter((t) => t.col === 'done').length;
          const late = p.deadline && p.deadline < today && p.status !== 'Done';
          const meta = STATUS_META[p.status] ?? STATUS_META['On hold'];
          return (
            <div className="proj" key={p.id}>
              <div className="cell c-name">
                <span className="cell-k">{t('Project name')}</span>
                <button className="proj-name ellipsis" onClick={() => openProject(p.id)} title={t('Open project')}>{p.name}</button>
              </div>
              <div className="cell c-client">
                <span className="cell-k">{t('Client')}</span>
                <span className="client">
                  <ClientDot client={clientOf(p.clientId)} />
                  <span className="ellipsis">{clientOf(p.clientId)?.name || '—'}</span>
                </span>
              </div>
              <div className="cell c-start">
                <span className="cell-k">{t('Start')}</span>
                <span className="cell-v">{fmtDate(p.start)}</span>
              </div>
              <div className="cell c-deadline">
                <span className="cell-k">{t('Due')}</span>
                <span className="cell-v" style={{ color: late ? 'var(--red)' : undefined, fontWeight: late ? 600 : undefined }} title={late ? t('Overdue') : undefined}>{fmtDate(p.deadline)}</span>
              </div>
              <div className="cell c-progress">
                <span className="cell-k">{t('Tasks')}</span>
                {tasks.length ? (
                  <span className="progress">
                    <span className="progress-bar"><div style={{ width: `${(done / tasks.length) * 100}%` }} /></span>
                    <span className="small" style={{ fontWeight: 600 }}>{done}/{tasks.length}</span>
                  </span>
                ) : (
                  <span className="cell-v" style={{ color: 'var(--faint)' }}>—</span>
                )}
              </div>
              <div className="cell c-status">
                <span className="cell-k">{t('Status')}</span>
                <button className="pill" style={{ background: meta.bg, color: meta.color }} onClick={() => cycle(p.id)} title={t('Click to change')}>{statusLabel(p.status)}</button>
              </div>
              <div className="c-actions">
                <button className="icon-btn" onClick={() => setEditing(p)} title={t('Edit')} aria-label={t('Edit {name}', { name: p.name })}>
                  <IconPencil />
                </button>
                <button className="icon-btn danger" onClick={() => void remove(p)} title={t('Delete')} aria-label={t('Delete {name}', { name: p.name })}>
                  <span style={{ fontSize: '1.125rem', lineHeight: 1 }}>×</span>
                </button>
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="empty">
            {data.projects.length === 0 ? t('No projects yet. Add your first one with "New project".') : t('No projects match this filter.')}
          </div>
        )}
      </div>}

      {editing && <ProjectModal project={editing} data={data} onClose={() => setEditing(null)} update={update} />}
    </section>
  );
}

/** Edit a project, or create one when `project` is not in the data yet (see newProject). */
export function ProjectModal({ project, data, onClose, update, onCreated, onDeleted }: {
  project: Project;
  data: AppData;
  onClose: () => void;
  update: Update;
  onCreated?: (id: string) => void;
  onDeleted?: () => void;
}) {
  // Snapshot at opening: the diff below must only contain what was changed in this form,
  // even if the project is refreshed from another device while the modal is open.
  const [orig] = useState(project);
  const [f, setF] = useState(project);
  const [budget, setBudget] = useState(project.budget ? String(project.budget) : '');
  const [creating] = useState(() => !data.projects.some((p) => p.id === project.id));
  const confirm = useConfirm();
  const toast = useToast();
  const budgetValue = budget.trim() ? parseAmount(budget) : 0;
  const valid = !!f.name.trim() && !dueBeforeStart(f) && budgetValue !== null;
  const save = () => {
    if (!valid || (f.start && !isDay(f.start)) || (f.deadline && !isDay(f.deadline))) return;
    const next = { ...f, name: f.name.trim(), budget: budgetValue ?? 0 };
    if (creating) {
      update((d) => ({ ...d, projects: [{ ...next, position: topPosition(d.projects) }, ...d.projects] }));
      toast(<>{t('Project created:')} <b>{next.name}</b></>, { tone: 'success' });
      onClose();
      onCreated?.(f.id);
      return;
    }
    const changed = changedFields(orig, next);
    update((d) => ({ ...d, projects: d.projects.map((p) => (p.id === f.id ? { ...p, ...changed } : p)) }));
    onClose();
  };
  const remove = async () => {
    const ok = await confirm({
      title: t('Delete this project?'),
      message: t('"{name}" will be deleted, along with its brief and journal. Its tasks, transactions and tracked time are kept, with no project.', { name: project.name }),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    const { restore } = removeProject(data, project.id);
    update((d) => removeProject(d, project.id).data);
    toast(<>{t('Project deleted:')} <b>{project.name}</b></>, { undo: () => update(restore) });
    onClose();
    onDeleted?.();
  };
  return (
    <Modal title={creating ? t('New project') : t('Edit project')} onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="form-grid">
          <Field label={t('Project name')}><input className="input" autoFocus={creating} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('Website redesign…')} /></Field>
          <Field label={t('Client')}><ClientSelect data={data} update={update} value={f.clientId} onChange={(clientId) => setF({ ...f, clientId })} /></Field>
          <Field label={t('Start')}><DatePicker value={f.start} onChange={(start) => setF({ ...f, start })} placeholder={t('No start date')} ariaLabel={t('Start')} /></Field>
          <Field label={t('Due')}><DatePicker value={f.deadline} onChange={(deadline) => setF({ ...f, deadline })} min={f.start || undefined} placeholder={t('No due date')} ariaLabel={t('Due')} /></Field>
          <Field label={t('Status')}>
            <Select value={f.status} onChange={(status) => setF({ ...f, status })} options={statusOptions()} ariaLabel={t('Status')} />
          </Field>
          <Field label={t('Budget excl. tax ({currency})', { currency: data.profile.currency })}>
            <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t('Agreed price, optional')} />
          </Field>
        </div>
        {dueBeforeStart(f) && <div className="small form-error">{t("The due date can't be before the start date.")}</div>}
        {budgetValue === null && <div className="small form-error">{t('Invalid amount. Examples: 12000 · 12 000 · 12000.50')}</div>}
        <div className="modal-foot">
          {creating ? <span /> : <button className="btn sm danger" type="button" onClick={() => void remove()}>{t('Delete project')}</button>}
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>{t('Cancel')}</button>
            <button className="btn sm" type="submit" disabled={!valid}>{creating ? t('Create project') : t('Save')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export const newProject = (): Project => ({ id: uid(), ...emptyProject(), position: 0 });

/* ---------------- Kanban ---------------- */

const PRIORITY_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const;

function Board({ data, update, filter, setFilter, onEdit, sectionRef }: {
  data: AppData;
  update: Update;
  filter: BoardFilter;
  setFilter: (f: BoardFilter) => void;
  onEdit: (t: Task) => void;
  sectionRef: React.RefObject<HTMLElement | null>;
}) {
  const [adding, setAdding] = useState<TaskColumn | null>(null);
  const [title, setTitle] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  // Done tasks older than a week stay in the database but leave the board, unless shown on demand.
  const [showArchived, setShowArchived] = useState(false);
  const running = runningEntry(data);
  const now = useNow(!!running);
  // Where a dragged card would land: in `col`, just before card `before` (null = at the end).
  const [drop, setDrop] = useState<{ col: TaskColumn; before: string | null } | null>(null);
  // Card to refocus after a keyboard move (React may move the focused node).
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    document.querySelector<HTMLElement>(`.task[data-id="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId, data.tasks]);
  const searchRef = useRef<HTMLInputElement>(null);
  // "/" anywhere (outside a field) jumps to the task search.
  useEffect(() => {
    const onFocus = () => searchRef.current?.focus();
    window.addEventListener('cockpit:search-tasks', onFocus);
    return () => window.removeEventListener('cockpit:search-tasks', onFocus);
  }, []);
  const toast = useToast();
  const today = isoDate();
  const weekEnd = addDays(today, 7);
  const projectOf = (id: string) => data.projects.find((p) => p.id === id);
  const clientOf = (id: string) => data.clients.find((c) => c.id === id);

  const active = filter.q.trim() !== '' || filter.clientId !== '' || filter.projectId !== '' || filter.due !== 'all' || filter.priority !== 'any';
  const q = filter.q.trim().toLowerCase();
  const matches = (t: Task) => {
    const project = projectOf(t.projectId);
    const client = clientOf(t.clientId) ?? clientOf(project?.clientId ?? '');
    if (filter.clientId && client?.id !== filter.clientId) return false;
    if (filter.projectId && t.projectId !== filter.projectId) return false;
    if (filter.priority !== 'any' && PRIORITY_RANK[t.priority] < PRIORITY_RANK[filter.priority]) return false;
    if (filter.due !== 'all') {
      if (t.col === 'done' || !t.due) return false;
      if (filter.due === 'overdue' && !(t.due < today)) return false;
      if (filter.due === 'today' && t.due !== today) return false;
      if (filter.due === 'week' && !(t.due <= weekEnd)) return false;
    }
    if (q) {
      const hay = [t.title, t.note, project?.name, client?.name, ...t.checklist.map((c) => c.text)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const place = (id: string, col: TaskColumn, before: string | null) => update((d) => placeTask(d, id, col, before));
  // Cards as shown in a column (archived ones only when displayed), for keyboard / arrow moves.
  const ordered = (col: TaskColumn) =>
    data.tasks.filter((t) => t.col === col && (showArchived || !isArchived(t, now)) && matches(t)).sort((a, b) => a.position - b.position);
  // Keyboard and phone buttons: one step up/down, or to the next/previous column (at the end).
  const step = (t: Task, dir: 'up' | 'down' | 'left' | 'right') => {
    const list = ordered(t.col);
    const i = list.findIndex((x) => x.id === t.id);
    if (dir === 'up' && i > 0) place(t.id, t.col, list[i - 1].id);
    else if (dir === 'down' && i < list.length - 1) place(t.id, t.col, list[i + 2]?.id ?? null);
    else if (dir === 'left' || dir === 'right') {
      const k = COLUMNS.findIndex((c) => c.key === t.col) + (dir === 'left' ? -1 : 1);
      if (k < 0 || k >= COLUMNS.length) return;
      place(t.id, COLUMNS[k].key, null);
    } else return;
    setFocusId(t.id);
  };
  // Phone arrows: keep the moved card under the finger, so a second tap moves the same card again.
  const anchor = useRef<{ id: string; top: number; at: number; pending: boolean } | null>(null);
  const tapStep = (e: React.MouseEvent, t: Task, dir: 'up' | 'down') => {
    const last = anchor.current;
    // A tap right after a move that lands on another card is almost always the same finger again.
    if (last && last.id !== t.id && Date.now() - last.at < 450) return;
    const card = (e.currentTarget as HTMLElement).closest('.task');
    anchor.current = { id: t.id, top: card?.getBoundingClientRect().top ?? 0, at: Date.now(), pending: true };
    step(t, dir);
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a?.pending) return;
    a.pending = false; // only the render caused by this tap
    const el = document.querySelector<HTMLElement>(`.task[data-id="${a.id}"]`);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - a.top);
  }, [data.tasks]);

  // Deleting is instant: the toast offers Undo for a few seconds.
  const removeTask = (task: Task) => {
    const { restore } = removeRow(data, 'tasks', task.id);
    update((d) => removeRow(d, 'tasks', task.id).data);
    toast(<>{t('Task deleted:')} <b>{task.title}</b></>, { undo: () => update(restore) });
  };
  const toggleTimer = (task: Task) => {
    if (running?.taskId === task.id) {
      const { added } = stopTimers(data);
      update((d) => stopTimers(d).data);
      toast(added ? <>{t('{d} logged on', { d: fmtDuration(added) })} <b>{task.title}</b></> : t('Timer stopped (under a minute, not logged)'));
    } else {
      update((d) => startTimer(d, { projectId: task.projectId, taskId: task.id }));
      toast(<>{t('Timer started on')} <b>{task.title}</b></>);
    }
  };

  // The card whose top half the pointer is above; null means the end of the column.
  const dropBefore = (e: DragEvent<HTMLDivElement>) => {
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.task[data-id]')];
    const hit = cards.find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    return hit?.dataset.id ?? null;
  };
  // A drop that would leave the card where it is shows no indicator.
  const isNoop = (col: TaskColumn, before: string | null) => {
    if (!dragId) return true;
    const t = data.tasks.find((x) => x.id === dragId);
    if (!t || t.col !== col) return false;
    if (before === dragId) return true;
    const list = ordered(col);
    const i = list.findIndex((x) => x.id === dragId);
    return (list[i + 1]?.id ?? null) === before;
  };

  const add = () => {
    const t = title.trim();
    if (!t || !adding) return;
    // New cards pick up the board filters, so they stay visible.
    update((d) => ({
      ...d,
      tasks: [
        ...d.tasks,
        {
          ...newTask(adding, d.projects.some((p) => p.id === filter.projectId) ? filter.projectId : ''),
          title: t,
          clientId: !filter.projectId && d.clients.some((c) => c.id === filter.clientId) ? filter.clientId : '',
          priority: filter.priority === 'any' ? 'none' : filter.priority,
          due: filter.due === 'today' ? today : '',
          position: nextPosition(d.tasks),
          doneAt: adding === 'done' ? new Date().toISOString() : '',
        },
      ],
    }));
    setTitle('');
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, col: TaskColumn) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    if (id) place(id, col, dropBefore(e));
    setDragId(null);
    setDrop(null);
  };

  const clientOptions = [{ value: '', label: t('All clients') }, ...data.clients.map((c) => ({ value: c.id, label: c.name, color: c.color }))];
  const projectOptions = [
    { value: '', label: t('All projects') },
    ...data.projects.filter((p) => p.status !== 'Done' || p.id === filter.projectId).map((p) => ({ value: p.id, label: p.name, color: clientOf(p.clientId)?.color })),
  ];
  const priorityOptions = [
    { value: 'any' as const, label: t('Any priority') },
    { value: 'high' as const, label: t('High only'), color: priorityMeta('high').color },
    { value: 'medium' as const, label: t('Medium and up'), color: priorityMeta('medium').color },
  ];
  const visible = data.tasks.filter((t) => (showArchived || !isArchived(t, now)));
  const shown = visible.filter(matches).length;

  return (
    <section className="section" ref={sectionRef} style={{ scrollMarginTop: '1rem' }}>
      <div className="head">
        <div className="head-title">
          <h2>{t('Tasks')}</h2>
          <span className="sub">{active ? t('{n} of {total} shown', { n: shown, total: visible.length }) : t('Drag cards to reorder them or move them to another column')}</span>
        </div>
        <button className="btn" onClick={() => onEdit(newTask('todo', filter.projectId))}>+ {t('New task')}</button>
      </div>

      <div className="board-tools">
        <label className="search">
          <IconSearch />
          <input
            ref={searchRef}
            value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && (setFilter({ ...filter, q: '' }), (e.target as HTMLInputElement).blur())}
            placeholder={t('Search tasks')}
            aria-label={t('Search tasks')}
          />
          {filter.q ? (
            <button className="x" onClick={() => setFilter({ ...filter, q: '' })} aria-label={t('Clear search')}>×</button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>
        <div className="tool-sel"><Select value={filter.clientId} onChange={(clientId) => setFilter({ ...filter, clientId })} options={clientOptions} size="sm" ariaLabel={t('Filter by client')} /></div>
        <div className="tool-sel"><Select value={filter.projectId} onChange={(projectId) => setFilter({ ...filter, projectId })} options={projectOptions} size="sm" ariaLabel={t('Filter by project')} /></div>
        <div className="tool-sel"><Select value={filter.priority} onChange={(priority) => setFilter({ ...filter, priority })} options={priorityOptions} size="sm" ariaLabel={t('Filter by priority')} /></div>
        <Seg label={t('Due')} value={filter.due} onChange={(due) => setFilter({ ...filter, due })} options={[['all', t('All')], ['overdue', t('Overdue')], ['today', t('Today')], ['week', t('7 days')]]} />
        {active && <button className="btn sm ghost" onClick={() => setFilter(NO_FILTER)}>{t('Clear filters')}</button>}
      </div>

      <div className="board">
        {COLUMNS.map((c) => {
          const all = data.tasks.filter((t) => t.col === c.key).sort((a, b) => a.position - b.position);
          const archived = all.filter((t) => isArchived(t, now)).length;
          const inCol = showArchived ? all : all.filter((t) => !isArchived(t, now));
          const tasks = inCol.filter(matches);
          return (
            <div
              key={c.key}
              className={'col' + (drop?.col === c.key && dragId && !(drop && isNoop(c.key, drop.before)) ? ' over' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                const before = dropBefore(e);
                if (drop?.col !== c.key || drop.before !== before) setDrop({ col: c.key, before });
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); }}
              onDrop={(e) => onDrop(e, c.key)}
            >
              <div className="col-head">
                <div className="col-name"><span className="dot round" style={{ background: c.dot }} />{t(c.label)}</div>
                <span className="count">{active && tasks.length !== inCol.length ? `${tasks.length}/${inCol.length}` : tasks.length}</span>
              </div>
              {tasks.map((task, idx) => {
                const project = projectOf(task.projectId);
                const pn = project?.name ?? '';
                const client = clientOf(task.clientId) ?? clientOf(project?.clientId ?? '');
                const open = task.col !== 'done';
                const late = open && !!task.due && task.due < today;
                const isToday = open && task.due === today;
                const pri = priorityMeta(task.priority);
                const checks = task.checklist.length;
                const checked = task.checklist.filter((x) => x.done).length;
                const timing = running?.taskId === task.id;
                const logged = data.timeEntries.filter((x) => x.taskId === task.id).reduce((a, x) => a + entryMinutes(x, now), 0);
                return (
                  <div
                    key={task.id}
                    data-id={task.id}
                    className={
                      'task' +
                      (dragId === task.id ? ' dragging' : '') +
                      (late ? ' is-late' : isToday ? ' is-today' : '') +
                      (timing ? ' is-running' : '') +
                      (task.col === 'done' ? ' is-done' : '') +
                      (drop?.col === c.key && drop.before === task.id && !isNoop(c.key, task.id) ? ' drop-before' : '')
                    }
                    draggable
                    tabIndex={0}
                    role="button"
                    aria-label={t('Edit task {title}. Alt + arrow keys to move it.', { title: task.title })}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; setDragId(task.id); }}
                    onDragEnd={() => { setDragId(null); setDrop(null); }}
                    onClick={() => onEdit(task)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.altKey && e.key.startsWith('Arrow')) {
                        e.preventDefault();
                        step(task, e.key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right');
                        return;
                      }
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(task); }
                    }}
                  >
                    {(client || task.priority !== 'none') && (
                      <div className="task-labels">
                        {client ? <ClientChip client={client} size="sm" /> : <span />}
                        {task.priority !== 'none' && (
                          <span className={'prio prio-' + task.priority} style={{ color: pri.color }} title={t('{p} priority', { p: t(pri.label) })}>
                            <IconFlag size={11} />{task.priority === 'high' ? t('High') : ''}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="task-top">
                      <span className="task-title">{task.title}</span>
                      <span className="task-btns">
                        {open && (
                          <button
                            className={'task-play' + (timing ? ' on' : '')}
                            aria-label={timing ? t('Stop timer') : t('Start timer')}
                            title={timing ? t('Stop timer') : t('Start timer')}
                            onClick={(e) => { e.stopPropagation(); toggleTimer(task); }}
                          >
                            {timing ? <IconStop size={10} /> : <IconPlay size={10} />}
                          </button>
                        )}
                        <button className="x" aria-label={t('Delete task')} onClick={(e) => { e.stopPropagation(); removeTask(task); }}>×</button>
                      </span>
                    </div>
                    <div className="task-foot">
                      {(pn || task.due || task.note || checks > 0 || logged > 0 || timing) && (
                        <div className="task-meta">
                          {pn && <span className="tag">{pn}</span>}
                          {task.due && <span className={'due' + (late ? ' late' : isToday ? ' today' : '')}>{task.col === 'done' ? fmtDate(task.due, true) : dueLabel(task.due, today)}</span>}
                          {checks > 0 && (
                            <span className={'meta-chip' + (checked === checks ? ' complete' : '')} title={t('Checklist')}>
                              <IconChecks size={12} />{checked}/{checks}
                            </span>
                          )}
                          {timing && running ? (
                            <span className="meta-chip live"><span className="live-dot" />{fmtClock(entryMinutes(running, now) * 60_000)}</span>
                          ) : logged > 0 ? (
                            <span className="meta-chip" title={t('Time logged')}><IconClock size={12} />{fmtDuration(logged)}</span>
                          ) : null}
                          {task.note && <span className="note-flag" title={task.note}>≡</span>}
                        </div>
                      )}
                      {/* Touch screens only (no drag and drop there): bottom right, away from the delete button. */}
                      <span className="task-order">
                        <button className="order-btn" aria-label={t('Move up')} disabled={idx === 0} onClick={(e) => { e.stopPropagation(); tapStep(e, task, 'up'); }}>↑</button>
                        <button className="order-btn" aria-label={t('Move down')} disabled={idx === tasks.length - 1} onClick={(e) => { e.stopPropagation(); tapStep(e, task, 'down'); }}>↓</button>
                      </span>
                    </div>
                    {checks > 0 && <span className="task-progress"><span style={{ width: `${(checked / checks) * 100}%` }} /></span>}
                  </div>
                );
              })}
              {tasks.length === 0 && active && inCol.length > 0 && <div className="col-empty">{t('No match here')}</div>}
              {drop?.col === c.key && drop.before === null && !isNoop(c.key, null) && <div className="drop-end" />}
              {archived > 0 && (
                <button className="archived-link" onClick={() => setShowArchived(!showArchived)} aria-pressed={showArchived}>
                  {showArchived ? t('Hide {n} archived', { n: archived }) : t('{n} archived (done over {days} days ago) · show', { n: archived, days: ARCHIVE_AFTER_DAYS })}
                </button>
              )}
              {adding === c.key ? (
                <form className="add-box" onSubmit={(e) => { e.preventDefault(); add(); }}>
                  <input
                    className="input"
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
                    placeholder={t('Task title, then Enter')}
                  />
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <button className="btn sm" type="submit">{t('Add')}</button>
                    <button className="btn sm ghost" type="button" onClick={() => setAdding(null)}>{t('Close')}</button>
                    <button className="btn sm ghost" type="button" style={{ marginLeft: 'auto' }} onClick={() => { setAdding(null); onEdit({ ...newTask(c.key, filter.projectId), title }); }}>{t('More…')}</button>
                  </div>
                </form>
              ) : (
                <button className="add-link" onClick={() => { setAdding(c.key); setTitle(''); }}>+ {t('Add a task')}</button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

