import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { DatePicker } from '../components/Calendar';
import { ClientChip } from '../components/pickers';
import { Select } from '../components/Select';
import { IconPencil, IconPlay, IconStop, IconTrash, Seg } from '../components/ui';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { ClientModal, ContactList } from '../components/ClientModal';
import { allTxns } from '../lib/finance';
import { projectStats } from '../lib/stats';
import { entryMinutes, fmtClock, fmtDuration, parseDuration, runningEntry, startTimer, stopTimers, sumMinutes, useNow, weekStart } from '../lib/time';
import { putBack, removeProject, removeRow } from '../lib/undo';
import { BRIEF_FIELDS, NOTE_KINDS, PROJECT_STATUSES, STATUS_META, statusLabel } from '../lib/constants';
import { fmtDate, isoDate, money, pct, uid } from '../lib/format';
import { isDay, sortNotes } from '../lib/store';
import type { AppData, Note, NoteKind, Project, TimeEntry } from '../types';
import { newProject, ProjectModal } from './OverviewPage';
import { t, tn } from '../lib/i18n';

type Update = (fn: (d: AppData) => AppData) => void;
type Props = { data: AppData; update: Update; projectId: string; openProject: (id: string) => void; back: () => void };

const kindOptions = () => NOTE_KINDS.map((k) => ({ value: k.key, label: t(k.label), color: k.color }));
const kindMeta = (k: NoteKind) => NOTE_KINDS.find((x) => x.key === k) ?? NOTE_KINDS[0];

export default function ProjectsPage(props: Props) {
  const project = props.data.projects.find((p) => p.id === props.projectId);
  if (props.projectId && !project) {
    return (
      <section className="section">
        <div className="empty">
          {t('This project no longer exists.')} <button className="link-btn" onClick={props.back}>{t('See all projects')}</button>
        </div>
      </section>
    );
  }
  return project ? <ProjectView {...props} project={project} /> : <ProjectList {...props} />;
}

/* ---------------- List ---------------- */

