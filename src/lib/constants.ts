import type { EntryType, NoteKind, Priority, ProjectStatus, TaskColumn } from '../types';

/*
 * Stored values (project statuses, categories, note kinds) keep the keys they were created with,
 * which are partly French: the database constrains them and existing rows use them. Only the
 * labels below are shown in the UI.
 */
export const LOCALE = 'en-GB';

/** Soft pill colours from one hue, readable in light and dark themes (mixed with the theme's surface and ink). */
export const soft = (hue: string) => ({
  bg: `color-mix(in srgb, ${hue} 14%, var(--surface))`,
  color: `color-mix(in srgb, ${hue} 78%, var(--ink))`,
});

export const PROJECT_STATUSES: ProjectStatus[] = ['Not started', 'In progress', 'On hold', 'Done'];

export const STATUS_META: Record<ProjectStatus, { label: string; bg: string; color: string }> = {
  'In progress': { label: 'In progress', ...soft('#f59e0b') },
  'Not started': { label: 'Not started', ...soft('#ef4444') },
  'On hold': { label: 'On hold', ...soft('#8b8b94') },
  'Done': { label: 'Done', ...soft('#22c55e') },
};
export const statusLabel = (s: ProjectStatus) => STATUS_META[s]?.label ?? s;

export const COLUMNS: { key: TaskColumn; label: string; dot: string }[] = [
  { key: 'todo', label: 'To do', dot: 'var(--faint)' },
  { key: 'ongoing', label: 'In progress', dot: 'var(--amber)' },
  { key: 'blocked', label: 'Blocked', dot: 'var(--red-2)' },
  { key: 'done', label: 'Done', dot: 'var(--green-2)' },
];

export const CATEGORIES: Record<EntryType, string[]> = {
  revenue: ['Services', 'Service provision', 'Subscriptions / retainers', 'Products', 'Trading', 'Investment', 'Real estate', 'Other income'],
  direct: ['Subcontracting', 'Project materials', 'Client licences'],
  opex: [
    'Software & SaaS',
    'Marketing',
    'Rent & office',
    'Travel',
    'Bank fees',
    'Social charges & taxes',
    'Training',
    'Other expense',
  ],
};

const CATEGORY_LABELS: Record<string, string> = {
  Services: 'Services',
  'Subscriptions / retainers': 'Subscriptions / retainers',
  Products: 'Products',
  'Other income': 'Other income',
  'Service provision': 'Service provision',
  Trading: 'Trading',
  Investment: 'Investment',
  'Real estate': 'Real estate',
  'Subcontracting': 'Subcontracting',
  'Project materials': 'Project materials',
  'Client licences': 'Client licences',
  'Software & SaaS': 'Software & SaaS',
  Marketing: 'Marketing',
  'Rent & office': 'Rent & office',
  'Travel': 'Travel',
  'Bank fees': 'Bank fees',
  'Social charges & taxes': 'Social charges & taxes',
  Training: 'Training',
  'Other expense': 'Other expense',
};
/** English label for a stored category (unknown categories are shown as stored). */
export const catLabel = (c: string) => CATEGORY_LABELS[c] ?? c;

export const TYPE_META: Record<EntryType, { label: string; short: string; bg: string; color: string }> = {
  revenue: { label: 'Revenue', short: 'Revenue', ...soft('#3b82f6') },
  direct: { label: 'Direct cost', short: 'Direct cost', ...soft('#f59e0b') },
  opex: { label: 'Operating expense', short: 'Operating', ...soft('#ef4444') },
};

export const CURRENCIES = [
  { v: 'EUR', l: 'EUR €' },
  { v: 'USD', l: 'USD $' },
  { v: 'CAD', l: 'CAD $' },
  { v: 'GBP', l: 'GBP £' },
  { v: 'CHF', l: 'CHF' },
  { v: 'MAD', l: 'MAD' },
];

export const NOTE_KINDS: { key: NoteKind; label: string; bg: string; color: string }[] = [
  { key: 'note', label: 'Note', ...soft('#8b8b94') },
  { key: 'call', label: 'Call', ...soft('#8b5cf6') },
  { key: 'decision', label: 'Decision', ...soft('#f97316') },
  { key: 'feedback', label: 'Client feedback', ...soft('#3b82f6') },
  { key: 'email', label: 'Email', ...soft('#14b8a6') },
];

export const BRIEF_FIELDS: { key: 'context' | 'goal' | 'deliverables' | 'out'; label: string; placeholder: string }[] = [
  { key: 'context', label: 'Context', placeholder: 'Who the client is, where the need comes from…' },
  { key: 'goal', label: 'Goal', placeholder: 'What the project should change for the client' },
  { key: 'deliverables', label: 'Deliverables', placeholder: 'Dashboard, CSV import, weekly report…' },
  { key: 'out', label: 'Out of scope', placeholder: 'What is not included (billed separately)' },
];

export const PRIORITIES: { key: Priority; label: string; color: string }[] = [
  { key: 'none', label: 'No priority', color: 'var(--faint)' },
  { key: 'low', label: 'Low', color: '#3b82f6' },
  { key: 'medium', label: 'Medium', color: '#f59e0b' },
  { key: 'high', label: 'High', color: '#ef4444' },
];
export const priorityMeta = (p: Priority) => PRIORITIES.find((x) => x.key === p) ?? PRIORITIES[0];
