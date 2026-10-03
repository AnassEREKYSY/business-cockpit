-- Subscriptions tracker (business and personal): ChatGPT, OVH, Netflix, Amazon Prime…
create table if not exists subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  category    text not null default 'Other',
  scope       text not null default 'personal' check (scope in ('business', 'personal')),
  amount      numeric(12, 2) not null default 0 check (amount >= 0),
  currency    text not null default 'EUR',
  cycle       text not null default 'monthly' check (cycle in ('weekly', 'monthly', 'quarterly', 'yearly')),
  start       date not null,
  "end"       date,
  payment     text not null default '',
  notes       text not null default '',
  color       text not null default '',
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on subscriptions (user_id);
alter table subscriptions enable row level security;
drop policy if exists "own subscriptions" on subscriptions;
create policy "own subscriptions" on subscriptions for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on subscriptions from anon;
grant select, insert, update, delete on subscriptions to authenticated;