function ProjectList({ data, update, openProject }: Props) {
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('active');
  const confirm = useConfirm();
  const toast = useToast();
  const removeP = async (p: Project) => {
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
  const [creating, setCreating] = useState<Project | null>(null);
  const clientOf = (id: string) => data.clients.find((c) => c.id === id);
  const list = data.projects.filter((p) => filter === 'all' || (filter === 'active' ? p.status !== 'Done' : p.status === 'Done'));
  const today = isoDate();
  const txns = allTxns(data);
  const m = (n: number) => money(n, data.profile.currency);

  return (
    <section className="section">
      <div className="head">
        <div className="head-title">
          <h1>{t('Projects')}</h1>
          <span className="sub">{t('Brief and journal for each project')}</span>
        </div>
        <div className="row">
          <Seg label={t('Filter projects')} value={filter} onChange={setFilter} options={[['active', t('Active')], ['all', t('All')], ['done', t('Done')]]} />
          <button className="btn" onClick={() => setCreating(newProject())}>+ {t('New project')}</button>
        </div>
      </div>

      <div className="pcards">
        {list.map((p) => {
          const client = clientOf(p.clientId);
          const tasks = data.tasks.filter((x) => x.projectId === p.id);
          const done = tasks.filter((x) => x.col === 'done').length;
          const last = sortNotes(data.notes.filter((n) => n.projectId === p.id))[0];
          const briefFilled = BRIEF_FIELDS.filter((f) => p.brief[f.key].trim()).length;
          const meta = STATUS_META[p.status];
          const late = p.deadline && p.deadline < today && p.status !== 'Done';
          const st = projectStats(data, p.id, txns);
          return (
            <div
              className="pcard"
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={(e) => !(e.target as HTMLElement).closest('.pcard-del') && openProject(p.id)}
              onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && openProject(p.id)}
              style={{ borderTopColor: client?.color ?? 'var(--line)' }}
            >
              <button className="icon-btn danger pcard-del" onClick={() => void removeP(p)} title={t('Delete project')} aria-label={t('Delete {name}', { name: p.name })}><IconTrash size={13} /></button>
              <div className="row" style={{ justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'nowrap' }}>
                {client ? <ClientChip client={client} size="sm" /> : <span className="small">{t('No client')}</span>}
                <span className="pill" style={{ background: meta.bg, color: meta.color }}>{statusLabel(p.status)}</span>
              </div>
              <div className="pcard-name">{p.name}</div>
              <div className="small" style={{ color: late ? 'var(--red)' : undefined }}>
                {p.start || p.deadline ? `${fmtDate(p.start)} → ${fmtDate(p.deadline)}` : t('No dates')}
              </div>
              {tasks.length > 0 && (
                <span className="progress">
                  <span className="progress-bar"><div style={{ width: `${(done / tasks.length) * 100}%` }} /></span>
                  <span className="small" style={{ fontWeight: 600 }}>{done}/{tasks.length}</span>
                </span>
              )}
              {(st.revenue > 0 || st.budget > 0 || st.minutes > 0) && (
                <div className="pcard-money">
                  <span>
                    <b>{m(st.revenue)}</b>
                    {st.budget > 0 && <span className="small"> / {m(st.budget)}</span>}
                  </span>
                  <span className="small">
                    {st.marginRate !== null ? t('{pct} margin', { pct: pct(st.marginRate) }) : ''}
                    {st.marginRate !== null && st.minutes ? ' · ' : ''}
                    {st.minutes ? fmtDuration(st.minutes) : ''}
                  </span>
                </div>
              )}
              <div className="pcard-foot">
                {last ? (
                  <span className="ellipsis">
                    <span style={{ color: kindMeta(last.kind).color, fontWeight: 600 }}>{t(kindMeta(last.kind).label)}</span> · {fmtDate(last.date, true)} · {last.body}
                  </span>
                ) : briefFilled ? (
                  <span>{t('Brief {n}/4 · no notes yet', { n: briefFilled })}</span>
                ) : (
                  <span>{t('Brief to fill in')}</span>
                )}
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="empty" style={{ gridColumn: '1 / -1' }}>
            {data.projects.length === 0 ? t('Create your first project to give it a brief and a journal.') : t('No projects match this filter.')}
          </div>
        )}
      </div>
      {creating && <ProjectModal project={creating} data={data} update={update} onClose={() => setCreating(null)} onCreated={openProject} />}
    </section>
  );
}

/* ---------------- One project ---------------- */

function ProjectView({ data, update, project: p, back }: Props & { project: Project }) {
  const [editing, setEditing] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const toast = useToast();
  const client = data.clients.find((c) => c.id === p.clientId);
  const tasks = data.tasks.filter((x) => x.projectId === p.id);
  const done = tasks.filter((x) => x.col === 'done').length;
  const meta = STATUS_META[p.status];
  const today = isoDate();
  const late = p.deadline && p.deadline < today && p.status !== 'Done';
  const running = runningEntry(data);
  const timing = running?.projectId === p.id;
  const now = useNow(timing);
  const st = projectStats(data, p.id, undefined, now);
  const m = (n: number) => money(n, data.profile.currency);

  const cycle = () =>
    update((d) => ({
      ...d,
      projects: d.projects.map((x) =>
        x.id === p.id ? { ...x, status: PROJECT_STATUSES[(PROJECT_STATUSES.indexOf(x.status) + 1) % PROJECT_STATUSES.length] } : x,
      ),
    }));
  const confirm = useConfirm();
  const removeIt = async () => {
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
    back();
  };
  const toggleTimer = () => {
    if (timing) {
      const { added } = stopTimers(data);
      update((d) => stopTimers(d).data);
      toast(added ? <>{t('{d} logged on', { d: fmtDuration(added) })} <b>{p.name}</b></> : t('Timer stopped (under a minute, not logged)'));
    } else {
      update((d) => startTimer(d, { projectId: p.id }));
      toast(<>{t('Timer started on')} <b>{p.name}</b></>);
    }
  };

  return (
    <section className="section loose">
      <button className="crumb-link small" style={{ alignSelf: 'flex-start' }} onClick={back}>← {t('All projects')}</button>

      <div className="card phead" style={{ borderTopColor: client?.color ?? 'var(--line)' }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: '0.625rem' }}>
            <h1 className="ellipsis" style={{ maxWidth: '100%' }}>{p.name}</h1>
            <button className="icon-btn" onClick={() => setEditing(true)} title={t('Edit project')} aria-label={t('Edit project')}><IconPencil /></button>
          </div>
          <div className="row" style={{ gap: '0.5rem', marginTop: '0.375rem' }}>
            {client ? <ClientChip client={client} /> : <span className="small">{t('No client')}</span>}
            <button className="pill" style={{ background: meta.bg, color: meta.color }} onClick={cycle} title={t('Click to change')}>{statusLabel(p.status)}</button>
            <span className="small" style={{ color: late ? 'var(--red)' : undefined, fontWeight: late ? 600 : undefined }}>
              {fmtDate(p.start)} → {fmtDate(p.deadline)}{late ? ` · ${t('overdue')}` : ''}
            </span>
          </div>
        </div>
        <div className="phead-side">
          <div className="phead-progress">
            <span className="small">{t('Tasks {done}/{total}', { done, total: tasks.length })}</span>
            <span className="progress-bar"><div style={{ width: tasks.length ? `${(done / tasks.length) * 100}%` : 0 }} /></span>
          </div>
          <button className={'btn ' + (timing ? 'danger' : 'outline')} onClick={toggleTimer}>
            {timing && running ? <><IconStop size={11} /> {fmtClock(entryMinutes(running, now) * 60_000)}</> : <><IconPlay size={11} /> {t('Start timer')}</>}
          </button>
          <button className="icon-btn danger" onClick={() => void removeIt()} title={t('Delete project')} aria-label={t('Delete project')}><IconTrash /></button>
        </div>
      </div>

      <div className="kpis pstats">
        <div className="kpi">
          <div className="kpi-k">{t('Budget')}</div>
          <div className="kpi-v">{st.budget ? m(st.budget) : '—'}</div>
          {st.budgetUsed !== null ? (
            <>
              <span className="goal-bar"><span style={{ width: `${Math.min(100, st.budgetUsed)}%`, background: st.budgetUsed > 100 ? 'var(--amber)' : undefined }} /></span>
              <div className="kpi-s">{st.budget > st.revenue ? t('{pct} invoiced · {left} left', { pct: pct(st.budgetUsed), left: m(st.budget - st.revenue) }) : t('{pct} invoiced', { pct: pct(st.budgetUsed) })}</div>
            </>
          ) : (
            <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(true)}>{t('Set a budget')}</button>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-k">{t('Revenue')}</div>
          <div className="kpi-v">{m(st.revenue)}</div>
          <div className="kpi-s" style={{ color: st.unpaid ? 'var(--amber)' : undefined }}>{st.unpaid ? t('{amount} not paid yet', { amount: m(st.unpaid) }) : t('All paid')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t('Margin')}</div>
          <div className="kpi-v" style={{ color: st.margin < 0 ? 'var(--red)' : undefined }}>{m(st.margin)}</div>
          <div className="kpi-s">{st.marginRate !== null ? t('{pct} after {costs} of costs', { pct: pct(st.marginRate), costs: m(st.costs) }) : t('No revenue yet')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t('Time')}</div>
          <div className="kpi-v">{fmtDuration(st.minutes)}</div>
          <div className="kpi-s">{st.perHour !== null ? t('{amount} earned per hour', { amount: m(st.perHour) }) : t('Start the timer to track it')}</div>
        </div>
      </div>

      {client && (
        <div className="card client-card" style={{ borderLeftColor: client.color }}>
          <div className="head">
            <div>
              <div className="card-title">{client.name} <span className="small" style={{ fontWeight: 500 }}>· {tn(client.contacts.length, '{n} contact', '{n} contacts')}</span></div>
              {client.notes ? <div className="small client-notes">{client.notes}</div> : <div className="small">{t("Client notes and contacts, shared by all of {name}'s projects.", { name: client.name })}</div>}
            </div>
            <button className="btn sm outline" onClick={() => setEditingClient(true)}><IconPencil /> {t('Edit client')}</button>
          </div>
          <ContactList client={client} onEdit={() => setEditingClient(true)} />
        </div>
      )}

      <div className="pgrid">
        <Brief project={p} update={update} />
        <Journal project={p} notes={data.notes} update={update} />
      </div>

      <TimeLog data={data} project={p} update={update} now={now} />

      {editing && <ProjectModal project={p} data={data} update={update} onClose={() => setEditing(false)} onDeleted={back} />}
      {editingClient && client && <ClientModal client={client} update={update} onClose={() => setEditingClient(false)} />}
    </section>
  );
}

/* ---------------- Time log ---------------- */

function TimeLog({ data, project, update, now }: { data: AppData; project: Project; update: Update; now: number }) {
  const [date, setDate] = useState(isoDate());
  const [dur, setDur] = useState('');
  const [taskId, setTaskId] = useState('');
  const [note, setNote] = useState('');
  const [all, setAll] = useState(false);
  const toast = useToast();
  const minutes = parseDuration(dur);
  const entries = data.timeEntries
    .filter((x) => x.projectId === project.id)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt ? 1 : 0) - (a.startedAt ? 1 : 0));
  const total = sumMinutes(entries, now);
  const week = sumMinutes(entries.filter((x) => x.date >= weekStart()), now);
  const tasks = data.tasks.filter((x) => x.projectId === project.id);
  const taskName = (id: string) => data.tasks.find((x) => x.id === id)?.title ?? '';
  const taskOptions = [{ value: '', label: t('Whole project') }, ...tasks.map((x) => ({ value: x.id, label: x.title }))];

  const add = () => {
    if (!minutes || !isDay(date)) return;
    const entry: TimeEntry = { id: uid(), projectId: project.id, taskId, date, minutes, note: note.trim(), startedAt: '' };
    update((d) => ({ ...d, timeEntries: [entry, ...d.timeEntries] }));
    toast(<>{t('{d} logged on', { d: fmtDuration(minutes) })} <b>{project.name}</b></>, {
      undo: () => update((d) => ({ ...d, timeEntries: d.timeEntries.filter((x) => x.id !== entry.id) })),
    });
    setDur('');
    setNote('');
  };
  const remove = (e: TimeEntry) => {
    const { restore } = removeRow(data, 'timeEntries', e.id);
    update((d) => removeRow(d, 'timeEntries', e.id).data);
    toast(t('{d} removed', { d: fmtDuration(entryMinutes(e)) }), { undo: () => update(restore) });
  };
  const shown = all ? entries : entries.slice(0, 8);

  return (
    <div className="card" style={{ gap: '0.875rem' }}>
      <div className="head">
        <div>
          <div className="card-title">{t('Time log')} <span className="small" style={{ fontWeight: 500 }}>{entries.length}</span></div>
          <div className="small">{t('{total} in total · {week} this week. Log time by hand, or use the timer.', { total: fmtDuration(total), week: fmtDuration(week) })}</div>
        </div>
      </div>
      <form className="time-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div className="note-ctl"><DatePicker value={date} onChange={setDate} clearable={false} size="sm" ariaLabel={t('Date')} /></div>
        <input className="input time-dur" value={dur} onChange={(e) => setDur(e.target.value)} placeholder="1h30" aria-label={t('Duration')} />
        <div className="time-task"><Select value={taskId} onChange={setTaskId} options={taskOptions} size="sm" ariaLabel={t('Task')} /></div>
        <input className="input time-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('What did you work on? (optional)')} aria-label={t('Note')} />
        <button className="btn sm" type="submit" disabled={!minutes}>{t('Log time')}</button>
      </form>
      {dur.trim() && !minutes && <div className="small" style={{ color: 'var(--red)' }}>{t('Write a duration like 1h30, 45m, 1:15 or 2.5')}</div>}
      <div className="time-list">
        {shown.map((e) => (
          <div className={'time-row' + (e.startedAt ? ' is-running' : '')} key={e.id}>
            <span className="time-date">{fmtDate(e.date, e.date.slice(0, 4) === String(new Date().getFullYear()))}</span>
            <span className="ellipsis time-what">
              {e.startedAt && <span className="live-dot" />}
              {taskName(e.taskId) || e.note || <span style={{ color: 'var(--muted)' }}>{t('Project work')}</span>}
              {taskName(e.taskId) && e.note ? <span className="small"> · {e.note}</span> : null}
            </span>
            <b className="time-dur-v">{e.startedAt ? fmtClock(entryMinutes(e, now) * 60_000) : fmtDuration(e.minutes)}</b>
            <button className="x" onClick={() => remove(e)} aria-label={t('Remove this time')} disabled={!!e.startedAt}>×</button>
          </div>
        ))}
        {entries.length === 0 && <div className="empty">{t('No time logged yet. Start the timer at the top, or log a session above.')}</div>}
        {entries.length > 8 && (
          <button className="archived-link" onClick={() => setAll(!all)}>{all ? t('Show less') : t('Show all {n}', { n: entries.length })}</button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Brief ---------------- */

function Brief({ project, update }: { project: Project; update: Update }) {
  const set = (key: keyof Project['brief'], value: string) =>
    update((d) => ({ ...d, projects: d.projects.map((x) => (x.id === project.id ? { ...x, brief: { ...x.brief, [key]: value } } : x)) }));
  return (
    <div className="card" style={{ gap: '0.75rem' }}>
      <div>
        <div className="card-title">{t('Brief')}</div>
        <div className="small">{t('What you reread before a call. Saved as you type.')}</div>
      </div>
      {BRIEF_FIELDS.map((f) => (
        <label className="brief-field" key={f.key}>
          <span className="brief-label">{t(f.label)}</span>
          <AutoText value={project.brief[f.key]} onChange={(v) => set(f.key, v)} placeholder={t(f.placeholder)} />
        </label>
      ))}
    </div>
  );
}

/** Textarea that grows with its content. */
function AutoText({ value, onChange, placeholder, autoFocus, onKeyDown, className = 'input auto-text' }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useEffect(fit, [value]);
  // Width changes (window resize, sidebar, phone rotation) change the height the text needs.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      className={className}
      rows={2}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ---------------- Journal ---------------- */

function Journal({ project, notes, update }: { project: Project; notes: Note[]; update: Update }) {
  const [kind, setKind] = useState<NoteKind>('note');
  const [date, setDate] = useState(isoDate());
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const toast = useToast();

  const list = sortNotes(notes.filter((n) => n.projectId === project.id));

  const add = () => {
    const text = body.trim();
    if (!text || !isDay(date)) return;
    update((d) => ({ ...d, notes: [...d.notes, { id: uid(), projectId: project.id, date, kind, body: text, createdAt: new Date().toISOString() }] }));
    setBody('');
    setKind('note');
  };
  const remove = (n: Note) => {
    update((d) => removeRow(d, 'notes', n.id).data);
    toast(t('Note deleted'), { undo: () => update((d) => putBack(d, 'notes', [n])) });
  };
  const save = (n: Note) => update((d) => ({ ...d, notes: d.notes.map((x) => (x.id === n.id ? n : x)) }));

  return (
    <div className="card" style={{ gap: '0.875rem' }}>
      <div>
        <div className="card-title">{t('Journal')} <span className="small" style={{ fontWeight: 500 }}>{list.length}</span></div>
        <div className="small">{t("Calls, decisions, client feedback: the project's memory, newest first.")}</div>
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <AutoText
          value={body}
          onChange={setBody}
          placeholder={t('What happened? (⌘ + Enter to add)')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
        />
        <div className="note-row">
          <div className="note-ctl">
            <Select value={kind} onChange={setKind} options={kindOptions()} size="sm" ariaLabel={t('Note type')} />
          </div>
          <div className="note-ctl"><DatePicker value={date} onChange={setDate} clearable={false} size="sm" ariaLabel={t('Date')} /></div>
          <div className="note-btns">
            <button className="btn sm" type="submit" disabled={!body.trim()}>{t('Add')}</button>
          </div>
        </div>
      </form>

      <div className="notes">
        {list.map((n) =>
          editingId === n.id ? (
            <NoteEditor key={n.id} note={n} onCancel={() => setEditingId(null)} onSave={(x) => { save(x); setEditingId(null); }} />
          ) : (
            <div className="note" key={n.id}>
              <div className="note-meta">
                <span className="note-date">{fmtDate(n.date, n.date.slice(0, 4) === String(new Date().getFullYear()))}</span>
                <span className="note-kind" style={{ background: kindMeta(n.kind).bg, color: kindMeta(n.kind).color }}>{t(kindMeta(n.kind).label)}</span>
                <span className="note-actions">
                  <button className="icon-btn" onClick={() => setEditingId(n.id)} title={t('Edit')} aria-label={t('Edit note')}><IconPencil /></button>
                  <button className="icon-btn danger" onClick={() => remove(n)} title={t('Delete')} aria-label={t('Delete note')}><span style={{ fontSize: '1.0625rem', lineHeight: 1 }}>×</span></button>
                </span>
              </div>
              <div className="note-body">{linkify(n.body)}</div>
            </div>
          ),
        )}
        {list.length === 0 && <div className="empty">{t("Log every call, decision or client feedback here. In three months, you'll know exactly who said what.")}</div>}
      </div>
    </div>
  );
}

function NoteEditor({ note, onSave, onCancel }: { note: Note; onSave: (n: Note) => void; onCancel: () => void }) {
  const [f, setF] = useState(note);
  const submit = () => {
    if (!f.body.trim() || !isDay(f.date)) return;
    onSave({ ...f, body: f.body.trim() });
  };
  return (
    <div className="note is-editing">
      <AutoText
        value={f.body}
        onChange={(body) => setF({ ...f, body })}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="note-row">
        <div className="note-ctl">
          <Select value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={kindOptions()} size="sm" ariaLabel={t('Note type')} />
        </div>
        <div className="note-ctl"><DatePicker value={f.date} onChange={(date) => setF({ ...f, date })} clearable={false} size="sm" ariaLabel={t('Date')} /></div>
        <div className="note-btns">
          <button className="btn sm ghost" type="button" onClick={onCancel}>{t('Cancel')}</button>
          <button className="btn sm" type="button" onClick={submit} disabled={!f.body.trim()}>{t('Save')}</button>
        </div>
      </div>
    </div>
  );
}

/** Plain text with clickable links (http/https only). */
function linkify(text: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return parts.map((part, i) => {
    if (!/^https?:\/\//.test(part)) return <Fragment key={i}>{part}</Fragment>;
    // "see https://x.com/a." -> the final dot is punctuation, not part of the link.
    let url = part;
    let tail = '';
    const m = url.match(/[.,;:!?»\]]+$/);
    if (m) {
      tail = m[0];
      url = url.slice(0, -tail.length);
    }
    if (url.endsWith(')') && !url.includes('(')) {
      tail = ')' + tail;
      url = url.slice(0, -1);
    }
    return (
      <Fragment key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
        {tail}
      </Fragment>
    );
  });
}
