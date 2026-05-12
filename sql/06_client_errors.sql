-- ════════════════════════════════════════════════════════════════════
-- 06_client_errors.sql — Logging errori lato client
-- Insert-only · leggibile solo da admin · retention 90 giorni
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.client_errors (
  id         bigserial primary key,
  ts         timestamptz not null default now(),
  user_id    uuid references auth.users(id),
  route      text,
  message    text,
  stack      text
);

create index if not exists client_errors_ts_idx on public.client_errors(ts desc);

alter table public.client_errors enable row level security;
alter table public.client_errors force  row level security;

-- INSERT: tutti, anche anon (errori in PublicDashboard); user_id NULL ammesso per anon
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert
  to anon, authenticated
  with check (
    -- per gli authenticated, user_id deve combaciare; per anon è null
    (auth.uid() is null and user_id is null)
    or
    (auth.uid() is not null and user_id = auth.uid())
  );

-- SELECT: solo admin
drop policy if exists client_errors_select on public.client_errors;
create policy client_errors_select on public.client_errors
  for select to authenticated
  using (public.current_role() = 'admin');

revoke update, delete on public.client_errors from authenticated, anon;

-- GRANT base — vedi nota in 03_roles.sql. INSERT è aperto anche ad anon
-- per loggare errori dalla PublicDashboard; le policy filtrano user_id.
-- SELECT solo a authenticated (la policy lo restringe ad admin).
grant select, insert on public.client_errors to authenticated;
grant insert         on public.client_errors to anon;

-- Retention 90 giorni — chiamata da cron Supabase pg_cron / Edge Function
create or replace function public.purge_old_client_errors()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.client_errors
   where ts < (now() - interval '90 days');
  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.purge_old_client_errors() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- end of 06_client_errors.sql
-- ════════════════════════════════════════════════════════════════════
