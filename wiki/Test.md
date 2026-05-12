# Test

## Unit test — `npm test`

Runner **zero-dep** custom: `test/_runner.mjs` (~110 righe) con API
tipo Jest.

### API runner

```js
import { describe, test, expect } from './_runner.mjs';

describe('mySuite', () => {
  test('check something', () => {
    expect(actual).toBe(expected);
    expect(actual).toEqual(deepEqual);
    expect(actual).toBeCloseTo(expected, digits=6);
    expect(actual).toBeNull();
    expect(actual).toBeTruthy();
    expect(actual).toBeFalsy();
    expect(actual).toContain(item);
    expect(actual).toHaveLength(n);
  });
});

// Esecuzione automatica via run() in test/index.mjs
```

### Loader sorgenti — `test/_load.mjs`

I sorgenti `src/*` sono IIFE che si attaccano a `window`/`globalThis`. In
Node il loader fa:

```js
import vm from 'node:vm';

export function loadSource (relPath) {
  const full = path.join(SRC_DIR, relPath);
  const code = fs.readFileSync(full, 'utf8');
  vm.runInThisContext(code, { filename: relPath });
}

export function resetGHG () {
  globalThis.GHG = {};
  if (typeof globalThis.window === 'undefined') globalThis.window = undefined;
}
```

Niente bundler, niente Babel: i test si limitano ai sorgenti JS puro
(`calc.js`, `constants.js`, `sanitize.js`, `SupabaseDB.jsx` limitatamente a
`redactPII`, `io.jsx` limitatamente a `enrichForUpsert`/`crc32`/`makeZip`).

I `.jsx` veri (rendering React) non sono testati a unit level — coperti
da Playwright e2e.

### Suite — 67 test totali

#### `test/calc.test.mjs` (35 test) — formule emissione

```js
describe('calc.num — parsing resiliente', () => {
  test('null/undefined/empty → 0', () => {
    expect(calc.num(null)).toBe(0);
    expect(calc.num(undefined)).toBe(0);
    expect(calc.num('')).toBe(0);
  });
  test('numero passa pulito', () => {
    expect(calc.num(42)).toBe(42);
    expect(calc.num(-3.14)).toBe(-3.14);
  });
  test('virgola decimale italiana', () => {
    expect(calc.num('1234,56')).toBe(1234.56);
  });
  test('NaN/Infinity → 0', () => {
    expect(calc.num(NaN)).toBe(0);
    expect(calc.num(Infinity)).toBe(0);
    expect(calc.num('boh')).toBe(0);
  });
});

describe('calc.emS1 / emS2 / emS3 — formule', () => {
  test('emS1: 1000 kg metano × 2.75 kgCO₂e/kg = 2.75 tCO₂e', () => {
    expect(calc.emS1(1000, 2.75)).toBeCloseTo(2.75, 4);
  });
  test('emS2Loc: 100 000 kWh × 0.355 = 35.5 tCO₂e', () => { ... });
  test('emS2Mkt: GO al 100% → FE_Market = 0 → emissione = 0', () => { ... });
});
```

Copre:
* `num` resiliente
* `emS1`, `emS2Loc`, `emS2Mkt`, `emS3`
* `lookupFE` con fallback Δ=0/1/2/>2 anni
* `validateRow` per s1/s2/s3/produzione/fe
* `intensity` (gruppo) e `intensityPerSite` (LB vs MB)
* `totals` (filtro per sito, S3 organizzativo)
* `availableYears` (dedup + sort desc)
* Verifica numerica scenario Piano Decarb

#### `test/io.test.mjs` (15 test) — `enrichForUpsert`

Bug storico: import "minimale" (solo Quantità + Combustibile, senza Em_tCO2e)
finiva nel DB con `em=null` → righe sparivano dagli aggregati senza errore
visibile. `enrichForUpsert` riempie l'em al commit facendo lookupFE sul
pool combinato (DB esistente + righe FE nello stesso file di import).

Test sentinella anti-regressione:

