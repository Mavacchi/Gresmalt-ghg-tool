-- ════════════════════════════════════════════════════════════════════
-- 15_mfa_auditor.sql — MFA TOTP obbligatoria per ruolo `auditor`
--
-- Idempotente: ri-eseguibile senza side-effects.
-- Prerequisito: 03_roles.sql + 14_mfa_editor.sql (questo lo estende).
--
-- DESIGN
--   sql/14_mfa_editor.sql ha forzato aal=aal2 sulle policy di scrittura
--   per il ruolo `editor`. L'auditor invece NON scrive — accede in
--   sola lettura a:
--     - tutte le tabelle dati (s1, s2, s3, ecc.) → policy SELECT
--       comune a tutti gli authenticated
--     - audit_log → policy SELECT specifica admin/auditor
--     - verify_audit_chain() → function SQL admin/auditor
--
--   L'audit log contiene PII (email operatori) ed eventi sensibili
--   (chi ha modificato cosa, quando). È il dato più sensibile
--   dell'applicazione dopo la chiave HMAC. Per mitigare il rischio
--   di token theft → audit leak, richiediamo aal=aal2 anche per
--   il SELECT su audit_log e per la chiamata a verify_audit_chain().
--
-- IMPATTO UX
--   Auditor con TOTP enrollato + verificato a login (aal2): vede
--     audit_log normalmente.
--   Auditor senza TOTP (aal1): SELECT su audit_log respinto con 403.
--     Per accedere all'audit deve enrollare e verificare TOTP.
--
--   La UI in src/AuthGate.jsx (MFAEnrollScreen) forza l'enrollment
--   automatico anche per auditor: al primo login senza factor TOTP
--   verificato, l'auditor vede il wizard QR code prima di poter
--   accedere alla console (stesso flow di editor). Il copy del
--   wizard è sensibile al ruolo: editor vede "Per modificare i
--   dati...", auditor vede "Per consultare l'audit log...".
--
-- ROLLBACK
--   Se questa migration crea problemi operativi, rieseguire
--   sql/03_roles.sql (la ricrea aperta a admin/auditor senza aal2).
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
--  Override audit_log_select: admin O (auditor AND aal2)
--
--  Admin invariato (può accedere anche a aal1, override emergenza
--  + nessun rischio lockout in caso di MFA device perso). Editor
--  e viewer sempre esclusi (la policy sotto non li nomina, RLS
--  default-deny).
-- ────────────────────────────────────────────────────────────────────
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or (public.current_role() = 'auditor'
        and (auth.jwt() ->> 'aal') = 'aal2')
  );

-- ────────────────────────────────────────────────────────────────────
--  Re-enforce verify_audit_chain(): admin always; auditor only at aal2
--
--  La function di sql/03_roles.sql esegue un check inline su
--  current_role() in ('admin','auditor'). La estendiamo con il check
--  aal2 per il branch auditor.
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
  v_role text := public.current_role();
  v_aal  text := coalesce(auth.jwt() ->> 'aal', 'aal1');
begin
  if v_role = 'admin' then
    -- Admin ok
    null;
  elsif v_role = 'auditor' then
    if v_aal <> 'aal2' then
      raise exception 'verify_audit_chain: auditor richiede MFA aal2 (current=%)', v_aal;
    end if;
  else
    raise exception 'verify_audit_chain: ruolo non autorizzato (%)', v_role;
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

-- ════════════════════════════════════════════════════════════════════
-- end of 15_mfa_auditor.sql
-- ════════════════════════════════════════════════════════════════════
