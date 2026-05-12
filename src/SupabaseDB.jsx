/* GHG Tool — Supabase client + traduzione campi + load + mutations.
 *
 * Espone:
 *   GHG.db.getClient()   istanza Supabase
 *   GHG.db.loadAll()     carica anagrafiche, produzione, fe, s1/s2/s3, materialità
 *   GHG.db.upsert(table, row)
 *   GHG.db.del(table, id)
 *   GHG.db.savemateriality(rows)
 *   GHG.db.keepalivePing()
 *   GHG.db.role()        legge il ruolo dall'access_token
 *
 * ─── DATA SHAPES (post-dbToApp, App-named PascalCase) ────────────────
 *
 * Il DB usa snake_case; la UI usa PascalCase con accenti italiani
 * (es. Quantità, Unità). dbToApp/appToDb traducono ai bordi.
 * Le sezioni leggono SEMPRE i campi App-named, ma molte funzioni
 * accettano anche le chiavi snake_case per resilienza (es. dopo un
 * upsert grezzo). Quando aggiungi un campo nuovo: aggiungi anche
 * la mappatura in DB_TO_APP qui sotto, altrimenti il campo arriva
 * raw alla UI e nessuno lo trova.
 *
 * @typedef {Object} Anagrafica
 * @property {string}  Codice_Sito         PK, es. 'IANO', 'VIANO_GARGOLA'
 * @property {string}  Nome_Sito           es. 'Stabilimento Iano'
 * @property {string}  Tipologia           'Stabilimento' | 'Magazzino' | 'Logistica' | …
 * @property {boolean} [Presenza_CHP]
 * @property {boolean} [Regime_ETS]
 * @property {string}  [Nota]
 *
 * @typedef {Object} Produzione
 * @property {string} Codice_Sito         FK → anagrafiche
 * @property {number} Anno
 * @property {number} [Produzione_kg]     volume produttivo in kg
 * @property {number} [Produzione_m2]     superficie prodotta in m²
 * @property {string} [Note_Produzione]
 *
 * @typedef {Object} FE                   Emission Factor
 * @property {string} FE_ID               PK, es. 'FE_S1_METANO_2024'
 * @property {string} Famiglia            's1' | 's2' | 's3'
 * @property {string} Codice_Voce         lookup key (es. 'metano', 'argilla')
 * @property {string} Descrizione
 * @property {number} Anno_Validità
 * @property {number} Valore              kgCO₂e per Unità
 * @property {string} Unità               es. 'kgCO2e/kg', 'kgCO2e/kWh'
 * @property {string} [Gas]               'CO2e' | 'CO2' | 'CH4' | …
 * @property {string} [Fonte]             es. 'ISPRA', 'AIB', 'Min. Ambiente'
 *
 * @typedef {Object} S1Row                Combustione diretta
 * @property {string} Codice_Sito
 * @property {number} Anno
 * @property {string} Categoria_S1        'Stazionaria' | 'Mobile' | 'Process' | 'Fugitive'
 * @property {string} Combustibile        lookup key in FE.Codice_Voce
 * @property {number} Quantità
 * @property {string} Unità               es. 'kg', 'Sm3', 'litri'
 * @property {number} [FE_Valore]         FE applicato (popolato da enrichForUpsert)
 * @property {number} Em_tCO2e            calcolato: Quantità × FE / 1000
 * @property {string} [Fonte_Dato]
 * @property {string} [Qualità_Dato]      'A' | 'B' | 'C'
 * @property {string} [Stato_Dato]        'draft' | 'verified' | 'audited'
 *
 * @typedef {Object} S2Row                Energia elettrica acquistata
 * @property {string} Codice_Sito
 * @property {number} Anno
 * @property {string} Voce_S2             'EE_Acquistata' | 'EE_Acquistata_GO' | 'TLR' | …
 * @property {number} Quantità
 * @property {string} Unità               'kWh' (warning altrove)
 * @property {number} FE_Location         kgCO₂e/kWh, mix di rete (Italia ~0.355)
 * @property {number} FE_Market           kgCO₂e/kWh, contratto reale (0 se 100% GO)
 * @property {number} Em_Loc_tCO2e        Quantità × FE_Location / 1000
 * @property {number} Em_Mkt_tCO2e        Quantità × FE_Market   / 1000
 * @property {string} [Strumento_MB]      'GO' | 'PPA' | 'contract' | …
 *
 * @typedef {Object} S3Row                Catena del valore (15 categorie GHG Protocol)
 * @property {number} Categoria_S3        1..15
 * @property {string} [Sottocategoria]
 * @property {number} Anno
 * @property {string} [Codice_FE]         lookup in FE (FE_ID o Codice_Voce)
 * @property {string} [Metodo]            'Activity-based' | 'Spend-based' | …
 * @property {number} Quantità
 * @property {string} Unità
 * @property {number} [FE_Valore]
 * @property {number} Em_tCO2e
 *
 * @typedef {Object} S3MaterialityRow
 * @property {number} cat_id              1..15
 * @property {string} status              'Inclusa' | 'Esclusa' | 'N.A.' | 'Da valutare'
 * @property {string} [justification]
 * @property {string} [methodological_ref]
 * @property {number} [review_year]
 *
 * @typedef {Object} AppData              Output di loadAll()
 * @property {Anagrafica[]}        anagrafiche
 * @property {Produzione[]}        produzione
 * @property {FE[]}                fe
 * @property {S1Row[]}             s1
 * @property {S2Row[]}             s2
 * @property {S3Row[]}             s3
 * @property {S3MaterialityRow[]}  s3_materiality
 * @property {Object<string,*>}    app_meta    chiave → valore (targets, ecc.)
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});

  // I segnaposto vengono sostituiti da build.mjs prima del deploy.
  // SUPABASE_PUBLISHABLE_KEY è il nuovo nome della "anon key" Supabase
  // (formato sb_publishable_...). Il build inietta lo stesso valore
  // anche su __SUPABASE_ANON_KEY__ per retrocompatibilità con bundle
  // più vecchi che potrebbero leggere il vecchio segnaposto.
  const SUPABASE_URL = '__SUPABASE_URL__';
  const SUPABASE_PUBLISHABLE_KEY = '__SUPABASE_PUBLISHABLE_KEY__';

  function isConfigured () {
    return SUPABASE_URL && !SUPABASE_URL.startsWith('__')
        && SUPABASE_PUBLISHABLE_KEY && !SUPABASE_PUBLISHABLE_KEY.startsWith('__');
  }

  let _client = null;

  // ─────────────────────────────────────────────────────────────────
  //  Client-side rate limiting (defense in depth — il DB ha i suoi
  //  limiti). Sliding window: max 30 mutazioni / 10 secondi per
  //  prevenire flooding accidentale (es. loop di import non chiuso).
  //  Il DB non viene comunque sovraccaricato grazie ai rate limit di
  //  Supabase, ma errori espliciti client-side aiutano a debuggare.
  // ─────────────────────────────────────────────────────────────────
  const RATE_WINDOW_MS = 10_000;
  const RATE_LIMIT = 30;
  const _rateStamps = [];
  function rateLimit (opName) {
    const now = Date.now();
    while (_rateStamps.length && _rateStamps[0] < now - RATE_WINDOW_MS) {
      _rateStamps.shift();
    }
    if (_rateStamps.length >= RATE_LIMIT) {
      throw new Error(
        `Rate limit: troppe mutazioni (${RATE_LIMIT} in ${RATE_WINDOW_MS/1000}s). ` +
        `Operazione "${opName}" rifiutata. Riprova fra qualche secondo.`
      );
    }
    _rateStamps.push(now);
  }

  function getClient () {
    if (_client) return _client;
    if (!isConfigured()) {
      throw new Error('Configurazione Supabase mancante: rieseguire build.mjs con SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY.');
    }
    if (!root.supabase || !root.supabase.createClient) {
      throw new Error('Supabase JS non caricato (verificare che la libreria UMD sia stata inlined).');
    }
    _client = root.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: 'pkce',
        storage: root.sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
    return _client;
  }

  // ─────────────────────────────────────────────────────────────────
  //  Traduzione DB ↔ App (snake_case ↔ CamelCase / PascalCase)
  // ─────────────────────────────────────────────────────────────────
  const DB_TO_APP = {
    anno:'Anno', codice_sito:'Codice_Sito', scope:'Scope',
    fonte_dato:'Fonte_Dato', qualita_dato:'Qualità_Dato',
    stato_dato:'Stato_Dato', note:'Note',
    categoria_s1:'Categoria_S1', combustibile:'Combustibile',
    quantita:'Quantità', unita:'Unità', fe_valore:'FE_Valore',
    em_tco2e:'Em_tCO2e', voce_s2:'Voce_S2', strumento_mb:'Strumento_MB',
    fe_location:'FE_Location', fe_market:'FE_Market',
    em_loc_tco2e:'Em_Loc_tCO2e', em_mkt_tco2e:'Em_Mkt_tCO2e',
    categoria_s3:'Categoria_S3', sottocategoria:'Sottocategoria',
    metodo:'Metodo', codice_fe:'Codice_FE', tabella:'Tabella',
    fe_id:'FE_ID', famiglia:'Famiglia', codice_voce:'Codice_Voce',
    descrizione:'Descrizione', anno_validita:'Anno_Validità',
    valore:'Valore', gas:'Gas', fonte:'Fonte', nota:'Nota',
    nome_sito:'Nome_Sito', tipologia:'Tipologia',
    presenza_chp:'Presenza_CHP', regime_ets:'Regime_ETS',
    note_produzione:'Note_Produzione',
    produzione_kg:'Produzione_kg', produzione_m2:'Produzione_m2',
    cat_id:'cat_id', status:'status', justification:'justification',
    methodological_ref:'methodological_ref', review_year:'review_year',
    id:'id'
  };
  const APP_TO_DB = Object.fromEntries(
    Object.entries(DB_TO_APP).map(([k,v]) => [v, k])
  );

  function dbToApp (row) {
    if (!row) return row;
    const out = {};
    for (const k of Object.keys(row)) {
      out[DB_TO_APP[k] || k] = row[k];
    }
    return out;
  }
  function appToDb (row) {
    if (!row) return row;
    const out = {};
    for (const k of Object.keys(row)) {
      const dbKey = APP_TO_DB[k] || k;
      // Filtra timestamp gestiti dal DB
      if (['created_at','updated_at','created_by','updated_by'].includes(dbKey)) continue;
      out[dbKey] = row[k];
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  //  Role
  // ─────────────────────────────────────────────────────────────────
  function role () {
    // getSession() di Supabase v2 è async — leggiamo invece dal globale
    // messo a disposizione da AuthGate dopo il login (sincrono).
    return root.__GHG_ROLE || 'guest';
  }

  // ─────────────────────────────────────────────────────────────────
  //  Load
  // ─────────────────────────────────────────────────────────────────
  /** @returns {Promise<AppData>} */
  async function loadAll () {
    const sb = getClient();
    const [
      anag, prod, fe, s1, s2, s3, mat, meta, sto
    ] = await Promise.all([
      sb.from('anagrafiche').select('*').order('codice_sito'),
      sb.from('produzione').select('*'),
      sb.from('fe').select('*'),
      sb.from('s1').select('*'),
      sb.from('s2').select('*'),
      sb.from('s3').select('*'),
      sb.from('s3_materiality').select('*').order('cat_id'),
      sb.from('app_meta').select('*'),
      sb.from('sito_tipologia_override').select('*').order('codice_sito').order('anno')
    ]);
    const anyError = [anag, prod, fe, s1, s2, s3, mat, meta, sto].find(r => r.error);
    if (anyError) throw anyError.error;
    return {
      anagrafiche:    (anag.data || []).map(dbToApp),
      produzione:     (prod.data || []).map(dbToApp),
      fe:             (fe.data || []).map(dbToApp),
      s1:             (s1.data || []).map(dbToApp),
      s2:             (s2.data || []).map(dbToApp),
      s3:             (s3.data || []).map(dbToApp),
      s3_materiality: (mat.data || []).map(dbToApp),
      sito_tipologia_override: (sto.data || []).map(dbToApp),
      app_meta:       (meta.data || []).reduce((acc, r) => {
        acc[r.key] = r.value; return acc;
      }, {})
    };
  }

  async function upsert (table, row) {
    rateLimit(`upsert ${table}`);
    const sb = getClient();
    const dbRow = appToDb(row);
    const { data, error } = await sb.from(table).upsert(dbRow).select().single();
    if (error) throw error;
    return dbToApp(data);
  }

  async function batchUpsert (table, rows) {
    rateLimit(`batchUpsert ${table}(${rows.length})`);
    const sb = getClient();
    const dbRows = rows.map(appToDb);
    const { data, error } = await sb.from(table).upsert(dbRows).select();
    if (error) throw error;
    return (data || []).map(dbToApp);
  }

  async function del (table, id) {
    rateLimit(`del ${table}`);
    const sb = getClient();
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  //  Bulk delete: elimina molte righe in una sola query DB.
  //  Solo per tabelle con PK semplice 'id' (UUID): s1, s2, s3, fe.
  //  Chunked a 200 ids per chiamata per restare sotto i limiti
  //  di URL length di PostgREST.
  //  Restituisce il numero di righe richieste per delete (Supabase
  //  non torna un count affidabile su delete, quindi ritorniamo il
  //  count del payload).
  // ─────────────────────────────────────────────────────────────────
  async function batchDelete (table, ids) {
    rateLimit(`batchDelete ${table}(${ids.length})`);
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const sb = getClient();
    const CHUNK = 200;
    let totalRequested = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { error } = await sb.from(table).delete().in('id', slice);
      if (error) throw error;
      totalRequested += slice.length;
    }
    return totalRequested;
  }

  // ─────────────────────────────────────────────────────────────────
  //  anonProbe — security check: anon (no session) NON deve leggere
  //  le tabelle protette. Usa un client Supabase separato senza
  //  sessione persistita (solo apikey anon, no Authorization Bearer).
  //  Ritorna { ok, leaked: [tables] }.
  // ─────────────────────────────────────────────────────────────────
  async function anonProbe () {
    if (!root.supabase || !root.supabase.createClient) {
      return { ok: false, error: 'Supabase JS non caricato' };
    }
    const probe = root.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'ghg_anon_probe'  // isolato dalla sessione utente
      }
    });
    // Tabelle protette (NON public_facts, che è la view pubblica per
    // la dashboard anonima). Se anche solo una di queste ritorna ≥ 1
    // riga al client anon, c'è un leak RLS.
    const TABLES = ['s1', 's2', 's3', 'fe',
      'anagrafiche', 'produzione', 'audit_log',
      's3_materiality', 'app_meta', 'role_map'];
    const leaked = [];
    for (const t of TABLES) {
      try {
        const { data, error } = await probe.from(t).select('*').limit(1);
        // RLS rifiuta tipicamente con error o con data = [] (a seconda
        // della config). Solo data.length > 0 è leak vero.
        if (!error && Array.isArray(data) && data.length > 0) {
          leaked.push(t);
        }
      } catch (_) { /* network/timeout: ignora, non è un leak */ }
    }
    return { ok: leaked.length === 0, leaked, tested: TABLES.length };
  }

  async function delProduzione (codice_sito, anno) {
    rateLimit('delProduzione');
    const sb = getClient();
    const { error } = await sb.from('produzione')
      .delete().eq('codice_sito', codice_sito).eq('anno', anno);
    if (error) throw error;
    return true;
  }

  // Save produzione gestendo PK composita (codice_sito, anno).
  // Se l'utente ha modificato uno dei due campi della PK (es. cambia
  // anno o sposta riga su un altro sito), un upsert puro INSERT-erebbe
  // una nuova riga lasciando la vecchia orfana.
  //
  // Implementazione: chiama la RPC atomica public.save_produzione(...)
  // (definita in sql/13_hardening.sql) che fa DELETE+UPSERT in una sola
  // transazione. Se la function non è ancora deployata sul DB legacy,
  // fallback al vecchio percorso DELETE+UPSERT non-atomico con warning
  // in console (race window di pochi ms).
  async function saveProduzione (newRow, originalKey) {
    rateLimit('saveProduzione');
    const sb = getClient();
    const { data, error } = await sb.rpc('save_produzione', {
      p_codice_sito: newRow.Codice_Sito,
      p_anno:        +newRow.Anno,
      p_kg:          newRow.Produzione_kg ?? null,
      p_m2:          newRow.Produzione_m2 ?? null,
      p_note:        newRow.Note ?? newRow.Note_Produzione ?? null,
      p_orig_sito:   originalKey ? originalKey.codice_sito : null,
      p_orig_anno:   originalKey ? +originalKey.anno : null
    });
    if (!error) return dbToApp(Array.isArray(data) ? data[0] : data);

    // Fallback legacy: la RPC atomica non è disponibile (DB pre-13_hardening.sql).
    // PGRST202 = function not found in PostgREST schema cache.
    if (error.code === 'PGRST202' || /save_produzione/.test(error.message || '')) {
      // eslint-disable-next-line no-console
      console.warn('[saveProduzione] RPC save_produzione non disponibile — applico DELETE+UPSERT non atomico. Eseguire sql/13_hardening.sql per chiudere la race window.');
      if (originalKey
          && (originalKey.codice_sito !== newRow.Codice_Sito
           || +originalKey.anno !== +newRow.Anno)) {
        const { error: delErr } = await sb.from('produzione')
          .delete()
          .eq('codice_sito', originalKey.codice_sito)
          .eq('anno', originalKey.anno);
        if (delErr) throw delErr;
      }
      const dbRow = appToDb(newRow);
      const { data: row, error: upErr } = await sb.from('produzione')
        .upsert(dbRow).select().single();
      if (upErr) throw upErr;
      return dbToApp(row);
    }
    throw error;
  }

  async function delAnagrafica (codice_sito) {
    rateLimit('delAnagrafica');
    const sb = getClient();
    const { error } = await sb.from('anagrafiche')
      .delete().eq('codice_sito', codice_sito);
    if (error) throw error;
    return true;
  }

  async function saveSitoTipologiaOverride (row) {
    rateLimit('saveSitoTipologiaOverride');
    const sb = getClient();
    const dbRow = appToDb(row);
    const { data, error } = await sb.from('sito_tipologia_override')
      .upsert(dbRow, { onConflict: 'codice_sito,anno' }).select().single();
    if (error) throw error;
    return dbToApp(data);
  }

  async function delSitoTipologiaOverride (codice_sito, anno) {
    rateLimit('delSitoTipologiaOverride');
    const sb = getClient();
    const { error } = await sb.from('sito_tipologia_override')
      .delete().eq('codice_sito', codice_sito).eq('anno', anno);
    if (error) throw error;
    return true;
  }

  async function saveMateriality (rows) {
    return batchUpsert('s3_materiality', rows);
  }

  // ─────────────────────────────────────────────────────────────────
  //  Copia anno: clona la struttura di S1/S2/S3/Produzione da un
  //  anno sorgente a uno destinazione.
  //
  //  Strategia:
  //  - Quantità COPIATE (l'utente le aggiusta dove serve)
  //  - FE_Valore / FE_Location / FE_Market / Em_* AZZERATI a null
  //    (sono anno-specifici → vanno ri-applicati con i FE del nuovo anno)
  //  - stato_dato = 'Provvisorio' (forza la verifica)
  //  - dedup logico: salta righe che già esistono in dst per la stessa
  //    combo business (sito+voce per S1/S2, categoria+sottocat+codice_fe
  //    per S3, sito per produzione)
  //  - id (UUID) NON copiato → il DB ne genera uno nuovo
  //  - created_at/by/updated_at/by NON copiati → DB li gestisce
  //
  //  Restituisce un summary { perTable: { s1: {inserted, skipped}, ... }, totalInserted, totalSkipped }.
  //  Operazione client-side multi-step (no transazione) — su errore
  //  parziale alcune tabelle possono essere inserite e altre no.
  //  Mostriamo il summary dettagliato nel toast/modal di conferma.
  // ─────────────────────────────────────────────────────────────────
  async function cloneYear (srcYear, dstYear) {
    rateLimit('cloneYear');
    if (!srcYear || !dstYear) throw new Error('Anno sorgente e destinazione richiesti');
    if (+srcYear === +dstYear) throw new Error('Anno sorgente e destinazione devono essere diversi');
    const sb = getClient();
    const summary = { perTable: {}, totalInserted: 0, totalSkipped: 0 };

    // Per S1, S2, S3, Produzione definiamo come ricavare la "chiave
    // business" (per dedup) e come trasformare la riga dst.
    const tableSpecs = [
      {
        name: 's1',
        // Chiave logica per dedup nel dst
        keyOf: r => [r.codice_sito, r.categoria_s1 || '', r.combustibile || ''].join('|'),
        // Campi azzerati nella copia (oltre a id/timestamp)
        nullify: ['fe_valore','em_tco2e']
      },
      {
        name: 's2',
        keyOf: r => [r.codice_sito, r.voce_s2 || ''].join('|'),
        nullify: ['fe_location','fe_market','em_loc_tco2e','em_mkt_tco2e']
      },
      {
        name: 's3',
        keyOf: r => [r.categoria_s3, r.sottocategoria || '', r.codice_fe || '', r.combustibile || ''].join('|'),
        nullify: ['fe_valore','em_tco2e']
      },
      {
        name: 'produzione',
        // Per produzione la PK è (codice_sito, anno) → dedup per sito basta
        keyOf: r => r.codice_sito,
        nullify: []  // i valori produttivi vanno copiati così come sono
      }
    ];

    // Campi mai copiati: id (UUID auto), audit timestamp/user (DB-managed)
    const STRIP = new Set(['id','created_at','created_by','updated_at','updated_by']);

    for (const spec of tableSpecs) {
      // 1) Carica righe sorgente
      const { data: srcRows, error: srcErr } = await sb.from(spec.name)
        .select('*').eq('anno', srcYear);
      if (srcErr) throw new Error(`${spec.name}: errore lettura anno ${srcYear} · ${srcErr.message}`);

      // 2) Carica chiavi già presenti nel dst (solo per dedup)
      const { data: dstRows, error: dstErr } = await sb.from(spec.name)
        .select('*').eq('anno', dstYear);
      if (dstErr) throw new Error(`${spec.name}: errore lettura anno ${dstYear} · ${dstErr.message}`);
      const existingKeys = new Set((dstRows || []).map(spec.keyOf));

      // 3) Costruisci righe da inserire (solo quelle non già presenti)
      const toInsert = [];
      let skipped = 0;
      for (const r of (srcRows || [])) {
        const k = spec.keyOf(r);
        if (existingKeys.has(k)) { skipped++; continue; }
        const newRow = {};
        for (const [field, val] of Object.entries(r)) {
          if (STRIP.has(field)) continue;
          newRow[field] = val;
        }
        newRow.anno = +dstYear;
        for (const f of spec.nullify) newRow[f] = null;
        // Default stato_dato = 'Provvisorio' per le righe clonate, così
        // sono visivamente distinte e l'utente sa che vanno verificate.
        // (Non sovrascriviamo se la sorgente ha già 'Stimato' che vogliamo preservare.)
        if ('stato_dato' in newRow && newRow.stato_dato !== 'Stimato') {
          newRow.stato_dato = 'Provvisorio';
        } else if (!('stato_dato' in newRow)) {
          newRow.stato_dato = 'Provvisorio';
        }
        toInsert.push(newRow);
      }

      // 4) Batch insert (chunked a 500 per essere safe sui limiti PostgREST)
      let inserted = 0;
      const CHUNK = 500;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const slice = toInsert.slice(i, i + CHUNK);
        const { data: ins, error: insErr } = await sb.from(spec.name)
          .insert(slice).select('id');
        if (insErr) throw new Error(`${spec.name}: insert fallito · ${insErr.message}`);
        inserted += (ins || []).length;
      }

      summary.perTable[spec.name] = { inserted, skipped, sourceRows: (srcRows || []).length };
      summary.totalInserted += inserted;
      summary.totalSkipped  += skipped;
    }

    return summary;
  }

  // ─────────────────────────────────────────────────────────────────
  //  Cascade: dopo upsert su un FE, ricalcola e ri-salva tutte le
  //  righe S1 e S3 che lo referenziano.
  //
  //  Implementazione preferita: RPC atomica public.cascade_fe_update(...)
  //  (sql/13_hardening.sql). Esegue gli UPDATE su S1 e S3 in una sola
  //  transazione → niente stato parziale in caso di errore.
  //
  //  Fallback (DB legacy senza la RPC): vecchio percorso "carica tutto
  //  in memoria + 2 batch upsert separati", non transazionale.
  // ─────────────────────────────────────────────────────────────────
  async function cascadeFEUpdate (feRow) {
    const sb = getClient();
    const feId = feRow.FE_ID || feRow.fe_id || null;
    const feCv = feRow.Codice_Voce || feRow.codice_voce || null;
    const feAnno = +(feRow.Anno_Validità || feRow.anno_validita || 0) || null;

    if (feAnno) {
      const { data, error } = await sb.rpc('cascade_fe_update', {
        p_fe_id:         feId,
        p_codice_voce:   feCv,
        p_anno_validita: feAnno
      });
      if (!error) {
        const row = Array.isArray(data) ? data[0] : data;
        return { s1: +(row && row.s1_updated) || 0, s3: +(row && row.s3_updated) || 0 };
      }
      if (error.code !== 'PGRST202' && !/cascade_fe_update/.test(error.message || '')) {
        throw error;
      }
      // eslint-disable-next-line no-console
      console.warn('[cascadeFEUpdate] RPC non disponibile — fallback non atomico. Eseguire sql/13_hardening.sql.');
    }

    // ── Fallback legacy ────────────────────────────────────────────
    const calc = root.GHG && root.GHG.calc;
    if (!calc) return { s1: 0, s3: 0 };

    const [{ data: s1All }, { data: s3All }, { data: feAll }] = await Promise.all([
      sb.from('s1').select('*'),
      sb.from('s3').select('*'),
      sb.from('fe').select('*')
    ]);
    const fe = (feAll || []).map(dbToApp);
    const matchesFE = (row, kind) => kind === 's1'
      ? (row.combustibile === feCv)
      : ((row.codice_fe === feId) || (row.codice_fe === feCv));
    const s1Touched = (s1All || []).filter(r => matchesFE(r, 's1'));
    const s3Touched = (s3All || []).filter(r => matchesFE(r, 's3'));

    const recalc = (row, table) => {
      const appRow = dbToApp(row);
      const lk = calc.lookupFE(table, appRow, fe);
      if (!lk.fe) return null;
      const feValore = +(lk.fe.Valore || lk.fe.valore || 0);
      const qty = +(appRow.Quantità || appRow.quantita || 0);
      const em = qty * feValore / 1000;
      return { ...row, fe_valore: feValore, em_tco2e: em };
    };
    const s1New = s1Touched.map(r => recalc(r, 's1')).filter(Boolean);
    const s3New = s3Touched.map(r => recalc(r, 's3')).filter(Boolean);
    if (s1New.length) {
      const { error } = await sb.from('s1').upsert(s1New).select();
      if (error) throw error;
    }
    if (s3New.length) {
      const { error } = await sb.from('s3').upsert(s3New).select();
      if (error) throw error;
    }
    return { s1: s1New.length, s3: s3New.length };
  }

  // ─────────────────────────────────────────────────────────────────
  //  Public RPC (anche per anon — PublicDashboard)
  // ─────────────────────────────────────────────────────────────────
  async function getPublicDashboard (year) {
    const sb = getClient();
    const { data, error } = await sb.rpc('get_public_dashboard', { p_year: year });
    if (error) throw error;
    return data;
  }
  async function listPublicYears () {
    const sb = getClient();
    const { data, error } = await sb.rpc('list_public_years');
    if (error) throw error;
    return data || [];
  }

  async function getMaterialityPublic () {
    const sb = getClient();
    const { data, error } = await sb.from('s3_materiality_public')
      .select('*').order('cat_id');
    if (error) throw error;
    return data || [];
  }

  async function keepalivePing () {
    const sb = getClient();
    const { data, error } = await sb.rpc('keepalive_ping');
    if (error) throw error;
    return data;
  }

  async function verifyAuditChain () {
    const sb = getClient();
    const { data, error } = await sb.rpc('verify_audit_chain');
    if (error) throw error;
    return data;
  }

  // Storico dei check schedulati settimanali (vedi sql/16_audit_chain_cron.sql).
  // Restituisce gli ultimi 10 record dalla view audit_chain_status. RLS:
  // accessibile solo da admin sempre, auditor a aal2.
  async function getAuditChainHistory () {
    const sb = getClient();
    const { data, error } = await sb.from('audit_chain_status')
      .select('*').order('ts', { ascending: false }).limit(10);
    if (error) throw error;
    return data || [];
  }

  // ─────────────────────────────────────────────────────────────────
  //  Ricerca FE online — DISABILITATA in UI (FEExplorer.jsx).
  //
  //  La Edge Function search_fe e la tabella di audit fe_search_log
  //  restano nel repo / nel DB per uso futuro o storico, ma nessuno
  //  le chiama da qui. Wrapper rimossi:
  //   - searchFE(query, year, scope)
  //   - markFESearchSelected(logId, idx, savedFeId)
  //  Vedi 9d6c8 / commit history.
  // ─────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────
  //  AI generica (Edge Function ai_assist · Gemini SENZA grounding).
  //  Quota separata da searchFE: usa il pool del modello puro
  //  (gemini-3.1-flash-lite, 500 RPD free) invece di Grounding-2.5.
  //
  //  Task supportati:
  //   - 'explain_balance' : payload = { year, totals: {s1,s2lb,s2mb,s3},
  //         intensity: {perM2,perKg}, go_coverage_pct, sites: [...],
  //         s2_method: 'lb'|'mb' }
  //         → returns { text: "<markdown>" }
  //   - 'normalize_unit'  : payload = { raw: "kg co2 eq per kwh" }
  //         → returns { unit, alternatives[], rationale }
  //   - 'suggest_code'    : payload = { descrizione, famiglia?,
  //         existing_codes? }
  //         → returns { codice_voce, famiglia, descrizione_breve, rationale }
  //
  //  Tutti i task sono loggati in ai_assist_log per audit.
  // ─────────────────────────────────────────────────────────────────
  async function aiAssist (task, payload) {
    const sb = getClient();
    const { data, error } = await sb.functions.invoke('ai_assist', {
      body: { task, payload }
    });
    if (error) {
      let detail = error.message || 'Edge Function fallita';
      try {
        if (error.context && typeof error.context.json === 'function') {
          const body = await error.context.json();
          if (body && body.error) detail = body.error;
        }
      } catch (_) { /* ignora errori di parse del body */ }
      throw new Error(detail);
    }
    if (data && data.ok === false) throw new Error(data.error || 'AI assist fallita');
    return data;
  }

  // Filtro PII per evitare di scrivere email / IBAN / codici fiscali /
  // Bearer token / numeri di telefono in client_errors. La tabella è
  // leggibile solo da admin (sql/06_client_errors.sql:32-36) ma è
  // comunque una buona difesa-in-profondità lato client (GDPR
  // minimization).
  const PII_PATTERNS = [
    // Email
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
    // Bearer / JWT (eyJ... 3 segmenti dot-separati base64url; tollera
    // segmenti corti tipo `eyJhdr.payload.sig` per coprire sia JWT veri
    // sia placeholder dummy che potrebbero finire in stack).
    [/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[jwt]'],
    [/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [redacted]'],
    // IBAN (semplificato: 2 lettere + 2 cifre + 11..30 alfanumerici)
    [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '[iban]'],
    // Codice fiscale italiano (16 alfanum maiuscoli con pattern noto)
    [/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g, '[cf]'],
    // Numero telefono internazionale (best-effort): country code +
    // 1-3 separatori opzionali (spazio, punto, dash) e 7..14 cifre
    // totali. Copre +39 333 1234567 e +39.333.1234567 ma non casi
    // patologici con tab o more separators.
    [/\+\d{1,3}(?:[\s.-]?\d{1,4}){1,4}\b/g, '[tel]']
  ];
  function redactPII (s) {
    if (s == null) return s;
    let out = String(s);
    for (const [re, rep] of PII_PATTERNS) out = out.replace(re, rep);
    return out;
  }

  async function logClientError (route, message, stack) {
    try {
      const sb = getClient();
      const session = await sb.auth.getSession();
      const userId = session && session.data && session.data.session
        ? session.data.session.user.id : null;
      await sb.from('client_errors').insert({
        user_id: userId,
        route:   redactPII(route),
        message: redactPII(message),
        stack:   stack ? redactPII(String(stack)).slice(0, 4000) : null
      });
    } catch (_) { /* non rilanciare per non creare loop */ }
  }

  // ─────────────────────────────────────────────────────────────────
  //  Year lock / sign-off (admin-only via RLS su app_meta)
  // ─────────────────────────────────────────────────────────────────
  async function getLockedYears () {
    const sb = getClient();
    const { data, error } = await sb.from('app_meta')
      .select('value').eq('key', 'locked_years').maybeSingle();
    if (error) throw error;
    if (!data) return [];
    const v = data.value;
    return Array.isArray(v) ? v.map(Number).filter(n => isFinite(n)) : [];
  }
  async function setLockedYears (years) {
    const sb = getClient();
    const v = (years || []).map(Number).filter(n => isFinite(n)).sort((a,b) => a-b);
    const { error } = await sb.from('app_meta')
      .upsert({ key: 'locked_years', value: v }, { onConflict: 'key' });
    if (error) throw error;
    return v;
  }
  async function toggleYearLock (year, locked) {
    const cur = await getLockedYears();
    const set = new Set(cur);
    if (locked) set.add(+year); else set.delete(+year);
    return setLockedYears([...set]);
  }

  // ─────────────────────────────────────────────────────────────────
  //  Target di Piano (baseline + 2034 + 2050)
  //  Salvati in app_meta.targets come JSON. Sovrascrivono G.TARGETS
  //  in App.jsx al loadAll(). Solo admin può scrivere (RLS app_meta).
  // ─────────────────────────────────────────────────────────────────
  async function saveTargets (targets) {
    rateLimit('saveTargets');
    const sb = getClient();
    const { error } = await sb.from('app_meta')
      .upsert({ key: 'targets', value: targets }, { onConflict: 'key' });
    if (error) throw error;
    return targets;
  }

  G.db = {
    getClient, role, loadAll, isConfigured,
    upsert, batchUpsert, del, batchDelete, delProduzione, saveProduzione, delAnagrafica,
    saveSitoTipologiaOverride, delSitoTipologiaOverride,
    saveMateriality,
    cloneYear,
    anonProbe,
    cascadeFEUpdate,
    getPublicDashboard, listPublicYears, getMaterialityPublic,
    keepalivePing, verifyAuditChain, getAuditChainHistory,
    aiAssist,
    getLockedYears, setLockedYears, toggleYearLock, saveTargets,
    logClientError, dbToApp, appToDb,
    // Esposto per test unitari
    redactPII
  };
})(typeof window !== 'undefined' ? window : globalThis);
