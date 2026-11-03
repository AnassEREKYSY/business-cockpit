-- Assistant: daily message counters, so the OpenAI bill stays small.
-- Every request to /api/assistant counts one (a question, and each step where the assistant reads data).
-- Limits per day (UTC): 300 per user, 500 for the whole app. Change them below if needed.
-- No policy on the table: only the function can read or write it.

create table if not exists cockpit.assistant_usage (
  bucket text not null,          -- 'user:<uuid>' or 'global'
  day date not null,
  count integer not null default 0,
  primary key (bucket, day)
);

alter table cockpit.assistant_usage enable row level security;

create or replace function cockpit.assistant_consume()
returns boolean
language plpgsql
security definer
set search_path = cockpit, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_bucket text;
  v_today date := (now() at time zone 'utc')::date;
  v_used integer;
  v_global integer;
begin
  if v_uid is null then
    return false;
  end if;
  v_bucket := 'user:' || v_uid::text;

  insert into assistant_usage (bucket, day, count) values (v_bucket, v_today, 0), ('global', v_today, 0)
  on conflict (bucket, day) do nothing;

  -- Lock both rows so parallel requests can't overshoot.
  select count into v_global from assistant_usage where bucket = 'global' and day = v_today for update;
  select count into v_used from assistant_usage where bucket = v_bucket and day = v_today for update;

  if v_used >= 300 or v_global >= 500 then
    return false;
  end if;

  update assistant_usage set count = count + 1 where day = v_today and bucket in (v_bucket, 'global');
  return true;
end;
$$;

revoke all on function cockpit.assistant_consume() from public;
grant execute on function cockpit.assistant_consume() to authenticated;
