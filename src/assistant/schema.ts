import { z } from 'zod';

/*
 * The assistant's tools, as the model sees them: a name, a description and the shape of the input.
 * Shared by the server (api/assistant.ts sends them to the model) and the browser (which runs them
 * on the data already loaded in Cockpit, see run.ts). There is no `execute` here on purpose:
 * every tool runs in the browser, and the ones that change data wait for the user to click Confirm.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const range = {
  from: day.optional().describe('First day included, YYYY-MM-DD. Omit for no lower bound.'),
  to: day.optional().describe('Last day included, YYYY-MM-DD. Omit for up to today.'),
};
const ref = (what: string) => z.string().min(1).max(120).describe(`${what}: its id from another tool, or its name`);

export const readTools = {
  search: {
    description:
      'Search everything (clients, contacts, projects, tasks, project journal notes, transactions, subscriptions, time entries) ' +
      'for a word or name. Use it to find ids, or to answer "when did I…" questions: results come with their dates.',
    inputSchema: z.object({ query: z.string().min(1).max(80), limit: z.number().int().min(1).max(40).default(20) }),
  },
  get_overview: {
    description:
      'Big picture for a period: revenue, costs, profit, margin, hours worked, unpaid and overdue invoices, tasks due, ' +
      'monthly cost of active subscriptions, monthly revenue goal. Default period: the current month.',
    inputSchema: z.object(range),
  },
  get_finances: {
    description: 'Revenue, direct costs, running costs and profit for a period, grouped by month, category, client or project.',
    inputSchema: z.object({ ...range, groupBy: z.enum(['month', 'category', 'client', 'project']).default('month') }),
  },
  list_transactions: {
    description: 'Individual transactions (newest first) with their ids, for a period. Filter by type, client, project or unpaid invoices only.',
    inputSchema: z.object({
      ...range,
      type: z.enum(['any', 'revenue', 'direct', 'opex']).default('any'),
      unpaidOnly: z.boolean().default(false).describe('Only invoices not paid yet'),
      client: ref('Client').optional(),
      project: ref('Project').optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  },
  get_client: {
    description: 'Everything about one client: notes, contacts, projects, money invoiced and unpaid, time worked, first and last activity.',
    inputSchema: z.object({ client: ref('Client') }),
  },
  get_project: {
    description:
      'Everything about one project: client, status, dates, brief, budget, revenue, costs, margin, margin per hour, time worked, ' +
      'open tasks, recent journal notes, first and last time logged.',
    inputSchema: z.object({ project: ref('Project') }),
  },
  list_tasks: {
    description: 'Tasks with their ids, filtered by status, project or due date. Done tasks include when they were finished.',
    inputSchema: z.object({
      status: z.enum(['open', 'todo', 'ongoing', 'blocked', 'done', 'any']).default('open').describe('"open" = everything not done'),
      project: ref('Project').optional(),
      dueBefore: day.optional().describe('Only tasks due on or before this day'),
      limit: z.number().int().min(1).max(50).default(25),
    }),
  },
  get_time: {
    description: 'Time worked in a period (running timers included), grouped by project, day or week.',
    inputSchema: z.object({ ...range, project: ref('Project').optional(), groupBy: z.enum(['project', 'day', 'week']).default('project') }),
  },
  list_subscriptions: {
    description: 'Subscriptions with their ids, price, cycle, cost per month and per year, next payment and total paid so far.',
    inputSchema: z.object({ includeCancelled: z.boolean().default(false), scope: z.enum(['any', 'business', 'personal']).default('any') }),
  },
  calculate: {
    description: 'Exact arithmetic. Use it for any calculation instead of doing it yourself. Supports + - * / % ( ) and decimals.',
    inputSchema: z.object({ expression: z.string().min(1).max(200).describe('For example: (2400 - 380) * 0.78') }),
  },
};

export const actionTools = {
  add_transaction: {
    description:
      'Record money in or out. "revenue" = earning or invoice; "direct" = cost of delivering a project; "opex" = running the business. ' +
      'The user confirms before it is saved.',
    inputSchema: z.object({
      type: z.enum(['revenue', 'direct', 'opex']),
      label: z.string().min(1).max(120),
      amount: z.number().positive().describe('In the profile currency'),
      date: day.optional().describe('Default: today'),
      category: z.string().max(60).optional(),
      client: ref('Client').optional(),
      project: ref('Project').optional(),
      paid: z.boolean().default(true).describe('Revenue only: false for an invoice not paid yet'),
      due: day.optional().describe('Revenue not paid yet: when it is due'),
    }),
  },
  mark_invoice_paid: {
    description: 'Mark an unpaid invoice (a revenue transaction) as paid. Find its id with list_transactions unpaidOnly first.',
    inputSchema: z.object({ transactionId: z.string().min(1) }),
  },
  add_subscription: {
    description: 'Add a subscription to the tracker (ChatGPT, OVH, Netflix…).',
    inputSchema: z.object({
      name: z.string().min(1).max(80),
      amount: z.number().positive(),
      currency: z.string().length(3).optional().describe('Default: the profile currency'),
      cycle: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
      start: day.optional().describe('First payment date. Default: today'),
      scope: z.enum(['business', 'personal']).default('personal'),
      category: z.string().max(40).optional(),
    }),
  },
  cancel_subscription: {
    description: 'Mark a subscription as cancelled from a given day. Find its id with list_subscriptions first.',
    inputSchema: z.object({ subscriptionId: z.string().min(1), end: day.optional().describe('Default: today') }),
  },
  add_task: {
    description: 'Add a task to the board.',
    inputSchema: z.object({
      title: z.string().min(1).max(160),
      project: ref('Project').optional(),
      due: day.optional(),
      priority: z.enum(['none', 'low', 'medium', 'high']).default('none'),
      status: z.enum(['todo', 'ongoing', 'blocked']).default('todo'),
    }),
  },
  set_task_status: {
    description: 'Move a task to another column, for example mark it done. Find its id with list_tasks or search first.',
    inputSchema: z.object({ taskId: z.string().min(1), status: z.enum(['todo', 'ongoing', 'blocked', 'done']) }),
  },
  log_time: {
    description: 'Log time worked on a project.',
    inputSchema: z.object({
      project: ref('Project'),
      minutes: z.number().int().min(1).max(24 * 60),
      date: day.optional().describe('Default: today'),
      note: z.string().max(200).optional(),
    }),
  },
  add_project_note: {
    description: 'Add a dated entry to a project journal (note, call, decision, client feedback, email).',
    inputSchema: z.object({
      project: ref('Project'),
      body: z.string().min(1).max(2000),
      kind: z.enum(['note', 'call', 'decision', 'feedback', 'email']).default('note'),
      date: day.optional().describe('Default: today'),
    }),
  },
};

export const assistantTools = { ...readTools, ...actionTools };
export type ReadToolName = keyof typeof readTools;
export type ActionToolName = keyof typeof actionTools;
export type ToolName = keyof typeof assistantTools;
export const isActionTool = (name: string): name is ActionToolName => name in actionTools;
export const isReadTool = (name: string): name is ReadToolName => name in readTools;

/** What the browser sends with each question, so the model knows the date, language and currency. */
export interface AssistantContext {
  today: string;
  weekday: string;
  lang: 'en' | 'fr';
  currency: string;
  name: string;
  company: string;
}
