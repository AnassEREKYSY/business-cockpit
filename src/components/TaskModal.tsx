import { useState } from 'react';
import { COLUMNS, PRIORITIES } from '../lib/constants';
import { uid } from '../lib/format';
import { isDay, nextPosition, withCol } from '../lib/store';
import { entryMinutes, fmtClock, fmtDuration, runningEntry, startTimer, stopTimers, useNow } from '../lib/time';
import { removeRow } from '../lib/undo';
import type { AppData, CheckItem, Task, TaskColumn } from '../types';
import { DatePicker } from './Calendar';
import { ClientSelect, ProjectSelect } from './pickers';
import { Select } from './Select';
import { useToast } from './Toast';
import { Field, IconPlay, IconStop, Modal } from './ui';

type Update = (fn: (d: AppData) => AppData) => void;

const COLUMN_OPTIONS = COLUMNS.map((c) => ({ value: c.key, label: c.label, color: c.dot }));
const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p.key, label: p.label, color: p.color }));

/** A blank task, opened in the modal to create one. */
export const newTask = (col: TaskColumn = 'todo', projectId = ''): Task => ({
  id: uid(), title: '', col, clientId: '', projectId, due: '', note: '', position: 0, doneAt: '', priority: 'none', checklist: [],
});

/** Fields of `edited` that differ from `original`. */
function changedFields<T extends object>(original: T, edited: T): Partial<T> {
  return Object.fromEntries(Object.entries(edited).filter(([k, v]) => v !== original[k as keyof T])) as Partial<T>;
}

