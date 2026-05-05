-- ════════════════════════════════════════════════════════════════════
-- 16_audit_chain_cron.sql — Verifica schedulata della hash chain audit
--
-- Idempotente: ri-eseguibile senza side-effects.
-- Eseguire come superuser dopo 13_hardening.sql.
--
-- Contiene:
--   1. Tabella audit_chain_check                — log dei check periodici
--   2. RLS lettura: admin sempre, auditor a aal2
--   3. verify_audit_chain_scheduled()           — versione no-role-check
--                                                 chiamabile da pg_cron
--   4. View audit_chain_status                  — ultimi 10 check (UI)
--   5. Schedulazione pg_cron settimanale
--
-- RAZIONALE
--   La function public.verify_audit_chain() (vedi 03_roles.sql + 15_)
--   richiede admin O auditor a aal2: pg_cron gira come postgres senza
--   JWT, quindi la chiamata fallirebbe sul check di ruolo. Servono
--   due function gemelle: una "interactive" con role check (Diagnostica
--   admin/auditor), una "scheduled" senza role check ma con accesso
--   ristretto via REVOKE EXECUTE per i ruoli applicativi.
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
--  1. Tabella di log
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.audit_chain_check (
  id             bigserial primary key,
  ts             timestamptz  not null default now(),
  status         text         not null check (status in ('ok','broken','error')),
  broken_id      bigint,
  expected_hash  text,
  actual_hash    text,
  total_rows     int          not null default 0,
  duration_ms    int          not null default 0,
  triggered_by   text         not null default 'cron' check (triggered_by in ('cron','manual')),
  error_message  text
);
create index if not exists audit_chain_check_ts_idx on public.audit_chain_check (ts desc);

-- ────────────────────────────────────────────────────────────────────
--  2. RLS — admin sempre, auditor solo a aal2; nessuno può INSERT/UPDATE
--     direttamente: la scrittura passa solo dalla function security definer.
-- ────────────────────────────────────────────────────────────────────
alter table public.audit_chain_check enable  row level security;
alter table public.audit_chain_check force   row level security;

drop policy if exists ac_select_admin_auditor on public.audit_chain_check;
create policy ac_select_admin_auditor on public.audit_chain_check
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or (
      public.current_role() = 'auditor'
      and coalesce(auth.jwt() ->> 'aal','aal1') = 'aal2'
    )
  );

revoke all    on public.audit_chain_check from anon, authenticated;
grant  select on public.audit_chain_check to   authenticated;

-- ────────────────────────────────────────────────────────────────────
--  3. Function callable da pg_cron (no role check, solo postgres/superuser)
--
--  Esegue lo stesso ricalcolo di verify_audit_chain() ma:
--    - non controlla current_role() (pg_cron non ha JWT)
--    - inserisce SEMPRE una riga in audit_chain_check (ok|broken|error)
--    - in caso di broken, esce al primo mismatch (come l'originale)
--    - cattura eccezioni → status='error' + error_message
--  Eseguibile solo da postgres (pg_cron) → REVOKE per anon/authenticated.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.verify_audit_chain_scheduled()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r           record;
  v_prev      text := null;
  v_calc      text;
  v_count     int  := 0;
  v_t0        timestamptz := clock_timestamp();
  v_status    text := 'ok';
  v_broken_id bigint;
  v_expected  text;
  v_actual    text;
  v_err       text;
begin
  begin
    for r in select * from public.audit_log order by id asc loop
      v_count := v_count + 1;
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
        v_status    := 'broken';
        v_broken_id := r.id;
        v_expected  := v_calc;
        v_actual    := r.row_hash;
        exit;
      end if;
      v_prev := r.row_hash;
    end loop;
  exception when others then
    v_status := 'error';
    v_err    := sqlerrm;
  end;

  insert into public.audit_chain_check
    (status, broken_id, expected_hash, actual_hash,
     total_rows, duration_ms, triggered_by, error_message)
  values
    (v_status, v_broken_id, v_expected, v_actual,
     v_count,
     extract(milliseconds from clock_timestamp() - v_t0)::int,
     'cron', v_err);
end;
$$;

-- Solo postgres/pg_cron può chiamarla. authenticated usa la versione
-- interactive (verify_audit_chain) con role check + UI Diagnostica.
revoke all on function public.verify_audit_chain_scheduled() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
--  4. View di stato (ultimi 10 check) per UI Diagnostica
--
--  security_invoker=on (default da PG 15) → eredita le policy di
--  audit_chain_check, quindi solo admin + auditor a aal2 vedono.
-- ────────────────────────────────────────────────────────────────────
create or replace view public.audit_chain_status as
select id, ts, status, broken_id, expected_hash, actual_hash,
       total_rows, duration_ms, triggered_by, error_message
from public.audit_chain_check
order by ts desc
limit 10;

grant select on public.audit_chain_status to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  5. Schedulazione pg_cron — settimanale, lunedì 03:30 UTC
--
--  Stesso pattern del blocco in 13_hardening.sql: do-nothing se l'
--  estensione manca (free tier). Su Pro+ schedulato in modo idempotente.
-- ────────────────────────────────────────────────────────────────────
do $cron$
declare
  v_has_cron boolean;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_has_cron;
  if not v_has_cron then
    raise notice 'pg_cron non disponibile: schedulare verify_audit_chain_scheduled via GitHub Actions';
    return;
  end if;

  perform cron.unschedule('ghg_verify_audit_chain')
    where exists (select 1 from cron.job where jobname = 'ghg_verify_audit_chain');
  perform cron.schedule(
    'ghg_verify_audit_chain',
    '30 3 * * 1',                              -- lunedì 03:30 UTC (dopo refresh public_facts dom 02:15)
    $j$ select public.verify_audit_chain_scheduled(); $j$
  );
end $cron$;

-- ════════════════════════════════════════════════════════════════════
-- end of 16_audit_chain_cron.sql
-- ════════════════════════════════════════════════════════════════════
