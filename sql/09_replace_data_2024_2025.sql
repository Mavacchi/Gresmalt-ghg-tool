-- ════════════════════════════════════════════════════════════════════
-- 09_replace_data_2024_2025.sql
--   1) Promozione admin: davide.settembre, luca.iattici, alessandra.salvarani
--   2) Sostituzione completa di s1 / s2 / s3 / fe (anni 2024+2025)
--      con dataset operativo Gresmalt.
--
-- USAGE
--   SQL Editor Supabase, eseguire come postgres / service_role.
--   Anagrafiche, Produzione, S3 Materiality, audit_log, app_meta
--   restano INVARIATE.
--
-- NOTE
--   - I numeri vengono inseriti in formato US (decimal point, no thousand
--     sep) — i valori Em_*_tCO2e sono quelli forniti dall'utente
--     (preserva intent: l'app non sovrascrive em pre-esistente).
--   - I trigger di audit firmano sia le DELETE sia le INSERT —
--     l'operazione resta tracciata in audit_log con hash chain.
-- ════════════════════════════════════════════════════════════════════

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1) PROMOZIONE A ADMIN
-- I trigger su public.role_map propagano automaticamente il ruolo a
-- auth.users.raw_app_meta_data per gli utenti già registrati e lo
-- applicano al primo login per quelli non ancora invitati.
--
-- Fix prerequisito: vecchi schemi pre-7d hanno role_map senza la
-- colonna `updated_by` ma il trigger BEFORE UPDATE set_updated_at()
-- la pretende → "record new has no field updated_by" su `do update`.
-- Add idempotente (allineato a 07_invite_operators.sql).
-- ────────────────────────────────────────────────────────────────────
alter table public.role_map
  add column if not exists updated_by uuid references auth.users(id);

insert into public.role_map (email, role) values
  ('davide.settembre@gresmalt.it',     'admin'),
  ('luca.iattici@gresmalt.it',         'admin'),
  ('alessandra.salvarani@gresmalt.it', 'admin')
on conflict (email) do update
  set role = excluded.role;

-- ────────────────────────────────────────────────────────────────────
-- 2) SOSTITUZIONE DATI ATTIVITÀ + FE
-- Ordine: s1, s2, s3 (dipendenze su anagrafiche), poi fe (no FK).
-- ────────────────────────────────────────────────────────────────────
delete from public.s1;
delete from public.s2;
delete from public.s3;
delete from public.fe;

