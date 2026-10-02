import type { AppData } from '../types';

/*
 * Deletes that can be undone. Each one returns the new data and a `restore` function that puts
 * back what was removed on top of the data as it is when Undo is pressed (other edits made
 * meanwhile are kept).
 */

type Rows = 'clients' | 'projects' | 'tasks' | 'entries' | 'recurring' | 'notes' | 'timeEntries';
type Restore = (d: AppData) => AppData;

/** Add rows back, skipping ids that exist again. */
export function putBack<K extends Rows>(d: AppData, key: K, rows: AppData[K]): AppData {
  const have = new Set((d[key] as { id: string }[]).map((x) => x.id));
  const back = (rows as { id: string }[]).filter((x) => !have.has(x.id));
  return back.length ? { ...d, [key]: [...(d[key] as { id: string }[]), ...back] } : d;
}

/** Remove one row of a simple list (task, note, transaction, subscription, time entry). */
export function removeRow<K extends Rows>(d: AppData, key: K, id: string): { data: AppData; restore: Restore } {
  const row = (d[key] as { id: string }[]).find((x) => x.id === id);
  if (!row) return { data: d, restore: (x) => x };
  const data = { ...d, [key]: (d[key] as { id: string }[]).filter((x) => x.id !== id) } as AppData;
  const restore: Restore = (x) => {
    const next = putBack(x, key, [row] as AppData[K]);
    // Keep the board and project order as it was.
    if (key === 'tasks') return { ...next, tasks: [...next.tasks].sort((a, b) => a.position - b.position) };
    return next;
  };
  return { data, restore };
}

const relink = <T extends { id: string }>(list: T[], ids: Set<string>, field: keyof T, value: string): T[] =>
  list.map((x) => (ids.has(x.id) && !x[field] ? { ...x, [field]: value } : x));

/** Delete a project with its journal; its tasks, money and time stay, unlinked. */
export function removeProject(d: AppData, id: string): { data: AppData; restore: Restore } {
  const project = d.projects.find((p) => p.id === id);
  if (!project) return { data: d, restore: (x) => x };
  const notes = d.notes.filter((n) => n.projectId === id);
  const ids = <T extends { id: string; projectId: string }>(list: T[]) => new Set(list.filter((x) => x.projectId === id).map((x) => x.id));
  const linked = { tasks: ids(d.tasks), entries: ids(d.entries), recurring: ids(d.recurring), time: ids(d.timeEntries) };
  const unlink = <T extends { projectId: string }>(x: T) => (x.projectId === id ? { ...x, projectId: '' } : x);
  const data: AppData = {
    ...d,
    projects: d.projects.filter((p) => p.id !== id),
    tasks: d.tasks.map(unlink),
    entries: d.entries.map(unlink),
    recurring: d.recurring.map(unlink),
    timeEntries: d.timeEntries.map(unlink),
    notes: d.notes.filter((n) => n.projectId !== id),
  };
  const restore: Restore = (x) => {
    if (x.projects.some((p) => p.id === id)) return x;
    const back = putBack({ ...x, projects: [...x.projects, project].sort((a, b) => a.position - b.position) }, 'notes', notes);
    return {
      ...back,
      tasks: relink(back.tasks, linked.tasks, 'projectId', id),
      entries: relink(back.entries, linked.entries, 'projectId', id),
      recurring: relink(back.recurring, linked.recurring, 'projectId', id),
      timeEntries: relink(back.timeEntries, linked.time, 'projectId', id),
    };
  };
  return { data, restore };
}

/** Delete a client; its projects and tasks stay, with no client. */
export function removeClient(d: AppData, id: string): { data: AppData; restore: Restore } {
  const client = d.clients.find((c) => c.id === id);
  if (!client) return { data: d, restore: (x) => x };
  const projects = new Set(d.projects.filter((p) => p.clientId === id).map((p) => p.id));
  const tasks = new Set(d.tasks.filter((t) => t.clientId === id).map((t) => t.id));
  const data: AppData = {
    ...d,
    clients: d.clients.filter((c) => c.id !== id),
    projects: d.projects.map((p) => (p.clientId === id ? { ...p, clientId: '' } : p)),
    tasks: d.tasks.map((t) => (t.clientId === id ? { ...t, clientId: '' } : t)),
  };
  const restore: Restore = (x) => {
    if (x.clients.some((c) => c.id === id)) return x;
    return {
      ...x,
      clients: [...x.clients, client].sort((a, b) => a.name.localeCompare(b.name)),
      projects: relink(x.projects, projects, 'clientId', id),
      tasks: relink(x.tasks, tasks, 'clientId', id),
    };
  };
  return { data, restore };
}
