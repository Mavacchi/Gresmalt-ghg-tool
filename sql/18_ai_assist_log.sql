-- ════════════════════════════════════════════════════════════════════
-- 18_ai_assist_log.sql — Audit log delle chiamate AI generiche
--
-- Idempotente: ri-eseguibile senza side-effects.
-- Eseguire come superuser dopo 17_fe_search_log.sql.
--
-- Contesto: l'Edge Function ai_assist (separata da search_fe per
-- isolare le quote: search_fe consuma il pool Grounding-2.5 limitato,
-- ai_assist usa gemini-3.1-flash-lite senza grounding, 500 RPD free
-- intatti) serve task non-grounded:
--   - 'explain_balance'  → riassunto del bilancio GHG di un anno
--   - 'normalize_unit'   → unità di misura nella forma canonica DB
--   - 'suggest_code'     → codice voce coerente con quelli esistenti
--
-- Ogni chiamata loggata per audit + per analisi uso (capire quali
-- task vengono usati di più, durata media, tasso di errore).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.ai_assist_log (
  id              bigserial primary key,
  ts              timestamptz  not null default now(),
  user_id         uuid         references auth.users(id),
  user_email      text,
  -- Tipo di task richiesto. Free-form text (no CHECK) per consentire
  -- nuovi task senza migration: validazione lato Edge Function.
  task            text         not null,
  -- Input completo (payload utente). Per 'explain_balance' contiene
  -- i totali GHG; per 'normalize_unit' la stringa raw; per
  -- 'suggest_code' descrizione + codici esistenti.
  input           jsonb,
  -- Output completo dell'LLM (testo o JSON parsato).
  output          jsonb,
  duration_ms     int,
  error_message   text
);

create index if not exists ai_assist_log_ts_idx     on public.ai_assist_log (ts desc);
create index if not exists ai_assist_log_user_idx   on public.ai_assist_log (user_id, ts desc);
create index if not exists ai_assist_log_task_idx   on public.ai_assist_log (task, ts desc);

-- ────────────────────────────────────────────────────────────────────
--  RLS — SELECT solo admin + auditor (aal2). INSERT delegato alla
--  RPC log_ai_assist (security definer) — nessuno scrive direttamente.
-- ────────────────────────────────────────────────────────────────────
alter table public.ai_assist_log enable row level security;
alter table public.ai_assist_log force  row level security;

drop policy if exists ai_assist_log_select on public.ai_assist_log;
create policy ai_assist_log_select on public.ai_assist_log
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or (
      public.current_role() = 'auditor'
      and coalesce(auth.jwt() ->> 'aal','aal1') = 'aal2'
    )
  );

revoke all    on public.ai_assist_log from anon, authenticated;
grant  select on public.ai_assist_log to   authenticated;

-- ────────────────────────────────────────────────────────────────────
--  RPC log_ai_assist — chiamata dalla Edge Function ai_assist
--
--  Security definer: l'Edge Function passa user JWT; leggiamo
--  l'identità da auth.uid() e inseriamo la riga con quel user_id.
--  Stessa logica di log_fe_search.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.log_ai_assist(
  p_task        text,
  p_input       jsonb,
  p_output      jsonb,
  p_duration_ms int,
  p_error       text default null
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
    raise exception 'log_ai_assist: sessione non autenticata';
  end if;
  if v_role not in ('admin','editor') then
    raise exception 'log_ai_assist: ruolo non autorizzato (%)', v_role;
  end if;
  select email into v_email from auth.users where id = v_uid;

  insert into public.ai_assist_log
    (user_id, user_email, task, input, output, duration_ms, error_message)
  values
    (v_uid, v_email, p_task, p_input, p_output, p_duration_ms, p_error)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.log_ai_assist(text, jsonb, jsonb, int, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- end of 18_ai_assist_log.sql
-- ════════════════════════════════════════════════════════════════════
