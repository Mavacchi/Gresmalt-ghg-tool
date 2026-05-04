-- ════════════════════════════════════════════════════════════════════
-- 12_update_materiality.sql — Materialità Scope 3 · 15 categorie
--
-- Allineato al dataset 2024+2025 (09_replace_data) e alla Corporate
-- Value Chain (Scope 3) Accounting and Reporting Standard del
-- GHG Protocol (rev. 2013).
--
--   Incluse (9):  1, 2, 3, 4, 5, 6, 7, 9, 12
--   Escluse (3):  8, 11, 15
--   N.A.    (3):  10, 13, 14
--
-- Ogni riga porta:
--   · justification: rationale di materialità + metodologia
--   · methodological_ref: fonti FE, allocation method, dati attività
--   · review_year: 2026 (review annuale del perimetro)
--
-- USAGE
--   SQL Editor Supabase, postgres / service_role.
--   Idempotente (UPSERT su cat_id) — rieseguibile a ogni review
--   aggiornando review_year e i testi.
-- ════════════════════════════════════════════════════════════════════

begin;

insert into public.s3_materiality (cat_id, status, justification, methodological_ref, review_year) values
  ( 1, 'Inclusa',
    'GHGP Cat 1 — Purchased goods and services. Hot-spot del Scope 3 in industria ceramica: copre materie prime di processo (argille, feldspati, sabbie silicee, fritte/smalti, pigmenti, additivi chimici), packaging primario/secondario (cartone, pallet legno, film LDPE, reggette PP) e servizi acquistati (agenti, lavorazioni esterne/acquisto prodotto finito, servizi tecnici, altre voci di costo non capex). Materialità qualitativa+quantitativa: presunta ≥ 30% del totale Scope 3 — soglia di significance triggerata.',
    'Approccio ibrido conforme GHGP Cat 1 hierarchy. Materie prime e packaging: mass-based, FE primari da EPD fornitore quando disponibili, fallback ecoinvent v3.10 cut-off + Confindustria Ceramica per le materie minerali. Servizi: spend-based con FE EXIOBASE 3.9.x mappati su classificazioni IO ITA, spesa monetaria base anno fiscale corrente. Volumi (kg/t) e spend (EUR) estratti da SAP MM/FI.',
    2026),

  ( 2, 'Inclusa',
    'GHGP Cat 2 — Capital goods. Inclusa per integrità di perimetro: impiantistica di processo (linee di pressatura, essiccatoi, forni, smaltatura, scelta) + materiali di consumo a vita pluriennale capitalizzati. La distinzione Cat 1 vs Cat 2 segue il criterio di capitalizzazione contabile (asset register, durata > 1 anno).',
    'Spend-based con FE EXIOBASE 3.9.x capital goods (proxy 0.25 kgCO₂e/EUR), anno monetario coerente con il fiscal year. Spesa estratta da SAP AA (Asset Accounting) + categorie OPEX riconducibili a beni durevoli. Allocation: full upstream cradle-to-gate del bene, non ammortizzata.',
    2026),

  ( 3, 'Inclusa',
    'GHGP Cat 3 — Fuel- and energy-related activities not included in Scope 1 or 2. Comprende WTT (Well-To-Tank) di combustibili stazionari/mobili rendicontati in Scope 1 (gas naturale, gasolio, benzina), WTT della generazione elettrica acquistata (Scope 2) e perdite di trasmissione/distribuzione (T&D) della rete elettrica. Categoria definita dallo Standard come complementare ai vettori energetici di S1/S2.',
    'Activity-based: WTT combustibili applicati alle quantità fisiche di Scope 1 (Sm³, litri); WTT EE + T&D applicati ai kWh di Scope 2. FE DESNZ/BEIS Conversion Factors 2024-2025 (set Annex 11 e 12). Nessun overlap con S1/S2 (FE DESNZ separa esplicitamente combustion da WTT).',
    2026),

  ( 4, 'Inclusa',
    'GHGP Cat 4 — Upstream transportation and distribution. Logistica delle materie prime dal produttore/cava agli stabilimenti del gruppo. Multimodale: strada (truck HGV), ferrovia (rail freight), nave (general cargo bulk) — quota marittima rilevante per argille e feldspati di origine extra-UE. Inclusa: la dispersione geografica delle origini e i tonnellaggi movimentati la rendono materialmente significativa.',
    'Distance-based (tkm = tonnellate × km) per modalità. FE DESNZ/BEIS Conversion Factors 2024-2025: HGV average laden 0.0755-0.0780 kgCO₂e/tkm, rail freight 0.0278, marittimo bulk general cargo 0.0132. Distanze e ripartizione modale ricavate da dichiarazioni fornitore (DDT, packing list, lane analysis).',
    2026),

  ( 5, 'Inclusa',
    'GHGP Cat 5 — Waste generated in operations. Rifiuti di processo prodotti dagli stabilimenti, distinti per pericolosità (CER) e destinazione (discarica vs recupero/riciclo). Inclusa per disclosure compliance ESRS E5 + GRI 306 e per chiusura del bilancio materiali in uscita.',
    'Mass-based (t) con FE DESNZ/BEIS 2024-2025: commercial+industrial waste landfill 0.5203 kgCO₂e/kg per smaltimento; allocation cut-off (0 kgCO₂e/kg) per riciclo open-loop conforme a recycled-content method. Quantità da MUD/SISTRI (Italia) e registri carico/scarico per stabilimento.',
    2026),

  ( 6, 'Inclusa',
    'GHGP Cat 6 — Business travel. Trasferte del personale per attività commerciali, formazione, audit fornitori. Tre voci principali: trasporto aereo, noleggio auto, accommodation (hotel). Inclusa per copertura completa delle attività indirette del personale fuori sede.',
    'Spend-based (EUR) con FE DEFRA Annex E + cambio medio annuo GBP/EUR. Voli 2.42 kgCO₂e/EUR (air transport), noleggio 0.27 kgCO₂e/EUR (proxy renting of machinery), hotel 0.41 kgCO₂e/EUR (hotels-catering-pubs). Spesa estratta dal sistema Note Spese (categorie viaggio).',
    2026),

  ( 7, 'Inclusa',
    'GHGP Cat 7 — Employee commuting. Spostamenti casa-lavoro del personale operativo e impiegatizio. Inclusa per allineamento alle best practice di settore e in coerenza con la rendicontazione GRI 305-3.',
    'Distance-based (km) con stima top-down: 40 km/giorno (proxy distanza media residenza-stabilimento) × 220 giorni lavorativi/anno × headcount medio annuo (506 dip. 2024, 484 dip. 2025). FE DESNZ/BEIS proxy auto media (~0.167 kgCO₂e/km, mix benzina/diesel). Da rifinire con survey modale + remote work share nei prossimi cicli.',
    2026),

  ( 8, 'Esclusa',
    'GHGP Cat 8 — Upstream leased assets. Esclusione motivata da non-applicabilità sostanziale. Gli asset operativi rilevanti (stabilimenti produttivi, impianti, mezzi pesanti aziendali) sono di proprietà del gruppo e già rendicontati in Scope 1+2 (financial control approach). Eventuali noleggi residuali di attrezzature minori sono catturati in Cat 1 sotto la voce servizi (spend-based) → escludere qui evita double-counting.',
    null,
    2026),

  ( 9, 'Inclusa',
    'GHGP Cat 9 — Downstream transportation and distribution. Distribuzione del prodotto finito (piastrelle ceramiche) ai clienti B2B. Tre flussi: Italia (truck domestico ≈ 27t cap.), Europa (truck internazionale), Export extra-UE (transoceanico). Hot-spot del Scope 3: il modello export-oriented del gruppo amplifica le tkm percorse per unità di prodotto.',
    'Distance-based (tkm) con FE DESNZ/BEIS 2024-2025: truck average laden 0.0755-0.0780, marittimo 0.0132 kgCO₂e/tkm. Tonnellaggi spediti × distanze medie per macro-area di destinazione (% piastrelle vendute × distanza tipica del lane). Dato attività SAP SD per i tonnellaggi, mix geografico da CRM/ordini.',
    2026),

  (10, 'N.A.',
    'GHGP Cat 10 — Processing of sold products. Non applicabile: le piastrelle ceramiche sono un prodotto finito ready-to-install. Nessun intermediate processing è richiesto al cliente B2B (rivenditore o posatore) prima dell''uso finale. Documentazione: schede tecniche di prodotto + EPD certificati ISO 14025 attestano lo stato finished-good.',
    null,
    2026),

  (11, 'Esclusa',
    'GHGP Cat 11 — Use of sold products. Esclusione motivata da emissioni d''uso trascurabili (≈ 0 kgCO₂e/unità funzionale per la vita utile del prodotto). Le piastrelle sono un prodotto inerte, non funzionalmente energetico: non consumano carburante, non emettono GHG durante la fase d''uso (life-cycle stage B per EN 15978). Soglia di significance non raggiunta.',
    null,
    2026),

  (12, 'Inclusa',
    'GHGP Cat 12 — End-of-life treatment of sold products. Trattamento a fine vita delle piastrelle vendute. Inclusa per chiusura del life-cycle cradle-to-grave conforme a EN 15978 (life-cycle stage C). Mix di gestione assunto in linea con statistiche italiane di gestione rifiuti edili: ≈ 30% inerti a discarica, ≈ 70% recupero come aggregato (riciclo open-loop).',
    'Mass-based (t) con FE DESNZ/BEIS 2024-2025 proxy aggregati: discarica inerti 0.0012-0.0013 kgCO₂e/kg (waste landfill aggregates), riciclo open-loop 0.0010 kgCO₂e/kg (allocation cut-off, no expansion). Tonnellaggi end-of-life proporzionali alla produzione annua (ipotesi steady-state vita utile).',
    2026),

  (13, 'N.A.',
    'GHGP Cat 13 — Downstream leased assets. Non applicabile: il modello di business B2B di Gresmalt non prevede asset (showroom, magazzini, stabilimenti) concessi in leasing/locazione a terze parti. Tutta la value chain a valle è transactional (vendita prodotto), non rental.',
    null,
    2026),

  (14, 'N.A.',
    'GHGP Cat 14 — Franchises. Non applicabile: il gruppo non opera in franchising. I brand commerciali del portafoglio sono gestiti internamente (proprietà + controllo operativo); assenza di franchisor-franchisee relationship.',
    null,
    2026),

  (15, 'Esclusa',
    'GHGP Cat 15 — Investments. Esclusione preliminare per il ciclo 2025: il perimetro finanziario rilevante (partecipazioni di controllo, joint venture) è già consolidato in Scope 1+2 del gruppo via financial-control boundary; le attività finanziarie residuali (cassa, partecipazioni minoritarie non operative) hanno significance trascurabile rispetto al totale Scope 3. Reinclusione condizionata a futura adozione metodologia PCAF (Partnership for Carbon Accounting Financials) se richiesta da framework di reporting (es. CSRD/ESRS) o da disclosure volontaria.',
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
  if c_inclusa <> 9 or c_esclusa <> 3 or c_na <> 3 or c_da_valutare <> 0 then
    raise exception 'Distribuzione materialità inattesa: Inclusa=%, Esclusa=%, N.A.=%, Da valutare=% (atteso 9/3/3/0)',
                    c_inclusa, c_esclusa, c_na, c_da_valutare;
  end if;
  raise notice '✓ Materialità S3 aggiornata · Inclusa=% · Esclusa=% · N.A.=% · Da valutare=%',
               c_inclusa, c_esclusa, c_na, c_da_valutare;
end $check$;

commit;

-- ════════════════════════════════════════════════════════════════════
-- end of 12_update_materiality.sql
-- ════════════════════════════════════════════════════════════════════