```js
describe('enrichForUpsert — S1', () => {
  test('em già presente con Q+Combustibile → SOVRASCRITTO (formula canonica)', () => {
    // Em è sempre derivato da Q × FE / 1000 quando i due input sono
    // disponibili. Eventuali Em pre-esistenti vengono sovrascritti
    // (es. valori arrotondati da Excel/SQL → precisione piena).
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Combustibile: 'metano',
      Quantità: 1000, Em_tCO2e: 9.99 // valore "sbagliato" o arrotondato
    }];
    const out = enrich('s1', rows, fePool);
    expect(out[0].Em_tCO2e).toBeCloseTo(2.75, 4); // ricalcolato
  });

  test('em pre-esistente + FE_Valore custom → usa FE custom (override formale)', () => {
    // Per "tenere" un Em diverso dal pool FE, l'utente passa FE_Valore esplicito.
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Combustibile: 'metano',
      Quantità: 1000, FE_Valore: 3.5, Em_tCO2e: 9.99
    }];
    const out = enrich('s1', rows, fePool);
    expect(out[0].Em_tCO2e).toBeCloseTo(3.5, 4);
  });
  ...
});
```

#### `test/zip.test.mjs` (7 test) — ZIP STORE encoder

Verifica che il ZIP STORE encoder inline (`G.io.makeZip` + `G.io.crc32`)
produca file ZIP validi.

```js
describe('crc32 — vettori noti', () => {
  test('"123456789" → 0xCBF43926', () => {
    expect(io.crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
  });
  test('"a" → 0xE8B7BE43', () => { ... });
});

describe('makeZip — struttura ZIP STORE', () => {
  test('signature locale 0x04034b50 a offset 0', () => { ... });
  test('end-of-central-directory in coda (signature 0x06054b50)', () => { ... });
  test('numero entries totale = 2', () => { ... });
});
```

#### `test/redactpii.test.mjs` (8 test) — PII redaction

Sentinella anti-regressione GDPR. Verifica che i log degli errori client
NON contengano email, JWT, IBAN, codici fiscali, telefoni.

```js
test('JWT in stack → [jwt]', () => {
  // Volutamente NON usiamo il prefisso eyJhbGciOiJIUzI1NiIs (header HS256
  // reale) per non triggerare il secret scan in CI sul nostro stesso file
  // di test. redactPII matcha qualunque eyJ.*.*.* base64.
  const fake = 'eyJ0ZXN0Ijp0cnVlfQ.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxw_dummy_signature';
  const out = redactPII('Authorization: Bearer ' + fake);
  expect(out.includes('eyJ0ZXN0')).toBeFalsy();
  expect(out.includes('[jwt]') || out.includes('Bearer [redacted]')).toBeTruthy();
});

test('Codice fiscale → [cf]', () => {
  const out = redactPII('cf RSSMRA80A01H501Z verifica fallita');
  expect(out.includes('RSSMRA80A01H501Z')).toBeFalsy();
  expect(out.includes('[cf]')).toBeTruthy();
});
```

### Output

```
  calc.num — parsing resiliente
    ✓ null/undefined/empty → 0
    ✓ numero passa pulito
    ✓ virgola decimale italiana
    ✓ NaN/Infinity → 0
  calc.emS1 / emS2 / emS3 — formule
    ✓ emS1: 1000 kg metano × 2.75 → 2.75 tCO₂e
    ...
  enrichForUpsert — S1
    ✓ em mancante + Combustibile noto → em calcolato
    ...
  crc32 — vettori noti
    ✓ "123456789" → 0xCBF43926
    ...
  redactPII — sanitize before client_errors insert
    ✓ email standard → [email]
    ...

  67 passed, 0 failed
```

Exit code 1 se almeno un test fallisce. CI fa fail il job.

## E2E test — `npm run test:e2e`

Playwright **Chromium only**, smoke test. Config in `playwright.config.js`.

```js
export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8123',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'python3 -m http.server --directory site 8123',
    url: 'http://127.0.0.1:8123',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
```

### Strategia stub Supabase

Il test deve aprire la console interna **senza una sessione Supabase
reale**. Soluzione: `addInitScript` inietta uno stub di `window.supabase`
**prima** che il bundle React monti.

```js
const STUB_INJECT = `
window.__GHG_TEST_MODE = true;
if (location.hash !== '#app') location.hash = '#app';

