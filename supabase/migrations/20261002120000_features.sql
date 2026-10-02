-- Project budgets, invoice payment status, monthly revenue goal, task priority and checklist,
-- and time tracking.
alter table profiles add column if not exists revenue_goal numeric(12, 2) not null default 0 check (revenue_goal >= 0);
alter table projects add column if not exists budget numeric(12, 2) not null default 0 check (budget >= 0);
-- Revenue rows: paid = false while the invoice waits for payment, due = when it is expected.
alter table entries add column if not exists paid boolean not null default true;
alter table entries add column if not exists due date;
alter table tasks add column if not exists priority text not null default 'none'
  check (priority in ('none', 'low', 'medium', 'high'));
alter table tasks add column if not exists checklist jsonb not null default '[]'::jsonb
  check (jsonb_typeof(checklist) = 'array');

create table if not exists time_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  project_id  uuid references projects on delete set null,
  -- Soft link (no foreign key): the time stays logged when its task is deleted.
  task_id     uuid,
  date        date not null,
  minutes     integer not null default 0 check (minutes between 0 and 100000),
  note        text not null default '',
  -- Set while the timer runs.
  started_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists time_entries_user_idx on time_entries (user_id, date);

alter table time_entries enable row level security;
drop policy if exists "own time" on time_entries;
create policy "own time" on time_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on time_entries from anon;
grant select, insert, update, delete on time_entries to authenticated;
