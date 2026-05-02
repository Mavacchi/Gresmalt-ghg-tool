-- ════════════════════════════════════════════════════════════════════
-- 05_app_meta.sql — app_meta + keepalive_ping()
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.app_meta (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz default now(),
  updated_by  uuid references auth.users(id)
);

alter table public.app_meta enable row level security;
alter table public.app_meta force  row level security;

-- Read: tutti gli authenticated
drop policy if exists app_meta_select on public.app_meta;
create policy app_meta_select on public.app_meta
  for select to authenticated
  using (true);

-- Write: solo admin
drop policy if exists app_meta_insert on public.app_meta;
create policy app_meta_insert on public.app_meta
  for insert to authenticated
  with check (public.current_role() = 'admin');

drop policy if exists app_meta_update on public.app_meta;
create policy app_meta_update on public.app_meta
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

revoke delete on public.app_meta from authenticated, anon;

-- Seed
insert into public.app_meta (key, value) values
  ('schema_version',    to_jsonb(1)),
  ('last_data_refresh', to_jsonb(now())),
  ('app_locked',        to_jsonb(false)),
  ('last_keepalive',    jsonb_build_object('ts', now()))
on conflict (key) do nothing;

-- ────────────────────────────────────────────────────────────────────
--  KEEPALIVE PING
--  Chiamabile da anon. Aggiorna SOLO la chiave 'last_keepalive'.
--  Security definer: bypassa RLS ma è sicura perché:
--   · non accetta parametri controllati dall'utente
--   · scrive su una sola chiave ben specifica
--   · ritorna solo {ok:true, ts}
-- ────────────────────────────────────────────────────────────────────
create or replace function public.keepalive_ping()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_meta (key, value, updated_at)
  values ('last_keepalive',
          jsonb_build_object('ts', now()),
          now())
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'ts', now())::json;
end;
$$;

grant execute on function public.keepalive_ping() to anon;

-- ════════════════════════════════════════════════════════════════════
-- end of 05_app_meta.sql
-- ════════════════════════════════════════════════════════════════════
