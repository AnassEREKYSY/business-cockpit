-- Other taxes to follow: CFE (business) and personal ones (investments, rents, property tax…).
create table if not exists tax_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  scope       text not null default 'personal' check (scope in ('business', 'personal')),
  year        integer not null,
  name        text not null,
  source      text not null default 'manual' check (source in ('manual', 'tr', 'ma', 'other', 'stake', 'estate')),
  base        numeric(14, 2),
  rate        numeric(6, 3) not null default 0 check (rate >= 0 and rate <= 100),
  withheld    numeric(12, 2) not null default 0 check (withheld >= 0),
  due_amount  numeric(12, 2) check (due_amount >= 0),
  due_date    date,
  paid        numeric(12, 2) not null default 0 check (paid >= 0),
  paid_on     date,
  notes       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists tax_items_user_idx on tax_items (user_id, year);
alter table tax_items enable row level security;
drop policy if exists "own tax items" on tax_items;
create policy "own tax items" on tax_items for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on tax_items from anon;
grant select, insert, update, delete on tax_items to authenticated;
