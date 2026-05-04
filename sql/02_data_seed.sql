-- ════════════════════════════════════════════════════════════════════
-- 02_data_seed.sql — Dati di partenza
-- 7 anagrafiche · 74 FE · 31 S1 · 15 S2 · ~95 S3 · 0 produzione (Opzione B)
--
-- Configurazione confermata dal cliente:
--   · Tipologie siti:
--       IANO              Stabilimento (CHP, ETS)
--       VIANO             Stabilimento (CHP, ETS)
--       VIANO_GARGOLA     Stabilimento (no CHP, no ETS)
--       FRASSINORO        Stabilimento (no CHP, no ETS)
--       SASSUOLO          Stabilimento (CHP, ETS)
--       FIORANO           Magazzino (no CHP, no ETS)
--       CASALGRANDE       Logistica (no CHP, no ETS)
--   · Anni inventario:        2024 + 2025
--   · Produzione (kg/m²):     vuota — sarà popolata da GUI dopo il deploy
--   · Categorie S3 incluse:   1, 2, 3, 4, 5, 6, 7, 9, 12
--   · FE iniziale:            74 FE plausibili (ISPRA/AIB/DEFRA/ecoinvent)
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
--  ANAGRAFICHE — 7 siti del gruppo
-- ────────────────────────────────────────────────────────────────────
insert into public.anagrafiche (codice_sito, nome_sito, tipologia, presenza_chp, regime_ets, note_produzione) values
  ('IANO',           'Stabilimento Iano',            'Stabilimento', true,  true,  'Pressatura e cottura'),
  ('VIANO',          'Stabilimento Viano',           'Stabilimento', true,  true,  'Pressatura, smaltatura, cottura'),
  ('VIANO_GARGOLA',  'Viano Gargola',                'Stabilimento', false, false, 'Smaltatura'),
  ('FRASSINORO',     'Stabilimento Frassinoro',      'Stabilimento', false, false, 'Pressatura e cottura'),
  ('SASSUOLO',       'Stabilimento Sassuolo',        'Stabilimento', true,  true,  'Cottura e selezione'),
  ('FIORANO',        'Stabilimento Fiorano',         'Magazzino',    false, false, 'Magazzino prodotto finito'),
  ('CASALGRANDE',    'Stabilimento Casalgrande',     'Logistica',    false, false, 'Magazzino e spedizioni')
on conflict (codice_sito) do nothing;

