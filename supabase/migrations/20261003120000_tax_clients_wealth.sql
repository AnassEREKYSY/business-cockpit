-- Micro-entreprise tax settings, client contacts, client on transactions, investment portfolios
-- (Trade Republic, Morocco) and real estate.
alter table profiles add column if not exists tax jsonb not null default '{}'::jsonb check (jsonb_typeof(tax) = 'object');
alter table profiles add column if not exists wealth jsonb not null default '{}'::jsonb check (jsonb_typeof(wealth) = 'object');
alter table clients add column if not exists notes text not null default '';
alter table clients add column if not exists contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(contacts) = 'array');
alter table entries add column if not exists client_id uuid references clients on delete set null;
alter table recurring add column if not exists client_id uuid references clients on delete set null;

create table if not exists assets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  account     text not null default 'tr' check (account in ('tr', 'ma', 'other')),
  name        text not null,
  symbol      text not null default '',
  isin        text not null default '',
  kind        text not null default 'etf' check (kind in ('etf', 'stock', 'crypto', 'opcvm', 'bond', 'cash', 'other')),
  currency    text not null default 'EUR',
  price       numeric(20, 8) not null default 0 check (price >= 0),
  price_at    timestamptz,
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists trades (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  asset_id    uuid not null references assets on delete cascade,
  date        date not null,
  side        text not null default 'buy' check (side in ('buy', 'sell', 'dividend')),
  quantity    numeric(24, 10) not null default 0 check (quantity >= 0),
  price       numeric(20, 8) not null default 0 check (price >= 0),
  fees        numeric(12, 2) not null default 0 check (fees >= 0),
  created_at  timestamptz not null default now()
);

create table if not exists asset_prices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  asset_id    uuid not null references assets on delete cascade,
  date        date not null,
  price       numeric(20, 8) not null check (price > 0),
  created_at  timestamptz not null default now()
);

create table if not exists properties (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  name            text not null,
  platform        text not null default 'direct' check (platform in ('direct', 'stake')),
  city            text not null default '',
  currency        text not null default 'EUR',
  purchase_date   date,
  purchase_price  numeric(14, 2) not null default 0 check (purchase_price >= 0),
  value           numeric(14, 2) not null default 0 check (value >= 0),
  debt            numeric(14, 2) not null default 0 check (debt >= 0),
  rent            numeric(12, 2) not null default 0 check (rent >= 0),
  charges         numeric(12, 2) not null default 0 check (charges >= 0),
  loan            numeric(12, 2) not null default 0 check (loan >= 0),
  notes           text not null default '',
  position        double precision not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists property_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  property_id  uuid not null references properties on delete cascade,
  date         date not null,
  kind         text not null default 'rent' check (kind in ('rent', 'expense', 'loan')),
  amount       numeric(12, 2) not null check (amount >= 0),
  label        text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists assets_user_idx on assets (user_id);
create index if not exists trades_user_idx on trades (user_id, date);
create index if not exists trades_asset_idx on trades (asset_id);
create index if not exists asset_prices_user_idx on asset_prices (user_id, date);
create index if not exists asset_prices_asset_idx on asset_prices (asset_id);
create index if not exists properties_user_idx on properties (user_id);
create index if not exists property_entries_user_idx on property_entries (user_id, date);
create index if not exists property_entries_property_idx on property_entries (property_id);

alter table assets enable row level security;
alter table trades enable row level security;
alter table asset_prices enable row level security;
alter table properties enable row level security;
alter table property_entries enable row level security;
drop policy if exists "own assets" on assets;
drop policy if exists "own trades" on trades;
drop policy if exists "own asset prices" on asset_prices;
drop policy if exists "own properties" on properties;
drop policy if exists "own property entries" on property_entries;
create policy "own assets" on assets for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own trades" on trades for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own asset prices" on asset_prices for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own properties" on properties for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own property entries" on property_entries for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on assets, trades, asset_prices, properties, property_entries from anon;
grant select, insert, update, delete on assets, trades, asset_prices, properties, property_entries to authenticated;
