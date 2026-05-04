-- ════════════════════════════════════════════════════════════════════
-- 10_delete_user.sql — cancellazione sicura di un auth.users
--
-- Scenario: utente da rimuovere (es. marco.vacchi@gresmalt.it).
-- Supabase Studio → Authentication → Users → Delete fallisce per
-- via dei vincoli FK created_by/updated_by/added_by/user_id che
-- puntano ad auth.users(id) senza ON DELETE definito.
--
-- Questo script:
--  1. Trova lo user_id dall'email.
--  2. Imposta a NULL tutte le colonne *_by / user_id che lo referenziano
--     (preserva le righe — l'audit_log resta intatto: la colonna
--     user_id lì non ha FK, solo user_email che è testuale).
--  3. Cancella la riga da public.role_map (se presente).
--  4. Cancella la riga da auth.users.
--
-- USAGE
--  · SQL Editor Supabase, eseguire come postgres / service_role
--    (la cancellazione di auth.users richiede privilegi elevati).
--  · Cambia la EMAIL nella riga indicata per puntare a un altro utente.
--  · Tutto in transazione: se qualcosa fallisce, rollback automatico.
--
-- ALTERNATIVA NON-DISTRUTTIVA
--  Se l'utente esiste ancora (l'email è recuperabile) preferire:
--    Authentication → Users → … → "Send magic link" / "Send password
--    recovery". L'utente clicca il link e imposta nuova password,
--    senza perdere FK references o audit history.
-- ════════════════════════════════════════════════════════════════════

begin;

do $del$
declare
  v_email text := 'marco.vacchi@gresmalt.it';   -- ⚠ MODIFICA SE NECESSARIO
  v_uid   uuid;
  v_n     int;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise notice 'Nessun utente con email %', v_email;
    return;
  end if;
  raise notice 'Trovato utente % → uid %', v_email, v_uid;

  -- 1. Nullifica tutti i riferimenti FK
  update public.anagrafiche    set created_by = null where created_by = v_uid;
  update public.anagrafiche    set updated_by = null where updated_by = v_uid;
  update public.produzione     set created_by = null where created_by = v_uid;
  update public.produzione     set updated_by = null where updated_by = v_uid;
  update public.fe             set created_by = null where created_by = v_uid;
  update public.fe             set updated_by = null where updated_by = v_uid;
  update public.s1             set created_by = null where created_by = v_uid;
  update public.s1             set updated_by = null where updated_by = v_uid;
  update public.s2             set created_by = null where created_by = v_uid;
  update public.s2             set updated_by = null where updated_by = v_uid;
  update public.s3             set created_by = null where created_by = v_uid;
  update public.s3             set updated_by = null where updated_by = v_uid;
  update public.s3_materiality set created_by = null where created_by = v_uid;
  update public.s3_materiality set updated_by = null where updated_by = v_uid;
  update public.app_meta       set updated_by = null where updated_by = v_uid;
  update public.role_map       set added_by   = null where added_by   = v_uid;
  update public.role_map       set updated_by = null where updated_by = v_uid;
  update public.client_errors  set user_id    = null where user_id    = v_uid;
  -- audit_log.user_id NON ha FK (per design — log immutabile): non
  -- viene toccato. user_email rimane testuale per traccia storica.

  -- 2. Rimuovi dal role_map (così il ruolo non viene riapplicato se
  --    l'email viene ricreata in futuro).
  delete from public.role_map where lower(email) = lower(v_email);
  get diagnostics v_n = row_count;
  raise notice 'role_map: rimosse % righe', v_n;

  -- 3. Cancella da auth.users.
  --    Note: identities/sessions/refresh_tokens hanno on delete cascade
  --    sul user_id verso auth.users → puliti in automatico da Supabase.
  delete from auth.users where id = v_uid;
  get diagnostics v_n = row_count;
  raise notice 'auth.users: rimosse % righe (atteso 1)', v_n;
  if v_n <> 1 then
    raise exception 'Cancellazione utente fallita (rimosse % righe, atteso 1)', v_n;
  end if;

  raise notice '✓ Utente % cancellato. Storico preservato in audit_log (user_email = "%")',
               v_email, v_email;
end $del$;

commit;

-- ════════════════════════════════════════════════════════════════════
-- end of 10_delete_user.sql
-- ════════════════════════════════════════════════════════════════════
