import { useEffect, useMemo, useRef, useState } from 'react';
import { EntryModal, newEntry } from './components/MoneyForms';
import { Palette, type Command } from './components/Palette';
import { TaskModal, newTask } from './components/TaskModal';
import { useToast } from './components/Toast';
import { Avatar, BrandMark, IconClients, IconData, IconFinance, IconOverview, IconPlus, IconProjects, IconSearch, IconStop, IconWealth, IconRepeat, IconTax, ThemeMini, ThemeSwitch } from './components/ui';
import { SCHEMA_OUTDATED } from './lib/remote';
import { unpaidInvoices } from './lib/stats';
import { resolved, useTheme, type ThemePref } from './lib/theme';
import { locale, setLang, t, useLang } from './lib/i18n';
import { entryMinutes, fmtClock, fmtDuration, runningEntry, stopTimers, sumMinutes, useNow, weekStart } from './lib/time';
import { isArchived } from './lib/store';
import type { Entry, Project, Task } from './types';
import { allTxns, totals } from './lib/finance';
import { monthKey, pct } from './lib/format';
import { useConfirm } from './components/Confirm';
import { statusLabel } from './lib/constants';
import { useAppData, type Repository, type SyncStatus } from './lib/store';
import DataPage from './pages/DataPage';
import FinancesPage from './pages/FinancesPage';
import OverviewPage from './pages/OverviewPage';
import ProjectsPage from './pages/ProjectsPage';
import ClientsPage from './pages/ClientsPage';
import WealthPage from './pages/WealthPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import TaxesPage from './pages/TaxesPage';
import { ProjectModal, newProject } from './pages/OverviewPage';
import { money } from './lib/format';

export type Page = 'overview' | 'projects' | 'clients' | 'fin' | 'taxes' | 'subs' | 'wealth' | 'data';
export type Account = { email: string; signOut: () => void };

const PAGES: { key: Page; hash: string; label: string; short?: string; Icon: () => React.JSX.Element }[] = [
  { key: 'overview', hash: '', label: 'Overview', Icon: IconOverview },
  { key: 'projects', hash: 'projects', label: 'Projects', Icon: IconProjects },
  { key: 'clients', hash: 'clients', label: 'Clients', Icon: IconClients },
  { key: 'fin', hash: 'finances', label: 'Finances', Icon: IconFinance },
  { key: 'taxes', hash: 'taxes', label: 'Taxes', Icon: IconTax },
  { key: 'subs', hash: 'subscriptions', label: 'Subscriptions', short: 'Subs', Icon: IconRepeat },
  { key: 'wealth', hash: 'wealth', label: 'Wealth', Icon: IconWealth },
  { key: 'data', hash: 'data', label: 'Data & profile', short: 'Profile', Icon: IconData },
];