/** Edit a task, or create it when it is not in the data yet (see newTask). */
export function TaskModal({ task, data, onClose, update }: { task: Task; data: AppData; onClose: () => void; update: Update }) {
  const [f, setF] = useState(task);
  const [creating] = useState(() => !data.tasks.some((t) => t.id === task.id));
  const [newItem, setNewItem] = useState('');
  const toast = useToast();
  const projectClient = (id: string) => data.clients.find((c) => c.id === data.projects.find((p) => p.id === id)?.clientId);
  // The task's own client only overrides its project's: drop it when it would say the same thing.
  const pickProject = (projectId: string) =>
    setF({ ...f, projectId, clientId: f.clientId && f.clientId === projectClient(projectId)?.id ? '' : f.clientId });

  const running = runningEntry(data);
  const timing = !creating && running?.taskId === task.id;
  const now = useNow(timing);
  const logged = data.timeEntries.filter((x) => x.taskId === task.id).reduce((a, x) => a + entryMinutes(x, now), 0);

  const save = () => {
    const title = f.title.trim();
    if (!title || (f.due && !isDay(f.due))) return;
    if (creating) {
      update((d) => ({
        ...d,
        tasks: [...d.tasks, { ...withCol({ ...f, col: 'todo' }, f.col), title, position: nextPosition(d.tasks) }],
      }));
      toast(<>Task <b>{title}</b> added</>, { tone: 'success' });
      onClose();
      return;
    }
    // Apply only what was changed in this form, on top of the current row (it may have been
    // updated from another device while the form was open).
    const changed = changedFields(task, { ...f, title });
    update((d) => ({
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === f.id
          ? { ...withCol({ ...t, ...changed, col: t.col }, changed.col ?? t.col), position: 'col' in changed ? nextPosition(d.tasks) : t.position }
          : t,
      ),
    }));
    onClose();
  };
  const remove = () => {
    const { restore } = removeRow(data, 'tasks', task.id);
    update((d) => removeRow(d, 'tasks', task.id).data);
    toast(<>Task <b>{task.title}</b> deleted</>, { undo: () => update(restore) });
    onClose();
  };
  const toggleTimer = () => {
    if (timing) {
      const { added } = stopTimers(data);
      update((d) => stopTimers(d).data);
      toast(added ? <>{fmtDuration(added)} logged on <b>{task.title}</b></> : 'Timer stopped (under a minute, not logged)');
    } else {
      update((d) => startTimer(d, { projectId: d.tasks.find((t) => t.id === task.id)?.projectId ?? f.projectId, taskId: task.id }));
      toast(<>Timer started on <b>{task.title}</b></>);
    }
  };

  const items = f.checklist;
  const setItems = (checklist: CheckItem[]) => setF({ ...f, checklist });
  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setItems([...items, { id: uid(), text, done: false }]);
    setNewItem('');
  };
  const doneCount = items.filter((i) => i.done).length;

  return (
    <Modal title={creating ? 'New task' : 'Task'} onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Title">
          <input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What needs doing?" />
        </Field>
        <div className="form-grid">
          <Field label="Client">
            <ClientSelect
              data={data}
              update={update}
              value={f.clientId}
              onChange={(clientId) => setF({ ...f, clientId: clientId === projectClient(f.projectId)?.id ? '' : clientId })}
              inherited={projectClient(f.projectId)}
            />
          </Field>
          <Field label="Project">
            <ProjectSelect projects={data.projects} clients={data.clients} value={f.projectId} onChange={pickProject} />
          </Field>
          <Field label="Column">
            <Select value={f.col} onChange={(col) => setF({ ...f, col })} options={COLUMN_OPTIONS} ariaLabel="Column" />
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(priority) => setF({ ...f, priority })} options={PRIORITY_OPTIONS} ariaLabel="Priority" />
          </Field>
          <Field label="Due">
            <DatePicker value={f.due} onChange={(due) => setF({ ...f, due })} placeholder="No due date" ariaLabel="Due" />
          </Field>
        </div>

        <div className="checklist">
          <div className="checklist-head">
            <span className="field-label">Checklist</span>
            {items.length > 0 && (
              <span className="small">{doneCount}/{items.length} done</span>
            )}
          </div>
          {items.length > 0 && (
            <div className="check-progress"><div style={{ width: `${(doneCount / items.length) * 100}%` }} /></div>
          )}
          {items.map((it, i) => (
            <div className={'check-row' + (it.done ? ' is-done' : '')} key={it.id}>
              <button
                type="button"
                className="check-box"
                role="checkbox"
                aria-checked={it.done}
                aria-label={it.text}
                onClick={() => setItems(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
              </button>
              <input
                className="check-text"
                value={it.text}
                aria-label={`Checklist item ${i + 1}`}
                onChange={(e) => setItems(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))}
                onBlur={(e) => !e.target.value.trim() && setItems(items.filter((x) => x.id !== it.id))}
              />
              <button type="button" className="x" aria-label="Remove item" onClick={() => setItems(items.filter((x) => x.id !== it.id))}>×</button>
            </div>
          ))}
          <div className="check-add">
            <input
              className="input"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addItem();
                }
              }}
              placeholder="Add an item and press Enter"
              aria-label="New checklist item"
            />
          </div>
        </div>

        <Field label="Note"><textarea className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Details, link, next step…" /></Field>

        {!creating && (
          <div className="task-time">
            <div>
              <div className="field-label">Time</div>
              <div className="task-time-v">
                {timing && running ? <span className="live-dot" /> : null}
                {timing && running ? fmtClock(now - Date.parse(running.startedAt) + running.minutes * 60_000) : fmtDuration(logged)}
                <span className="small">{timing ? ' running' : logged ? ' logged on this task' : ' nothing logged yet'}</span>
              </div>
            </div>
            <button type="button" className={'btn sm ' + (timing ? 'danger' : 'outline')} onClick={toggleTimer}>
              {timing ? <><IconStop size={11} /> Stop</> : <><IconPlay size={11} /> Start timer</>}
            </button>
          </div>
        )}

        <div className="modal-foot">
          {creating ? <span /> : <button className="btn sm danger" type="button" onClick={remove}>Delete</button>}
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn sm" type="submit" disabled={!f.title.trim()}>{creating ? 'Create task' : 'Save'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
