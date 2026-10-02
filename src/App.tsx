import { useEffect, useMemo, useRef, useState } from 'react';
import { EntryModal, newEntry } from './components/MoneyForms';
import { Palette, type Command } from './components/Palette';
import { TaskModal, newTask } from './components/TaskModal';
import { useToast } from './components/Toast';
import { Avatar, BrandMark, IconData, IconFinance, IconOverview, IconPlus, IconProjects, IconSearch, IconStop, ThemeMini, ThemeSwitch } from './components/ui';
import { SCHEMA_OUTDATED } from './lib/remote';
import { unpaidInvoices } from './lib/stats';
import { resolved, useTheme } from './lib/theme';
import { entryMinutes, fmtClock, fmtDuration, runningEntry, stopTimers, sumMinutes, useNow, weekStart } from './lib/time';
import { isArchived } from './lib/store';
import type { Entry, Project, Task } from './types';
import { allTxns, totals } from './lib/finance';
import { monthKey, pct } from './lib/format';
import { useConfirm } from './components/Confirm';
import { LOCALE } from './lib/constants';
import { useAppData, type Repository, type SyncStatus } from './lib/store';
import DataPage from './pages/DataPage';
import FinancesPage from './pages/FinancesPage';
import OverviewPage from './pages/OverviewPage';
import ProjectsPage from './pages/ProjectsPage';
import { ProjectModal, newProject } from './pages/OverviewPage';
import { money } from './lib/format';

export type Page = 'overview' | 'projects' | 'fin' | 'data';
export type Account = { email: string; signOut: () => void };

const PAGES: { key: Page; hash: string; label: string; Icon: () => React.JSX.Element }[] = [
  { key: 'overview', hash: '', label: 'Overview', Icon: IconOverview },
  { key: 'projects', hash: 'projects', label: 'Projects', Icon: IconProjects },
  { key: 'fin', hash: 'finances', label: 'Finances', Icon: IconFinance },
  { key: 'data', hash: 'data', label: 'Data & profile', Icon: IconData },
];