const __stubData = {
  anagrafiche: [{ codice_sito: 'TEST', ... }],
  produzione:  [{ codice_sito: 'TEST', anno: 2024, ... }],
  fe:          [{ id: 'fe-1', ... }],
  s1:          [{ id: 's1-1', anno: 2024, ... }],
  s2:          [{ ... }],
  s3:          [{ ... }],
  s3_materiality: [{ cat_id: 1, status: 'Inclusa' }],
  app_meta:    [...],
  audit_log:   [{ id: 1, ts: ..., user_email: 'admin@example.com', ... }],
  audit_chain_status: [...]
};

// JWT con role=admin + aal=aal2
const ADMIN_JWT = btoa(JSON.stringify({alg:'none',typ:'JWT'})) + '.' +
                  btoa(JSON.stringify({sub:'u-1', email:'admin@example.com',
                       app_metadata:{role:'admin'}, aal:'aal2', ...})) + '.sig';

const __stubSession = { access_token: ADMIN_JWT, ... };

const __stubSupabase = {
  createClient: function (url, key, opts) {
    return {
      auth: {
        getSession: () => Promise.resolve({ data: {session: __stubSession} }),
        onAuthStateChange: (cb) => { setTimeout(() => cb('SIGNED_IN', __stubSession), 0); ... },
        signInWithPassword: () => Promise.resolve({ data: {session: __stubSession} }),
        mfa: { ... }
      },
      from: (table) => ({
        select: () => ({ ... promise di __stubData[table] ... }),
        upsert: () => Promise.resolve({data, error: null}),
        ...
      }),
      rpc: (name) => Promise.resolve({ data: stubResults[name], error: null }),
      functions: { invoke: () => Promise.resolve({data:{ok:true}, error: null}) }
    };
  }
};

// Trick critico: defineProperty con setter no-op per evitare che l'UMD reale
// (incluso inline da build.mjs) sovrascriva il nostro stub.
Object.defineProperty(window, 'supabase', {
  configurable: false,
  enumerable: true,
  get () { return __stubSupabase; },
  set (_) { /* no-op */ }
});
`;
```

### Test cases

**Test 1: Public Dashboard si carica senza errori critici**

```js
test('si carica senza errori console critici', async ({ page }) => {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !shouldIgnoreError(msg.text())) errors.push(msg.text());
  });
  page.on('pageerror', err => { if (!shouldIgnoreError(err.message)) errors.push(err.message); });

  await page.addInitScript(STUB_INJECT.replace(`location.hash = '#app'`, ''));
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('#root')?.children?.length > 0, { timeout: 10_000 });
  await page.waitForTimeout(1000);

  expect(errors).toEqual([]);
});
```

**Test 2-12: ogni sezione della sidebar apre senza ReferenceError**

```js
const SECTIONS = [
  { key: 'dashboard',   label: 'Dashboard' },
  { key: 'site',        label: 'Analisi per Sede' },
  { key: 'scope',       label: 'Analisi per Scope' },
  { key: 'materiality', label: 'Materialità' },
  { key: 'quality',     label: 'Data Quality' },
  { key: 'fe',          label: 'FE Explorer' },
  { key: 'scenarios',   label: 'Scenario' },
  { key: 'output',      label: 'Download' },
  { key: 'data',        label: 'Gestione Dati' },
  { key: 'audit',       label: 'Audit Trail' },
  { key: 'diag',        label: 'Diagnostica' }
];

for (const s of SECTIONS) {
  test(`apre sezione "${s.label}" senza ReferenceError`, async ({ page }) => {
    ...
    await page.locator('aside button').filter({ hasText: s.label }).first().click();
    await page.waitForTimeout(500);
    const refErrors = errors.filter(e => /ReferenceError|TypeError.*undefined/.test(e));
    expect(refErrors).toEqual([]);
  });
}
```

**Test 13: Gestione Dati apre tutte le 7 tab senza ReferenceError**

```js
const TABS = ['anagrafiche', 's1', 's2', 's3', 'fe', 'produzione', 'targets'];
for (const t of TABS) {
  await page.locator(`button#dm-tab-${t}`).click({ timeout: 3_000 });
  await page.waitForTimeout(400);
  // verifica errori
}
```

**Test 14-15: Login flow**

```js
test('LoginScreen si renderizza senza ReferenceError', async ({ page }) => {
  await page.addInitScript(() => { window.__GHG_INITIAL_LOGGED_OUT = true; });
  await page.addInitScript(STUB_INJECT);
  await page.goto('/');
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
  ...
});

