-- ════════════════════════════════════════════════════════════════════
-- 14_mfa_editor.sql — MFA TOTP obbligatoria per ruolo `editor`
--
-- Idempotente: ri-eseguibile senza side-effects.
-- Prerequisito: 03_roles.sql + 08_year_lock.sql (questo lo OVERRIDE).
--
-- DESIGN
--   Le policy RLS attuali permettono a un editor di scrivere su
--   s1/s2/s3/produzione/fe/anagrafiche/s3_materiality finché l'anno
--   non è bloccato. Questa migration aggiunge un secondo vincolo:
--   l'editor deve avere una sessione AAL2 (= ha completato MFA TOTP
--   al login) per fare INSERT/UPDATE.
--
--   Il check si esprime con `(auth.jwt() ->> 'aal') = 'aal2'`.
--
--   Conseguenze:
--     · Editor con TOTP enrollato + verificato a login → scrive ✅
--     · Editor senza TOTP (aal1) → INSERT/UPDATE rifiutati con 403,
--       costretto a enrollarsi (la UI in AuthGate.jsx mostra il
--       wizard di enrollment se rileva editor + nessun factor)
--     · Admin → branch invariato, può scrivere anche con aal1
--       (evita lockout in caso di MFA device perso, override
--       d'emergenza)
--     · Auditor/viewer → invariato (non scrivono comunque)
--     · DELETE → invariato (admin-only)
--
--   Le policy SELECT non sono toccate: leggere resta libero per ogni
--   authenticated, indipendentemente da aal.
--
--   Defense-in-depth: l'enforcement è SQL (anche se un client modifica-
--   to bypassasse la UI di enrollment, il DB respinge la write).
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
--  TABELLE CON YEAR_LOCK (s1, s2, s3, produzione)
--  Override delle policy create da 08_year_lock.sql aggiungendo aal2.
-- ────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select unnest(array['s1','s2','s3']) loop
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I
                    for insert to authenticated
                    with check (
                      public.current_role() = ''admin''
                      or (public.current_role() = ''editor''
                          and not public.is_year_locked(anno)
                          and (auth.jwt() ->> ''aal'') = ''aal2'')
                    );', t, t);

    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I
                    for update to authenticated
                    using (
                      public.current_role() = ''admin''
                      or (public.current_role() = ''editor''
                          and not public.is_year_locked(anno)
                          and (auth.jwt() ->> ''aal'') = ''aal2'')
                    )
                    with check (
                      public.current_role() = ''admin''
                      or (public.current_role() = ''editor''
                          and not public.is_year_locked(anno)
                          and (auth.jwt() ->> ''aal'') = ''aal2'')
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
        and not public.is_year_locked(anno)
        and (auth.jwt() ->> 'aal') = 'aal2')
  );

drop policy if exists produzione_update on public.produzione;
create policy produzione_update on public.produzione
  for update to authenticated
  using (
    public.current_role() = 'admin'
    or (public.current_role() = 'editor'
        and not public.is_year_locked(anno)
        and (auth.jwt() ->> 'aal') = 'aal2')
  )
  with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'editor'
        and not public.is_year_locked(anno)
        and (auth.jwt() ->> 'aal') = 'aal2')
  );

-- ────────────────────────────────────────────────────────────────────
--  TABELLE SENZA YEAR_LOCK (fe, anagrafiche, s3_materiality)
--  Override delle policy create da 03_roles.sql aggiungendo aal2.
-- ────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select unnest(array['fe','anagrafiche','s3_materiality']) loop
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I
                    for insert to authenticated
                    with check (
                      public.current_role() = ''admin''
                      or (public.current_role() = ''editor''
                          and (auth.jwt() ->> ''aal'') = ''aal2'')
                    );', t, t);

    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I
                    for update to authenticated
                    using (
                      public.current_role() = ''admin''
                      or (public.current_role() = ''editor''
                          and (auth.jwt() ->> ''aal'') = ''aal2'')
                    )
                    with check (
                      public.current_role() = ''admin''
                      or (public.current_role() = ''editor''
                          and (auth.jwt() ->> ''aal'') = ''aal2'')
                    );', t, t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────
--  Helper SQL: ritorna lo stato MFA dell'utente corrente.
--  Usata dalla UI per decidere se mostrare il wizard di enrollment.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.current_aal()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;
grant execute on function public.current_aal() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- end of 14_mfa_editor.sql
-- ════════════════════════════════════════════════════════════════════