type Route = { page: Page; projectId: string };
/** #/projects/<uuid> opens one project; other hashes map to a page. Old French links still work. */
const routeFromHash = (): Route => {
  const m = location.hash.match(/^#\/(?:projects|projets)(?:\/([0-9a-f-]{36}))?$/i);
  if (m) return { page: 'projects', projectId: m[1] ?? '' };
  if (location.hash === '#/donnees') return { page: 'data', projectId: '' };
  return { page: PAGES.find((p) => p.hash && location.hash === '#/' + p.hash)?.key ?? 'overview', projectId: '' };
};

const SYNC_LABEL: Record<SyncStatus, string> = {
  loading: 'Loading…',
  saved: 'Saved',
  saving: 'Saving…',
  error: 'Not saved, retrying…',
  rejected: 'Change rejected',
  'load-error': 'Offline',
};

export default function App({ repo, account }: { repo: Repository; account?: Account }) {
  const { data, update, status, rejection, loadError, retryLoad, hasUnsaved } = useAppData(repo);
  const confirm = useConfirm();
  const toast = useToast();
  const { pref, setTheme } = useTheme();
  const [palette, setPalette] = useState(false);
  // Forms opened from the palette or a keyboard shortcut, wherever you are.
  const [modal, setModal] = useState<{ task?: Task; project?: Project; entry?: Entry } | null>(null);
  const running = data ? runningEntry(data) : undefined;
  const now = useNow(!!running);
  const signOut = account
    ? async () => {
        if (
          hasUnsaved() &&
          !(await confirm({
            title: 'Sign out?',
            message: "Some changes aren't saved yet. They will be lost.",
            confirmLabel: 'Sign out',
            danger: true,
          }))
        )
          return;
        account.signOut();
      }
    : undefined;
  const session = account && signOut ? { ...account, signOut: () => void signOut() } : undefined;
  const [route, setRoute] = useState<Route>(routeFromHash);
  const page = route.page;

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (p: Page, projectId = '') => {
    const hash = p === 'projects' && projectId ? `projects/${projectId}` : PAGES.find((x) => x.key === p)!.hash;
    window.location.hash = hash ? '/' + hash : '';
    setRoute({ page: p, projectId });
    window.scrollTo({ top: 0 });
  };
  const setPage = (p: Page) => go(p);
  const openProject = (id: string) => go('projects', id);
  const searchTasks = () => {
    if (route.page !== 'overview') go('overview');
    window.setTimeout(() => window.dispatchEvent(new Event('cockpit:search-tasks')), 80);
  };
  const stopTimer = () => {
    if (!data) return;
    const { added, stopped } = stopTimers(data);
    update((d) => stopTimers(d).data);
    const what = data.tasks.find((t) => t.id === stopped?.taskId)?.title ?? data.projects.find((p) => p.id === stopped?.projectId)?.name;
    toast(added ? <>{fmtDuration(added)} logged{what ? <> on <b>{what}</b></> : null}</> : 'Timer stopped (under a minute, not logged)');
  };

  // Keyboard: Ctrl/⌘ + K anywhere; single keys only outside text fields and dialogs.
  const keys = useRef({ g: 0 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.overlay, .pop')) return;
      const k = e.key.toLowerCase();
      if (Date.now() - keys.current.g < 900) {
        keys.current.g = 0;
        const to = ({ o: 'overview', p: 'projects', f: 'fin', d: 'data' } as Record<string, Page>)[k];
        if (to) go(to);
        return;
      }
      if (k === 'g') keys.current.g = Date.now();
      else if (k === 'n') setModal({ task: newTask() });
      else if (k === 'p') setModal({ project: newProject() });
      else if (k === '/') {
        e.preventDefault();
        searchTasks();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const glance = useMemo(() => {
    if (!data) return null;
    const month = allTxns(data).filter((t) => t.date.slice(0, 7) === monthKey());
    return {
      active: data.projects.filter((p) => p.status === 'In progress').length,
      blocked: data.tasks.filter((t) => t.col === 'blocked').length,
      netRate: totals(month).netRate,
      hasRevenue: totals(month).rev > 0,
      toCollect: unpaidInvoices(data).reduce((a, e) => a + e.amount, 0),
    };
  }, [data]);

  if (status === 'load-error' && loadError === SCHEMA_OUTDATED) {
    return (
      <div className="login">
        <div className="login-card section" style={{ gap: '0.75rem' }}>
          <h1 style={{ fontSize: '1.25rem' }}>One database update to run</h1>
          <p className="sub" style={{ margin: 0, lineHeight: 1.6 }}>
            This version of Cockpit adds time tracking, invoices and budgets, and your database needs the matching tables. In Supabase, open
            <b> SQL Editor → New query</b>, paste the file <code>supabase/migrations/20261002120000_features.sql</code> from your repository, click
            <b> Run</b>, then try again. Your data is safe and unchanged.
          </p>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn" onClick={retryLoad}>Try again</button>
            {session && <button className="btn ghost" onClick={session.signOut}>Sign out</button>}
          </div>
        </div>
      </div>
    );
  }
  if (status === 'load-error') {
    return (
      <div className="login">
        <div className="login-card section" style={{ gap: '0.75rem' }}>
          <h1 style={{ fontSize: '1.25rem' }}>Couldn't load your data</h1>
          <p className="sub" style={{ margin: 0, lineHeight: 1.6 }}>Check your internet connection, then try again. Nothing was changed.</p>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn" onClick={retryLoad}>Try again</button>
            {session && <button className="btn ghost" onClick={session.signOut}>Sign out</button>}
          </div>
        </div>
      </div>
    );
  }
  if (!data || !glance) return <Loading />;
  const openedProject = page === 'projects' && route.projectId ? data.projects.find((p) => p.id === route.projectId) : undefined;
  const P = data.profile;
  const current = PAGES.find((p) => p.key === page)!;
  const today = new Date().toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const weekMin = sumMinutes(data.timeEntries.filter((x) => x.date >= weekStart()), now);
  const runningLabel = running
    ? data.tasks.find((t) => t.id === running.taskId)?.title ?? data.projects.find((p) => p.id === running.projectId)?.name ?? 'Timer'
    : '';
  const clientColor = (id: string) => data.clients.find((c) => c.id === id)?.color;
  const dark = resolved(pref) === 'dark';
  const commands: Command[] = [
    { id: 'new-task', group: 'Actions', label: 'New task', hint: 'N', icon: <IconPlus />, keywords: 'add create todo', run: () => setModal({ task: newTask() }) },
    { id: 'new-project', group: 'Actions', label: 'New project', hint: 'P', icon: <IconPlus />, keywords: 'add create', run: () => setModal({ project: newProject() }) },
    { id: 'new-entry', group: 'Actions', label: 'New transaction', icon: <IconPlus />, keywords: 'add invoice expense revenue cost money', run: () => setModal({ entry: newEntry() }) },
    ...(running
      ? [{ id: 'stop-timer', group: 'Actions', label: `Stop timer · ${runningLabel}`, hint: fmtClock(entryMinutes(running, now) * 60_000), icon: <IconStop size={12} />, keywords: 'time tracking', run: stopTimer }]
      : []),
    { id: 'search-tasks', group: 'Actions', label: 'Search tasks on the board', hint: '/', icon: <IconSearch size={14} />, keywords: 'filter find', run: searchTasks },
    { id: 'theme', group: 'Actions', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: <span className="palette-theme" />, keywords: 'theme dark light mode black white', run: () => setTheme(dark ? 'light' : 'dark') },
    ...PAGES.map(({ key, label, Icon }) => ({ id: 'go-' + key, group: 'Go to', label, hint: 'G ' + { overview: 'O', projects: 'P', fin: 'F', data: 'D' }[key], icon: <Icon />, run: () => go(key) })),
    ...data.projects
      .filter((p) => p.status !== 'Done')
      .slice(0, 5)
      .map((p) => ({ id: 'rp-' + p.id, group: 'Projects', label: p.name, hint: data.clients.find((c) => c.id === p.clientId)?.name, color: clientColor(p.clientId), when: 'empty' as const, run: () => openProject(p.id) })),
    ...data.projects.map((p) => ({
      id: 'p-' + p.id, group: 'Projects', label: p.name, hint: data.clients.find((c) => c.id === p.clientId)?.name ?? p.status,
      keywords: p.status, color: clientColor(p.clientId), when: 'query' as const, run: () => openProject(p.id),
    })),
    ...data.tasks
      .filter((t) => !isArchived(t))
      .map((t) => {
        const project = data.projects.find((p) => p.id === t.projectId);
        return {
          id: 't-' + t.id, group: 'Tasks', label: t.title, hint: project?.name ?? { todo: 'To do', ongoing: 'In progress', blocked: 'Blocked', done: 'Done' }[t.col],
          keywords: `${t.note} ${t.checklist.map((c) => c.text).join(' ')}`, color: clientColor(t.clientId) ?? clientColor(project?.clientId ?? ''),
          when: 'query' as const, run: () => setModal({ task: t }),
        };
      }),
    ...data.clients.map((c) => ({ id: 'c-' + c.id, group: 'Clients', label: c.name, hint: 'Client', color: c.color, when: 'query' as const, run: () => go('data') })),
  ];

  const nav = PAGES.map(({ key, label, Icon }) => (
    <button key={key} className={'nav-btn' + (page === key ? ' on' : '')} onClick={() => setPage(key)} aria-current={page === key ? 'page' : undefined}>
      <Icon />
      {label}
    </button>
  ));

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <BrandMark size={32} />
          <div className="brand-name">Cockpit</div>
        </div>
        <button className="search-btn" onClick={() => setPalette(true)}>
          <IconSearch size={14} />
          <span>Search…</span>
          <kbd>{navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <nav className="nav">
          <div className="eyebrow">Menu</div>
          {nav}
        </nav>
        <div className="glance">
          <div className="eyebrow">At a glance</div>
          <div className="glance-row"><span>Projects in progress</span><b>{glance.active}</b></div>
          <div className="glance-row"><span>Blocked tasks</span><b className={glance.blocked ? 'bad' : ''}>{glance.blocked}</b></div>
          <div className="glance-row"><span>This month's margin</span><b>{glance.hasRevenue ? pct(glance.netRate) : '—'}</b></div>
          <div className="glance-row"><span>To collect</span><b>{glance.toCollect ? money(glance.toCollect, P.currency) : '—'}</b></div>
          <div className="glance-row"><span>Tracked this week</span><b>{fmtDuration(weekMin)}</b></div>
        </div>
        <div className="glance" style={{ marginTop: 'auto' }}>
          <div className="eyebrow">Theme</div>
          <ThemeSwitch pref={pref} onChange={setTheme} />
        </div>
        <button className="me" style={{ marginTop: 0 }} onClick={() => setPage('data')} title="Edit profile">
          <Avatar name={P.name} photo={P.avatar} />
          <div style={{ minWidth: 0 }}>
            <div className="me-name ellipsis">{P.name || 'Your name'}</div>
            <div className="me-mail ellipsis">{P.email || P.company}</div>
          </div>
        </button>
      </aside>

      <main className="main">
        <div className="crumbs">
          <div className="row" style={{ gap: '0.5rem' }}>
            <span className="mobile-brand"><BrandMark size={24} /></span>
            <span>{P.company || 'My business'}</span>
            <span className="sep">/</span>
            {openedProject ? (
              <>
                <button className="crumb-link" onClick={() => setPage('projects')}>Projects</button>
                <span className="sep">/</span>
                <span className="here ellipsis" style={{ maxWidth: '16rem' }}>{openedProject.name}</span>
              </>
            ) : (
              <span className="here">{current.label}</span>
            )}
          </div>
          <div className="row" style={{ gap: '0.75rem' }}>
            {running && (
              <span className="timer-pill">
                <button className="timer-pill-main" onClick={() => running.projectId && openProject(running.projectId)} title="Open the project">
                  <span className="live-dot" />
                  <b>{fmtClock(entryMinutes(running, now) * 60_000)}</b>
                  <span className="ellipsis">{runningLabel}</span>
                </button>
                <button className="timer-pill-stop" onClick={stopTimer} aria-label="Stop timer" title="Stop timer"><IconStop size={10} /></button>
              </span>
            )}
            {account && (
              <span className={'sync sync-' + status} role="status" title={account.email}>
                <span className="sync-dot" />
                {SYNC_LABEL[status]}
              </span>
            )}
            <span className="today">{today}</span>
            <button className="theme-mini" onClick={() => setPalette(true)} aria-label="Search"><IconSearch size={15} /></button>
            <ThemeMini dark={resolved(pref) === 'dark'} onToggle={(o) => setTheme(resolved(pref) === 'dark' ? 'light' : 'dark', o)} />
          </div>
        </div>

        {status === 'rejected' && (
          <div className="banner" role="alert">
            <span>
              <b>The database rejected your last change.</b> Reload to start again from what is saved.
              {rejection && <span className="small"> ({rejection})</span>}
            </span>
            <button className="btn sm" onClick={retryLoad}>Reload</button>
          </div>
        )}

        <div className="page" key={page + route.projectId}>
        {page === 'overview' && <OverviewPage data={data} update={update} openProject={openProject} goFinances={() => setPage('fin')} />}
        {page === 'projects' && (
          <ProjectsPage data={data} update={update} projectId={route.projectId} openProject={openProject} back={() => setPage('projects')} />
        )}
        {page === 'fin' && <FinancesPage data={data} update={update} openProject={openProject} />}
        {page === 'data' && <DataPage data={data} update={update} account={session} />}
        </div>
      </main>

      <nav className="tabbar">{nav}</nav>
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {modal?.task && <TaskModal task={modal.task} data={data} update={update} onClose={() => setModal(null)} />}
      {modal?.project && <ProjectModal project={modal.project} data={data} update={update} onClose={() => setModal(null)} onCreated={openProject} />}
      {modal?.entry && <EntryModal entry={modal.entry} data={data} update={update} onClose={() => setModal(null)} />}
    </div>
  );
}

export function Loading() {
  return (
    <div className="login">
      <div className="row" style={{ gap: '0.625rem', color: 'var(--muted)', fontSize: '0.8125rem', fontWeight: 600 }}>
        <BrandMark size={28} />
        Loading…
      </div>
    </div>
  );
}
