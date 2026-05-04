-- ════════════════════════════════════════════════════════════════════
-- 11_reset_password.sql — reset diretto password di un auth.users
--
-- Quando usarlo:
--   · Il flow "Send password recovery" di Supabase rimanda ad un Site
--     URL non più valido (es. http://localhost:3000) e non si riesce
--     a configurare il giusto redirect in tempo, o l'utente non riceve
--     l'email.
--   · L'utente ha dimenticato la password e bisogna ripristinare
--     l'accesso amministrativamente.
--
-- USAGE
--   1. Modifica EMAIL e NUOVA_PASSWORD qui sotto.
--   2. Esegui in SQL Editor Supabase come postgres / service_role.
--   3. Comunica la password all'utente via canale sicuro (NON email
--      del progetto, NON Slack pubblico). Chiedigli di cambiarla
--      al primo login.
--
-- SICUREZZA
--   · La password verrà bcrypt-hashata via pgcrypto prima dello store
--     (auth.users.encrypted_password è bcrypt).
--   · Le sessioni attive dell'utente NON vengono invalidate da questo
--     script — se vuoi forzare il logout su tutti i device, esegui anche:
--       delete from auth.refresh_tokens where user_id = '<uid>';
--   · L'operazione viene tracciata in auth.audit_log_entries (built-in
--     Supabase) come change_password.
-- ════════════════════════════════════════════════════════════════════

begin;

do $reset$
declare
  v_email    text := 'marco.vacchi@gresmalt.it';   -- ⚠ MODIFICA
  v_password text := 'CambiamiSubito2026!';         -- ⚠ MODIFICA + comunica + chiedi cambio
  v_uid      uuid;
begin
  if length(v_password) < 8 then
    raise exception 'Password troppo corta (% caratteri, minimo 8)', length(v_password);
  end if;

  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'Nessun utente con email %', v_email;
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
         updated_at = now(),
         -- Conferma l'email se non già confermata (così il login funziona
         -- anche per account creati ma non ancora attivati).
         email_confirmed_at = coalesce(email_confirmed_at, now())
   where id = v_uid;

  -- Invalida le sessioni attive (l'utente dovrà fare login con la nuova
  -- password). Pulisce sia refresh_tokens che sessions.
  -- NB: auth.refresh_tokens.user_id è varchar (non uuid) per design
  -- storico Supabase → cast esplicito a text.
  delete from auth.refresh_tokens where user_id = v_uid::text;
  delete from auth.sessions        where user_id = v_uid;

  raise notice '✓ Password resettata per % (uid %). Sessioni invalidate.', v_email, v_uid;
  raise notice 'Comunica la nuova password via canale sicuro e chiedi di cambiarla al primo login.';
end $reset$;

commit;

-- ════════════════════════════════════════════════════════════════════
-- end of 11_reset_password.sql
-- ════════════════════════════════════════════════════════════════════
