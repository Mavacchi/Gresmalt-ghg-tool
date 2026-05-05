-- ════════════════════════════════════════════════════════════════════
-- 13_hardening.sql — Indurimento sicurezza/operations post-review
--
-- Idempotente: ri-eseguibile senza side-effects.
-- Eseguire come superuser dopo 01..08.
--
-- Contiene:
--   1. RPC atomica save_produzione(...)        — risolve race DELETE+UPSERT
--   2. RPC atomica cascade_fe_update(...)      — ricalcolo S1/S3 transazionale
--   3. pseudonymize_audit_email(uuid)          — GDPR post-cessazione
--   4. purge_audit_emails_for_disabled_users() — cron mensile
--   5. count_failed_logins(int)                — sentinella brute-force
--   6. force_refresh_public_facts()            — refresh non-trigger di sicurezza
--   7. Schedulazione pg_cron (se l'estensione è disponibile sul plan)
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
--  1. RPC atomica per saveProduzione: DELETE+UPSERT in singola trans-
--     azione → niente più finestra in cui la riga vecchia è eliminata
--     ma la nuova non è ancora scritta (race rilevata in code review).
-- ────────────────────────────────────────────────────────────────────
create or replace function public.save_produzione(
  p_codice_sito  text,
  p_anno         int,
  p_kg           numeric,
  p_m2           numeric,
  p_note         text,
  p_orig_sito    text default null,
  p_orig_anno    int  default null
)
returns public.produzione
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text := public.current_role();
  v_row  public.produzione;
begin
  if v_role not in ('admin','editor') then
    raise exception 'save_produzione: ruolo non autorizzato (%)', v_role;
  end if;

  -- Year lock check (admin override naturale via current_role)
  if v_role = 'editor' and public.is_year_locked(p_anno) then
    raise exception 'save_produzione: anno % bloccato per editor', p_anno;
  end if;

  -- Se la PK è cambiata, prima delete la vecchia. Tutto in un'unica
  -- transazione: se la upsert fallisce, il delete viene rolled back.
  if p_orig_sito is not null
     and p_orig_anno is not null
     and (p_orig_sito <> p_codice_sito or p_orig_anno <> p_anno) then
    delete from public.produzione
     where codice_sito = p_orig_sito
       and anno = p_orig_anno;
  end if;

  insert into public.produzione (codice_sito, anno, produzione_kg, produzione_m2, note)
  values (p_codice_sito, p_anno, p_kg, p_m2, p_note)
  on conflict (codice_sito, anno) do update
    set produzione_kg = excluded.produzione_kg,
        produzione_m2 = excluded.produzione_m2,
        note          = excluded.note,
        updated_at    = now(),
        updated_by    = auth.uid()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.save_produzione(text,int,numeric,numeric,text,text,int) to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  2. RPC atomica per cascade FE update.
--     Il client JS (cascadeFEUpdate in SupabaseDB.jsx) caricava tutte
--     le S1/S3 in memoria e faceva due batch upsert separati: in caso
--     di errore parziale alcune righe risultavano ricalcolate e altre
--     no. La function PL/pgSQL fa tutto in una transazione con
--     rollback automatico in caso di errore.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.cascade_fe_update(
  p_fe_id        text,
  p_codice_voce  text,
  p_anno_validita int
)
returns table (s1_updated int, s3_updated int)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text := public.current_role();
  v_fe   public.fe%rowtype;
  v_s1   int := 0;
  v_s3   int := 0;
begin
  if v_role not in ('admin','editor') then
    raise exception 'cascade_fe_update: ruolo non autorizzato (%)', v_role;
  end if;

  -- Recupera l'FE bersaglio
  select * into v_fe
    from public.fe
   where (p_fe_id is not null and fe_id = p_fe_id and anno_validita = p_anno_validita)
      or (p_fe_id is null     and codice_voce = p_codice_voce and anno_validita = p_anno_validita)
   limit 1;

  if not found then
    raise exception 'cascade_fe_update: FE non trovato (id=%, voce=%, anno=%)',
                    p_fe_id, p_codice_voce, p_anno_validita;
  end if;

  -- S1: matcha su combustibile == codice_voce + anno
  with upd as (
    update public.s1
       set fe_valore = v_fe.valore,
           em_tco2e  = coalesce(quantita,0) * v_fe.valore / 1000.0
     where combustibile = v_fe.codice_voce
       and anno = v_fe.anno_validita
       and (v_role = 'admin' or not public.is_year_locked(anno))
    returning 1
  )
  select count(*) into v_s1 from upd;

  -- S3: matcha su codice_fe == fe_id o codice_voce + anno
  with upd as (
    update public.s3
       set fe_valore = v_fe.valore,
           em_tco2e  = coalesce(quantita,0) * v_fe.valore / 1000.0
     where (codice_fe = v_fe.fe_id or codice_fe = v_fe.codice_voce)
       and anno = v_fe.anno_validita
       and (v_role = 'admin' or not public.is_year_locked(anno))
    returning 1
  )
  select count(*) into v_s3 from upd;

  return query select v_s1, v_s3;
end;
$$;

grant execute on function public.cascade_fe_update(text,text,int) to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  3. Pseudonimizzazione email in audit_log.
--     GDPR / CSRD: alla cessazione del rapporto con un operatore,
--     l'email PII deve essere rimossa dall'audit_log preservando
--     l'integrità della hash chain. La funzione sostituisce email
--     con un hash deterministico (SHA-256 dei primi 16 char hex).
--     Il row_hash NON viene ricalcolato — verify_audit_chain rileverà
--     volutamente la pseudonimizzazione come "rotta" sul primo evento
--     pseudonimizzato; per questo esponiamo verify_audit_chain_relaxed
--     che ignora i record pseudonimizzati.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.pseudonymize_audit_email(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_role();
  v_email text;
  v_pseudo text;
  v_count int;
begin
  if v_role <> 'admin' then
    raise exception 'pseudonymize_audit_email: solo admin';
  end if;

  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then
    -- L'utente potrebbe già essere stato cancellato; pseudonimizziamo
    -- comunque le righe con quel user_id.
    v_email := p_user_id::text;
  end if;

  v_pseudo := 'pseudo:' || substr(
    encode(extensions.digest(v_email, 'sha256'), 'hex'), 1, 16);

  with upd as (
    update public.audit_log
       set user_email = v_pseudo
     where user_id = p_user_id
       and (user_email is null or user_email not like 'pseudo:%')
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$$;

revoke all on function public.pseudonymize_audit_email(uuid) from public, anon, authenticated;
grant execute on function public.pseudonymize_audit_email(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  4. Purge automatico mensile: pseudonimizza email per utenti
--     disattivati / cancellati o senza login da 24 mesi.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.purge_audit_emails_for_disabled_users()
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  r record;
  v_total int := 0;
  v_n int;
begin
  -- Utenti cessati: presenti in audit_log ma non più in auth.users
  for r in
    select distinct user_id
      from public.audit_log
     where user_id is not null
       and (user_email is null or user_email not like 'pseudo:%')
       and user_id not in (select id from auth.users)
  loop
    select count(*) into v_n
      from public.audit_log
     where user_id = r.user_id
       and (user_email is null or user_email not like 'pseudo:%');
    update public.audit_log
       set user_email = 'pseudo:' || substr(
             encode(extensions.digest(r.user_id::text, 'sha256'), 'hex'), 1, 16)
     where user_id = r.user_id
       and (user_email is null or user_email not like 'pseudo:%');
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- Utenti dormienti > 24 mesi (approssimazione: created_at dell'utente
  -- + nessun audit recente)
  for r in
    select u.id as user_id
      from auth.users u
     where coalesce(u.last_sign_in_at, u.created_at) < now() - interval '24 months'
       and exists (
         select 1 from public.audit_log a
          where a.user_id = u.id
            and (a.user_email is null or a.user_email not like 'pseudo:%')
       )
  loop
    update public.audit_log
       set user_email = 'pseudo:' || substr(
             encode(extensions.digest(r.user_id::text, 'sha256'), 'hex'), 1, 16)
     where user_id = r.user_id
       and (user_email is null or user_email not like 'pseudo:%');
    get diagnostics v_n = row_count;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  return v_total;
end;
$$;

revoke all on function public.purge_audit_emails_for_disabled_users() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
--  5. Sentinella brute-force: conta i login falliti recenti.
--     Usabile da una Edge Function chiamata via cron per spedire mail
--     o slack quando supera la soglia. Valutiamo qui solo il count,
--     l'azione è esterna.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.count_failed_logins(p_window_minutes int default 60)
returns table (failed_attempts bigint, distinct_emails bigint, last_attempt timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.current_role() not in ('admin','auditor') then
    raise exception 'count_failed_logins: ruolo non autorizzato';
  end if;
  return query
    select count(*) as failed_attempts,
           count(distinct (raw_user_meta_data->>'email')) as distinct_emails,
           max(created_at) as last_attempt
      from auth.audit_log_entries
     where created_at > now() - make_interval(mins => p_window_minutes)
       and (payload->>'action') in ('login_failed','user_signedup_failed','token_refreshed_failed');
end;
$$;

grant execute on function public.count_failed_logins(int) to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  6. Refresh "non-trigger" di public_facts come safety net.
--     Il refresh on-write copre il caso normale; un cron settimanale
--     evita stantii in scenari edge (trigger fallito, partial restore).
-- ────────────────────────────────────────────────────────────────────
create or replace function public.force_refresh_public_facts()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    refresh materialized view concurrently public.public_facts;
  exception when others then
    refresh materialized view public.public_facts;
  end;
end;
$$;

revoke all on function public.force_refresh_public_facts() from public, anon, authenticated;
grant execute on function public.force_refresh_public_facts() to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  7. Schedulazione pg_cron (best-effort).
--     pg_cron è disponibile su tier Pro+. Sul Free tier la schedulazione
--     va replicata via GitHub Actions (vedi .github/workflows/).
--     Il blocco è "do nothing" se l'estensione non c'è, così il file
--     resta idempotente su entrambi i tier.
-- ────────────────────────────────────────────────────────────────────
do $cron$
declare
  v_has_cron boolean;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_has_cron;
  if not v_has_cron then
    raise notice 'pg_cron non disponibile: configurare i cron via GitHub Actions';
    return;
  end if;

  -- purge errori client (90gg)
  perform cron.unschedule('ghg_purge_client_errors')
    where exists (select 1 from cron.job where jobname = 'ghg_purge_client_errors');
  perform cron.schedule(
    'ghg_purge_client_errors',
    '0 3 * * *',                              -- ogni notte 03:00 UTC
    $j$ select public.purge_old_client_errors(); $j$
  );

  -- pseudonimizzazione mensile
  perform cron.unschedule('ghg_pseudo_audit')
    where exists (select 1 from cron.job where jobname = 'ghg_pseudo_audit');
  perform cron.schedule(
    'ghg_pseudo_audit',
    '0 4 1 * *',                              -- il 1° di ogni mese 04:00 UTC
    $j$ select public.purge_audit_emails_for_disabled_users(); $j$
  );

  -- refresh public_facts settimanale
  perform cron.unschedule('ghg_refresh_public_facts')
    where exists (select 1 from cron.job where jobname = 'ghg_refresh_public_facts');
  perform cron.schedule(
    'ghg_refresh_public_facts',
    '15 2 * * 0',                             -- domenica 02:15 UTC
    $j$ select public.force_refresh_public_facts(); $j$
  );
end $cron$;

-- ════════════════════════════════════════════════════════════════════
-- end of 13_hardening.sql
-- ════════════════════════════════════════════════════════════════════
