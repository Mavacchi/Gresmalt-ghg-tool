-- ════════════════════════════════════════════════════════════════════
-- 03_roles.sql — RLS, ruoli, helper current_role()
-- ════════════════════════════════════════════════════════════════════
--
-- Definisce:
--   · current_role()     legge da app_metadata (NON user_metadata)
--   · verify_audit_chain() ricalcola la hash chain e ritorna il primo
--                          id rotto, oppure null se integra
--   · ENABLE + FORCE ROW LEVEL SECURITY su tutte le tabelle private
--   · REVOKE espliciti da anon (default deny)
--   · POLICY autenticati per SELECT/INSERT/UPDATE/DELETE
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
--  current_role() — legge da app_metadata, security definer
-- ────────────────────────────────────────────────────────────────────
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role',''),
    'viewer'
  );
$$;
grant execute on function public.current_role() to authenticated, anon;

-- ────────────────────────────────────────────────────────────────────
--  verify_audit_chain() — diagnostica integrità hash chain
-- ────────────────────────────────────────────────────────────────────
create or replace function public.verify_audit_chain()
returns table(broken_id bigint, expected_hash text, actual_hash text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_prev text := null;
  v_calc text;
begin
  if public.current_role() not in ('admin','auditor') then
    raise exception 'verify_audit_chain: ruolo non autorizzato';
  end if;

  for r in select * from public.audit_log order by id asc loop
    v_calc := encode(
      extensions.digest(
        coalesce(v_prev,'') ||
        r.ts::text ||
        r.table_name ||
        r.operation ||
        coalesce(r.new_data::text,'') ||
        coalesce(r.old_data::text,''),
        'sha256'),
      'hex');
    if v_calc <> r.row_hash then
      broken_id     := r.id;
      expected_hash := v_calc;
      actual_hash   := r.row_hash;
      return next;
      return;
    end if;
    v_prev := r.row_hash;
  end loop;
  return;
end;
$$;
grant execute on function public.verify_audit_chain() to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  REVOKE espliciti per anon (default deny)
-- ────────────────────────────────────────────────────────────────────
revoke all on public.anagrafiche      from anon;
revoke all on public.produzione       from anon;
revoke all on public.fe               from anon;
revoke all on public.s1               from anon;
revoke all on public.s2               from anon;
revoke all on public.s3               from anon;
revoke all on public.s3_materiality   from anon;
revoke all on public.audit_log        from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
--  GRANT base per `authenticated`
--
--  RLS in PostgreSQL è una checkbox SOPRA i grant: senza il GRANT
--  base sulla tabella l'utente riceve "permission denied for table"
--  prima che le policy vengano valutate. Su alcuni progetti Supabase
--  (free tier, restore da backup, custom roles) i grant default a
--  `authenticated` non sono garantiti sulle tabelle create da
--  migrazioni applicative: li espliciti per essere robusti su ogni
--  setup.
--
--  Le policy RLS più sotto restringono ulteriormente cosa
--  authenticated può fare in base a current_role().
--
--  audit_log riceve SELECT (la policy filtra admin/auditor);
--  l'INSERT passa solo dal trigger write_audit() in security definer.
-- ────────────────────────────────────────────────────────────────────
grant usage on schema public to authenticated;
grant select, insert, update, delete on
       public.anagrafiche, public.produzione, public.fe,
       public.s1, public.s2, public.s3, public.s3_materiality
       to authenticated;
grant select on public.audit_log to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  ENABLE + FORCE RLS
-- ────────────────────────────────────────────────────────────────────
alter table public.anagrafiche      enable row level security;
alter table public.anagrafiche      force  row level security;
alter table public.produzione       enable row level security;
alter table public.produzione       force  row level security;
alter table public.fe               enable row level security;
alter table public.fe               force  row level security;
alter table public.s1               enable row level security;
alter table public.s1               force  row level security;
alter table public.s2               enable row level security;
alter table public.s2               force  row level security;
alter table public.s3               enable row level security;
alter table public.s3               force  row level security;
alter table public.s3_materiality   enable row level security;
alter table public.s3_materiality   force  row level security;
alter table public.audit_log        enable row level security;
alter table public.audit_log        force  row level security;

-- ────────────────────────────────────────────────────────────────────
--  POLICY GENERICHE — applicate a tutte le tabelle dati operative
-- ────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  for t in select unnest(array['anagrafiche','produzione','fe','s1','s2','s3','s3_materiality'])
  loop
    -- SELECT: tutti gli authenticated
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('create policy %I_select on public.%I
                    for select to authenticated
                    using (true);', t, t);

    -- INSERT: solo admin/editor
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I
                    for insert to authenticated
                    with check (public.current_role() in (''admin'',''editor''));', t, t);

    -- UPDATE: solo admin/editor
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I
                    for update to authenticated
                    using (public.current_role() in (''admin'',''editor''))
                    with check (public.current_role() in (''admin'',''editor''));', t, t);

    -- DELETE: solo admin
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_delete on public.%I
                    for delete to authenticated
                    using (public.current_role() = ''admin'');', t, t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────
--  AUDIT LOG — solo SELECT per admin/auditor; nessun write diretto
-- ────────────────────────────────────────────────────────────────────
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.current_role() in ('admin','auditor'));

revoke insert, update, delete on public.audit_log from authenticated, anon;

-- ════════════════════════════════════════════════════════════════════
-- end of 03_roles.sql
-- ════════════════════════════════════════════════════════════════════
