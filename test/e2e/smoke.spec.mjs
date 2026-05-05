/* GHG Tool — Smoke test runtime (Playwright)
 *
 * Verifica che le viste principali del bundle si aprano senza
 * lanciare ReferenceError o altri errori bloccanti. Sarebbe stato
 * il "fail safe" che avrebbe catturato il bug di PR #30/#31/#32:
 * 5 identifier rotti dopo lo split di DataManager — apparsi solo
 * a render runtime, sfuggiti a `npm test` + `npm run lint`.
 *
 * COSA TESTA
 *   1. Public Dashboard si carica senza errori console
 *   2. Console interna (con db stubbato lato client) apre tutte
 *      le sezioni della sidebar senza ReferenceError:
 *        Dashboard, Site, Scope, Materiality, Quality, FE,
 *        Scenarios, Output, Data (incluse 7 tab interne),
 *        Audit, Diagnostics
 *
 * COSA NON TESTA (intenzionale)
 *   - Login Supabase reale (richiederebbe credenziali in CI)
 *   - Mutazioni DB (richiederebbero account test)
 *   - Visual regression (fuori scope smoke test)
 *
 * STUB STRATEGY
 *   Prima del React mount, iniettiamo nel bundle uno stub di
 *   window.GHG.db che simula una sessione admin con dati minimi.
 *   In questo modo il render della console procede senza chiamare
 *   davvero Supabase. Niente network, test deterministici.
 */

import { test, expect } from '@playwright/test';

// Errors che NON sono bug nostri (prevenire falsi positivi)
const IGNORED_CONSOLE_PATTERNS = [
  /favicon/i,                     // favicon 404 in test environment
  /WebSocket connection/i,         // realtime non disponibile
  /^Failed to load resource/i,     // fetch verso supabase.co
  /Multiple GoTrueClient/i,        // nel test stub creiamo client multipli
  /Refused to (get|set) unsafe header/i  // CSP browser headers
];

function shouldIgnoreError (text) {
  return IGNORED_CONSOLE_PATTERNS.some(re => re.test(text));
}

/**
 * Snippet che gira PRIMA del bundle JS, sostituisce window.supabase
 * con uno stub che ritorna dati minimi e mock di tutte le API
 * usate dall'app. Necessario per renderizzare la console interna
 * senza una vera sessione Supabase.
 */