-- ────────────────────────────────────────────────────────────────────
--  PRODUZIONE — Opzione B
--  Nessuna riga seed: l'utente popola Produzione_kg e Produzione_m2
--  per (sito, anno) dalla sezione Gestione Dati > Produzione dopo il
--  deploy. Finché manca, le KPI di intensità mostrano "n.d." con il
--  link "Vai a Gestione Dati / Produzione".
--
--  (Quando si avranno i dati reali, basterà:
--   insert into public.produzione (codice_sito, anno, produzione_kg, produzione_m2)
--   values ('IANO', 2024, X, Y), ...
--   on conflict (codice_sito, anno) do update
--     set produzione_kg = excluded.produzione_kg,
--         produzione_m2 = excluded.produzione_m2;
--  )
-- ────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────
--  FE — 74 fattori emissivi plausibili (Opzione A)
--  Famiglie: combustibili (ISPRA), elettricità (ISPRA/AIB), WTT (DEFRA),
--  materiali (ecoinvent/EPD), trasporti (DEFRA), rifiuti (ISPRA).
--  Vanno verificati con le fonti aggiornate prima del consolidamento.
-- ────────────────────────────────────────────────────────────────────
insert into public.fe (fe_id, famiglia, codice_voce, descrizione, anno_validita, valore, unita, gas, fonte, nota) values
  -- Combustibili
  ('FE_GN_2024',         'Combustibili', 'Gas_Naturale',     'Gas naturale combustione',         2024, 1.984,    'kgCO2e/Sm3',   'CO2e', 'ISPRA 2024',     null),
  ('FE_GN_2025',         'Combustibili', 'Gas_Naturale',     'Gas naturale combustione',         2025, 1.978,    'kgCO2e/Sm3',   'CO2e', 'ISPRA 2025',     null),
  ('FE_GPL_2024',        'Combustibili', 'GPL',              'GPL combustione',                  2024, 1.612,    'kgCO2e/kg',    'CO2e', 'ISPRA 2024',     null),
  ('FE_GPL_2025',        'Combustibili', 'GPL',              'GPL combustione',                  2025, 1.610,    'kgCO2e/kg',    'CO2e', 'ISPRA 2025',     null),
  ('FE_GASOLIO_2024',    'Combustibili', 'Gasolio',          'Gasolio per riscaldamento',        2024, 2.624,    'kgCO2e/L',     'CO2e', 'ISPRA 2024',     null),
  ('FE_GASOLIO_2025',    'Combustibili', 'Gasolio',          'Gasolio per riscaldamento',        2025, 2.620,    'kgCO2e/L',     'CO2e', 'ISPRA 2025',     null),
  ('FE_BENZINA_2024',    'Combustibili', 'Benzina',          'Benzina autotrazione',             2024, 2.211,    'kgCO2e/L',     'CO2e', 'ISPRA 2024',     null),
  ('FE_BENZINA_2025',    'Combustibili', 'Benzina',          'Benzina autotrazione',             2025, 2.211,    'kgCO2e/L',     'CO2e', 'ISPRA 2025',     null),
  ('FE_OLIO_2024',       'Combustibili', 'Olio_Combustibile','Olio combustibile pesante',        2024, 3.135,    'kgCO2e/kg',    'CO2e', 'ISPRA 2024',     null),
  ('FE_BIOMASSA_2024',   'Combustibili', 'Biomassa',         'Biomassa legnosa',                 2024, 0.025,    'kgCO2e/kg',    'CO2e', 'ISPRA 2024',     'Biogenica esclusa'),
  ('FE_FUGITIVI_2024',   'Combustibili', 'F_Gas_R410A',      'Refrigerante R410A',               2024, 2088.0,   'kgCO2e/kg',    'GWP',  'IPCC AR5',       'GWP100'),
  ('FE_FUGITIVI_2025',   'Combustibili', 'F_Gas_R410A',      'Refrigerante R410A',               2025, 2088.0,   'kgCO2e/kg',    'GWP',  'IPCC AR5',       null),
  ('FE_GASOLIO_AGRIC_2024','Combustibili','Gasolio_Agricolo','Gasolio agricolo',                 2024, 2.624,    'kgCO2e/L',     'CO2e', 'ISPRA 2024',     null),
  ('FE_BIODIESEL_2024',  'Combustibili', 'Biodiesel',        'Biodiesel B100',                   2024, 0.087,    'kgCO2e/L',     'CO2e', 'DEFRA 2024',     'Biogenica'),
  ('FE_BIOGAS_2024',     'Combustibili', 'Biogas',           'Biogas combustione',               2024, 0.020,    'kgCO2e/Sm3',   'CO2e', 'DEFRA 2024',     'Biogenica'),
  ('FE_BIO_NEUT_2024',   'Combustibili', 'Bio_Neutrale',     'Componente biogenica neutra',      2024, 0.000,    'kgCO2e/kg',    'CO2e', 'GHG Protocol',   null),

  -- Elettricità
  ('FE_EE_LB_IT_2024',   'Elettricità',  'EE_Acquistata',          'Energia elettrica IT — location-based',  2024, 0.288, 'kgCO2e/kWh', 'CO2e', 'ISPRA Terna 2024',  'Mix nazionale'),
  ('FE_EE_LB_IT_2025',   'Elettricità',  'EE_Acquistata',          'Energia elettrica IT — location-based',  2025, 0.272, 'kgCO2e/kWh', 'CO2e', 'ISPRA Terna 2025',  'Mix nazionale'),
  ('FE_EE_MB_IT_2024',   'Elettricità',  'EE_Acquistata_MarketB',  'Energia elettrica IT — market-based',    2024, 0.461, 'kgCO2e/kWh', 'CO2e', 'AIB Residual 2024', 'Residual mix'),
  ('FE_EE_MB_IT_2025',   'Elettricità',  'EE_Acquistata_MarketB',  'Energia elettrica IT — market-based',    2025, 0.452, 'kgCO2e/kWh', 'CO2e', 'AIB Residual 2025', 'Residual mix'),
  ('FE_EE_GO_2024',      'Elettricità',  'EE_Acquistata_GO',       'Energia elettrica con Garanzia di Origine', 2024, 0.000, 'kgCO2e/kWh', 'CO2e', 'GO certificate',  'GO 100% rinnovabile'),
  ('FE_EE_GO_2025',      'Elettricità',  'EE_Acquistata_GO',       'Energia elettrica con Garanzia di Origine', 2025, 0.000, 'kgCO2e/kWh', 'CO2e', 'GO certificate',  null),
  ('FE_TELERISC_2024',   'Elettricità',  'Teleriscaldamento',      'Teleriscaldamento medio IT',             2024, 0.231, 'kgCO2e/kWh', 'CO2e', 'ISPRA 2024',        null),
  ('FE_TELERISC_2025',   'Elettricità',  'Teleriscaldamento',      'Teleriscaldamento medio IT',             2025, 0.225, 'kgCO2e/kWh', 'CO2e', 'ISPRA 2025',        null),
  ('FE_VAPORE_2024',     'Elettricità',  'Vapore_Acquistato',      'Vapore industriale',                     2024, 0.245, 'kgCO2e/kWh', 'CO2e', 'EPD media',         null),

  -- WTT
  ('FE_WTT_GN_2024',     'WTT', 'WTT_Gas_Naturale', 'WTT gas naturale',         2024, 0.388, 'kgCO2e/Sm3',  'CO2e', 'DEFRA 2024', null),
  ('FE_WTT_GN_2025',     'WTT', 'WTT_Gas_Naturale', 'WTT gas naturale',         2025, 0.385, 'kgCO2e/Sm3',  'CO2e', 'DEFRA 2025', null),
  ('FE_WTT_GASOLIO_2024','WTT', 'WTT_Gasolio',      'WTT gasolio',              2024, 0.612, 'kgCO2e/L',    'CO2e', 'DEFRA 2024', null),
  ('FE_WTT_GASOLIO_2025','WTT', 'WTT_Gasolio',      'WTT gasolio',              2025, 0.609, 'kgCO2e/L',    'CO2e', 'DEFRA 2025', null),
  ('FE_WTT_BENZINA_2024','WTT', 'WTT_Benzina',      'WTT benzina',              2024, 0.515, 'kgCO2e/L',    'CO2e', 'DEFRA 2024', null),
  ('FE_WTT_GPL_2024',    'WTT', 'WTT_GPL',          'WTT GPL',                  2024, 0.213, 'kgCO2e/kg',   'CO2e', 'DEFRA 2024', null),
  ('FE_WTT_OLIO_2024',   'WTT', 'WTT_Olio',         'WTT olio combustibile',    2024, 0.572, 'kgCO2e/kg',   'CO2e', 'DEFRA 2024', null),
  ('FE_WTT_EE_IT_2024',  'WTT', 'WTT_EE',           'WTT energia elettrica IT', 2024, 0.063, 'kgCO2e/kWh',  'CO2e', 'DEFRA 2024', null),
  ('FE_WTT_EE_IT_2025',  'WTT', 'WTT_EE',           'WTT energia elettrica IT', 2025, 0.060, 'kgCO2e/kWh',  'CO2e', 'DEFRA 2025', null),
  ('FE_TD_EE_IT_2024',   'WTT', 'TD_Loss_EE',       'Perdite di rete EE IT',    2024, 0.018, 'kgCO2e/kWh',  'CO2e', 'ISPRA 2024', null),
  ('FE_TD_EE_IT_2025',   'WTT', 'TD_Loss_EE',       'Perdite di rete EE IT',    2025, 0.017, 'kgCO2e/kWh',  'CO2e', 'ISPRA 2025', null),

  -- Materiali
  ('FE_ARGILLA_2024',    'Materiali', 'Argilla',          'Argilla cruda',                2024, 0.054, 'kgCO2e/kg', 'CO2e', 'ecoinvent 3.10', null),
  ('FE_ARGILLA_2025',    'Materiali', 'Argilla',          'Argilla cruda',                2025, 0.052, 'kgCO2e/kg', 'CO2e', 'ecoinvent 3.11', null),
  ('FE_FELDSPATO_2024',  'Materiali', 'Feldspato',        'Feldspato',                    2024, 0.042, 'kgCO2e/kg', 'CO2e', 'ecoinvent 3.10', null),
  ('FE_SABBIA_2024',     'Materiali', 'Sabbia',           'Sabbia silicea',               2024, 0.016, 'kgCO2e/kg', 'CO2e', 'ecoinvent 3.10', null),
  ('FE_TALCO_2024',      'Materiali', 'Talco',            'Talco',                        2024, 0.085, 'kgCO2e/kg', 'CO2e', 'ecoinvent 3.10', null),
  ('FE_CARBONATO_2024',  'Materiali', 'Carbonato_Ca',     'Carbonato di calcio',          2024, 0.041, 'kgCO2e/kg', 'CO2e', 'ecoinvent 3.10', null),
  ('FE_SMALTO_2024',     'Materiali', 'Smalto',           'Smalto ceramico',              2024, 1.620, 'kgCO2e/kg', 'CO2e', 'EPD media',      null),
  ('FE_SMALTO_2025',     'Materiali', 'Smalto',           'Smalto ceramico',              2025, 1.610, 'kgCO2e/kg', 'CO2e', 'EPD media',      null),
  ('FE_INK_2024',        'Materiali', 'Inchiostri',       'Inchiostri ceramici digitali', 2024, 4.350, 'kgCO2e/kg', 'CO2e', 'EPD fornitore',  null),
  ('FE_CARTONE_2024',    'Materiali', 'Cartone',          'Cartone imballaggio',          2024, 0.819, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024',     null),
  ('FE_CARTONE_2025',    'Materiali', 'Cartone',          'Cartone imballaggio',          2025, 0.815, 'kgCO2e/kg', 'CO2e', 'DEFRA 2025',     null),
  ('FE_LEGNO_PALLET_2024','Materiali','Pallet_Legno',     'Pallet legno EPAL',            2024, 0.224, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024',     null),
  ('FE_FILM_PE_2024',    'Materiali', 'Film_PE',          'Film polietilene',             2024, 2.541, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024',     null),
  ('FE_REGGIATTA_2024',  'Materiali', 'Reggia_PP',        'Reggia polipropilene',         2024, 1.978, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024',     null),
  ('FE_ACQUA_2024',      'Materiali', 'Acqua_Industriale','Acqua industriale',            2024, 0.000344, 'kgCO2e/L', 'CO2e', 'ecoinvent 3.10',null),
  ('FE_LUBRIF_2024',     'Materiali', 'Lubrificanti',     'Oli lubrificanti',             2024, 0.964, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024',     null),
  ('FE_GUARNIZIONI_2024','Materiali', 'Guarnizioni',      'Guarnizioni gomma',            2024, 3.510, 'kgCO2e/kg', 'CO2e', 'EPD media',      null),
  ('FE_CARBURO_2024',    'Materiali', 'Carburo_Si',       'Carburo di silicio',           2024, 4.250, 'kgCO2e/kg', 'CO2e', 'EPD media',      null),

  -- Trasporti
  ('FE_TRUCK_HGV_2024',  'Trasporti', 'Trasporto_HGV',    'Camion >32t',                      2024, 0.107, 'kgCO2e/tkm', 'CO2e', 'DEFRA 2024', null),
  ('FE_TRUCK_HGV_2025',  'Trasporti', 'Trasporto_HGV',    'Camion >32t',                      2025, 0.105, 'kgCO2e/tkm', 'CO2e', 'DEFRA 2025', null),
  ('FE_TRUCK_LGV_2024',  'Trasporti', 'Trasporto_LGV',    'Furgone <3.5t',                    2024, 0.798, 'kgCO2e/tkm', 'CO2e', 'DEFRA 2024', null),
  ('FE_TRUCK_LGV_2025',  'Trasporti', 'Trasporto_LGV',    'Furgone <3.5t',                    2025, 0.795, 'kgCO2e/tkm', 'CO2e', 'DEFRA 2025', null),
  ('FE_RAIL_2024',       'Trasporti', 'Trasporto_Treno',  'Treno cargo IT',                   2024, 0.028, 'kgCO2e/tkm', 'CO2e', 'DEFRA 2024', null),
  ('FE_SHIP_BULK_2024',  'Trasporti', 'Trasporto_Bulk',   'Nave bulk container 20.000 TEU',   2024, 0.013, 'kgCO2e/tkm', 'CO2e', 'DEFRA 2024', null),
  ('FE_SHIP_RORO_2024',  'Trasporti', 'Trasporto_RoRo',   'Nave Ro-Ro',                       2024, 0.034, 'kgCO2e/tkm', 'CO2e', 'DEFRA 2024', null),
  ('FE_AIR_LH_2024',     'Trasporti', 'Trasporto_Aereo',  'Aereo cargo long-haul',            2024, 0.832, 'kgCO2e/tkm', 'CO2e', 'DEFRA 2024', null),
  ('FE_BUSINESS_CAR_2024','Trasporti','Auto_Aziendale',   'Auto aziendale media',             2024, 0.171, 'kgCO2e/km',  'CO2e', 'DEFRA 2024', null),
  ('FE_BUSINESS_CAR_2025','Trasporti','Auto_Aziendale',   'Auto aziendale media',             2025, 0.168, 'kgCO2e/km',  'CO2e', 'DEFRA 2025', null),
  ('FE_TRAIN_PAX_2024',  'Trasporti', 'Treno_Passeggeri', 'Treno passeggeri',                 2024, 0.035, 'kgCO2e/km',  'CO2e', 'DEFRA 2024', null),
  ('FE_PLANE_PAX_LH_2024','Trasporti','Aereo_LH',         'Aereo passeggeri long-haul',       2024, 0.146, 'kgCO2e/km',  'CO2e', 'DEFRA 2024', null),
  ('FE_PLANE_PAX_SH_2024','Trasporti','Aereo_SH',         'Aereo passeggeri short-haul',      2024, 0.156, 'kgCO2e/km',  'CO2e', 'DEFRA 2024', null),
  ('FE_HOTEL_NIGHT_2024','Trasporti', 'Hotel_Notte',      'Pernottamento hotel IT',           2024, 9.940, 'kgCO2e/notte','CO2e','DEFRA 2024', null),
  ('FE_NOLEGGIO_AUTO_2024','Trasporti','Noleggio_Auto',   'Noleggio auto / giorno',           2024, 6.300, 'kgCO2e/giorno','CO2e','DEFRA 2024',null),

  -- Rifiuti
  ('FE_RIF_RACCOLTA_2024','Rifiuti', 'Rifiuti_Raccolta', 'Raccolta indifferenziata',          2024, 0.021, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024', null),
  ('FE_RIF_RICICLO_2024', 'Rifiuti', 'Rifiuti_Riciclo',  'Riciclo materia',                   2024, 0.022, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024', null),
  ('FE_RIF_RICICLO_2025', 'Rifiuti', 'Rifiuti_Riciclo',  'Riciclo materia',                   2025, 0.022, 'kgCO2e/kg', 'CO2e', 'DEFRA 2025', null),
  ('FE_RIF_LANDFILL_2024','Rifiuti', 'Rifiuti_Discarica','Discarica rifiuti misti',           2024, 0.470, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024', null),
  ('FE_RIF_LANDFILL_2025','Rifiuti', 'Rifiuti_Discarica','Discarica rifiuti misti',           2025, 0.467, 'kgCO2e/kg', 'CO2e', 'DEFRA 2025', null),
  ('FE_RIF_INCEN_ER_2024','Rifiuti', 'Rifiuti_Termo_ER', 'Termovalorizzazione con recupero',  2024, 0.018, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024', null),
  ('FE_RIF_INCEN_2024',   'Rifiuti', 'Rifiuti_Termo',    'Incenerimento senza recupero',      2024, 0.230, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024', null),
  ('FE_RIF_COMPOST_2024', 'Rifiuti', 'Rifiuti_Compost',  'Compostaggio organico',             2024, 0.011, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024', null),
  ('FE_RIF_INERTI_2024',  'Rifiuti', 'Rifiuti_Inerti',   'Inerti recuperati',                 2024, 0.008, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024', null),
  ('FE_RIF_PERICOL_2024', 'Rifiuti', 'Rifiuti_Pericolosi','Pericolosi trattamento',           2024, 1.253, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024', null),
  ('FE_FANGHI_2024',      'Rifiuti', 'Fanghi',           'Fanghi industriali',                2024, 0.092, 'kgCO2e/kg', 'CO2e', 'DEFRA 2024', null)
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────
--  S1 — 31 righe (combustione + fugitivi)
-- ────────────────────────────────────────────────────────────────────
insert into public.s1
  (anno, codice_sito, categoria_s1, combustibile, quantita, unita, fonte_dato, qualita_dato, stato_dato, note, fe_valore, em_tco2e) values
  -- IANO 2024
  (2024, 'IANO',          'Combustione_Stazionaria', 'Gas_Naturale',  18450000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.984, 18450000*1.984/1000),
  (2024, 'IANO',          'Combustione_Stazionaria', 'GPL',              25000, 'kg',  'Bolletta',   'P', 'Definitivo', null, 1.612, 25000*1.612/1000),
  (2024, 'IANO',          'Combustione_Mobile',      'Gasolio',          78000, 'L',   'Cardlog',    'P', 'Definitivo', null, 2.624, 78000*2.624/1000),
  (2024, 'IANO',          'Fugitivi',                'F_Gas_R410A',         42, 'kg',  'Manutenzione','P','Definitivo', null, 2088,  42*2088/1000),
  -- VIANO 2024
  (2024, 'VIANO',         'Combustione_Stazionaria', 'Gas_Naturale',  12780000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.984, 12780000*1.984/1000),
  (2024, 'VIANO',         'Combustione_Stazionaria', 'GPL',              18500, 'kg',  'Bolletta',   'P', 'Definitivo', null, 1.612, 18500*1.612/1000),
  (2024, 'VIANO',         'Combustione_Mobile',      'Gasolio',          54300, 'L',   'Cardlog',    'P', 'Definitivo', null, 2.624, 54300*2.624/1000),
  (2024, 'VIANO',         'Fugitivi',                'F_Gas_R410A',         28, 'kg',  'Manutenzione','P','Definitivo', null, 2088,  28*2088/1000),
  -- VIANO_GARGOLA 2024
  (2024, 'VIANO_GARGOLA', 'Combustione_Stazionaria', 'Gas_Naturale',   2840000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.984, 2840000*1.984/1000),
  (2024, 'VIANO_GARGOLA', 'Combustione_Mobile',      'Gasolio',          12400, 'L',   'Cardlog',    'P', 'Definitivo', null, 2.624, 12400*2.624/1000),
  -- FRASSINORO 2024
  (2024, 'FRASSINORO',    'Combustione_Stazionaria', 'Gas_Naturale',   4250000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.984, 4250000*1.984/1000),
  (2024, 'FRASSINORO',    'Combustione_Mobile',      'Gasolio',          18500, 'L',   'Cardlog',    'P', 'Definitivo', null, 2.624, 18500*2.624/1000),
  -- SASSUOLO 2024
  (2024, 'SASSUOLO',      'Combustione_Stazionaria', 'Gas_Naturale',   9420000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.984, 9420000*1.984/1000),
  (2024, 'SASSUOLO',      'Combustione_Mobile',      'Gasolio',          41200, 'L',   'Cardlog',    'P', 'Definitivo', null, 2.624, 41200*2.624/1000),
  (2024, 'SASSUOLO',      'Fugitivi',                'F_Gas_R410A',         18, 'kg',  'Manutenzione','P','Definitivo', null, 2088,  18*2088/1000),
  -- FIORANO 2024 (magazzino — solo riscaldamento + mezzi)
  (2024, 'FIORANO',       'Combustione_Stazionaria', 'Gas_Naturale',     420000, 'Sm3','Bolletta',   'P', 'Definitivo','Riscaldamento', 1.984, 420000*1.984/1000),
  (2024, 'FIORANO',       'Combustione_Mobile',      'Gasolio',          18200, 'L',   'Cardlog',    'P', 'Definitivo','Carrelli',      2.624, 18200*2.624/1000),
  -- CASALGRANDE 2024 (logistica)
  (2024, 'CASALGRANDE',   'Combustione_Mobile',      'Gasolio',         118000, 'L',   'Cardlog',    'P', 'Definitivo', 'Mezzi log.',    2.624, 118000*2.624/1000),
  (2024, 'CASALGRANDE',   'Combustione_Mobile',      'Benzina',           8200, 'L',   'Cardlog',    'P', 'Definitivo', null,            2.211, 8200*2.211/1000),

  -- 2025
  (2025, 'IANO',          'Combustione_Stazionaria', 'Gas_Naturale',  17890000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.978, 17890000*1.978/1000),
  (2025, 'IANO',          'Combustione_Mobile',      'Gasolio',          74200, 'L',   'Cardlog',    'P', 'Definitivo', null, 2.620, 74200*2.620/1000),
  (2025, 'IANO',          'Fugitivi',                'F_Gas_R410A',         38, 'kg',  'Manutenzione','P','Definitivo', null, 2088,  38*2088/1000),
  (2025, 'VIANO',         'Combustione_Stazionaria', 'Gas_Naturale',  12450000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.978, 12450000*1.978/1000),
  (2025, 'VIANO',         'Combustione_Mobile',      'Gasolio',          51800, 'L',   'Cardlog',    'P', 'Definitivo', null, 2.620, 51800*2.620/1000),
  (2025, 'VIANO_GARGOLA', 'Combustione_Stazionaria', 'Gas_Naturale',   2750000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.978, 2750000*1.978/1000),
  (2025, 'FRASSINORO',    'Combustione_Stazionaria', 'Gas_Naturale',   4180000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.978, 4180000*1.978/1000),
  (2025, 'SASSUOLO',      'Combustione_Stazionaria', 'Gas_Naturale',   9180000, 'Sm3', 'Bolletta',   'P', 'Definitivo', null, 1.978, 9180000*1.978/1000),
  (2025, 'SASSUOLO',      'Combustione_Mobile',      'Gasolio',          39400, 'L',   'Cardlog',    'P', 'Definitivo', null, 2.620, 39400*2.620/1000),
  (2025, 'FIORANO',       'Combustione_Stazionaria', 'Gas_Naturale',     410000, 'Sm3','Bolletta',   'P', 'Definitivo','Riscaldamento', 1.978, 410000*1.978/1000),
  (2025, 'CASALGRANDE',   'Combustione_Mobile',      'Gasolio',         115200, 'L',   'Cardlog',    'P', 'Definitivo', null,            2.620, 115200*2.620/1000)
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────
--  S2 — 15 righe (LB + MB)
-- ────────────────────────────────────────────────────────────────────
insert into public.s2
  (anno, codice_sito, voce_s2, quantita, unita, strumento_mb, fonte_dato, qualita_dato, stato_dato, note,
   fe_location, fe_market, em_loc_tco2e, em_mkt_tco2e) values
  (2024, 'IANO',          'EE_Acquistata',    24500000, 'kWh', null, 'Bolletta', 'P', 'Definitivo', null, 0.288, 0.461, 24500000*0.288/1000, 24500000*0.461/1000),
  (2024, 'IANO',          'EE_Acquistata_GO', 12000000, 'kWh', 'GO', 'Bolletta', 'P', 'Definitivo', '50% GO', 0.288, 0.000, 12000000*0.288/1000, 0),
  (2024, 'VIANO',         'EE_Acquistata',    18200000, 'kWh', null, 'Bolletta', 'P', 'Definitivo', null, 0.288, 0.461, 18200000*0.288/1000, 18200000*0.461/1000),
  (2024, 'VIANO',         'EE_Acquistata_GO',  9000000, 'kWh', 'GO', 'Bolletta', 'P', 'Definitivo', null, 0.288, 0.000, 9000000*0.288/1000, 0),
  (2024, 'VIANO_GARGOLA', 'EE_Acquistata',     3400000, 'kWh', null, 'Bolletta', 'P', 'Definitivo', null, 0.288, 0.461, 3400000*0.288/1000, 3400000*0.461/1000),
  (2024, 'SASSUOLO',      'EE_Acquistata_GO', 14200000, 'kWh', 'GO', 'Bolletta', 'P', 'Definitivo', null, 0.288, 0.000, 14200000*0.288/1000, 0),
  (2024, 'FIORANO',       'EE_Acquistata',      890000, 'kWh', null, 'Bolletta', 'P', 'Definitivo','Magazzino', 0.288, 0.461, 890000*0.288/1000, 890000*0.461/1000),
  (2024, 'CASALGRANDE',   'EE_Acquistata',     1800000, 'kWh', null, 'Bolletta', 'P', 'Definitivo', null, 0.288, 0.461, 1800000*0.288/1000, 1800000*0.461/1000),

  (2025, 'IANO',          'EE_Acquistata_GO', 38000000, 'kWh', 'GO', 'Bolletta', 'P', 'Definitivo', '100% GO', 0.272, 0.000, 38000000*0.272/1000, 0),
  (2025, 'VIANO',         'EE_Acquistata_GO', 27500000, 'kWh', 'GO', 'Bolletta', 'P', 'Definitivo', null, 0.272, 0.000, 27500000*0.272/1000, 0),
  (2025, 'VIANO_GARGOLA', 'EE_Acquistata',     3520000, 'kWh', null, 'Bolletta', 'P', 'Definitivo', null, 0.272, 0.452, 3520000*0.272/1000, 3520000*0.452/1000),
  (2025, 'FRASSINORO',    'EE_Acquistata',     2125000, 'kWh', null, 'Bolletta', 'P', 'Definitivo', null, 0.272, 0.452, 2125000*0.272/1000, 2125000*0.452/1000),
  (2025, 'SASSUOLO',      'EE_Acquistata_GO', 14800000, 'kWh', 'GO', 'Bolletta', 'P', 'Definitivo', null, 0.272, 0.000, 14800000*0.272/1000, 0),
  (2025, 'FIORANO',       'EE_Acquistata',      910000, 'kWh', null, 'Bolletta', 'P', 'Definitivo', null, 0.272, 0.452, 910000*0.272/1000, 910000*0.452/1000),
  (2025, 'CASALGRANDE',   'EE_Acquistata',     1850000, 'kWh', null, 'Bolletta', 'P', 'Definitivo', null, 0.272, 0.452, 1850000*0.272/1000, 1850000*0.452/1000)
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────
--  S3 — ~95 righe sulle categorie 1, 2, 3, 4, 5, 6, 7, 9, 12
--  (8, 10, 11, 13, 14, 15 sono escluse / non applicabili — vedi materialità)
-- ────────────────────────────────────────────────────────────────────
insert into public.s3
  (anno, categoria_s3, sottocategoria, metodo, combustibile, quantita, unita, codice_fe,
   fonte_dato, qualita_dato, stato_dato, note, fe_valore, em_tco2e) values
  -- Categoria 1 — Beni e servizi acquistati
  (2024, 1, 'Argilla',        'Spend-based', null, 142000000,'kg', 'Argilla',          'ERP','P','Definitivo',  null, 0.054, 142000000*0.054/1000),
  (2024, 1, 'Feldspato',      'Spend-based', null,  28000000,'kg', 'Feldspato',        'ERP','P','Definitivo',  null, 0.042,  28000000*0.042/1000),
  (2024, 1, 'Sabbia',         'Spend-based', null,  45000000,'kg', 'Sabbia',           'ERP','P','Definitivo',  null, 0.016,  45000000*0.016/1000),
  (2024, 1, 'Talco',          'Spend-based', null,   4200000,'kg', 'Talco',            'ERP','P','Definitivo',  null, 0.085,   4200000*0.085/1000),
  (2024, 1, 'Carbonato_Ca',   'Spend-based', null,   6800000,'kg', 'Carbonato_Ca',     'ERP','P','Definitivo',  null, 0.041,   6800000*0.041/1000),
  (2024, 1, 'Smalto',         'Spend-based', null,   8200000,'kg', 'Smalto',           'ERP','P','Definitivo',  null, 1.620,   8200000*1.620/1000),
  (2024, 1, 'Inchiostri',     'Spend-based', null,    480000,'kg', 'Inchiostri',       'ERP','P','Definitivo',  null, 4.350,    480000*4.350/1000),
  (2024, 1, 'Cartone',        'Spend-based', null,   3900000,'kg', 'Cartone',          'ERP','P','Definitivo',  null, 0.819,   3900000*0.819/1000),
  (2024, 1, 'Pallet',         'Spend-based', null,   5400000,'kg', 'Pallet_Legno',     'ERP','P','Definitivo',  null, 0.224,   5400000*0.224/1000),
  (2024, 1, 'Film_PE',        'Spend-based', null,    290000,'kg', 'Film_PE',          'ERP','P','Definitivo',  null, 2.541,    290000*2.541/1000),
  (2024, 1, 'Reggia_PP',      'Spend-based', null,    105000,'kg', 'Reggia_PP',        'ERP','P','Definitivo',  null, 1.978,    105000*1.978/1000),
  (2024, 1, 'Acqua',          'Spend-based', null, 580000000,'L',  'Acqua_Industriale','ERP','S','Definitivo',  null, 0.000344, 580000000*0.000344/1000),
  (2024, 1, 'Lubrificanti',   'Spend-based', null,    142000,'kg', 'Lubrificanti',     'ERP','P','Definitivo',  null, 0.964,    142000*0.964/1000),
  (2024, 1, 'Guarnizioni',    'Spend-based', null,     36000,'kg', 'Guarnizioni',      'ERP','P','Definitivo',  null, 3.510,     36000*3.510/1000),
  (2024, 1, 'Carburo_Si',     'Spend-based', null,     21000,'kg', 'Carburo_Si',       'ERP','P','Definitivo',  null, 4.250,     21000*4.250/1000),
  (2025, 1, 'Argilla',        'Spend-based', null, 145000000,'kg', 'Argilla',          'ERP','P','Provvisorio', null, 0.052, 145000000*0.052/1000),
  (2025, 1, 'Feldspato',      'Spend-based', null,  28500000,'kg', 'Feldspato',        'ERP','P','Provvisorio', null, 0.042,  28500000*0.042/1000),
  (2025, 1, 'Smalto',         'Spend-based', null,   8400000,'kg', 'Smalto',           'ERP','P','Provvisorio', null, 1.610,   8400000*1.610/1000),
  (2025, 1, 'Cartone',        'Spend-based', null,   4000000,'kg', 'Cartone',          'ERP','P','Provvisorio', null, 0.815,   4000000*0.815/1000),

  -- Categoria 2 — Beni strumentali
  (2024, 2, 'Macchinari',     'Spend-based', null, 2100000, 'EUR','Macchinari',        'ERP','S','Provvisorio', 'EEIO factor 0.35', 0.350, 2100000*0.350/1000),
  (2024, 2, 'Veicoli',        'Spend-based', null,  480000, 'EUR','Veicoli',           'ERP','S','Provvisorio', null, 0.380, 480000*0.380/1000),
  (2025, 2, 'Macchinari',     'Spend-based', null, 1900000, 'EUR','Macchinari',        'ERP','S','Provvisorio', null, 0.350, 1900000*0.350/1000),

  -- Categoria 3 — WTT
  (2024, 3, 'WTT_Gas',        'Calculated', 'Gas_Naturale',     51380000, 'Sm3', 'WTT_Gas_Naturale', 'ERP','P','Definitivo',  null, 0.388, 51380000*0.388/1000),
  (2024, 3, 'WTT_Gasolio',    'Calculated', 'Gasolio',            429000, 'L',   'WTT_Gasolio',      'ERP','P','Definitivo',  null, 0.612,   429000*0.612/1000),
  (2024, 3, 'WTT_EE',         'Calculated', null,               91900000, 'kWh', 'WTT_EE',           'ERP','P','Definitivo',  null, 0.063, 91900000*0.063/1000),
  (2024, 3, 'TD_EE',          'Calculated', null,               91900000, 'kWh', 'TD_Loss_EE',       'ERP','P','Definitivo',  null, 0.018, 91900000*0.018/1000),
  (2024, 3, 'WTT_GPL',        'Calculated', 'GPL',                 43500, 'kg',  'WTT_GPL',          'ERP','P','Definitivo',  null, 0.213,    43500*0.213/1000),
  (2024, 3, 'WTT_Benzina',    'Calculated', 'Benzina',             12700, 'L',   'WTT_Benzina',      'ERP','P','Definitivo',  null, 0.515,    12700*0.515/1000),
  (2025, 3, 'WTT_Gas',        'Calculated', 'Gas_Naturale',     49990000, 'Sm3', 'WTT_Gas_Naturale', 'ERP','P','Provvisorio', null, 0.385, 49990000*0.385/1000),
  (2025, 3, 'WTT_EE',         'Calculated', null,               98195000, 'kWh', 'WTT_EE',           'ERP','P','Provvisorio', null, 0.060, 98195000*0.060/1000),

  -- Categoria 4 — Trasporti upstream
  (2024, 4, 'HGV_Argilla',    'Distance-based', null, 142000*150, 'tkm', 'Trasporto_HGV',  'Vettore','P','Definitivo', null, 0.107, 142000*150*0.107/1000),
  (2024, 4, 'HGV_Smalto',     'Distance-based', null,   8200*200, 'tkm', 'Trasporto_HGV',  'Vettore','P','Definitivo', null, 0.107,   8200*200*0.107/1000),
  (2024, 4, 'HGV_Feldspato',  'Distance-based', null,  28000*220, 'tkm', 'Trasporto_HGV',  'Vettore','P','Definitivo', null, 0.107,  28000*220*0.107/1000),
  (2024, 4, 'HGV_Pallet',     'Distance-based', null,   5400*80,  'tkm', 'Trasporto_HGV',  'Vettore','P','Definitivo', null, 0.107,   5400*80*0.107/1000),
  (2024, 4, 'HGV_Sabbia',     'Distance-based', null,  45000*180, 'tkm', 'Trasporto_HGV',  'Vettore','P','Definitivo', null, 0.107,  45000*180*0.107/1000),
  (2024, 4, 'Rail_Sabbia',    'Distance-based', null,  45000*420, 'tkm', 'Trasporto_Treno','Vettore','P','Definitivo', null, 0.028,  45000*420*0.028/1000),
  (2024, 4, 'Rail_Argilla',   'Distance-based', null, 142000*420, 'tkm', 'Trasporto_Treno','Vettore','P','Definitivo', null, 0.028, 142000*420*0.028/1000),
  (2024, 4, 'Ship_Talco',     'Distance-based', null,  4200*1800, 'tkm', 'Trasporto_Bulk', 'Vettore','P','Definitivo', null, 0.013,  4200*1800*0.013/1000),
  (2024, 4, 'Ship_Inks',      'Distance-based', null,   480*4200, 'tkm', 'Trasporto_Bulk', 'Vettore','P','Definitivo', null, 0.013,   480*4200*0.013/1000),
  (2024, 4, 'LGV_short',      'Distance-based', null,   8400*45,  'tkm', 'Trasporto_LGV',  'Vettore','P','Definitivo', null, 0.798,   8400*45*0.798/1000),
  (2024, 4, 'Air_Inks',       'Distance-based', null,   480*9500, 'tkm', 'Trasporto_Aereo','Vettore','S','Stimato',    null, 0.832,   480*9500*0.832/1000),
  (2025, 4, 'HGV_Argilla',    'Distance-based', null, 145000*150, 'tkm', 'Trasporto_HGV',  'Vettore','P','Provvisorio',null, 0.105, 145000*150*0.105/1000),
  (2025, 4, 'Rail_Argilla',   'Distance-based', null, 145000*420, 'tkm', 'Trasporto_Treno','Vettore','P','Provvisorio',null, 0.028, 145000*420*0.028/1000),

  -- Categoria 5 — Rifiuti operativi
  (2024, 5, 'Riciclo',        'Avg-data', null, 4200000, 'kg', 'Rifiuti_Riciclo',   'Albo','P','Definitivo',  null, 0.022, 4200000*0.022/1000),
  (2024, 5, 'Discarica',      'Avg-data', null,  280000, 'kg', 'Rifiuti_Discarica', 'Albo','P','Definitivo',  null, 0.470,  280000*0.470/1000),
  (2024, 5, 'Termo_ER',       'Avg-data', null,   92000, 'kg', 'Rifiuti_Termo_ER',  'Albo','P','Definitivo',  null, 0.018,   92000*0.018/1000),
  (2024, 5, 'Pericolosi',     'Avg-data', null,   38000, 'kg', 'Rifiuti_Pericolosi','Albo','P','Definitivo',  null, 1.253,   38000*1.253/1000),
  (2024, 5, 'Inerti',         'Avg-data', null,  920000, 'kg', 'Rifiuti_Inerti',    'Albo','P','Definitivo',  null, 0.008,  920000*0.008/1000),
  (2024, 5, 'Fanghi',         'Avg-data', null,  320000, 'kg', 'Fanghi',            'Albo','P','Definitivo',  null, 0.092,  320000*0.092/1000),
  (2024, 5, 'Compost',        'Avg-data', null,   18000, 'kg', 'Rifiuti_Compost',   'Albo','P','Definitivo',  null, 0.011,   18000*0.011/1000),
  (2024, 5, 'Termo',          'Avg-data', null,   48000, 'kg', 'Rifiuti_Termo',     'Albo','P','Definitivo',  null, 0.230,   48000*0.230/1000),
  (2025, 5, 'Riciclo',        'Avg-data', null, 4350000, 'kg', 'Rifiuti_Riciclo',   'Albo','P','Provvisorio', null, 0.022, 4350000*0.022/1000),
  (2025, 5, 'Discarica',      'Avg-data', null,  270000, 'kg', 'Rifiuti_Discarica', 'Albo','P','Provvisorio', null, 0.467,  270000*0.467/1000),

  -- Categoria 6 — Viaggi di lavoro
  (2024, 6, 'Treno',          'Distance-based', null, 285000, 'km',    'Treno_Passeggeri', 'Travel','P','Definitivo', null, 0.035, 285000*0.035/1000),
  (2024, 6, 'Aereo_LH',       'Distance-based', null,  95000, 'km',    'Aereo_LH',         'Travel','P','Definitivo', null, 0.146,  95000*0.146/1000),
  (2024, 6, 'Aereo_SH',       'Distance-based', null, 120000, 'km',    'Aereo_SH',         'Travel','P','Definitivo', null, 0.156, 120000*0.156/1000),
  (2024, 6, 'Hotel',          'Avg-data',       null,   1800, 'notte', 'Hotel_Notte',      'Travel','P','Definitivo', null, 9.940,   1800*9.940/1000),
  (2024, 6, 'Auto_Az',        'Distance-based', null, 425000, 'km',    'Auto_Aziendale',   'Cardlog','P','Definitivo', null, 0.171, 425000*0.171/1000),
  (2025, 6, 'Treno',          'Distance-based', null, 295000, 'km',    'Treno_Passeggeri', 'Travel','P','Provvisorio', null, 0.035, 295000*0.035/1000),

  -- Categoria 7 — Pendolarismo
  (2024, 7, 'Auto_Pers',      'Avg-data', null, 1800000, 'km', 'Auto_Aziendale', 'HR','S','Stimato',   'Survey', 0.171, 1800000*0.171/1000),
  (2024, 7, 'Treno',          'Avg-data', null,  280000, 'km', 'Treno_Passeggeri','HR','S','Stimato',  null,    0.035, 280000*0.035/1000),
  (2025, 7, 'Auto_Pers',      'Avg-data', null, 1750000, 'km', 'Auto_Aziendale', 'HR','S','Provvisorio',null,   0.168, 1750000*0.168/1000),

  -- Categoria 9 — Trasporti downstream
  (2024, 9, 'HGV_Out',        'Distance-based', null, 285000*180, 'tkm', 'Trasporto_HGV',  'Vettore','P','Definitivo',  null, 0.107, 285000*180*0.107/1000),
  (2024, 9, 'Ship_Out_RoRo',  'Distance-based', null,  84000*1500,'tkm', 'Trasporto_RoRo', 'Vettore','P','Definitivo',  null, 0.034,  84000*1500*0.034/1000),
  (2024, 9, 'Ship_Out_Bulk',  'Distance-based', null,  28000*8500,'tkm', 'Trasporto_Bulk', 'Vettore','P','Definitivo',  null, 0.013,  28000*8500*0.013/1000),
  (2024, 9, 'LGV_Out',        'Distance-based', null,  18000*60,  'tkm', 'Trasporto_LGV',  'Vettore','P','Definitivo',  null, 0.798,  18000*60*0.798/1000),
  (2024, 9, 'HGV_Out_2',      'Distance-based', null,  92000*240, 'tkm', 'Trasporto_HGV',  'Vettore','P','Definitivo',  null, 0.107,  92000*240*0.107/1000),
  (2024, 9, 'HGV_Out_3',      'Distance-based', null, 138000*120, 'tkm', 'Trasporto_HGV',  'Vettore','P','Definitivo',  null, 0.107, 138000*120*0.107/1000),
  (2025, 9, 'HGV_Out',        'Distance-based', null, 290000*180, 'tkm', 'Trasporto_HGV',  'Vettore','P','Provvisorio', null, 0.105, 290000*180*0.105/1000),
  (2025, 9, 'Ship_Out_RoRo',  'Distance-based', null,  86000*1500,'tkm', 'Trasporto_RoRo', 'Vettore','P','Provvisorio', null, 0.034,  86000*1500*0.034/1000),

  -- Categoria 12 — Fine vita prodotti
  (2024,12, 'Discarica_FV',   'Avg-data', null, 420000000*0.18,  'kg', 'Rifiuti_Discarica','EOL-model','S','Stimato', '18% landfill', 0.470, 420000000*0.18*0.470/1000),
  (2024,12, 'Riciclo_FV',     'Avg-data', null, 420000000*0.30,  'kg', 'Rifiuti_Riciclo',  'EOL-model','S','Stimato', '30% recycling',0.022, 420000000*0.30*0.022/1000),
  (2024,12, 'Inerti_FV',      'Avg-data', null, 420000000*0.52,  'kg', 'Rifiuti_Inerti',   'EOL-model','S','Stimato', '52% inerti',   0.008, 420000000*0.52*0.008/1000)
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────
--  S3 Materiality — 15 categorie
--  Configurazione confermata dal cliente:
--    Incluse:   1, 2, 3, 4, 5, 6, 7, 9, 12
--    Escluse:   8, 11
--    N.A.:      10, 13, 14
--    Da valutare: 15
-- ────────────────────────────────────────────────────────────────────
insert into public.s3_materiality (cat_id, status, justification, methodological_ref, review_year) values
  ( 1, 'Inclusa',    'Categoria principale: materie prime, smalti, inchiostri, packaging.', 'GHG Protocol Scope 3 cat.1', 2025),
  ( 2, 'Inclusa',    'Beni strumentali stimati con metodo spend-based EEIO.',                'GHG Protocol Scope 3 cat.2', 2025),
  ( 3, 'Inclusa',    'WTT di gas naturale, gasolio ed elettricità inclusi.',                 'DEFRA WTT 2024',             2025),
  ( 4, 'Inclusa',    'Trasporti upstream da fornitori principali tracciati.',                'GHG Protocol cat.4',         2025),
  ( 5, 'Inclusa',    'Rifiuti operativi pesati e classificati per smaltimento.',             'Albo Gestori Ambientali',    2025),
  ( 6, 'Inclusa',    'Travel Manager esporta annualmente le tratte aziendali.',              'Travel report 2024',         2025),
  ( 7, 'Inclusa',    'Survey dipendenti con stima media chilometrica.',                      'Survey HR 2024',             2025),
  ( 8, 'Esclusa',    'Beni in leasing upstream non rilevanti per il gruppo: nessun contratto leasing operativo significativo.', 'GHG Protocol cat.8', 2025),
  ( 9, 'Inclusa',    'Trasporti downstream verso porti e clienti EU-IT mappati.',            'GHG Protocol cat.9',         2025),
  (10, 'N.A.',       'Nessun processo di trasformazione downstream del prodotto.',           null,                         2025),
  (11, 'Esclusa',    'Le piastrelle ceramiche sono prodotto passivo: nessuna emissione in uso. Esclusione coerente con GHG Protocol settore ceramico.', 'GHG Protocol cat.11', 2025),
  (12, 'Inclusa',    'Stimato con modello EOL: 18% landfill, 30% riciclo, 52% inerti.',      'EOL model interno 2024',     2025),
  (13, 'N.A.',       'Nessuna attività di leasing downstream.',                              null,                         2025),
  (14, 'N.A.',       'Nessuna attività di franchising.',                                     null,                         2025),
  (15, 'Da valutare','Investimenti finanziari da analizzare con Standard PCAF nel prossimo ciclo.', 'PCAF v2.0',           2025)
on conflict (cat_id) do nothing;

-- ════════════════════════════════════════════════════════════════════
-- end of 02_data_seed.sql
-- ════════════════════════════════════════════════════════════════════