type Route = { page: Page; projectId: string };
/** #/projects/<uuid> opens one project; other hashes map to a page. Old French links still work. */
const routeFromHash = (): Route => {
  const m = location.hash.match(/^#\/(?:projects|projets)(?:\/([0-9a-f-]{36}))?$/i);
  if (m) return { page: 'projects', projectId: m[1] ?? '' };
  if (location.hash === '#/donnees') return { page: 'data', projectId: '' };
  return { page: PAGES.find((p) => p.hash && location.hash === '#/' + p.hash)?.key ?? 'overview', projectId: '' };
};

const SYNC_TEXT: Record<SyncStatus, string> = {
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
  const lang = useLang();
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
            title: t('Sign out?'),
            message: t("Some changes aren't saved yet. They will be lost."),
            confirmLabel: t('Sign out'),
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
    toast(added ? (what ? <>{t('{d} logged on', { d: fmtDuration(added) })} <b>{what}</b></> : t('{d} logged', { d: fmtDuration(added) })) : t('Timer stopped (under a minute, not logged)'));
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
        const to = ({ o: 'overview', p: 'projects', c: 'clients', f: 'fin', t: 'taxes', s: 'subs', w: 'wealth', d: 'data' } as Record<string, Page>)[k];
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
          <h1 style={{ fontSize: '1.25rem' }}>{t('One database update to run')}</h1>
          <p className="sub" style={{ margin: 0, lineHeight: 1.6 }}>
            {t('This version of Cockpit adds new features, and your database needs the matching tables. In Supabase, open SQL Editor → New query, paste the newest file(s) of supabase/migrations/ from your repository that you haven’t run yet, click Run, then try again. Your data is safe and unchanged.')}
          </p>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn" onClick={retryLoad}>{t('Try again')}</button>
            {session && <button className="btn ghost" onClick={session.signOut}>{t('Sign out')}</button>}
          </div>
        </div>
      </div>
    );
  }
  if (status === 'load-error') {
    return (
      <div className="login">
        <div className="login-card section" style={{ gap: '0.75rem' }}>
          <h1 style={{ fontSize: '1.25rem' }}>{t("Couldn't load your data")}</h1>
          <p className="sub" style={{ margin: 0, lineHeight: 1.6 }}>{t('Check your internet connection, then try again. Nothing was changed.')}</p>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn" onClick={retryLoad}>{t('Try again')}</button>
            {session && <button className="btn ghost" onClick={session.signOut}>{t('Sign out')}</button>}
          </div>
        </div>
      </div>
    );
  }
  if (!data || !glance) return <Loading />;
  const openedProject = page === 'projects' && route.projectId ? data.projects.find((p) => p.id === route.projectId) : undefined;
  const P = data.profile;
  const current = PAGES.find((p) => p.key === page)!;
  const today = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const weekMin = sumMinutes(data.timeEntries.filter((x) => x.date >= weekStart()), now);
  const runningLabel = running
    ? data.tasks.find((t) => t.id === running.taskId)?.title ?? data.projects.find((p) => p.id === running.projectId)?.name ?? t('Timer')
    : '';
  const clientColor = (id: string) => data.clients.find((c) => c.id === id)?.color;
  const dark = resolved(pref) === 'dark';
  const commands: Command[] = [
    { id: 'new-task', group: t('Actions'), label: t('New task'), hint: 'N', icon: <IconPlus />, keywords: 'add create todo', run: () => setModal({ task: newTask() }) },
    { id: 'new-project', group: t('Actions'), label: t('New project'), hint: 'P', icon: <IconPlus />, keywords: 'add create', run: () => setModal({ project: newProject() }) },
    { id: 'new-entry', group: t('Actions'), label: t('New transaction'), icon: <IconPlus />, keywords: 'add invoice expense revenue cost money', run: () => setModal({ entry: newEntry() }) },
    ...(running
      ? [{ id: 'stop-timer', group: t('Actions'), label: t('Stop timer · {what}', { what: runningLabel }), hint: fmtClock(entryMinutes(running, now) * 60_000), icon: <IconStop size={12} />, keywords: 'time tracking', run: stopTimer }]
      : []),
    { id: 'search-tasks', group: t('Actions'), label: t('Search tasks on the board'), hint: '/', icon: <IconSearch size={14} />, keywords: 'filter find', run: searchTasks },
    { id: 'theme', group: t('Actions'), label: dark ? t('Switch to light theme') : t('Switch to dark theme'), icon: <span className="palette-theme" />, keywords: 'theme dark light mode black white', run: () => setTheme(dark ? 'light' : 'dark') },
    ...PAGES.map(({ key, label, Icon }) => ({ id: 'go-' + key, group: t('Go to'), label: t(label), hint: 'G ' + { overview: 'O', projects: 'P', clients: 'C', fin: 'F', taxes: 'T', subs: 'S', wealth: 'W', data: 'D' }[key], icon: <Icon />, run: () => go(key) })),
    ...data.projects
      .filter((p) => p.status !== 'Done')
      .slice(0, 5)
      .map((p) => ({ id: 'rp-' + p.id, group: t('Projects'), label: p.name, hint: data.clients.find((c) => c.id === p.clientId)?.name, color: clientColor(p.clientId), when: 'empty' as const, run: () => openProject(p.id) })),
    ...data.projects.map((p) => ({
      id: 'p-' + p.id, group: t('Projects'), label: p.name, hint: data.clients.find((c) => c.id === p.clientId)?.name ?? statusLabel(p.status),
      keywords: p.status, color: clientColor(p.clientId), when: 'query' as const, run: () => openProject(p.id),
    })),
    ...data.tasks
      .filter((t) => !isArchived(t))
      .map((task) => {
        const project = data.projects.find((p) => p.id === task.projectId);
        return {
          id: 't-' + task.id, group: t('Tasks'), label: task.title, hint: project?.name ?? t({ todo: 'To do', ongoing: 'In progress', blocked: 'Blocked', done: 'Done' }[task.col]),
          keywords: `${task.note} ${task.checklist.map((c) => c.text).join(' ')}`, color: clientColor(task.clientId) ?? clientColor(project?.clientId ?? ''),
          when: 'query' as const, run: () => setModal({ task }),
        };
      }),
    ...data.clients.map((c) => ({ id: 'c-' + c.id, group: t('Clients'), label: c.name, hint: t('Client'), color: c.color, when: 'query' as const, run: () => go('data') })),
  ];

  const nav = PAGES.map(({ key, label, short, Icon }) => (
    <button key={key} className={'nav-btn' + (page === key ? ' on' : '')} onClick={() => setPage(key)} aria-current={page === key ? 'page' : undefined} title={t(label)}>
      <Icon />
      <span className="nav-label">{t(label)}</span>
      {short && <span className="nav-short">{t(short)}</span>}
    </button>
  ));
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => setPage('overview')} aria-label="Cockpit">
            <BrandMark size={30} />
            <span className="brand-name">Cockpit</span>
          </button>

          <nav className="topnav" aria-label={t('Menu')}>{nav}</nav>

          <div className="top-actions">
            {running && (
              <span className="timer-pill">
                <button className="timer-pill-main" onClick={() => running.projectId && openProject(running.projectId)} title={t('Open the project')}>
                  <span className="live-dot" />
                  <b>{fmtClock(entryMinutes(running, now) * 60_000)}</b>
                  <span className="ellipsis">{runningLabel}</span>
                </button>
                <button className="timer-pill-stop" onClick={stopTimer} aria-label={t('Stop timer')} title={t('Stop timer')}><IconStop size={10} /></button>
              </span>
            )}
            <button className="search-btn" onClick={() => setPalette(true)} aria-label={t('Search')}>
              <IconSearch size={15} />
              <span className="search-label">{t('Search…')}</span>
              <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            <LangSwitch />
            <ThemeMini dark={resolved(pref) === 'dark'} onToggle={(o) => setTheme(resolved(pref) === 'dark' ? 'light' : 'dark', o)} />
            <UserMenu
              name={P.name}
              email={account?.email || P.email || P.company}
              photo={P.avatar}
              status={account ? t(SYNC_TEXT[status]) : ''}
              statusClass={'sync-' + status}
              pref={pref}
              setTheme={setTheme}
              glance={glance}
              currency={P.currency}
              weekMin={weekMin}
              onProfile={() => setPage('data')}
              onSignOut={session?.signOut}
            />
          </div>
        </div>
      </header>

      <main className="main">
        <div className="crumbs">
          <div className="row" style={{ gap: '0.5rem' }}>
            <span>{P.company || t('My business')}</span>
            <span className="sep">/</span>
            {openedProject ? (
              <>
                <button className="crumb-link" onClick={() => setPage('projects')}>{t('Projects')}</button>
                <span className="sep">/</span>
                <span className="here ellipsis" style={{ maxWidth: '16rem' }}>{openedProject.name}</span>
              </>
            ) : (
              <span className="here">{t(current.label)}</span>
            )}
          </div>
          <div className="row" style={{ gap: '0.75rem' }}>
            {account && (
              <span className={'sync sync-' + status} role="status" title={account.email}>
                <span className="sync-dot" />
                {t(SYNC_TEXT[status])}
              </span>
            )}
            <span className="today">{today}</span>
          </div>
        </div>

        {status === 'rejected' && (
          <div className="banner" role="alert">
            <span>
              <b>{t('The database rejected your last change.')}</b> {t('Reload to start again from what is saved.')}
              {rejection && <span className="small"> ({rejection})</span>}
            </span>
            <button className="btn sm" onClick={retryLoad}>{t('Reload')}</button>
          </div>
        )}

        <div className="page" key={page + route.projectId + lang}>
        {page === 'overview' && <OverviewPage data={data} update={update} openProject={openProject} goFinances={() => setPage('fin')} />}
        {page === 'projects' && (
          <ProjectsPage data={data} update={update} projectId={route.projectId} openProject={openProject} back={() => setPage('projects')} />
        )}
        {page === 'fin' && <FinancesPage data={data} update={update} openProject={openProject} goToData={() => setPage('data')} />}
        {page === 'clients' && <ClientsPage data={data} update={update} openProject={openProject} />}
        {page === 'taxes' && <TaxesPage data={data} update={update} />}
        {page === 'subs' && <SubscriptionsPage data={data} update={update} />}
        {page === 'wealth' && <WealthPage data={data} update={update} />}
        {page === 'data' && <DataPage data={data} update={update} account={session} />}
        </div>
      </main>

      <nav className="tabbar">{nav.filter((n) => n.key !== 'data')}</nav>
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {modal?.task && <TaskModal task={modal.task} data={data} update={update} onClose={() => setModal(null)} />}
      {modal?.project && <ProjectModal project={modal.project} data={data} update={update} onClose={() => setModal(null)} onCreated={openProject} />}
      {modal?.entry && <EntryModal entry={modal.entry} data={data} update={update} onClose={() => setModal(null)} />}
    </div>
  );
}