const STUB_INJECT = `
window.__GHG_TEST_MODE = true;
// Forza la rotta interna per i test di console
if (location.hash !== '#app') location.hash = '#app';

// Stub minimo del client Supabase usato dal bundle.
// Risponde alle API che il bundle invoca al boot:
//   auth.getSession, auth.onAuthStateChange, auth.mfa.*, from(t).select,
//   rpc, functions.invoke
const __stubData = {
  anagrafiche: [{ codice_sito: 'TEST', nome_sito: 'Sito test',
                   tipologia: 'Stabilimento', presenza_chp: false,
                   regime_ets: false, note_produzione: '' }],
  produzione:  [{ codice_sito: 'TEST', anno: 2024,
                   produzione_kg: 1000, produzione_m2: 10 }],
  fe:          [{ id: 'fe-1', fe_id: 'FE_GN_2024', famiglia: 'Combustibili',
                   codice_voce: 'Gas_Naturale', anno_validita: 2024,
                   valore: 1.984, unita: 'kgCO2e/Sm3', gas: 'CO2e',
                   fonte: 'ISPRA' }],
  s1:          [{ id: 's1-1', anno: 2024, codice_sito: 'TEST',
                   categoria_s1: 'Stazionaria', combustibile: 'Gas_Naturale',
                   quantita: 100, unita: 'Sm3', fe_valore: 1.984,
                   em_tco2e: 0.1984, qualita_dato: 'P', stato_dato: 'Definitivo' }],
  s2:          [{ id: 's2-1', anno: 2024, codice_sito: 'TEST',
                   voce_s2: 'EE_Acquistata', quantita: 1000, unita: 'kWh',
                   fe_location: 0.272, fe_market: 0.452,
                   em_loc_tco2e: 0.272, em_mkt_tco2e: 0.452,
                   qualita_dato: 'P', stato_dato: 'Definitivo' }],
  s3:          [{ id: 's3-1', anno: 2024, categoria_s3: 1,
                   sottocategoria: 'Materie prime', quantita: 100,
                   unita: 'kg', codice_fe: 'FE_GN_2024', fe_valore: 0.054,
                   em_tco2e: 5.4, qualita_dato: 'S', stato_dato: 'Provvisorio' }],
  s3_materiality: [{ cat_id: 1, status: 'Inclusa', justification: 'Test' }],
  app_meta:    [
    { key: 'last_data_refresh', value: new Date().toISOString() },
    { key: 'targets',           value: {} },
    { key: 'locked_years',      value: [] }
  ],
  audit_log:   [{ id: 1, ts: new Date().toISOString(), user_id: 'u-1',
                   user_email: 'admin@example.com',
                   table_name: 's1', operation: 'INSERT',
                   row_id: 's1-1', old_data: null, new_data: {},
                   prev_hash: null, row_hash: 'abc' }]
};

// JWT con app_metadata.role = 'admin' e aal2 (così il check MFA passa)
const ADMIN_JWT_HEADER  = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
const ADMIN_JWT_PAYLOAD = btoa(JSON.stringify({
  sub: 'u-1', email: 'admin@example.com',
  app_metadata: { role: 'admin' },
  aal: 'aal2', aud: 'authenticated', exp: Date.now() / 1000 + 3600
}));
const ADMIN_JWT = ADMIN_JWT_HEADER + '.' + ADMIN_JWT_PAYLOAD + '.signature';

const __stubSession = {
  access_token: ADMIN_JWT,
  refresh_token: 'r',
  expires_in: 3600,
  user: { id: 'u-1', email: 'admin@example.com',
          app_metadata: { role: 'admin' } }
};

// Stub di window.supabase compatibile con createClient(url, key, opts).
//
// Usiamo Object.defineProperty con setter no-op perché l'UMD reale
// (incluso inline da build.mjs) fa "self.supabase = factory()" e
// sovrascriverebbe il nostro stub. Con il descriptor configurable:false
// + set() vuoto, l'assignment dell'UMD è un silenzioso no-op (codice
// esterno non in strict mode), così il nostro stub rimane attivo.
const __stubSupabase = {
  createClient: function (url, key, opts) {
    const tableQuery = (table) => {
      const data = __stubData[table] || [];
      const chain = {
        select: () => chain,
        order:  () => chain,
        eq:     () => chain,
        in:     () => chain,
        limit:  () => chain,
        maybeSingle: () => Promise.resolve({ data: data[0] || null, error: null }),
        single: () => Promise.resolve({ data: data[0] || null, error: null }),
        then:   (cb) => Promise.resolve({ data, error: null }).then(cb),
        upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: data[0], error: null }) }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: data[0], error: null }) }) }),
        update: () => ({ eq: () => ({ select: () => Promise.resolve({ data, error: null }) }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) })
      };
      return chain;
    };

    return {
      auth: {
        getSession: () => Promise.resolve({ data: { session: __stubSession }, error: null }),
        onAuthStateChange: (cb) => {
          setTimeout(() => cb('SIGNED_IN', __stubSession), 0);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signInWithPassword: () => Promise.resolve({ data: { session: __stubSession }, error: null }),
        signOut: () => Promise.resolve({ error: null }),
        mfa: {
          getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }),
          listFactors: () => Promise.resolve({ data: { totp: [{ id: 'f1', status: 'verified' }] }, error: null }),
          challenge: () => Promise.resolve({ data: { id: 'c1' }, error: null }),
          verify: () => Promise.resolve({ data: { session: __stubSession }, error: null }),
          enroll: () => Promise.resolve({ data: { id: 'f1', totp: { qr_code: 'data:image/svg+xml;utf8,<svg/>', secret: 'BASE32' } }, error: null }),
          unenroll: () => Promise.resolve({ data: {}, error: null })
        }
      },
      from: tableQuery,
      rpc: (name) => {
        const stubResults = {
          get_public_dashboard: { anno: 2024, em_tco2e_total: 100, em_per_scope: { s1: 50, s2_lb: 30, s2_mb: 0, s3: 20 }, s3_breakdown: { 1: 20 }, site_pct: { TEST: 100 }, go_coverage_pct: 100, intensity_per_kg: 0.1, intensity_per_m2: 10 },
          list_public_years:    [2024, 2023, 2022, 2021, 2020],
          verify_audit_chain:   [],
          keepalive_ping:       { ok: true, ts: new Date().toISOString() }
        };
        return Promise.resolve({ data: stubResults[name] !== undefined ? stubResults[name] : null, error: null });
      },
      functions: {
        invoke: () => Promise.resolve({ data: { ok: true, signature: 'stub' }, error: null })
      }
    };
  }
};

Object.defineProperty(window, 'supabase', {
  configurable: false,
  enumerable: true,
  get () { return __stubSupabase; },
  set (_) { /* no-op: ignora assignment dell'UMD reale */ }
});
`;

