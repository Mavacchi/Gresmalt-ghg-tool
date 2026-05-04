-- ════════════════════════════════════════════════════════════════════
-- 12_update_materiality.sql — Materialità Scope 3 · 15 categorie
--
-- Aggiorna public.s3_materiality coerentemente con il dataset 2024+2025
-- caricato via 09_replace_data_2024_2025.sql:
--
--   Incluse:    1, 2, 3, 4, 5, 6, 7, 9, 12       (9 categorie attive)
--   Escluse:   8, 11                              (2 con motivazione)
--   N.A.:      10, 13, 14                         (3 non applicabili)
--   Da valutare: 15                               (1 in roadmap)
--
-- Ogni riga porta:
--   · justification (perché inclusa/esclusa/N.A./da valutare)
--   · methodological_ref (FE / fonti dati)
--   · review_year (anno di review della materialità: 2026)
--
-- USAGE
--   SQL Editor Supabase, postgres / service_role.
--   Idempotente (UPSERT su cat_id) — può essere rieseguito a ogni
--   review annuale aggiornando review_year.
-- ════════════════════════════════════════════════════════════════════

begin;

insert into public.s3_materiality (cat_id, status, justification, methodological_ref, review_year) values
  ( 1, 'Inclusa',
    'Beni e servizi acquistati: materie prime ceramiche (argille, feldspati, sabbie silicee, fritte/smalti, pigmenti, additivi), imballaggi (cartone, pallet legno, film LDPE, reggette PP) e servizi vari (agenti, lavorazioni esterne, consulenze, altro). Categoria materialmente significativa per un produttore ceramico: rappresenta una quota rilevante delle emissioni Scope 3 totali.',
    'Materie prime + imballaggi: Mass-based con FE da EPD fornitore / ecoinvent / Confindustria Ceramica (kgCO₂e/kg). Servizi: Spend-based con FE EXIOBASE 3.9.x (kgCO₂e/EUR). Volumi e spesa estratti da SAP.',
    2026),

  ( 2, 'Inclusa',
    'Beni capitali: impiantistica e materiali di consumo industriali. Inclusa per coerenza con GHG Protocol (capital goods sono parte della catena del valore upstream).',
    'Spend-based con FE EXIOBASE 3.9.x capital goods (0.25 kgCO₂e/EUR). Spesa estratta da SAP (CAPEX + materiali consumo).',
    2026),

  ( 3, 'Inclusa',
    'Combustibili e attività relative ai consumi energetici (Well-to-Tank): emissioni upstream legate a estrazione, raffinazione, trasporto di gas naturale, gasolio, benzina + WTT elettricità + perdite di trasmissione e distribuzione (T&D). Inclusa per inventario completo dei vettori energetici già rendicontati in Scope 1 e 2.',
    'Activity-based: WTT combustibili applicati alle stesse quantità di Scope 1; WTT elettricità + T&D applicati ai kWh acquistati Scope 2. FE DESNZ/BEIS 2024-2025.',
    2026),

  ( 4, 'Inclusa',
    'Trasporto e distribuzione upstream: spedizioni di materie prime (argille, feldspati, sabbie, fritte/smalti, pigmenti, additivi, packaging) verso gli stabilimenti via strada, ferrovia e nave. Inclusa: la logistica delle materie prime è materialmente rilevante data l''estensione delle origini (estero per via mare).',
    'Distance-based (tkm) con FE DESNZ/BEIS 2024 per modalità: strada HGV medio (0.0755 kgCO₂e/tkm), ferrovia (0.0278), nave bulk (0.0132). Distanze e modalità da dichiarazioni fornitore.',
    2026),

  ( 5, 'Inclusa',
    'Rifiuti operativi: pericolosi e non-pericolosi a discarica o riciclo. Inclusa per copertura completa dei flussi materiali in uscita dagli stabilimenti.',
    'Mass-based (t) con FE proxy: discarica DESNZ/BEIS 2024 commercial+industrial waste landfill (0.5203 kgCO₂e/kg); riciclo cut-off (0.000 kgCO₂e/kg, allocazione recycled-content).',
    2026),

  ( 6, 'Inclusa',
    'Trasferte business: voli, auto a noleggio, hotel. Inclusa per coerenza con la rendicontazione del personale aziendale fuori sede.',
    'Spend-based (EUR) con FE DEFRA Annex E + cambio medio GBP/EUR: voli (2.42 kgCO₂e/EUR), noleggio (0.27), hotel (0.41). Spesa da Note Spese.',
    2026),

  ( 7, 'Inclusa',
    'Pendolarismo dipendenti casa-lavoro. Stimato a partire dalla forza lavoro media (506 dip. 2024, 484 dip. 2025) × distanza media giornaliera (40 km × 220 giorni lavorativi). Inclusa: copre l''impatto indiretto dell''operatività.',
    'Distance-based (km) con FE DESNZ/BEIS proxy auto media (~0.167 kgCO₂e/km). Stima interna basata su forza lavoro × ipotesi standard.',
    2026),

  ( 8, 'Esclusa',
    'Asset in leasing upstream: non significativi. Gli asset operativi rilevanti (stabilimenti, impianti, mezzi pesanti) sono di proprietà o già contabilizzati in Scope 1+2 del gruppo; eventuali noleggi residui (es. attrezzature minori) sono coperti in Cat 1 (servizi spend-based). Esclusione motivata da immateriality + double-counting.',
    null,
    2026),

  ( 9, 'Inclusa',
    'Trasporto e distribuzione downstream: spedizione del prodotto finito (piastrelle) verso clienti in Italia, Europa e mercati transoceanici. Inclusa: rappresenta una quota molto rilevante delle emissioni Scope 3 dato il modello B2B export-oriented del gruppo.',
    'Distance-based (tkm) con FE DESNZ/BEIS 2024-2025: strada HGV medio (0.0755-0.0780 kgCO₂e/tkm), nave (0.0132). Suddiviso per destinazione (Italia, Europa, Export) con quote settoriali (% piastrelle vendute) e distanze medie.',
    2026),

  (10, 'N.A.',
    'Processing of sold products: non applicabile. Le piastrelle ceramiche sono un prodotto finito che non richiede ulteriore lavorazione industriale prima dell''installazione finale.',
    null,
    2026),

  (11, 'Esclusa',
    'Use of sold products: emissioni d''uso trascurabili. Le piastrelle ceramiche sono un prodotto inerte, non consumano energia né emettono gas durante l''uso (life-cycle in opera). Esclusa per immateriality (≈ 0 per design del prodotto).',
    null,
    2026),

  (12, 'Inclusa',
    'Fine vita prodotti venduti: stimato sulla base del mix gestione end-of-life italiano (≈ 30% inerti a discarica, ≈ 70% riciclo come aggregato). Inclusa per chiusura del ciclo di vita.',
    'Mass-based (t) con FE DESNZ/BEIS 2024-2025 proxy aggregati: discarica inerti (0.0012-0.0013 kgCO₂e/kg), riciclo open-loop (0.0010 kgCO₂e/kg). Volumi proporzionali alla produzione annua.',
    2026),

  (13, 'N.A.',
    'Downstream leased assets: non applicabile. Il modello di business B2B di Gresmalt non prevede asset (negozi, showroom, stabilimenti) dati in leasing a terzi.',
    null,
    2026),

  (14, 'N.A.',
    'Franchises: non applicabile. Gresmalt non opera in franchising; i marchi del gruppo sono gestiti internamente.',
    null,
    2026),

  (15, 'Da valutare',
    'Investments: da valutare in funzione del perimetro finanziario del gruppo (partecipazioni, attività finanziarie). Roadmap: review nel ciclo 2026 con il dipartimento Finance per definire metodologia (PCAF) e scope.',
    null,
    2026)

