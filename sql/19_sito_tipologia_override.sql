-- 19_sito_tipologia_override.sql
-- Override temporale della tipologia di un sito.
--
-- Caso d'uso: anagrafiche.tipologia è la funzione "di default" del sito
-- (Stabilimento produttivo / Magazzino / Logistica / Uffici / Altro).
-- Ma un sito può cambiare funzione nel tempo: es. VIANO_GARGOLA è
-- "Stabilimento produttivo" oggi, ma dal 2026 diventerà "Magazzino".
--
-- Per non perdere lo storico né forzare un dato "ora" sul default,
-- questa tabella permette di sovrascrivere la tipologia per (sito,anno).
-- I check di Data Quality usano poi la VIEW sito_tipologia_effettiva
-- per ottenere la tipologia "vera" di un sito in un dato anno
-- (coalesce(override, anagrafiche.tipologia)).
--
-- RLS: ricalca quella di anagrafiche
--   - SELECT: tutti gli authenticated
--   - INSERT/UPDATE: admin oppure editor + MFA aal2
--   - DELETE: solo admin

-- ────────────────────────────────────────────────────────────────────
--  1. Tabella
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.sito_tipologia_override (
  codice_sito  text  not null references public.anagrafiche(codice_sito)
                      on update cascade on delete cascade,
  anno         int   not null check (anno >= 2000 and anno <= 2100),
  tipologia    text  not null check (tipologia in (
                 'Stabilimento produttivo','Magazzino','Logistica','Uffici','Altro'
               )),
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  primary key (codice_sito, anno)
);

create index if not exists sito_tipologia_override_anno_idx
  on public.sito_tipologia_override (anno);

-- ────────────────────────────────────────────────────────────────────
--  2. RLS
-- ────────────────────────────────────────────────────────────────────
alter table public.sito_tipologia_override enable  row level security;
alter table public.sito_tipologia_override force   row level security;

drop policy if exists sito_tipologia_override_select on public.sito_tipologia_override;
create policy sito_tipologia_override_select
  on public.sito_tipologia_override
  for select to authenticated
  using (true);

drop policy if exists sito_tipologia_override_insert on public.sito_tipologia_override;
create policy sito_tipologia_override_insert
  on public.sito_tipologia_override
  for insert to authenticated
  with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'editor'
        and (auth.jwt() ->> 'aal') = 'aal2')
  );

drop policy if exists sito_tipologia_override_update on public.sito_tipologia_override;
create policy sito_tipologia_override_update
  on public.sito_tipologia_override
  for update to authenticated
  using (
    public.current_role() = 'admin'
    or (public.current_role() = 'editor'
        and (auth.jwt() ->> 'aal') = 'aal2')
  )
  with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'editor'
        and (auth.jwt() ->> 'aal') = 'aal2')
  );

drop policy if exists sito_tipologia_override_delete on public.sito_tipologia_override;
create policy sito_tipologia_override_delete
  on public.sito_tipologia_override
  for delete to authenticated
  using (public.current_role() = 'admin');

revoke all  on public.sito_tipologia_override from anon;
grant select, insert, update, delete on public.sito_tipologia_override to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  3. View "tipologia effettiva per (sito, anno)"
--  Per ogni (anagrafica, anno presente in produzione/s1/s2/s3),
--  ritorna la tipologia override se presente, altrimenti il default.
--  Usata dal check Data Quality.
-- ────────────────────────────────────────────────────────────────────
create or replace view public.sito_tipologia_effettiva as
with anni as (
  select distinct anno from public.produzione where anno is not null
  union
  select distinct anno from public.s1 where anno is not null
  union
  select distinct anno from public.s2 where anno is not null
  union
  select distinct anno from public.s3 where anno is not null
)
select
  a.codice_sito,
  y.anno,
  coalesce(o.tipologia, a.tipologia) as tipologia,
  (o.tipologia is not null)         as is_override
from public.anagrafiche a
cross join anni y
left join public.sito_tipologia_override o
       on o.codice_sito = a.codice_sito and o.anno = y.anno;

grant select on public.sito_tipologia_effettiva to authenticated;

-- end of 19_sito_tipologia_override.sql
