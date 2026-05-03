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
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});

  // I segnaposto vengono sostituiti da build.mjs prima del deploy.
  const SUPABASE_URL = '__SUPABASE_URL__';
  const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';

  function isConfigured () {
    return SUPABASE_URL && !SUPABASE_URL.startsWith('__')
        && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('__');
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
      throw new Error('Configurazione Supabase mancante: rieseguire build.mjs con SUPABASE_URL e SUPABASE_ANON_KEY.');
    }
    if (!root.supabase || !root.supabase.createClient) {
      throw new Error('Supabase JS non caricato (verificare che la libreria UMD sia stata inlined).');
    }
    _client = root.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
    try {
      const sb = getClient();
      const session = sb.auth && sb.auth.session && sb.auth.session();
      // v2: usare getSession (async); qui leggiamo dal globale messo
      // a disposizione da AuthGate dopo il login.
      const cached = root.__GHG_ROLE;
      if (cached) return cached;
      return 'guest';
    } catch (_) { return 'guest'; }
  }

  // ─────────────────────────────────────────────────────────────────
  //  Load
  // ─────────────────────────────────────────────────────────────────
  async function loadAll () {
    const sb = getClient();
    const [
      anag, prod, fe, s1, s2, s3, mat, meta
    ] = await Promise.all([
      sb.from('anagrafiche').select('*').order('codice_sito'),
      sb.from('produzione').select('*'),
      sb.from('fe').select('*'),
      sb.from('s1').select('*'),
      sb.from('s2').select('*'),
      sb.from('s3').select('*'),
      sb.from('s3_materiality').select('*').order('cat_id'),
      sb.from('app_meta').select('*')
    ]);
    const anyError = [anag, prod, fe, s1, s2, s3, mat, meta].find(r => r.error);
    if (anyError) throw anyError.error;
    return {
      anagrafiche:    (anag.data || []).map(dbToApp),
      produzione:     (prod.data || []).map(dbToApp),
      fe:             (fe.data || []).map(dbToApp),
      s1:             (s1.data || []).map(dbToApp),
      s2:             (s2.data || []).map(dbToApp),
      s3:             (s3.data || []).map(dbToApp),
      s3_materiality: (mat.data || []).map(dbToApp),
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

  async function delProduzione (codice_sito, anno) {
    rateLimit('delProduzione');
    const sb = getClient();
    const { error } = await sb.from('produzione')
      .delete().eq('codice_sito', codice_sito).eq('anno', anno);
    if (error) throw error;
    return true;
  }

  async function delAnagrafica (codice_sito) {
    rateLimit('delAnagrafica');
    const sb = getClient();
    const { error } = await sb.from('anagrafiche')
      .delete().eq('codice_sito', codice_sito);
    if (error) throw error;
    return true;
  }

  async function saveMateriality (rows) {
    return batchUpsert('s3_materiality', rows);
  }

  // ─────────────────────────────────────────────────────────────────
  //  Cascade: dopo upsert su un FE, ricalcola e ri-salva tutte le
  //  righe S1 e S3 che lo referenziano.
  //  Rispetta la spec: "Quando si salva un FE: ricalcolo automatico
  //  di TUTTE le righe S1/S3 dipendenti, batch sbUpsert,
  //  refresh public_facts."
  // ─────────────────────────────────────────────────────────────────
  async function cascadeFEUpdate (feRow) {
    const sb = getClient();
    const calc = root.GHG && root.GHG.calc;
    if (!calc) return { s1: 0, s3: 0 };

    // Carica TUTTE le S1 + S3 + FE per fare lookup completo
    const [{ data: s1All }, { data: s3All }, { data: feAll }] = await Promise.all([
      sb.from('s1').select('*'),
      sb.from('s3').select('*'),
      sb.from('fe').select('*')
    ]);

    const fe = (feAll || []).map(dbToApp);

    // Filtra le righe che usano questo FE (per FE_ID o Codice_Voce)
    const feId = feRow.FE_ID || feRow.fe_id;
    const feCv = feRow.Codice_Voce || feRow.codice_voce;
    const matchesFE = (row, kind) => {
      if (kind === 's1') {
        // S1 usa Combustibile == FE.Codice_Voce + Anno_Validità
        return (row.combustibile === feCv);
      } else {
        // S3 usa Codice_FE == FE.FE_ID o == FE.Codice_Voce
        return (row.codice_fe === feId) || (row.codice_fe === feCv);
      }
    };
    const s1Touched = (s1All || []).filter(r => matchesFE(r, 's1'));
    const s3Touched = (s3All || []).filter(r => matchesFE(r, 's3'));

    // Ricalcola con il nuovo FE
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

    // Batch update
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

  async function logClientError (route, message, stack) {
    try {
      const sb = getClient();
      const session = await sb.auth.getSession();
      const userId = session && session.data && session.data.session
        ? session.data.session.user.id : null;
      await sb.from('client_errors').insert({
        user_id: userId, route, message,
        stack: stack ? String(stack).slice(0, 4000) : null
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

  G.db = {
    getClient, role, loadAll, isConfigured,
    upsert, batchUpsert, del, delProduzione, delAnagrafica, saveMateriality,
    cascadeFEUpdate,
    getPublicDashboard, listPublicYears, getMaterialityPublic,
    keepalivePing, verifyAuditChain,
    getLockedYears, setLockedYears, toggleYearLock,
    logClientError, dbToApp, appToDb
  };
})(typeof window !== 'undefined' ? window : globalThis);