test.describe('Public Dashboard', () => {
  test('si carica senza errori console critici', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !shouldIgnoreError(msg.text())) {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      if (!shouldIgnoreError(err.message)) errors.push(err.message);
    });

    await page.addInitScript(STUB_INJECT.replace(`if (location.hash !== '#app') location.hash = '#app';`, ''));
    await page.goto('/');

    // Aspetta che React abbia montato qualcosa
    await page.waitForFunction(() => document.querySelector('#root')?.children?.length > 0, { timeout: 10_000 });
    // Lascia tempo al fetch RPC finto e re-render
    await page.waitForTimeout(1000);

    expect(errors, `Errori console: ${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('Console interna — navigazione sezioni', () => {
  // Lista delle voci sidebar e le label visibili
  const SECTIONS = [
    { key: 'dashboard',   label: 'Dashboard' },
    { key: 'site',        label: 'Analisi per Sede' },
    { key: 'scope',       label: 'Analisi per Scope' },
    { key: 'materiality', label: 'Materialità' },
    { key: 'quality',     label: 'Data Quality' },
    { key: 'fe',          label: 'FE Explorer' },
    { key: 'scenarios',   label: 'Scenario' },
    { key: 'output',      label: 'Output' },
    { key: 'data',        label: 'Gestione Dati' },
    { key: 'audit',       label: 'Audit Trail' },
    { key: 'diag',        label: 'Diagnostica' }
  ];

  for (const s of SECTIONS) {
    test(`apre sezione "${s.label}" senza ReferenceError`, async ({ page }) => {
      const errors = [];
      page.on('console', msg => {
        if (msg.type() === 'error' && !shouldIgnoreError(msg.text())) {
          errors.push(msg.text());
        }
      });
      page.on('pageerror', err => {
        if (!shouldIgnoreError(err.message)) errors.push(err.message);
      });

      await page.addInitScript(STUB_INJECT);
      await page.goto('/');
      await page.waitForFunction(() => window.__GHG_ROLE === 'admin', { timeout: 10_000 });
      // Aspetta che la sidebar (aside) sia montata
      await page.waitForSelector('aside button', { timeout: 5_000 });

      // Click sulla voce di sidebar che match la label
      const btn = page.locator('aside button').filter({ hasText: s.label }).first();
      await btn.click({ timeout: 5_000 });

      // Lascia tempo al render della sezione
      await page.waitForTimeout(500);

      const refErrors = errors.filter(e => /ReferenceError|TypeError.*undefined/.test(e));
      expect(refErrors, `Errori critici nella sezione "${s.label}":\n${refErrors.join('\n')}`).toEqual([]);
    });
  }

  // Test specifico Gestione Dati: clicca tutte le 7 tab interne
  test('Gestione Dati — tutte le 7 tab si aprono', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !shouldIgnoreError(msg.text())) {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      if (!shouldIgnoreError(err.message)) errors.push(err.message);
    });

    await page.addInitScript(STUB_INJECT);
    await page.goto('/');
    await page.waitForFunction(() => window.__GHG_ROLE === 'admin', { timeout: 10_000 });
    await page.waitForSelector('aside button', { timeout: 5_000 });

    // Naviga a Gestione Dati
    await page.locator('aside button').filter({ hasText: 'Gestione Dati' }).first().click();
    await page.waitForSelector('[role="tablist"]', { timeout: 5_000 });

    // Tab della Gestione Dati (vedi src/sections/DataManager.jsx)
    const TABS = ['anagrafiche', 's1', 's2', 's3', 'fe', 'produzione', 'targets'];
    for (const t of TABS) {
      const errBefore = errors.length;
      await page.locator(`button#dm-tab-${t}`).click({ timeout: 3_000 });
      await page.waitForTimeout(400);
      const newRefErrors = errors.slice(errBefore).filter(e => /ReferenceError/.test(e));
      expect(newRefErrors, `ReferenceError nella tab DM "${t}":\n${newRefErrors.join('\n')}`).toEqual([]);
    }
  });
});
