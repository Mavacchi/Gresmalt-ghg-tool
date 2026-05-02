-- ════════════════════════════════════════════════════════════════════
-- 07_invite_operators.sql — Inviti utenti con ruolo iniziale
-- ════════════════════════════════════════════════════════════════════
--
-- Esegue:
--   1) Invia un invito Supabase via auth.admin (richiede service_role
--      key — eseguire dal SQL editor di Supabase con i privilegi giusti)
--   2) Imposta il ruolo in app_metadata appena l'utente accetta l'invito
--
-- IMPORTANTE: il ruolo va in app_metadata (non user_metadata).
--             user_metadata è scrivibile dall'utente → privilege escalation.
--
-- USAGE:
--   1. Aprire il dashboard Supabase → Authentication → Users → Invite
--      e invitare ogni indirizzo manualmente. Oppure richiamare
--      l'endpoint /auth/v1/invite con la service_role key.
--   2. Eseguire questo file con il SQL editor: imposta i ruoli in
--      app_metadata per i 3 utenti elencati. Riesegui ogni volta che
--      aggiungi un nuovo utente.
-- ════════════════════════════════════════════════════════════════════

-- Helper privato (può essere chiamato solo da postgres / service_role)
do $$
declare
  rec record;
  emails text[] := ARRAY[
    'marco.vacchi@gresmalt.it',
    'davide.settembre@gresmalt.it',
    'luca.iattici@gresmalt.it'
  ];
  roles  text[] := ARRAY[
    'admin',                 -- marco.vacchi
    'editor',                -- davide.settembre
    'editor'                 -- luca.iattici
  ];
  i int;
begin
  for i in 1 .. array_length(emails, 1) loop
    update auth.users
       set raw_app_meta_data =
             coalesce(raw_app_meta_data, '{}'::jsonb)
             || jsonb_build_object('role', roles[i])
     where email = emails[i];

    if not found then
      raise notice 'Utente % non ancora registrato. Invitarlo dal dashboard Supabase, poi rieseguire questo script.', emails[i];
    else
      raise notice 'Utente % aggiornato a ruolo %.', emails[i], roles[i];
    end if;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────
--  PROMEMORIA MFA
--  Per admin e auditor MFA TOTP è obbligatorio. L'enrollment avviene
--  al primo login dalla sezione Account → MFA del client.
--  Per forzare l'AAL2 sui ruoli admin/auditor, configurare
--  Authentication → Policies in Supabase.
-- ────────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- end of 07_invite_operators.sql
-- ════════════════════════════════════════════════════════════════════