/** EN / FR switch. */
function LangSwitch() {
  const lang = useLang();
  return (
    <div className="lang-switch" role="radiogroup" aria-label={t('Language')}>
      {(['en', 'fr'] as const).map((l) => (
        <button key={l} role="radio" aria-checked={lang === l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Avatar button with a small menu: profile, quick numbers, theme, sign out. */
function UserMenu({ name, email, photo, status, statusClass, pref, setTheme, glance, currency, weekMin, onProfile, onSignOut }: {
  name: string;
  email: string;
  photo: string;
  status: string;
  statusClass: string;
  pref: ThemePref;
  setTheme: (p: ThemePref, o?: { x: number; y: number }) => void;
  glance: { active: number; blocked: number; netRate: number; hasRevenue: boolean; toCollect: number };
  currency: string;
  weekMin: number;
  onProfile: () => void;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="user-menu" ref={ref}>
      <button className="user-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('Edit profile')}>
        <Avatar name={name} photo={photo} />
      </button>
      {open && (
        <div className="user-pop" role="menu">
          <div className="user-head">
            <Avatar name={name} photo={photo} large />
            <div style={{ minWidth: 0 }}>
              <b className="ellipsis">{name || t('Your name')}</b>
              <span className="small ellipsis">{email}</span>
              {status && <span className={'sync ' + statusClass}><span className="sync-dot" />{status}</span>}
            </div>
          </div>
          <div className="user-glance">
            <div><span>{t('Projects in progress')}</span><b>{glance.active}</b></div>
            <div><span>{t('Blocked tasks')}</span><b className={glance.blocked ? 'bad' : ''}>{glance.blocked}</b></div>
            <div><span>{t("This month's margin")}</span><b>{glance.hasRevenue ? pct(glance.netRate) : '—'}</b></div>
            <div><span>{t('To collect')}</span><b>{glance.toCollect ? money(glance.toCollect, currency) : '—'}</b></div>
            <div><span>{t('Tracked this week')}</span><b>{fmtDuration(weekMin)}</b></div>
          </div>
          <div className="user-section">
            <span className="eyebrow">{t('Theme')}</span>
            <ThemeSwitch pref={pref} onChange={setTheme} />
          </div>
          <div className="user-actions">
            <button className="btn sm outline" onClick={() => { setOpen(false); onProfile(); }}>{t('Data & profile')}</button>
            {onSignOut && <button className="btn sm ghost" onClick={() => { setOpen(false); onSignOut(); }}>{t('Sign out')}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Loading() {
  return (
    <div className="login">
      <div className="row" style={{ gap: '0.625rem', color: 'var(--muted)', fontSize: '0.8125rem', fontWeight: 600 }}>
        <BrandMark size={28} />
        {t('Loading…')}
      </div>
    </div>
  );
}
