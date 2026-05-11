-- ════════════════════════════════════════════════════════════════════
-- 17_fe_search_log.sql — Audit log delle ricerche FE via LLM
--
-- Idempotente: ri-eseguibile senza side-effects.
-- Eseguire come superuser dopo 16_audit_chain_cron.sql.
--
-- Contesto: la feature "Cerca FE" in src/sections/FEExplorer.jsx
-- invoca l'Edge Function search_fe che usa Gemini 2.5 Flash con
-- Google Search Grounding per proporre FE da fonti pubbliche
-- (ISPRA, DEFRA, EPA, AIB, IPCC, ecc.). Ogni chiamata viene
-- loggata qui per audit trail e per la conformità CSRD: deve
-- sempre essere possibile risalire alla fonte di un FE inserito
-- nel database.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.fe_search_log (
  id              bigserial primary key,
  ts              timestamptz  not null default now(),
  user_id         uuid         references auth.users(id),
  user_email      text,
  query           text         not null,
  -- Lista dei domini sorgente effettivamente usati (whitelist filtrata
  -- dall'Edge Function), es. ["defra.gov.uk", "ispra.gov.it"].
  sources_used    text[]       default '{}',
  -- Risposta completa dell'LLM con candidati + URL + citazioni.
  -- jsonb per query/indici futuri (es. cercare tutti i FE da DEFRA).
  response        jsonb,
  -- Indice del candidato che l'utente ha effettivamente selezionato
  -- e salvato in public.fe. Null se l'utente non ha salvato nulla.
  selected_idx    int,
  -- Riferimento al FE salvato (se l'utente ha confermato).
  saved_fe_id     uuid         references public.fe(id) on delete set null,
  -- Metadati performance
  duration_ms     int,
  -- Errore (se la chiamata Gemini è fallita / quota esaurita / ecc.)
  error_message   text
);

create index if not exists fe_search_log_ts_idx     on public.fe_search_log (ts desc);
create index if not exists fe_search_log_user_idx   on public.fe_search_log (user_id, ts desc);

-- ────────────────────────────────────────────────────────────────────
--  RLS — INSERT/SELECT entrambi gestiti via Edge Function security
--  definer; il client diretto non scrive nella tabella. SELECT solo
--  admin + auditor (a aal2 per coerenza con audit_log).
-- ────────────────────────────────────────────────────────────────────
alter table public.fe_search_log enable row level security;
alter table public.fe_search_log force  row level security;

drop policy if exists fe_search_log_select on public.fe_search_log;
create policy fe_search_log_select on public.fe_search_log
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or (
      public.current_role() = 'auditor'
      and coalesce(auth.jwt() ->> 'aal','aal1') = 'aal2'
    )
  );

revoke all    on public.fe_search_log from anon, authenticated;
grant  select on public.fe_search_log to   authenticated;
-- INSERT delegato alla Edge Function con service_role; nessun client
-- scrive direttamente questa tabella.

-- ────────────────────────────────────────────────────────────────────
--  RPC pubblica per logging (chiamata dalla Edge Function)
--
--  Security definer: la Edge Function passa user JWT in Authorization;
--  noi leggiamo l'identità dalla session via auth.uid() e inseriamo
--  con quel user_id. In questo modo:
--   - non serve service_role nella Edge Function
--   - l'utente che chiama è univocamente tracciato
-- ────────────────────────────────────────────────────────────────────
create or replace function public.log_fe_search(
  p_query        text,
  p_sources_used text[],
  p_response     jsonb,
  p_duration_ms  int,
  p_error        text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_role   text := public.current_role();
  v_id     bigint;
begin
  if v_uid is null then
    raise exception 'log_fe_search: sessione non autenticata';
  end if;
  if v_role not in ('admin','editor') then
    raise exception 'log_fe_search: ruolo non autorizzato (%)', v_role;
  end if;
  select email into v_email from auth.users where id = v_uid;

  insert into public.fe_search_log
    (user_id, user_email, query, sources_used, response, duration_ms, error_message)
  values
    (v_uid, v_email, p_query, p_sources_used, p_response, p_duration_ms, p_error)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.log_fe_search(text, text[], jsonb, int, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  RPC per aggiornare la riga con selected_idx + saved_fe_id quando
--  l'utente conferma il salvataggio di un candidato.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.mark_fe_search_selected(
  p_log_id        bigint,
  p_selected_idx  int,
  p_saved_fe_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'mark_fe_search_selected: sessione non autenticata';
  end if;
  update public.fe_search_log
     set selected_idx = p_selected_idx,
         saved_fe_id  = p_saved_fe_id
   where id = p_log_id
     and user_id = v_uid;  -- safety: l'utente può aggiornare solo i propri log
end;
$$;

grant execute on function public.mark_fe_search_selected(bigint, int, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- end of 17_fe_search_log.sql
-- ════════════════════════════════════════════════════════════════════
