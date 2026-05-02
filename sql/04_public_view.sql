-- ════════════════════════════════════════════════════════════════════
-- 04_public_view.sql — Vista pubblica per Faccia A (clienti)
-- ════════════════════════════════════════════════════════════════════
--
-- Crea:
--   · public_facts                 vista materializzata aggregata
--   · refresh_public_facts()       trigger di refresh on-write
--   · get_public_dashboard(int)    RPC unica per il client anonimo
--   · s3_materiality_public        vista filtrata (cat_id, status)
--
-- IMPORTANTE: la materialized view NON espone total_kg né total_m2,
-- solo i due rapporti di intensità. site_pct contiene percentuali (0–100).
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
--  PUBLIC FACTS (vista materializzata)
-- ────────────────────────────────────────────────────────────────────
drop materialized view if exists public.public_facts cascade;

create materialized view public.public_facts as
with
  years as (
    select distinct anno from (
      select anno from public.s1
      union all select anno from public.s2
      union all select anno from public.s3
      union all select anno from public.produzione
    ) y where anno is not null
  ),
  s1_y as (
    select anno, codice_sito,
           sum(coalesce(em_tco2e,0)) as em
    from public.s1 group by anno, codice_sito
  ),
  s2_y as (
    select anno, codice_sito,
           sum(coalesce(em_loc_tco2e,0)) as em_loc,
           sum(coalesce(em_mkt_tco2e,0)) as em_mkt
    from public.s2 group by anno, codice_sito
  ),
  s3_y as (
    select anno, categoria_s3,
           sum(coalesce(em_tco2e,0)) as em
    from public.s3 group by anno, categoria_s3
  ),
  prod_y as (
    select anno,
           sum(coalesce(produzione_kg,0)) as total_kg,
           sum(coalesce(produzione_m2,0)) as total_m2
    from public.produzione group by anno
  ),
  go_cov as (
    -- copertura % di GO sul totale kWh acquistati
    select anno,
           case when sum(quantita) > 0
             then 100.0 * sum(case when voce_s2 = 'EE_Acquistata_GO'
                                   then quantita else 0 end)
                  / sum(quantita)
             else 0 end as pct
    from public.s2 where unita = 'kWh' group by anno
  ),
  totals as (
    select y.anno,
           coalesce((select sum(em)     from s1_y where anno = y.anno),0) as s1_total,
           coalesce((select sum(em_loc) from s2_y where anno = y.anno),0) as s2_lb_total,
           coalesce((select sum(em_mkt) from s2_y where anno = y.anno),0) as s2_mb_total,
           coalesce((select sum(em)     from s3_y where anno = y.anno),0) as s3_total
    from years y
  )
select
  y.anno,
  (t.s1_total + t.s2_lb_total + t.s3_total) as em_tco2e_total,
  jsonb_build_object(
    's1',    t.s1_total,
    's2_lb', t.s2_lb_total,
    's2_mb', t.s2_mb_total,
    's3',    t.s3_total
  ) as em_per_scope,
  coalesce(
    (select jsonb_object_agg(categoria_s3::text, em)
       from s3_y where anno = y.anno),
    '{}'::jsonb
  ) as s3_breakdown,
  coalesce(
    (select jsonb_object_agg(
              codice_sito,
              case
                when (t.s1_total + t.s2_lb_total) > 0
                  then round(100.0 * (s1_y.em + s2_y.em_loc)
                              / (t.s1_total + t.s2_lb_total), 2)
                else 0
              end)
       from s1_y full outer join s2_y using (anno, codice_sito)
       where coalesce(s1_y.anno, s2_y.anno) = y.anno),
    '{}'::jsonb
  ) as site_pct,
  coalesce((select pct from go_cov where anno = y.anno),0) as go_coverage_pct,

  -- Intensità (i denominatori NON vengono esposti nella MV)
  case
    when (select total_kg from prod_y where anno = y.anno) > 0
      then ((t.s1_total + t.s2_lb_total + t.s3_total) * 1000.0 * 1000.0)
           / (select total_kg from prod_y where anno = y.anno)
    else null
  end as intensity_per_kg,

  case
    when (select total_m2 from prod_y where anno = y.anno) > 0
      then ((t.s1_total + t.s2_lb_total + t.s3_total) * 1000.0)
           / (select total_m2 from prod_y where anno = y.anno)
    else null
  end as intensity_per_m2,

  now() as refresh_ts
from years y
join totals t on t.anno = y.anno
where y.anno is not null;

create unique index public_facts_anno_idx on public.public_facts(anno);

-- ────────────────────────────────────────────────────────────────────
--  Refresh on-write
-- ────────────────────────────────────────────────────────────────────
create or replace function public.refresh_public_facts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.public_facts;
  return null;
exception
  when others then
    -- fallback (es. prima ricostruzione: niente unique snapshot)
    refresh materialized view public.public_facts;
    return null;
end;
$$;

do $$
declare t text;
begin
  for t in select unnest(array['s1','s2','s3','produzione']) loop
    execute format('drop trigger if exists %I_refresh on public.%I;', t, t);
    execute format('create trigger %I_refresh
                    after insert or update or delete on public.%I
                    for each statement
                    execute function public.refresh_public_facts();', t, t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────
--  RPC pubblica
-- ────────────────────────────────────────────────────────────────────
create or replace function public.get_public_dashboard(p_year int)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select row_to_json(f) from public.public_facts f where anno = p_year;
$$;

create or replace function public.list_public_years()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(anno order by anno desc), '[]'::json)
    from public.public_facts;
$$;

grant select on public.public_facts                        to anon;
grant execute on function public.get_public_dashboard(int) to anon;
grant execute on function public.list_public_years()       to anon;

-- ────────────────────────────────────────────────────────────────────
--  Materialità — vista pubblica (cat_id, status)
-- ────────────────────────────────────────────────────────────────────
create or replace view public.s3_materiality_public as
  select cat_id, status from public.s3_materiality;

grant select on public.s3_materiality_public to anon;

-- ────────────────────────────────────────────────────────────────────
--  Refresh iniziale
-- ────────────────────────────────────────────────────────────────────
refresh materialized view public.public_facts;

-- ────────────────────────────────────────────────────────────────────
--  TEST DI NO-LEAK / SELF-CHECK
-- ────────────────────────────────────────────────────────────────────
do $$
begin
  -- 1) site_pct deve contenere percentuali (0..100), non valori assoluti
  if exists (
    select 1 from public.public_facts,
                 jsonb_each_text(site_pct) s
    where (s.value)::numeric > 100
  ) then
    raise exception 'site_pct deve contenere percentuali (0..100), non valori assoluti';
  end if;

  -- 2) public_facts NON deve esporre total_kg né total_m2
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'public_facts'
      and column_name in ('total_kg','total_m2')
  ) then
    raise exception 'public_facts non deve esporre volumi assoluti di produzione';
  end if;

  -- 3) intensity_per_kg e intensity_per_m2 devono essere presenti
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'public_facts'
      and column_name in ('intensity_per_kg','intensity_per_m2')
  ) then
    raise exception 'public_facts deve esporre intensity_per_kg e intensity_per_m2';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- end of 04_public_view.sql
-- ════════════════════════════════════════════════════════════════════