on conflict (cat_id) do update
   set status             = excluded.status,
       justification      = excluded.justification,
       methodological_ref = excluded.methodological_ref,
       review_year        = excluded.review_year;

-- ────────────────────────────────────────────────────────────────────
-- VERIFICA
-- ────────────────────────────────────────────────────────────────────
do $check$
declare
  c_inclusa     int;
  c_esclusa     int;
  c_na          int;
  c_da_valutare int;
begin
  select count(*) into c_inclusa     from public.s3_materiality where status = 'Inclusa';
  select count(*) into c_esclusa     from public.s3_materiality where status = 'Esclusa';
  select count(*) into c_na          from public.s3_materiality where status = 'N.A.';
  select count(*) into c_da_valutare from public.s3_materiality where status = 'Da valutare';
  if c_inclusa <> 9 or c_esclusa <> 2 or c_na <> 3 or c_da_valutare <> 1 then
    raise exception 'Distribuzione materialità inattesa: Inclusa=%, Esclusa=%, N.A.=%, Da valutare=% (atteso 9/2/3/1)',
                    c_inclusa, c_esclusa, c_na, c_da_valutare;
  end if;
  raise notice '✓ Materialità S3 aggiornata · Inclusa=% · Esclusa=% · N.A.=% · Da valutare=%',
               c_inclusa, c_esclusa, c_na, c_da_valutare;
end $check$;

commit;

-- ════════════════════════════════════════════════════════════════════
-- end of 12_update_materiality.sql
-- ════════════════════════════════════════════════════════════════════
