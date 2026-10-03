export type ProjectStatus = 'Not started' | 'In progress' | 'On hold' | 'Done';
export type TaskColumn = 'todo' | 'ongoing' | 'blocked' | 'done';
/** revenue = money in; direct = cost tied to delivering a project; opex = running the business. */
export type EntryType = 'revenue' | 'direct' | 'opex';
export type Frequency = 'monthly' | 'yearly';
export type Priority = 'none' | 'low' | 'medium' | 'high';

export interface Profile {
  name: string;
  email: string;
  company: string;
  currency: string;
  /** Kept for older saves; no longer shown or used. */
  targetPct: number;
  alertPct: number;
  /** Profile photo as a small data URL ('' = initials). */
  avatar: string;
  /** ETF followed by the investment card (Euronext ISIN + market), '' when not set. */
  investIsin: string;
  investMic: string;
  investName: string;
  /** Monthly revenue goal shown on the Overview, 0 = none. */
  revenueGoal: number;
  /** Micro-entreprise rates used to estimate taxes on revenue. */
  tax: TaxSettings;
  /** Wealth settings: fallback exchange rates (1 EUR = x). */
  wealth: WealthSettings;
}

export type TaxActivity = 'bic_services' | 'bnc' | 'bic_sales' | 'custom';

/** Micro-entreprise contributions, as % of revenue. ACRE applies up to and including acreUntil. */
export interface TaxSettings {
  activity: TaxActivity;
  /** Business start date ('' = unknown). */
  start: string;
  /** Last day of the ACRE period ('' = no ACRE). */
  acreUntil: string;
  /** Social contributions, normal rate. */
  social: number;
  /** Social contributions during ACRE. */
  acre: number;
  /** Contribution à la formation professionnelle. */
  cfp: number;
  /** Versement libératoire de l'impôt sur le revenu (0 = not chosen). */
  vl: number;
}

export interface WealthSettings {
  /** Fallback rates, 1 EUR = x MAD / x USD, used when live rates can't be loaded. */
  eurMad: number;
  eurUsd: number;
  eurAed: number;
}

/** A person at a client company. */
export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
}

/** Money put into the S&P 500 ETF on a given day. */
export interface Investment {
  id: string;
  date: string;
  amount: number;
  /** Price per share actually paid, when known; 0 = use that day's market close. */
  price: number;
  /** That day's market close, saved when the amount is entered (0 = not known yet). */
  close: number;
}

/** A client, with the label color shown on its projects and task cards. */
export interface Client {
  id: string;
  name: string;
  color: string;
  notes: string;
  contacts: Contact[];
}

export interface Project {
  id: string;
  name: string;
  clientId: string;
  start: string;
  deadline: string;
  status: ProjectStatus;
  /** List order, smallest first. New projects get min - 1 so they show on top. */
  position: number;
  /** Brief shown on the project page. */
  brief: ProjectBrief;
  /** Agreed price for the project (excl. tax), 0 = not set. */
  budget: number;
}

export interface ProjectBrief {
  context: string;
  goal: string;
  deliverables: string;
  out: string;
}

export type NoteKind = 'note' | 'call' | 'decision' | 'feedback' | 'email';

/** A dated entry in a project's journal (call, decision, client feedback…). */
export interface Note {
  id: string;
  projectId: string;
  date: string;
  kind: NoteKind;
  body: string;
  /** When the note was written (ISO); orders notes of the same day. */
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  col: TaskColumn;
  clientId: string;
  projectId: string;
  due: string;
  note: string;
  /** Order on the board. Only the moved or added card gets a new value (max + 1). */
  position: number;
  /** When the task entered the Done column (ISO), '' otherwise. Hidden from the board a week later. */
  doneAt: string;
  priority: Priority;
  checklist: CheckItem[];
}

/** One line of a task's checklist. */
export interface CheckItem {
  id: string;
  text: string;
  done: boolean;
}

/** Time spent on a project (and optionally one of its tasks). A running timer has startedAt set. */
export interface TimeEntry {
  id: string;
  projectId: string;
  /** Soft link: the time stays logged on the project if the task is deleted. */
  taskId: string;
  date: string;
  /** Minutes already counted; a running timer adds the time since startedAt. */
  minutes: number;
  note: string;
  /** ISO time the timer was started, '' when stopped. */
  startedAt: string;
}

/** One-off transaction, typed in by hand. */
export interface Entry {
  id: string;
  date: string;
  label: string;
  type: EntryType;
  category: string;
  amount: number;
  projectId: string;
  /** Revenue only: false while the invoice is waiting to be paid. Costs are always paid. */
  paid: boolean;
  /** Revenue only: when the invoice is due ('' = no due date). */
  due: string;
  /** Client paid by / paying, when not given by the project ('' = none). */
  clientId: string;
}

/** Subscription, retainer or fixed contractor fee that repeats until stopped. */
export interface Recurring {
  id: string;
  label: string;
  type: EntryType;
  category: string;
  amount: number;
  frequency: Frequency;
  start: string;
  end: string;
  projectId: string;
  clientId: string;
}

export interface AppData {
  profile: Profile;
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  entries: Entry[];
  recurring: Recurring[];
  notes: Note[];
  investments: Investment[];
  timeEntries: TimeEntry[];
  assets: Asset[];
  trades: Trade[];
  assetPrices: AssetPrice[];
  properties: Property[];
  propertyEntries: PropertyEntry[];
}

export type AccountKey = 'tr' | 'ma' | 'other';
export type AssetKind = 'etf' | 'stock' | 'crypto' | 'opcvm' | 'bond' | 'cash' | 'other';

/** Something held in an investment account. */
export interface Asset {
  id: string;
  account: AccountKey;
  name: string;
  /** Market symbol for live prices (Yahoo Finance, e.g. VWCE.DE, BTC-EUR); '' = price typed by hand. */
  symbol: string;
  isin: string;
  kind: AssetKind;
  currency: string;
  /** Last known price per unit (typed, or saved from the live feed). */
  price: number;
  priceAt: string;
  position: number;
}

/** A buy, a sell, or a dividend (quantity 0, price = amount received). */
export interface Trade {
  id: string;
  assetId: string;
  date: string;
  side: 'buy' | 'sell' | 'dividend';
  quantity: number;
  price: number;
  fees: number;
}

/** A price typed by hand on a given day (Moroccan stocks, OPCVM): the history of manual prices. */
export interface AssetPrice {
  id: string;
  assetId: string;
  date: string;
  price: number;
}

/** A real estate investment. Amounts per month unless stated. */
export interface Property {
  id: string;
  name: string;
  /** 'direct': a property you own. 'stake': a share bought on Stake (fractional real estate, UAE). */
  platform: 'direct' | 'stake';
  city: string;
  currency: string;
  purchaseDate: string;
  purchasePrice: number;
  /** Estimated current value. */
  value: number;
  /** Loan principal still owed. */
  debt: number;
  rent: number;
  charges: number;
  loan: number;
  notes: string;
  position: number;
}

/** Money in or out for a property in a given month. */
export interface PropertyEntry {
  id: string;
  propertyId: string;
  date: string;
  kind: 'rent' | 'expense' | 'loan';
  amount: number;
  label: string;
}

/** A transaction as the finance views see it: either typed in, or generated from a recurring item. */
export interface Txn extends Omit<Entry, 'paid' | 'due'> {
  recurringId?: string;
  paid?: boolean;
  due?: string;
}