-- ────────────────────────────────────────────────────────────────────
-- FE — Fattori Emissivi (74 righe: 37 × 2024 + 37 × 2025)
-- ────────────────────────────────────────────────────────────────────
insert into public.fe
  (fe_id, famiglia, codice_voce, descrizione, anno_validita, valore, unita, gas, fonte, nota) values
  -- 2024
  ('FE_GN_TOT_24',  'Combustibili', 'GAS_NAT',          'Gas Naturale - totale CO2e',         2024, 2.02100, 'kgCO2e/Sm³',  'CO2e', 'ISPRA / fattori nazionali combustibili',         'Valore operativo; da riallineare al workbook annuale'),
  ('FE_GASOLIO_24', 'Combustibili', 'GASOLIO',          'Gasolio - combustione totale',       2024, 2.65000, 'kgCO2e/litro','CO2e', 'ISPRA / fattori nazionali combustibili',         'Valore operativo'),
  ('FE_BENZINA_24', 'Combustibili', 'BENZINA',          'Benzina - combustione totale',       2024, 2.30300, 'kgCO2e/litro','CO2e', 'ISPRA / fattori nazionali combustibili',         'Valore operativo'),
  ('FE_DECARB_24',  'Combustibili', 'PROCESSO_DECARB',  'Decarbonatazione CaCO3',             2024, 0.44000, 'kgCO2/kg_CaCO3','CO2','Stechiometria',                                  '44/100 da CaCO3'),
  ('FE_EE_LOC_24',  'Elettricità',  'EE_LOCATION',      'FE location-based Italia',           2024, 0.23470, 'kgCO2e/kWh',  'CO2e', 'ISPRA Rapporto 413/2025',                        'Fattore consumi Italia 2023, ultimo consolidato'),
  ('FE_EE_RES_24',  'Elettricità',  'EE_RESIDUAL',      'Residual mix Italia',                2024, 0.44120, 'kgCO2e/kWh',  'CO2e', 'AIB Residual Mix 2024',                          'Italia residual mix 2024'),
  ('FE_EE_GO_24',   'Elettricità',  'EE_GO',            'Con Garanzie di Origine',            2024, 0.00000, 'kgCO2e/kWh',  'CO2e', 'GHG Protocol Scope 2',                           'Market-based; solo con GO/EAC conformi ai quality criteria'),
  ('FE_WTT_GN_24',  'WTT',          'WTT_GAS_NAT',      'WTT Gas Naturale',                   2024, 0.34400, 'kgCO2e/Sm³',  'CO2e', 'DESNZ/BEIS 2024-2025',                           'Valore operativo; nessuna major change 2025'),
  ('FE_WTT_GA_24',  'WTT',          'WTT_GASOLIO',      'WTT Gasolio',                        2024, 0.62500, 'kgCO2e/litro','CO2e', 'DESNZ/BEIS 2024-2025',                           'Valore operativo; nessuna major change 2025'),
  ('FE_WTT_BE_24',  'WTT',          'WTT_BENZINA',      'WTT Benzina',                        2024, 0.54000, 'kgCO2e/litro','CO2e', 'DESNZ/BEIS 2024-2025',                           'Valore operativo; nessuna major change 2025'),
  ('FE_WTT_EE_24',  'WTT',          'WTT_EE',           'WTT Elettricità',                    2024, 0.03800, 'kgCO2e/kWh',  'CO2e', 'DESNZ/BEIS 2024-2025',                           'Generazione; nessuna major change 2025'),
  ('FE_TD_EE_24',   'WTT',          'TD_EE',            'T&D losses Elettricità',             2024, 0.01900, 'kgCO2e/kWh',  'CO2e', 'DESNZ/BEIS 2024-2025',                           'Perdite rete; nessuna major change 2025'),
  ('FE_TR_STR_24',  'Trasporto',    'TR_STRADA',        'Strada HGV medio',                   2024, 0.07547, 'kgCO2e/tkm',  'CO2e', 'DESNZ/BEIS 2024',                                'Average laden'),
  ('FE_TR_FER_24',  'Trasporto',    'TR_FERROVIA',      'Ferrovia merci',                     2024, 0.02779, 'kgCO2e/tkm',  'CO2e', 'DESNZ/BEIS 2024',                                'Rail freight'),
  ('FE_TR_NAV_24',  'Trasporto',    'TR_NAVE',          'Marittimo bulk',                     2024, 0.01321, 'kgCO2e/tkm',  'CO2e', 'DESNZ/BEIS 2024',                                'General cargo average'),
  ('FE_RIF_PD_24',  'Rifiuti',      'RIF_DISC_PERIC',   'Rifiuti pericolosi a discarica',     2024, 0.52033, 'kgCO2e/kg',   'CO2e', 'Proxy landfill pericolosi',                      null),
  ('FE_RIF_ND_24',  'Rifiuti',      'RIF_DISC_NONPERIC','Rifiuti non pericolosi a discarica', 2024, 0.52033, 'kgCO2e/kg',   'CO2e', 'DESNZ/BEIS 2024',                                'Commercial and industrial waste landfill'),
  ('FE_RIF_PR_24',  'Rifiuti',      'RIF_RIC_PERIC',    'Rifiuti pericolosi da riciclo',      2024, 0.00000, 'kgCO2e/kg',   'CO2e', 'Proxy riciclo pericolosi',                       'Cut-off'),
  ('FE_RIF_NR_24',  'Rifiuti',      'RIF_RIC_NONPERIC', 'Rifiuti non pericolosi da riciclo',  2024, 0.00000, 'kgCO2e/kg',   'CO2e', 'Proxy riciclo non pericolosi',                   'Cut-off'),
  ('FE_VO_SP_24',   'Viaggi',       'VOLO_SPEND',       'Volo spend-based',                   2024, 2.42147, 'kgCO2e/EUR',  'CO2e', 'DEFRA Annex E + cambio medio GBP/EUR 2024',      'Air transport'),
  ('FE_AN_SP_24',   'Viaggi',       'AUTO_NOLEGGIO_SPEND','Auto noleggio spend-based',        2024, 0.27093, 'kgCO2e/EUR',  'CO2e', 'DEFRA Annex E + cambio medio GBP/EUR 2024',      'Proxy: Renting of machinery etc'),
  ('FE_HOT_SP_24',  'Viaggi',       'HOTEL_SPEND',      'Hotel spend-based',                  2024, 0.41487, 'kgCO2e/EUR',  'CO2e', 'DEFRA Annex E + cambio medio GBP/EUR 2024',      'Hotels, catering, pubs etc'),
  ('FE_CA_24',      'Commuting',    'COMM_AUTO',        'Auto pendolarismo',                  2024, 0.16691, 'kgCO2e/km',   'CO2e', 'DESNZ/BEIS 2024',                                'Proxy auto media'),
  ('FE_MA_AR_24',   'Materiali',    'MAT_ARGILLE',      'Argille e minerali',                 2024, 0.08000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent / Confindustria Ceramica','Valore legacy; da sostituire con dato specifico'),
  ('FE_MA_FE_24',   'Materiali',    'MAT_FELDSPATI',    'Feldspati',                          2024, 0.09000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; da sostituire con dato specifico'),
  ('FE_MA_SA_24',   'Materiali',    'MAT_SABBIE',       'Sabbie silicee',                     2024, 0.05000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; da sostituire con dato specifico'),
  ('FE_MA_FR_24',   'Materiali',    'MAT_FRITTE',       'Fritte e smalti',                    2024, 1.20000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; proxy glass/ceramic frit'),
  ('FE_MA_PI_24',   'Materiali',    'MAT_PIGMENTI',     'Pigmenti',                           2024, 2.50000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; proxy chemical'),
  ('FE_MA_AD_24',   'Materiali',    'MAT_ADDITIVI',     'Additivi chimici',                   2024, 1.80000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; proxy chemical'),
  ('FE_MA_CA_24',   'Materiali',    'MAT_CARTONE',      'Imballaggi cartone',                 2024, 0.86000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore packaging / ecoinvent',            'Valore legacy; da riallineare a grado riciclato/vergine'),
  ('FE_MA_PA_24',   'Materiali',    'MAT_PALLET',       'Pallet legno',                       2024, 0.31000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore packaging / ecoinvent',            'Valore legacy'),
  ('FE_MA_FI_24',   'Materiali',    'MAT_FILM',         'Film plastico LDPE',                 2024, 2.53000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore packaging / ecoinvent',            'Valore legacy'),
  ('FE_MA_RE_24',   'Materiali',    'MAT_REGGETTE',     'Reggette PP',                        2024, 1.95000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore packaging / ecoinvent',            'Valore legacy'),
  ('FE_SP_CX_24',   'Materiali',    'SPEND_CAPEX',      'Capital goods spend',                2024, 0.25000, 'kgCO2e/EUR',  'CO2e', 'EXIOBASE 3.9.x - da ricalcolare',                'Valore legacy 3.8; richiede remapping e anno monetario coerente'),
  ('FE_SP_SV_24',   'Materiali',    'SPEND_SERVIZI',    'Servizi spend',                      2024, 0.12000, 'kgCO2e/EUR',  'CO2e', 'EXIOBASE 3.9.x - da ricalcolare',                'Valore legacy 3.8; richiede remapping e anno monetario coerente'),
  ('FE_EOL_I_24',   'FinVita',      'EOL_DISC_INERTI',  'Piastrelle discarica',               2024, 0.00123, 'kgCO2e/kg',   'CO2e', 'DESNZ/BEIS 2024',                                'Proxy aggregates landfill'),
  ('FE_EOL_R_24',   'FinVita',      'EOL_RICICLO',      'Piastrelle riciclo',                 2024, 0.00098, 'kgCO2e/kg',   'CO2e', 'DESNZ/BEIS 2024',                                'Proxy aggregates open-loop recycling'),
  -- 2025
  ('FE_GN_TOT_25',  'Combustibili', 'GAS_NAT',          'Gas Naturale - totale CO2e',         2025, 2.02100, 'kgCO2e/Sm³',  'CO2e', 'ISPRA / fattori nazionali combustibili',         'Valore operativo; da riallineare al workbook annuale'),
  ('FE_GASOLIO_25', 'Combustibili', 'GASOLIO',          'Gasolio - combustione totale',       2025, 2.65000, 'kgCO2e/litro','CO2e', 'ISPRA / fattori nazionali combustibili',         'Valore operativo'),
  ('FE_BENZINA_25', 'Combustibili', 'BENZINA',          'Benzina - combustione totale',       2025, 2.30300, 'kgCO2e/litro','CO2e', 'ISPRA / fattori nazionali combustibili',         'Valore operativo'),
  ('FE_DECARB_25',  'Combustibili', 'PROCESSO_DECARB',  'Decarbonatazione CaCO3',             2025, 0.44000, 'kgCO2/kg_CaCO3','CO2','Stechiometria',                                  '44/100 da CaCO3'),
  ('FE_EE_LOC_25',  'Elettricità',  'EE_LOCATION',      'FE location-based Italia',           2025, 0.19890, 'kgCO2e/kWh',  'CO2e', 'ISPRA Rapporto 413/2025',                        'Stima preliminare Italia 2024; da consolidare'),
  ('FE_EE_RES_25',  'Elettricità',  'EE_RESIDUAL',      'Residual mix Italia',                2025, 0.44120, 'kgCO2e/kWh',  'CO2e', 'AIB Residual Mix 2024',                          'Ultimo residual mix Italia disponibile'),
  ('FE_EE_GO_25',   'Elettricità',  'EE_GO',            'Con Garanzie di Origine',            2025, 0.00000, 'kgCO2e/kWh',  'CO2e', 'GHG Protocol Scope 2',                           'Market-based; solo con GO/EAC conformi ai quality criteria'),
  ('FE_WTT_GN_25',  'WTT',          'WTT_GAS_NAT',      'WTT Gas Naturale',                   2025, 0.34400, 'kgCO2e/Sm³',  'CO2e', 'DESNZ/BEIS 2025',                                'Valore operativo; factors remained constant'),
  ('FE_WTT_GA_25',  'WTT',          'WTT_GASOLIO',      'WTT Gasolio',                        2025, 0.62500, 'kgCO2e/litro','CO2e', 'DESNZ/BEIS 2025',                                'Valore operativo; factors remained constant'),
  ('FE_WTT_BE_25',  'WTT',          'WTT_BENZINA',      'WTT Benzina',                        2025, 0.54000, 'kgCO2e/litro','CO2e', 'DESNZ/BEIS 2025',                                'Valore operativo; factors remained constant'),
  ('FE_WTT_EE_25',  'WTT',          'WTT_EE',           'WTT Elettricità',                    2025, 0.03800, 'kgCO2e/kWh',  'CO2e', 'DESNZ/BEIS 2025',                                'Generazione; no major changes'),
  ('FE_TD_EE_25',   'WTT',          'TD_EE',            'T&D losses Elettricità',             2025, 0.01900, 'kgCO2e/kWh',  'CO2e', 'DESNZ/BEIS 2025',                                'Perdite rete; no major changes'),
  ('FE_TR_STR_25',  'Trasporto',    'TR_STRADA',        'Strada HGV medio',                   2025, 0.07800, 'kgCO2e/tkm',  'CO2e', 'DESNZ/BEIS 2025',                                'Average laden'),
  ('FE_TR_FER_25',  'Trasporto',    'TR_FERROVIA',      'Ferrovia merci',                     2025, 0.02779, 'kgCO2e/tkm',  'CO2e', 'DESNZ/BEIS 2025',                                'Rail freight'),
  ('FE_TR_NAV_25',  'Trasporto',    'TR_NAVE',          'Marittimo bulk',                     2025, 0.01321, 'kgCO2e/tkm',  'CO2e', 'DESNZ/BEIS 2025',                                'General cargo average'),
  ('FE_RIF_PD_25',  'Rifiuti',      'RIF_DISC_PERIC',   'Rifiuti pericolosi a discarica',     2025, 0.52033, 'kgCO2e/kg',   'CO2e', 'Proxy landfill pericolosi',                      null),
  ('FE_RIF_ND_25',  'Rifiuti',      'RIF_DISC_NONPERIC','Rifiuti non pericolosi a discarica', 2025, 0.52033, 'kgCO2e/kg',   'CO2e', 'DESNZ/BEIS 2025',                                'Commercial and industrial waste landfill'),
  ('FE_RIF_PR_25',  'Rifiuti',      'RIF_RIC_PERIC',    'Rifiuti pericolosi da riciclo',      2025, 0.00000, 'kgCO2e/kg',   'CO2e', 'Proxy riciclo pericolosi',                       'Cut-off'),
  ('FE_RIF_NR_25',  'Rifiuti',      'RIF_RIC_NONPERIC', 'Rifiuti non pericolosi da riciclo',  2025, 0.00000, 'kgCO2e/kg',   'CO2e', 'Proxy riciclo non pericolosi',                   'Cut-off'),
  ('FE_VO_SP_25',   'Viaggi',       'VOLO_SPEND',       'Volo spend-based',                   2025, 2.44989, 'kgCO2e/EUR',  'CO2e', 'DEFRA Annex E + cambio medio GBP/EUR 2025',      'Air transport'),
  ('FE_AN_SP_25',   'Viaggi',       'AUTO_NOLEGGIO_SPEND','Auto noleggio spend-based',        2025, 0.27411, 'kgCO2e/EUR',  'CO2e', 'DEFRA Annex E + cambio medio GBP/EUR 2025',      'Proxy: Renting of machinery etc'),
  ('FE_HOT_SP_25',  'Viaggi',       'HOTEL_SPEND',      'Hotel spend-based',                  2025, 0.41974, 'kgCO2e/EUR',  'CO2e', 'DEFRA Annex E + cambio medio GBP/EUR 2025',      'Hotels, catering, pubs etc'),
  ('FE_CA_25',      'Commuting',    'COMM_AUTO',        'Auto pendolarismo',                  2025, 0.16725, 'kgCO2e/km',   'CO2e', 'DESNZ/BEIS 2025',                                'Proxy auto media'),
  ('FE_MA_AR_25',   'Materiali',    'MAT_ARGILLE',      'Argille e minerali',                 2025, 0.08000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent / Confindustria Ceramica','Valore legacy; da sostituire con dato specifico'),
  ('FE_MA_FE_25',   'Materiali',    'MAT_FELDSPATI',    'Feldspati',                          2025, 0.09000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; da sostituire con dato specifico'),
  ('FE_MA_SA_25',   'Materiali',    'MAT_SABBIE',       'Sabbie silicee',                     2025, 0.05000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; da sostituire con dato specifico'),
  ('FE_MA_FR_25',   'Materiali',    'MAT_FRITTE',       'Fritte e smalti',                    2025, 1.20000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; proxy glass/ceramic frit'),
  ('FE_MA_PI_25',   'Materiali',    'MAT_PIGMENTI',     'Pigmenti',                           2025, 2.50000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; proxy chemical'),
  ('FE_MA_AD_25',   'Materiali',    'MAT_ADDITIVI',     'Additivi chimici',                   2025, 1.80000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore / ecoinvent',                      'Valore legacy; proxy chemical'),
  ('FE_MA_CA_25',   'Materiali',    'MAT_CARTONE',      'Imballaggi cartone',                 2025, 0.86000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore packaging / ecoinvent',            'Valore legacy; da riallineare a grado riciclato/vergine'),
  ('FE_MA_PA_25',   'Materiali',    'MAT_PALLET',       'Pallet legno',                       2025, 0.31000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore packaging / ecoinvent',            'Valore legacy'),
  ('FE_MA_FI_25',   'Materiali',    'MAT_FILM',         'Film plastico LDPE',                 2025, 2.53000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore packaging / ecoinvent',            'Valore legacy'),
  ('FE_MA_RE_25',   'Materiali',    'MAT_REGGETTE',     'Reggette PP',                        2025, 1.95000, 'kgCO2e/kg',   'CO2e', 'EPD fornitore packaging / ecoinvent',            'Valore legacy'),
  ('FE_SP_CX_25',   'Materiali',    'SPEND_CAPEX',      'Capital goods spend',                2025, 0.25000, 'kgCO2e/EUR',  'CO2e', 'EXIOBASE 3.9.x - da ricalcolare',                'Valore legacy 3.8; richiede remapping e anno monetario coerente'),
  ('FE_SP_SV_25',   'Materiali',    'SPEND_SERVIZI',    'Servizi spend',                      2025, 0.12000, 'kgCO2e/EUR',  'CO2e', 'EXIOBASE 3.9.x - da ricalcolare',                'Valore legacy 3.8; richiede remapping e anno monetario coerente'),
  ('FE_EOL_I_25',   'FinVita',      'EOL_DISC_INERTI',  'Piastrelle discarica',               2025, 0.00126, 'kgCO2e/kg',   'CO2e', 'DESNZ/BEIS 2025',                                'Proxy aggregates landfill'),
  ('FE_EOL_R_25',   'FinVita',      'EOL_RICICLO',      'Piastrelle riciclo',                 2025, 0.00101, 'kgCO2e/kg',   'CO2e', 'DESNZ/BEIS 2025',                                'Proxy aggregates open-loop recycling');

-- ────────────────────────────────────────────────────────────────────
-- S1 — Combustione diretta (31 righe)
-- ────────────────────────────────────────────────────────────────────
insert into public.s1
  (anno, codice_sito, categoria_s1, combustibile, quantita, unita,
   fonte_dato, qualita_dato, stato_dato, note, fe_valore, em_tco2e) values
  -- 2024
  (2024, 'IANO',          'Gas_Naturale',    'GAS_NAT',         22916841, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210, 46315),
  (2024, 'VIANO',         'Gas_Naturale',    'GAS_NAT',          4569554, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210,  9235),
  (2024, 'FRASSINORO',    'Gas_Naturale',    'GAS_NAT',          5634446, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210, 11387),
  (2024, 'CASALGRANDE',   'Gas_Naturale',    'GAS_NAT',             2738, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210,     6),
  (2024, 'FIORANO',       'Gas_Naturale',    'GAS_NAT',            15211, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210,    31),
  (2024, 'SASSUOLO',      'Gas_Naturale',    'GAS_NAT',            10632, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210,    21),
  (2024, 'SASSUOLO',      'Benzina_Auto',    'BENZINA',             1349, 'litri',    'SAP',               'P', 'Definitivo', null,       2.3030,     3),
  (2024, 'SASSUOLO',      'Gasolio_Auto',    'GASOLIO',            95268, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,   252),
  (2024, 'FIORANO',       'Gasolio_Auto',    'GASOLIO',            58000, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,   154),
  (2024, 'VIANO',         'Gasolio_Auto',    'GASOLIO',            44600, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,   118),
  (2024, 'VIANO_GARGOLA', 'Gasolio_Auto',    'GASOLIO',             2400, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,     6),
  (2024, 'CASALGRANDE',   'Gasolio_Auto',    'GASOLIO',            13000, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,    34),
  (2024, 'IANO',          'Gasolio_Auto',    'GASOLIO',           110000, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,   292),
  (2024, 'FRASSINORO',    'Gasolio_Auto',    'GASOLIO',            18000, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,    48),
  (2024, 'IANO',          'Processo_Decarb', 'PROCESSO_DECARB',  9363616, 'kg CaCO₃', 'Stima interna',     'E', 'Stimato',    'LOI 3,5%', 0.4400,  4120),
  -- 2025
  (2025, 'IANO',          'Gas_Naturale',    'GAS_NAT',         23556856, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210, 47608),
  (2025, 'VIANO',         'Gas_Naturale',    'GAS_NAT',          1925606, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210,  3892),
  (2025, 'VIANO_GARGOLA', 'Gas_Naturale',    'GAS_NAT',               11, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210,     0),
  (2025, 'FRASSINORO',    'Gas_Naturale',    'GAS_NAT',          6336992, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210, 12807),
  (2025, 'CASALGRANDE',   'Gas_Naturale',    'GAS_NAT',             3901, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210,     8),
  (2025, 'FIORANO',       'Gas_Naturale',    'GAS_NAT',            18388, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210,    37),
  (2025, 'SASSUOLO',      'Gas_Naturale',    'GAS_NAT',            11464, 'Sm³',      'Fattura fornitore', 'P', 'Definitivo', null,       2.0210,    23),
  (2025, 'SASSUOLO',      'Benzina_Auto',    'BENZINA',             9151, 'litri',    'SAP',               'P', 'Definitivo', null,       2.3030,    21),
  (2025, 'SASSUOLO',      'Gasolio_Auto',    'GASOLIO',            95056, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,   252),
  (2025, 'FIORANO',       'Gasolio_Auto',    'GASOLIO',            74400, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,   197),
  (2025, 'VIANO',         'Gasolio_Auto',    'GASOLIO',            22000, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,    58),
  (2025, 'VIANO_GARGOLA', 'Gasolio_Auto',    'GASOLIO',             2400, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,     6),
  (2025, 'CASALGRANDE',   'Gasolio_Auto',    'GASOLIO',            11000, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,    29),
  (2025, 'IANO',          'Gasolio_Auto',    'GASOLIO',           109992, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,   291),
  (2025, 'FRASSINORO',    'Gasolio_Auto',    'GASOLIO',            20000, 'litri',    'SAP',               'P', 'Definitivo', null,       2.6500,    53),
  (2025, 'IANO',          'Processo_Decarb', 'PROCESSO_DECARB',  9061067, 'kg CaCO₃', 'Stima interna',     'E', 'Stimato',    'LOI 3,5%', 0.4400,  3987);

-- ────────────────────────────────────────────────────────────────────
-- S2 — Energia elettrica acquistata (15 righe)
-- ────────────────────────────────────────────────────────────────────
insert into public.s2
  (anno, codice_sito, voce_s2, quantita, unita, strumento_mb,
   fonte_dato, qualita_dato, stato_dato, note,
   fe_location, fe_market, em_loc_tco2e, em_mkt_tco2e) values
  -- 2024 — FE_Location 0.2347 (mix Italia 2023)
  (2024, 'IANO',          'EE_Acquistata_GO',   3193698, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.2347, 0.0000,  750,  0),
  (2024, 'VIANO',         'EE_Acquistata_GO',   6551604, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.2347, 0.0000, 1538,  0),
  (2024, 'CASALGRANDE',   'EE_Acquistata_GO',    358307, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.2347, 0.0000,   84,  0),
  (2024, 'VIANO_GARGOLA', 'EE_Acquistata_GO',    159518, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.2347, 0.0000,   37,  0),
  (2024, 'FIORANO',       'EE_Acquistata_GO',    344808, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.2347, 0.0000,   81,  0),
  (2024, 'SASSUOLO',      'EE_Acquistata_GO',    377358, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.2347, 0.0000,   89,  0),
  (2024, 'FRASSINORO',    'EE_Acquistata_GO',   8716707, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.2347, 0.0000, 2046,  0),
  (2024, 'SASSUOLO',      'EE_Acquistata_Grid',   46786, 'kWh', 'Grid_Residual', 'Fattura fornitore', 'P', 'Definitivo', null, 0.2347, 0.4412,   11, 21),
  -- 2025 — FE_Location 0.1989 (preliminare Italia 2024)
  (2025, 'IANO',          'EE_Acquistata_GO',   3195741, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.1989, 0.0000,  636,  0),
  (2025, 'VIANO',         'EE_Acquistata_GO',   3268364, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.1989, 0.0000,  650,  0),
  (2025, 'CASALGRANDE',   'EE_Acquistata_GO',    336654, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.1989, 0.0000,   67,  0),
  (2025, 'VIANO_GARGOLA', 'EE_Acquistata_GO',    154856, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.1989, 0.0000,   31,  0),
  (2025, 'FIORANO',       'EE_Acquistata_GO',    375142, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.1989, 0.0000,   75,  0),
  (2025, 'SASSUOLO',      'EE_Acquistata_GO',    421065, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.1989, 0.0000,   84,  0),
  (2025, 'FRASSINORO',    'EE_Acquistata_GO',   9472090, 'kWh', 'GO',            'Fattura fornitore', 'P', 'Definitivo', null, 0.1989, 0.0000, 1884,  0);

-- ────────────────────────────────────────────────────────────────────
-- S3 — Catena del valore (100 righe: 90 main + 10 cat 3 WTT)
-- ────────────────────────────────────────────────────────────────────
insert into public.s3
  (anno, categoria_s3, sottocategoria, metodo, combustibile, quantita, unita,
   codice_fe, fonte_dato, qualita_dato, stato_dato, note, fe_valore, em_tco2e) values
  -- ─── 2024 cat 1 (Materie prime + Servizi) ─────────────────────
  (2024,  1, 'Argille',                                'Mass-based',    null, 122965, 't',   'MAT_ARGILLE',          'SAP', 'P', 'Definitivo', null,                                                                                  0.0800,   10),
  (2024,  1, 'Feldspati',                              'Mass-based',    null,  82159, 't',   'MAT_FELDSPATI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.0900,    7),
  (2024,  1, 'Sabbie silicee',                         'Mass-based',    null,  62407, 't',   'MAT_SABBIE',           'SAP', 'P', 'Definitivo', null,                                                                                  0.0500,    3),
  (2024,  1, 'Fritte e smalti',                        'Mass-based',    null,   7777, 't',   'MAT_FRITTE',           'SAP', 'P', 'Definitivo', 'MAT PRIME PER SMALTI; SMALTI; M.P. GRANIGLIE DDG; MAT. PRIME GRANIGLIE',              1.2000,    9),
  (2024,  1, 'Pigmenti',                               'Mass-based',    null,    112, 't',   'MAT_PIGMENTI',         'SAP', 'P', 'Definitivo', 'COLORANTI IMPASTO; COLORANTI TINTOMETRO; PIGMENTI PER SMALTI',                        2.5000,    0),
  (2024,  1, 'Additivi chimici',                       'Mass-based',    null,   2208, 't',   'MAT_ADDITIVI',         'SAP', 'P', 'Definitivo', 'ADDITIVI IMPASTO; INCH COLLE SOLV DIG; ADDITIVI PER SMALTI; COLLA',                   1.8000,    4),
  (2024,  1, 'Imballaggi cartone',                     'Mass-based',    null,   1507, 't',   'MAT_CARTONE',          'SAP', 'P', 'Definitivo', 'CARTONE PER IMBALLI',                                                                 0.8600,    1),
  (2024,  1, 'Pallet legno',                           'Mass-based',    null,   6086, 't',   'MAT_PALLET',           'SAP', 'P', 'Definitivo', 'PALETTE',                                                                             0.3100,    2),
  (2024,  1, 'Film plastico',                          'Mass-based',    null,    440, 't',   'MAT_FILM',             'SAP', 'P', 'Definitivo', 'BOBINE-CAPPUCCI-FOGL',                                                                2.5300,    1),
  (2024,  1, 'Reggette PP',                            'Mass-based',    null,    117, 't',   'MAT_REGGETTE',         'SAP', 'P', 'Definitivo', 'REGGETTA',                                                                            1.9500,    0),
  (2024,  1, 'Servizi vari (Agenti)',                  'Spend-based',   null, 6095640, 'EUR','SPEND_SERVIZI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.1200,  731),
  (2024,  1, 'Servizi vari (Lav.est./Acq.prd.fin)',    'Spend-based',   null, 6243738, 'EUR','SPEND_SERVIZI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.1200,  749),
  (2024,  1, 'Servizi vari (Servizi)',                 'Spend-based',   null,30551788, 'EUR','SPEND_SERVIZI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.1200, 3666),
  (2024,  1, 'Servizi vari (Altro)',                   'Spend-based',   null,10716685, 'EUR','SPEND_SERVIZI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.1200, 1286),
  -- ─── 2024 cat 2 (Capital goods) ──────────────────────────────
  (2024,  2, 'Impiantistica',                          'Spend-based',   null,13103478, 'EUR','SPEND_CAPEX',          'SAP', 'P', 'Definitivo', null,                                                                                  0.2500, 3276),
  (2024,  2, 'Materiali di consumo',                   'Spend-based',   null, 2062710, 'EUR','SPEND_CAPEX',          'SAP', 'P', 'Definitivo', null,                                                                                  0.2500,  516),
  -- ─── 2024 cat 4 (Trasporto upstream) ─────────────────────────
  (2024,  4, 'Argille_Strada',                         'Distance-based',null,18813695, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '153 km',                                                  0.0755, 1420),
  (2024,  4, 'Argille_Treno',                          'Distance-based',null,55457363, 'tkm','TR_FERROVIA',          'Dichiarazione fornitore', 'S', 'Definitivo', '451 km',                                                  0.0278, 1541),
  (2024,  4, 'Argille_Nave',                           'Distance-based',null,76115538, 'tkm','TR_NAVE',              'Dichiarazione fornitore', 'S', 'Definitivo', '619 km',                                                  0.0132, 1005),
  (2024,  4, 'Feldspati_Strada',                       'Distance-based',null,18075077, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '220 km',                                                  0.0755, 1364),
  (2024,  4, 'Feldspati_Treno',                        'Distance-based',null,       0, 'tkm','TR_FERROVIA',          'Dichiarazione fornitore', 'S', 'Definitivo', '0 km',                                                    0.0278,    0),
  (2024,  4, 'Feldspati_Nave',                         'Distance-based',null,18650193, 'tkm','TR_NAVE',              'Dichiarazione fornitore', 'S', 'Definitivo', '227 km',                                                  0.0132,  246),
  (2024,  4, 'Sabbie silicee_Strada',                  'Distance-based',null,10609212, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '170 km',                                                  0.0755,  801),
  (2024,  4, 'Sabbie silicee_Treno',                   'Distance-based',null,       0, 'tkm','TR_FERROVIA',          'Dichiarazione fornitore', 'S', 'Definitivo', '0 km',                                                    0.0278,    0),
  (2024,  4, 'Sabbie silicee_Nave',                    'Distance-based',null, 6739970, 'tkm','TR_NAVE',              'Dichiarazione fornitore', 'S', 'Definitivo', '108 km',                                                  0.0132,   89),
  (2024,  4, 'Fritte e smalti_Strada',                 'Distance-based',null,10739438, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '1381 km',                                                 0.0755,  811),
  (2024,  4, 'Pigmenti_Strada',                        'Distance-based',null,  154550, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '1381 km',                                                 0.0755,   12),
  (2024,  4, 'Additivi chimici_Strada',                'Distance-based',null,  287032, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '130 km',                                                  0.0755,   22),
  (2024,  4, 'Imballaggi cartone_Strada',              'Distance-based',null,   69299, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '46 km',                                                   0.0755,    5),
  (2024,  4, 'Pallet legno_Strada',                    'Distance-based',null,  304316, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '50 km',                                                   0.0755,   23),
  (2024,  4, 'Film plastico_Strada',                   'Distance-based',null,  100790, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '229 km',                                                  0.0755,    8),
  (2024,  4, 'Reggette PP_Strada',                     'Distance-based',null,   19676, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '168 km',                                                  0.0755,    1),
  -- ─── 2024 cat 5 (Rifiuti) ────────────────────────────────────
  (2024,  5, 'Rifiuti pericolosi a discarica',         'Mass-based',    null,    244, 't',   'RIF_DISC_PERIC',       'SAP', 'P', 'Definitivo', null,                                                                                  0.5203,    0),
  (2024,  5, 'Rifiuti non pericolosi a discarica',     'Mass-based',    null,     98, 't',   'RIF_DISC_NONPERIC',    'SAP', 'P', 'Definitivo', null,                                                                                  0.5203,    0),
  (2024,  5, 'Rifiuti pericolosi da riciclo',          'Mass-based',    null,     41, 't',   'RIF_RIC_PERIC',        'SAP', 'P', 'Definitivo', null,                                                                                  0.0000,    0),
  (2024,  5, 'Rifiuti non pericolosi da riciclo',      'Mass-based',    null,   5990, 't',   'RIF_RIC_NONPERIC',     'SAP', 'P', 'Definitivo', null,                                                                                  0.0000,    0),
  -- ─── 2024 cat 6 (Trasferte) ──────────────────────────────────
  (2024,  6, 'Voli',                                   'Spend-based',   null, 111203, 'EUR', 'VOLO_SPEND',           'Note spese', 'P', 'Definitivo', null,                                                                           2.4215,  269),
  (2024,  6, 'Auto noleggio',                          'Spend-based',   null,  22440, 'EUR', 'AUTO_NOLEGGIO_SPEND',  'Note spese', 'P', 'Definitivo', null,                                                                           0.2709,    6),
  (2024,  6, 'Hotel',                                  'Spend-based',   null, 222845, 'EUR', 'HOTEL_SPEND',          'Note spese', 'P', 'Definitivo', null,                                                                           0.4149,   92),
  -- ─── 2024 cat 7 (Commuting) ──────────────────────────────────
  (2024,  7, 'Commuting_Auto',                         'Distance-based',null, 4452800, 'km', 'COMM_AUTO',            'Stima interna', 'E', 'Definitivo', '40 km/giorno × 220 giorni/anno = 8.800 km/anno * 506 dipendenti',           0.1669,  743),
  -- ─── 2024 cat 9 (Trasporto downstream) ───────────────────────
  (2024,  9, 'Italia_Strada',                          'Distance-based',null, 26006138, 'tkm','TR_STRADA',           'Proxy settoriale', 'E', 'Definitivo', 'Truck with domestic destination having a capacity of 27 tons (34,75% of tiles sold) | 300 km',  0.0755,  1963),
  (2024,  9, 'Europa_Strada',                          'Distance-based',null,202258406, 'tkm','TR_STRADA',           'Proxy settoriale', 'E', 'Definitivo', 'Truck with European destination having a capacity of 27 tons (58,33% of tiles sold) | 1390 km', 0.0755, 15264),
  (2024,  9, 'Export_Nave',                            'Distance-based',null,112552072, 'tkm','TR_NAVE',             'Proxy settoriale', 'E', 'Definitivo', 'Transoceanic transport shipment (6,92% of tiles  sold) | 6520 km',                              0.0132,  1487),
  -- ─── 2024 cat 12 (Fine vita prodotti) ────────────────────────
  (2024, 12, 'Piastrelle_Discarica',                   'Mass-based',    null,  79013, 't',   'EOL_DISC_INERTI',      'Proxy settoriale', 'E', 'Definitivo', '30% delle piastrelle prodotte',                                          0.0012,    0),
  (2024, 12, 'Piastrelle_Riciclo',                     'Mass-based',    null, 184363, 't',   'EOL_RICICLO',          'Proxy settoriale', 'E', 'Definitivo', '70% delle piastrelle prodotte',                                          0.0010,    0),

  -- ─── 2025 cat 1 ──────────────────────────────────────────────
  (2025,  1, 'Argille',                                'Mass-based',    null, 119082, 't',   'MAT_ARGILLE',          'SAP', 'P', 'Definitivo', null,                                                                                  0.0800,   10),
  (2025,  1, 'Feldspati',                              'Mass-based',    null,  82393, 't',   'MAT_FELDSPATI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.0900,    7),
  (2025,  1, 'Sabbie silicee',                         'Mass-based',    null,  57413, 't',   'MAT_SABBIE',           'SAP', 'P', 'Definitivo', null,                                                                                  0.0500,    3),
  (2025,  1, 'Fritte e smalti',                        'Mass-based',    null,   7298, 't',   'MAT_FRITTE',           'SAP', 'P', 'Definitivo', 'MAT PRIME PER SMALTI; SMALTI; M.P. GRANIGLIE DDG; MAT. PRIME GRANIGLIE',              1.2000,    9),
  (2025,  1, 'Pigmenti',                               'Mass-based',    null,    107, 't',   'MAT_PIGMENTI',         'SAP', 'P', 'Definitivo', 'COLORANTI IMPASTO; COLORANTI TINTOMETRO; PIGMENTI PER SMALTI',                        2.5000,    0),
  (2025,  1, 'Additivi chimici',                       'Mass-based',    null,   2155, 't',   'MAT_ADDITIVI',         'SAP', 'P', 'Definitivo', 'ADDITIVI IMPASTO; INCH COLLE SOLV DIG; ADDITIVI PER SMALTI; COLLA',                   1.8000,    4),
  (2025,  1, 'Imballaggi cartone',                     'Mass-based',    null,   1483, 't',   'MAT_CARTONE',          'SAP', 'P', 'Definitivo', 'CARTONE PER IMBALLI',                                                                 0.8600,    1),
  (2025,  1, 'Pallet legno',                           'Mass-based',    null,   5808, 't',   'MAT_PALLET',           'SAP', 'P', 'Definitivo', 'PALETTE',                                                                             0.3100,    2),
  (2025,  1, 'Film plastico',                          'Mass-based',    null,    461, 't',   'MAT_FILM',             'SAP', 'P', 'Definitivo', 'BOBINE-CAPPUCCI-FOGL',                                                                2.5300,    1),
  (2025,  1, 'Reggette PP',                            'Mass-based',    null,    118, 't',   'MAT_REGGETTE',         'SAP', 'P', 'Definitivo', 'REGGETTA',                                                                            1.9500,    0),
  (2025,  1, 'Servizi vari (Agenti)',                  'Spend-based',   null, 5717659, 'EUR','SPEND_SERVIZI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.1200,  686),
  (2025,  1, 'Servizi vari (Lav.est./Acq.prd.fin)',    'Spend-based',   null, 6060789, 'EUR','SPEND_SERVIZI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.1200,  727),
  (2025,  1, 'Servizi vari (Servizi)',                 'Spend-based',   null,25030294, 'EUR','SPEND_SERVIZI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.1200, 3004),
  (2025,  1, 'Servizi vari (Altro)',                   'Spend-based',   null,12336485, 'EUR','SPEND_SERVIZI',        'SAP', 'P', 'Definitivo', null,                                                                                  0.1200, 1480),
  -- ─── 2025 cat 2 ──────────────────────────────────────────────
  (2025,  2, 'Impiantistica',                          'Spend-based',   null, 3903979, 'EUR','SPEND_CAPEX',          'SAP', 'P', 'Definitivo', null,                                                                                  0.2500,  976),
  (2025,  2, 'Materiali di consumo',                   'Spend-based',   null, 2051186, 'EUR','SPEND_CAPEX',          'SAP', 'P', 'Definitivo', null,                                                                                  0.2500,  513),
  -- ─── 2025 cat 4 ──────────────────────────────────────────────
  (2025,  4, 'Argille_Strada',                         'Distance-based',null,18219472, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '153 km',                                                  0.0780, 1421),
  (2025,  4, 'Argille_Treno',                          'Distance-based',null,60255246, 'tkm','TR_FERROVIA',          'Dichiarazione fornitore', 'S', 'Definitivo', '506 km',                                                  0.0278, 1674),
  (2025,  4, 'Argille_Nave',                           'Distance-based',null,54182089, 'tkm','TR_NAVE',              'Dichiarazione fornitore', 'S', 'Definitivo', '455 km',                                                  0.0132,  716),
  (2025,  4, 'Feldspati_Strada',                       'Distance-based',null,18373582, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '223 km',                                                  0.0780, 1433),
  (2025,  4, 'Feldspati_Treno',                        'Distance-based',null,       0, 'tkm','TR_FERROVIA',          'Dichiarazione fornitore', 'S', 'Definitivo', '0 km',                                                    0.0278,    0),
  (2025,  4, 'Feldspati_Nave',                         'Distance-based',null,33369061, 'tkm','TR_NAVE',              'Dichiarazione fornitore', 'S', 'Definitivo', '405 km',                                                  0.0132,  441),
  (2025,  4, 'Sabbie silicee_Strada',                  'Distance-based',null, 9243551, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '161 km',                                                  0.0780,  721),
  (2025,  4, 'Sabbie silicee_Treno',                   'Distance-based',null,       0, 'tkm','TR_FERROVIA',          'Dichiarazione fornitore', 'S', 'Definitivo', '0 km',                                                    0.0278,    0),
  (2025,  4, 'Sabbie silicee_Nave',                    'Distance-based',null, 5569096, 'tkm','TR_NAVE',              'Dichiarazione fornitore', 'S', 'Definitivo', '97 km',                                                   0.0132,   74),
  (2025,  4, 'Fritte e smalti_Strada',                 'Distance-based',null,10077934, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '1381 km',                                                 0.0780,  786),
  (2025,  4, 'Pigmenti_Strada',                        'Distance-based',null,  148273, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '1381 km',                                                 0.0780,   12),
  (2025,  4, 'Additivi chimici_Strada',                'Distance-based',null,  280113, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '130 km',                                                  0.0780,   22),
  (2025,  4, 'Imballaggi cartone_Strada',              'Distance-based',null,   68207, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '46 km',                                                   0.0780,    5),
  (2025,  4, 'Pallet legno_Strada',                    'Distance-based',null,  290395, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '50 km',                                                   0.0780,   23),
  (2025,  4, 'Film plastico_Strada',                   'Distance-based',null,  105626, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '229 km',                                                  0.0780,    8),
  (2025,  4, 'Reggette PP_Strada',                     'Distance-based',null,   19833, 'tkm','TR_STRADA',            'Dichiarazione fornitore', 'S', 'Definitivo', '168 km',                                                  0.0780,    2),
  -- ─── 2025 cat 5 ──────────────────────────────────────────────
  (2025,  5, 'Rifiuti pericolosi a discarica',         'Mass-based',    null,    247, 't',   'RIF_DISC_PERIC',       'SAP', 'P', 'Definitivo', null,                                                                                  0.5203,    0),
  (2025,  5, 'Rifiuti non pericolosi a discarica',     'Mass-based',    null,    166, 't',   'RIF_DISC_NONPERIC',    'SAP', 'P', 'Definitivo', null,                                                                                  0.5203,    0),
  (2025,  5, 'Rifiuti pericolosi da riciclo',          'Mass-based',    null,     53, 't',   'RIF_RIC_PERIC',        'SAP', 'P', 'Definitivo', null,                                                                                  0.0000,    0),
  (2025,  5, 'Rifiuti non pericolosi da riciclo',      'Mass-based',    null,   4313, 't',   'RIF_RIC_NONPERIC',     'SAP', 'P', 'Definitivo', null,                                                                                  0.0000,    0),
  -- ─── 2025 cat 6 ──────────────────────────────────────────────
  (2025,  6, 'Voli',                                   'Spend-based',   null, 121177, 'EUR', 'VOLO_SPEND',           'Note spese', 'P', 'Definitivo', null,                                                                           2.4499,  297),
  (2025,  6, 'Auto noleggio',                          'Spend-based',   null,  24126, 'EUR', 'AUTO_NOLEGGIO_SPEND',  'Note spese', 'P', 'Definitivo', null,                                                                           0.2741,    7),
  (2025,  6, 'Hotel',                                  'Spend-based',   null, 237473, 'EUR', 'HOTEL_SPEND',          'Note spese', 'P', 'Definitivo', null,                                                                           0.4197,  100),
  -- ─── 2025 cat 7 ──────────────────────────────────────────────
  (2025,  7, 'Commuting_Auto',                         'Distance-based',null, 4259200, 'km', 'COMM_AUTO',            'Stima interna', 'E', 'Definitivo', '40 km/giorno × 220 giorni/anno = 8.800 km/anno * 484 dipendenti',           0.1673,  712),
  -- ─── 2025 cat 9 ──────────────────────────────────────────────
  (2025,  9, 'Italia_Strada',                          'Distance-based',null, 25439036, 'tkm','TR_STRADA',           'Proxy settoriale', 'E', 'Definitivo', 'Truck with domestic destination having a capacity of 27 tons (33,58% of tiles sold) | 300 km',  0.0780,  1984),
  (2025,  9, 'Europa_Strada',                          'Distance-based',null,207514252, 'tkm','TR_STRADA',           'Proxy settoriale', 'E', 'Definitivo', 'Truck with European destination having a capacity of 27 tons (59,12% of tiles sold) | 1390 km', 0.0780, 16186),
  (2025,  9, 'Export_Nave',                            'Distance-based',null,120190228, 'tkm','TR_NAVE',             'Proxy settoriale', 'E', 'Definitivo', 'Transoceanic transport shipment (7,30% of tiles  sold) | 6520 km',                              0.0132,  1588),
  -- ─── 2025 cat 12 ─────────────────────────────────────────────
  (2025, 12, 'Piastrelle_Discarica',                   'Mass-based',    null,  74772, 't',   'EOL_DISC_INERTI',      'Proxy settoriale', 'E', 'Definitivo', '30% delle piastrelle prodotte',                                          0.0013,    0),
  (2025, 12, 'Piastrelle_Riciclo',                     'Mass-based',    null, 174468, 't',   'EOL_RICICLO',          'Proxy settoriale', 'E', 'Definitivo', '70% delle piastrelle prodotte',                                          0.0010,    0),

  -- ─── Cat 3 (Combustibili upstream WTT) — 6 righe ────────────
  (2024,  3, 'WTT Gas Naturale',     'Activity-based','GAS_NAT',  33149422, 'Sm³',   'WTT_GAS_NAT',  null, null, null, null, 0.3440, 11403),
  (2024,  3, 'WTT Gasolio',          'Activity-based','GASOLIO',    341268, 'litri', 'WTT_GASOLIO',  null, null, null, null, 0.6250,   213),
  (2024,  3, 'WTT Benzina',          'Activity-based','BENZINA',      1349, 'litri', 'WTT_BENZINA',  null, null, null, null, 0.5400,     1),
  (2025,  3, 'WTT Gas Naturale',     'Activity-based','GAS_NAT',  31853218, 'Sm³',   'WTT_GAS_NAT',  null, null, null, null, 0.3440, 10958),
  (2025,  3, 'WTT Gasolio',          'Activity-based','GASOLIO',    334848, 'litri', 'WTT_GASOLIO',  null, null, null, null, 0.6250,   209),
  (2025,  3, 'WTT Benzina',          'Activity-based','BENZINA',      9151, 'litri', 'WTT_BENZINA',  null, null, null, null, 0.5400,     5),
  -- ─── Cat 3 (Elettricità upstream WTT + T&D) — 4 righe ───────
  (2024,  3, 'WTT Elettricità (generazione)', 'Activity-based', null, 19748786, 'kWh', 'WTT_EE', null, null, null, null, 0.0380, 750),
  (2024,  3, 'T&D Losses Elettricità',        'Activity-based', null, 19748786, 'kWh', 'TD_EE',  null, null, null, null, 0.0190, 375),
  (2025,  3, 'WTT Elettricità (generazione)', 'Activity-based', null, 17223912, 'kWh', 'WTT_EE', null, null, null, null, 0.0380, 655),
  (2025,  3, 'T&D Losses Elettricità',        'Activity-based', null, 17223912, 'kWh', 'TD_EE',  null, null, null, null, 0.0190, 327);

-- ────────────────────────────────────────────────────────────────────
-- 3) RICALCOLO Em CANONICO da Q × FE / 1000
-- I valori Em_*_tCO2e nelle INSERT sopra sono quelli forniti
-- dall'utente (rounded a integer per leggibilità tabellare).
-- Qui ricalcoliamo con piena precisione dal FE applicato così la
-- prima loadAll() restituisce numeri consistenti con la formula
-- canonica (stesso comportamento di io.enrichForUpsert).
-- Solo righe con quantita > 0 (le altre conservano l'Em fornito).
-- ────────────────────────────────────────────────────────────────────
update public.s1
   set em_tco2e = round((quantita * fe_valore / 1000)::numeric, 6)
 where quantita is not null and quantita > 0
   and fe_valore is not null;

update public.s2
   set em_loc_tco2e = round((quantita * fe_location / 1000)::numeric, 6)
 where quantita is not null and quantita > 0
   and fe_location is not null;

update public.s2
   set em_mkt_tco2e = round((quantita * fe_market / 1000)::numeric, 6)
 where quantita is not null and quantita > 0
   and fe_market is not null;

update public.s3
   set em_tco2e = round((quantita * fe_valore / 1000)::numeric, 6)
 where quantita is not null and quantita > 0
   and fe_valore is not null;

-- ────────────────────────────────────────────────────────────────────
-- 4) VERIFICA POST-INSERT
-- Sanity check sui conteggi attesi.
-- ────────────────────────────────────────────────────────────────────
do $check$
declare
  c_fe int; c_s1 int; c_s2 int; c_s3 int;
  tot_s1 numeric; tot_s2lb numeric; tot_s3 numeric;
begin
  select count(*) into c_fe from public.fe;
  select count(*) into c_s1 from public.s1;
  select count(*) into c_s2 from public.s2;
  select count(*) into c_s3 from public.s3;
  if c_fe <> 74 then raise exception 'FE: atteso 74, trovato %', c_fe; end if;
  if c_s1 <> 31 then raise exception 'S1: atteso 31, trovato %', c_s1; end if;
  if c_s2 <> 15 then raise exception 'S2: atteso 15, trovato %', c_s2; end if;
  if c_s3 <> 100 then raise exception 'S3: atteso 100, trovato %', c_s3; end if;
  -- Totali post-ricalcolo (sanity, non vincolante)
  select sum(em_tco2e)     into tot_s1   from public.s1 where anno = 2024;
  select sum(em_loc_tco2e) into tot_s2lb from public.s2 where anno = 2024;
  select sum(em_tco2e)     into tot_s3   from public.s3 where anno = 2024;
  raise notice 'OK · FE=% S1=% S2=% S3=%', c_fe, c_s1, c_s2, c_s3;
  raise notice '2024 totals · S1=% tCO₂e · S2_LB=% tCO₂e · S3=% tCO₂e',
               round(tot_s1,1), round(tot_s2lb,1), round(tot_s3,1);
end $check$;

commit;

-- ════════════════════════════════════════════════════════════════════
-- end of 09_replace_data_2024_2025.sql
-- ════════════════════════════════════════════════════════════════════
