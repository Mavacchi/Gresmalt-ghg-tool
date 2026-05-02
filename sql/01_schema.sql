-- ════════════════════════════════════════════════════════════════════
-- 01_schema.sql — GHG Tool · Schema base
-- Gruppo Ceramiche Gresmalt
-- ════════════════════════════════════════════════════════════════════
--
-- Crea le 9 tabelle del modello dati (anagrafiche, produzione, fe,
-- s1, s2, s3, s3_materiality, audit_log, app_meta, client_errors),
-- i trigger di updated_at e di audit con hash chain SHA-256, e la RPC
-- keepalive_ping() chiamata dal cron GitHub Actions.
--
-- Eseguire come superuser sul progetto Supabase, una sola volta in
-- ordine: 01 → 02 → 03 → 04 → 05 → 06.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────────────
--  Helper updated_at
-- ────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- ────────────────────────────────────────────────────────────────────
--  ANAGRAFICHE
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.anagrafiche (
  codice_sito       text primary key,
  nome_sito         text not null,
  tipologia         text,
  presenza_chp      boolean default false,
  regime_ets        boolean default false,
  note_produzione   text,
  created_at        timestamptz default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz default now(),
  updated_by        uuid references auth.users(id)
);

create trigger anagrafiche_set_updated_at
before update on public.anagrafiche
for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────
--  PRODUZIONE  (kg + m² per sito/anno)
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.produzione (
  codice_sito       text not null references public.anagrafiche(codice_sito) on delete restrict,
  anno              int  not null check (anno between 2000 and 2100),
  produzione_kg     numeric check (produzione_kg is null or produzione_kg >= 0),
  produzione_m2     numeric check (produzione_m2 is null or produzione_m2 >= 0),
  note              text,
  created_at        timestamptz default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz default now(),
  updated_by        uuid references auth.users(id),
  primary key (codice_sito, anno),
  check (coalesce(produzione_kg,0) + coalesce(produzione_m2,0) > 0)
);

create trigger produzione_set_updated_at
before update on public.produzione
for each row execute function public.set_updated_at();

create index if not exists produzione_anno_idx on public.produzione(anno);

-- ────────────────────────────────────────────────────────────────────
--  FE — Fattori Emissivi
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.fe (
  id              uuid primary key default gen_random_uuid(),
  fe_id           text,
  famiglia        text,
  codice_voce     text,
  descrizione     text,
  anno_validita   int,
  valore          numeric not null check (valore >= 0),
  unita           text,
  gas             text,
  fonte           text,
  nota            text,
  created_at      timestamptz default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz default now(),
  updated_by      uuid references auth.users(id)
);

create unique index if not exists fe_id_anno_uk
  on public.fe(fe_id, anno_validita) where fe_id is not null;
create index if not exists fe_codice_voce_idx
  on public.fe(codice_voce, anno_validita);
create index if not exists fe_famiglia_idx on public.fe(famiglia);

create trigger fe_set_updated_at
before update on public.fe
for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────
--  S1
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.s1 (
  id              uuid primary key default gen_random_uuid(),
  scope           int not null default 1 check (scope = 1),
  anno            int not null,
  codice_sito     text not null references public.anagrafiche(codice_sito),
  categoria_s1    text,
  combustibile    text,
  quantita        numeric check (quantita is null or quantita >= 0),
  unita           text,
  fonte_dato      text,
  qualita_dato    text check (qualita_dato in ('P','S','E') or qualita_dato is null),
  stato_dato      text check (stato_dato in ('Definitivo','Provvisorio','Stimato') or stato_dato is null),
  note            text,
  fe_valore       numeric,
  em_tco2e        numeric,
  created_at      timestamptz default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz default now(),
  updated_by      uuid references auth.users(id)
);
create index if not exists s1_anno_sito_idx on public.s1(anno, codice_sito);

create trigger s1_set_updated_at
before update on public.s1
for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────
--  S2
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.s2 (
  id               uuid primary key default gen_random_uuid(),
  scope            int not null default 2 check (scope = 2),
  anno             int not null,
  codice_sito      text not null references public.anagrafiche(codice_sito),
  voce_s2          text,
  quantita         numeric check (quantita is null or quantita >= 0),
  unita            text,
  strumento_mb     text,
  fonte_dato       text,
  qualita_dato     text check (qualita_dato in ('P','S','E') or qualita_dato is null),
  stato_dato       text check (stato_dato in ('Definitivo','Provvisorio','Stimato') or stato_dato is null),
  note             text,
  fe_location      numeric,
  fe_market        numeric,
  em_loc_tco2e     numeric,
  em_mkt_tco2e     numeric,
  created_at       timestamptz default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz default now(),
  updated_by       uuid references auth.users(id)
);
create index if not exists s2_anno_sito_idx on public.s2(anno, codice_sito);

