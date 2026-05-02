/* GHG Tool — Supabase client + traduzione campi + load + mutations.
 *
 * Espone:
 *   GHG.db.getClient()   istanza Supabase
 *   GHG.db.loadAll()     carica anagrafiche, produzione, fe, s1/s2/s3, materialità
 *   GHG.db.upsert(table, row)
 *   GHG.db.del(table, id)
 *   GHG.db.savemateriality(rows)
 *   GHG.db.refreshFacts() chiama public.get_public_dashboard
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
    const sb = getClient();
    const dbRow = appToDb(row);
    const { data, error } = await sb.from(table).upsert(dbRow).select().single();
    if (error) throw error;
    return dbToApp(data);
  }

  async function batchUpsert (table, rows) {
    const sb = getClient();
    const dbRows = rows.map(appToDb);
    const { data, error } = await sb.from(table).upsert(dbRows).select();
    if (error) throw error;
    return (data || []).map(dbToApp);
  }

  async function del (table, id) {
    const sb = getClient();
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  async function delProduzione (codice_sito, anno) {
    const sb = getClient();
    const { error } = await sb.from('produzione')
      .delete().eq('codice_sito', codice_sito).eq('anno', anno);
    if (error) throw error;
    return true;
  }

  async function saveMateriality (rows) {
    return batchUpsert('s3_materiality', rows);
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
    const { data, error } = await sb.from('s3_materiality_public').select('*');
    if (error) throw error;
    return data || [];
  }

  async function keepalivePing () {
    const sb = getClient();
    const { data, error } = await sb.rpc('keepalive_ping');
    if (error) throw error;
    return data;
  }

  async function refreshFacts () {
    // Tipicamente avviene via trigger automatici. Esposto per il bottone admin.
    const sb = getClient();
    const { data, error } = await sb.rpc('refresh_public_facts_manual');
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

  G.db = {
    getClient, role, loadAll, isConfigured,
    upsert, batchUpsert, del, delProduzione, saveMateriality,
    getPublicDashboard, listPublicYears, getMaterialityPublic,
    keepalivePing, refreshFacts, verifyAuditChain,
    logClientError, dbToApp, appToDb
  };
})(typeof window !== 'undefined' ? window : globalThis);
