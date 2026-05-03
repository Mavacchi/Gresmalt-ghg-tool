-- ════════════════════════════════════════════════════════════════════
-- 08_year_lock.sql — Sign-off / lock di un anno di inventario
-- ════════════════════════════════════════════════════════════════════
--
-- DESIGN
--   Quando un anno di inventario viene "approvato" (chiusura ufficiale,
--   pubblicazione nel Bilancio, audit esterno), nessun utente di ruolo
--   `editor` deve poter più modificare le righe S1/S2/S3/Produzione di
--   quell'anno. L'admin mantiene la possibilità di modificare per
--   correzioni straordinarie (eventi che vengono comunque catturati
--   dall'audit_log con hash chain, vedi 01/03).
--
--   Implementazione minimale: una sola entry in `app_meta` di chiave
--   `locked_years` con `value::jsonb` = array di interi (es. [2021,
--   2022]). Una function `is_year_locked(int)` la legge. Le policy
--   delle 4 tabelle dati operative aggiungono il check.
--
--   Vantaggi:
--     · niente nuova tabella, audit_log già copre app_meta
--     · admin override naturale (basta non bloccare il suo ramo)
--     · un solo punto di verità (nessuna desync col DB)
--
-- USAGE
--   Eseguire una volta come postgres / service_role.
--   Da UI (Diagnostica) admin può aggiungere/togliere anni.
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
--  Function: is_year_locked(int) → boolean
-- ────────────────────────────────────────────────────────────────────
create or replace function public.is_year_locked(p_year int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value from public.app_meta where key = 'locked_years'),
    '[]'::jsonb
  ) @> to_jsonb(p_year);
$$;
grant execute on function public.is_year_locked(int) to authenticated;

-- Inizializza la chiave (idempotente)
insert into public.app_meta (key, value)
  values ('locked_years', '[]'::jsonb)
  on conflict (key) do nothing;

-- ────────────────────────────────────────────────────────────────────
--  RIDEFINIZIONE POLICY su s1, s2, s3, produzione per rispettare il
--  lock. Admin sempre può; editor solo se l'anno non è bloccato.
--  SELECT/DELETE invariate (DELETE è già admin-only via 03).
-- ────────────────────────────────────────────────────────────────────
do $$
declare
  t      text;
  anno_col text;
begin
  for t in select unnest(array['s1','s2','s3']) loop
    -- INSERT
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I
                    for insert to authenticated
                    with check (
                      public.current_role() = ''admin''
                      or (public.current_role() = ''editor''
                          and not public.is_year_locked(new.anno))
                    );', t, t);

    -- UPDATE: lock check su entrambi old.anno e new.anno (impedisce sia
    -- la modifica diretta che lo "spostamento" di una riga in/out di un
    -- anno bloccato).
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I
                    for update to authenticated
                    using (
                      public.current_role() = ''admin''
                      or (public.current_role() = ''editor''
                          and not public.is_year_locked(old.anno))
                    )
                    with check (
                      public.current_role() = ''admin''
                      or (public.current_role() = ''editor''
                          and not public.is_year_locked(new.anno))
                    );', t, t);
  end loop;
end $$;

-- Produzione (stessa logica)
drop policy if exists produzione_insert on public.produzione;
create policy produzione_insert on public.produzione
  for insert to authenticated
  with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'editor'
        and not public.is_year_locked(new.anno))
  );
drop policy if exists produzione_update on public.produzione;
create policy produzione_update on public.produzione
  for update to authenticated
  using (
    public.current_role() = 'admin'
    or (public.current_role() = 'editor'
        and not public.is_year_locked(old.anno))
  )
  with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'editor'
        and not public.is_year_locked(new.anno))
  );

-- ════════════════════════════════════════════════════════════════════
-- end of 08_year_lock.sql
-- ════════════════════════════════════════════════════════════════════