create trigger s2_set_updated_at
before update on public.s2
for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────
--  S3
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.s3 (
  id               uuid primary key default gen_random_uuid(),
  scope            int not null default 3 check (scope = 3),
  anno             int not null,
  categoria_s3     int not null check (categoria_s3 between 1 and 15),
  sottocategoria   text,
  metodo           text,
  combustibile     text,
  quantita         numeric check (quantita is null or quantita >= 0),
  unita            text,
  codice_fe        text,
  fonte_dato       text,
  qualita_dato     text check (qualita_dato in ('P','S','E') or qualita_dato is null),
  stato_dato       text check (stato_dato in ('Definitivo','Provvisorio','Stimato') or stato_dato is null),
  note             text,
  fe_valore        numeric,
  em_tco2e         numeric,
  tabella          text default 'Main',
  created_at       timestamptz default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz default now(),
  updated_by       uuid references auth.users(id)
);
create index if not exists s3_anno_cat_idx on public.s3(anno, categoria_s3);

create trigger s3_set_updated_at
before update on public.s3
for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────
--  S3 Materiality (15 categorie)
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.s3_materiality (
  cat_id              int primary key check (cat_id between 1 and 15),
  status              text not null default 'Da valutare'
                       check (status in ('Inclusa','Esclusa','N.A.','Da valutare')),
  justification       text,
  methodological_ref  text,
  review_year         int,
  created_at          timestamptz default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz default now(),
  updated_by          uuid references auth.users(id)
);

create trigger mat_set_updated_at
before update on public.s3_materiality
for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────
--  AUDIT LOG (hash chain)
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id           bigserial primary key,
  ts           timestamptz not null default now(),
  user_id      uuid,
  user_email   text,
  table_name   text not null,
  operation    text not null check (operation in ('INSERT','UPDATE','DELETE')),
  row_id       text,
  old_data     jsonb,
  new_data     jsonb,
  prev_hash    text,
  row_hash     text
);
create index if not exists audit_log_ts_idx on public.audit_log(ts desc);
create index if not exists audit_log_table_idx on public.audit_log(table_name, ts desc);

create or replace function public.audit_hash_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
begin
  select row_hash into v_prev
  from public.audit_log
  order by id desc
  limit 1;

  new.prev_hash := v_prev;
  new.row_hash := encode(
    digest(
      coalesce(v_prev,'') ||
      new.ts::text ||
      new.table_name ||
      new.operation ||
      coalesce(new.new_data::text,'') ||
      coalesce(new.old_data::text,''),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

create trigger audit_log_chain
before insert on public.audit_log
for each row execute function public.audit_hash_chain();

-- ────────────────────────────────────────────────────────────────────
--  Trigger generico write_audit
-- ────────────────────────────────────────────────────────────────────
create or replace function public.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_row_id text;
begin
  select email into v_email
  from auth.users
  where id = auth.uid();

  if (tg_op = 'DELETE') then
    v_row_id := coalesce((to_jsonb(old)->>'id'),
                         (to_jsonb(old)->>'codice_sito'),
                         (to_jsonb(old)->>'cat_id'),
                         (to_jsonb(old)->>'key'));
    insert into public.audit_log
      (user_id, user_email, table_name, operation, row_id, old_data, new_data)
    values
      (auth.uid(), v_email, tg_table_name, tg_op, v_row_id, to_jsonb(old), null);
    return old;
  else
    v_row_id := coalesce((to_jsonb(new)->>'id'),
                         (to_jsonb(new)->>'codice_sito'),
                         (to_jsonb(new)->>'cat_id'),
                         (to_jsonb(new)->>'key'));
    insert into public.audit_log
      (user_id, user_email, table_name, operation, row_id, old_data, new_data)
    values
      (auth.uid(), v_email, tg_table_name, tg_op, v_row_id,
       case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
       to_jsonb(new));
    return new;
  end if;
end;
$$;

-- Aggancio del trigger su 8 tabelle
do $$
declare
  t text;
begin
  for t in select unnest(array['anagrafiche','produzione','fe','s1','s2','s3',
                               's3_materiality','app_meta'])
  loop
    execute format('drop trigger if exists %I_audit on public.%I;', t, t);
    execute format('create trigger %I_audit
                    after insert or update or delete on public.%I
                    for each row execute function public.write_audit();', t, t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────
--  KEEPALIVE PING (chiamato da GitHub Actions)
-- ────────────────────────────────────────────────────────────────────
-- Definita anche in 05_app_meta.sql per garantire le dipendenze;
-- qui solo dichiarazione anticipata commentata.
-- (vedi 05_app_meta.sql per la versione finale)

-- ════════════════════════════════════════════════════════════════════
-- end of 01_schema.sql
-- ════════════════════════════════════════════════════════════════════