test('login submit → console interna', async ({ page }) => {
  await page.addInitScript(() => { window.__GHG_INITIAL_LOGGED_OUT = true; });
  await page.addInitScript(STUB_INJECT);
  await page.goto('/');
  await page.locator('input[type="email"]').fill('admin@example.com');
  await page.locator('input[type="password"]').fill('irrelevant');
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => window.__GHG_ROLE === 'admin', { timeout: 10_000 });
  ...
});
```

### Ignored console errors

```js
const IGNORED_CONSOLE_PATTERNS = [
  /favicon/i,                     // favicon 404 in test environment
  /WebSocket connection/i,         // realtime non disponibile
  /^Failed to load resource/i,     // fetch verso supabase.co (stubbato)
  /Multiple GoTrueClient/i,        // nel test stub creiamo client multipli
  /Refused to (get|set) unsafe header/i  // CSP browser headers
];
```

### Razionale

Cattura bug runtime tipo `ReferenceError` dopo split di file (vedi commit
history per i bug storici PR #31, #32, #34: 3 bug consecutivi sfuggiti
a unit test + ESLint perché vivevano in IIFE separati).

Senza e2e, un typo come `const { isLoading, loadingSkeleton, pctOf } = G.sectionsHelpers`
quando in realtà l'export non esiste sarebbe scoperto solo dall'utente
quando apre la sezione.

## Lint

```bash
npm run lint
# → eslint --ext .js,.jsx,.mjs --max-warnings 50 src/ test/ build.mjs

npm run lint:no-dangerous-html
# → ! grep -r --include='*.jsx' --include='*.js' 'dangerouslySetInnerHTML' src/
```

### ESLint config (`.eslintrc.json`)

```json
{
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "script",
    "ecmaFeatures": { "jsx": true }
  },
  "env": { "browser": true, "node": true, "es2022": true },
  "globals": {
    "GHG": "writable",
    "React": "readonly",
    "ReactDOM": "readonly",
    "Chart": "readonly",
    "supabase": "readonly",
    "XLSX": "readonly",
    "PptxGenJS": "readonly",
    "turnstile": "readonly"
  },
  "rules": {
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "no-script-url": "error",
    "no-unused-vars": ["warn", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_",
      "caughtErrorsIgnorePattern": "^_"
    }],
    "no-console": ["warn", { "allow": ["warn", "error", "info"] }],
    "no-debugger": "error",
    "no-alert": "error",
    "eqeqeq": ["warn", "smart"],
    "no-with": "error",
    "no-throw-literal": "error",
    "no-return-assign": ["error", "except-parens"]
  }
}
```

Le `globals` evitano `no-undef` warning per le UMD lib + il namespace `GHG`.

Soglia max 50 warnings nel `package.json`. Errori bloccano sempre.

## Coverage

I test attuali sono **sentinella anti-regressione**, non coverage-driven.
Le aree coperte:

* ✅ Formule di calcolo emissione (super critiche — un bug qui falsa i numeri ESG)
* ✅ `enrichForUpsert` (bug storico)
* ✅ `redactPII` (GDPR compliance)
* ✅ ZIP STORE encoder (backup format)
* ✅ Rendering React di tutte le 11 sezioni + 7 tab DataManager (e2e)

Aree **non** coperte (intenzionalmente):

* ❌ Login Supabase reale (richiederebbe credenziali in CI)
* ❌ Mutazioni DB (richiederebbero account test)
* ❌ Edge Functions (deno test separato, non incluso nel CI repo)
* ❌ Visual regression (fuori scope smoke test)

## Eseguire i test localmente

```bash
# Unit test
npm test

# E2E (la prima volta scarica chromium ~150 MB)
npx playwright install chromium
npm run build
npm run test:e2e

# Solo un test
npx playwright test --grep "Login flow"

# Con UI mode (debug visuale)
npx playwright test --ui

# Vedi il report dopo failure
npx playwright show-report
```

## Risorse

- [[Architettura]] — pattern IIFE che spiega lo stub strategy
- [[Sicurezza]] — redactPII test contesto GDPR
- [[GitHub-Actions]] — workflow CI che esegue tutti i test
