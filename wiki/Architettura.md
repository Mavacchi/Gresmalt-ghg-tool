# Architettura

Il tool è stato disegnato per **massima trasparenza, manutenibilità e
riproducibilità**, sacrificando volutamente le comodità moderne (bundler,
TypeScript, framework backend) in favore di:

1. **Build deterministico e ispezionabile** — un solo file HTML, zero
   network al primo paint, niente catena di dipendenze opache.
2. **Resilienza alle CDN** — le librerie core sono inline; quelle opzionali
   (Excel/PPTX) sono lazy via CDN con SRI hash per defense-in-depth.
3. **Hosting statico zero-config** — GitHub Pages senza Pages-Functions,
   senza Cloudflare Workers, senza container.

## Stack tecnico

| Layer | Tecnologia | Versione | Note |
|---|---|---|---|
| Frontend rendering | React | 18.3.1 (UMD production) | inline nel bundle |
| Charting | Chart.js | 4.5.1 (UMD) | inline nel bundle |
| DB client | @supabase/supabase-js | 2.105.4 (UMD) | inline nel bundle |
| Excel export | @e965/xlsx | 0.20.3 | lazy da CDN, SRI |
| PPTX export | pptxgenjs | 4.0.1 | lazy da CDN, SRI |
| Build | Babel core | 7.29.0 | solo `@babel/preset-react` classic runtime |
| Test runner | custom zero-dep | — | `test/_runner.mjs` (~110 righe) |
| E2E test | Playwright | ^1.59.1 | chromium only, smoke |
| Linter | ESLint | 10.3.0 | regole no-eval, no-Function, no-innerHTML |
| Database | PostgreSQL (Supabase) | 17.6 | RLS abilitata su tutte le tabelle |
| Auth | Supabase Auth | — | email + TOTP MFA |
| Edge runtime | Deno | std@0.224.0 | `serve()` semplice |
| Hosting | GitHub Pages | — | servito dal repo `main` branch |
| Captcha | Cloudflare Turnstile | — | opzionale, gated dietro env |

## Filosofia di design

### No bundler, no node_modules in produzione

I sorgenti `src/*.js` e `src/**/*.jsx` sono **IIFE** che si attaccano a
un namespace globale `window.GHG`. Lo script `build.mjs`:

1. Legge ogni file `src/*` in ordine specifico (vedi sotto).
2. Per i `.jsx` invoca **Babel** in-process con preset-react classic runtime
   (output: `React.createElement(...)` ovunque c'era JSX).
3. Concatena tutto in un singolo `<script>` inline.
4. Aggiunge in cima alla pagina React, ReactDOM, Chart.js e supabase-js letti
   da `node_modules/*/umd/*.js`, anch'essi inline.
5. Genera `site/index.html` autocontenuto.

### Pattern IIFE su `window.GHG`

Ogni sorgente in `src/` ha questa forma:

```js
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useEffect } = root.React;

  function MyComponent ({ data }) { … }

  G.sections = G.sections || {};
  G.sections.MyComponent = MyComponent;
})(typeof window !== 'undefined' ? window : globalThis);
```

Vantaggi rispetto a moduli ESM:

* **Niente bundler runtime**: no Vite/Webpack/Rollup, no `import` magico.
* **Test in Node**: il loader in `test/_load.mjs` legge il file come stringa
  e lo esegue via `vm.runInThisContext` con un `globalThis.GHG = {}`. Zero
  trasformazioni.
* **Inspezionabile**: aprendo `site/index.html` con devtools il bundle è
  perfettamente leggibile (no source maps necessarie).

Svantaggi accettati:

* Devi rispettare un ordine di caricamento (vedi `SRC_FILES` in `build.mjs`).
* I cross-reference passano da `G.X` non da `import`, quindi un typo si
  scopre solo a runtime.

### Naming convention DB ↔ App

* **Database (Supabase)**: `snake_case` senza accenti (`anno`, `codice_sito`,
  `qualita_dato`, `em_tco2e`).
* **App (UI)**: `PascalCase` con accenti italiani (`Anno`, `Codice_Sito`,
  `Qualità_Dato`, `Em_tCO2e`).

La traduzione è in `SupabaseDB.jsx` (`DB_TO_APP` / `APP_TO_DB`). Tutte le
sezioni leggono campi App-named, ma molte funzioni (es. validateRow) accettano
entrambe le convenzioni per resilienza dopo un upsert grezzo.

> **Importante**: quando aggiungi una colonna al DB devi aggiungere anche
> la mappatura in `DB_TO_APP`, altrimenti il campo arriva raw alla UI e
> nessuno lo trova.

## Build pipeline (`build.mjs` in dettaglio)

```
       ┌──────────────────────────────────────┐
       │   build.mjs (~670 righe)             │
       └──────────────────┬───────────────────┘
                          │
       ┌──────────────────┼───────────────────┐
       ▼                  ▼                   ▼
 ┌───────────┐     ┌─────────────┐     ┌─────────────┐
 │ Babel     │     │ Lib loader  │     │ Asset       │
 │ compile   │     │ + UMD patch │     │ resolver    │
 │ src/*.jsx │     │ react/dom/  │     │ logo,       │
 │           │     │ chart/sb    │     │ favicon     │
 └─────┬─────┘     └──────┬──────┘     └──────┬──────┘
       │                  │                   │
       └──────────────────┼───────────────────┘
                          │
       ┌──────────────────┼───────────────────┐
       ▼                  ▼                   ▼
 ┌───────────┐     ┌─────────────┐     ┌─────────────┐
 │ Forbidden │     │ SRI hash    │     │ Placeholder │
 │ tokens    │     │ calc:       │     │ replace:    │
 │ check     │     │ SheetJS,    │     │ __SUPABASE_*│
 │           │     │ pptxgenjs   │     │ __LOGO_*    │
 └─────┬─────┘     └──────┬──────┘     └──────┬──────┘
       │                  │                   │
       └──────────────────┼───────────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ site/index.html │ ← ~1.1 MB autocontenuto
                 │ site/build.txt  │ ← timestamp anti-stale
                 │ site/.nojekyll  │ ← GitHub Pages
                 │ site/_headers   │ ← Cloudflare/Netlify
                 └─────────────────┘
```

### Step dettagliati

**1) Risoluzione asset (`resolveLogo`, `resolveLogoMark`, `resolveFavicon`)**

Cerca in `assets/`:
* `logo.{svg,png,jpg,jpeg}` → wordmark "gresmalt GROUP"
* `Logo-ridotto.{svg,png,jpg,jpeg}` (case-variants) → brand mark compatto per sidebar collassata
* `favicon.{ico,png,svg,jpg,jpeg}`

Tutti vengono **inline come data-URI base64** (CSP-safe, niente download separati).
Se assenti, fallback agli SVG inline definiti in `logo.js` / `build.mjs`.

**2) Compile (`compile`)**

Babel transform di tutti i `.jsx` con preset-react **classic runtime** (NON
automatic, perché `React.createElement` deve restare quello globale UMD).
I `.js` sono copiati raw. Ogni file viene prefissato con un commento
`/* ─── src/path.jsx ─── */` per facilitare debug.

L'ordine di concatenazione è in `SRC_FILES`:

```
1.  src/constants.js              ← deve essere primo (G.fmt, G.COLORS, ...)
2.  src/logo.js
3.  src/sanitize.js
4.  src/calc.js
5.  src/SupabaseDB.jsx
6.  src/components/ui.jsx         ← G.ui.* usato ovunque
7.  src/components/DataTable.jsx
8.  src/components/Charts.jsx
9.  src/io.jsx                    ← export Excel/PPTX
10. src/sections/PublicDashboard.jsx
11. src/sections/Dashboard.jsx
12. src/sections/_shared.jsx      ← helper usati da sezioni successive
13. src/sections/SiteAnalysis.jsx
14. src/sections/ScopeAnalysis.jsx
15. src/sections/DataQuality.jsx
16. src/sections/FEExplorer.jsx
17. src/sections/Scenarios.jsx
18. src/sections/Output.jsx
19. src/sections/Materiality.jsx
20. src/sections/DataManager.shared.jsx
21. src/sections/DataManager.tabs.jsx
22. src/sections/DataManager.scopeModals.jsx
23. src/sections/DataManager.jsx
24. src/sections/AuditTrail.jsx
25. src/sections/Diagnostics.jsx
26. src/AuthGate.jsx
27. src/App.jsx
```

**3) UMD patch (`patchInlinedUMD`)**

Webpack 5 emette un runtime "auto publicPath" che chiama
`document.currentScript.src`. Quando una UMD viene inlined dentro
`<script>...</script>`, `currentScript.src` è `""` e webpack lancia
`throw new Error("Automatic publicPath is not supported in this browser")`,
bloccando l'init della libreria (es. `@supabase/supabase-js` →
`window.supabase` resta undefined).

`publicPath` non serve a runtime perché le UMD non fanno code-splitting
dinamico, quindi una regex sostituisce il throw con
`if (!publicPath) publicPath = "/";`.

**4) Lint pre-compile (forbidden tokens)**

`build.mjs` blocca il build se trova nei sorgenti `src/`:

* `dangerouslySetInnerHTML` (React unsafe rendering)
* `eval(` (code injection)
* `new Function(` (code injection)
* `document.write(` (deprecato + può rompere CSP)
* `innerHTML =` (XSS-prone)

Lo script `npm run lint:no-dangerous-html` ripete il check più ristretto
in CI come second gate.

**5) Calcolo SRI**

```js
function sri (path) {
  const h = createHash('sha384').update(readFileSync(path)).digest('base64');
  return `sha384-${h}`;
}
```

Calcolato dai bundle locali pinnati (`node_modules/@e965/xlsx/dist/xlsx.full.min.js`
e `node_modules/pptxgenjs/dist/pptxgen.bundle.js`). Iniettato nei placeholder
`__SHEETJS_SRI__` e `__PPTXGENJS_SRI__`. Il client carica la stessa versione
da `cdn.jsdelivr.net`; se l'hash CDN diverge, il browser blocca il load.

**6) Sostituzione placeholder**

```js
for (const [k, v] of Object.entries(placeholders)) {
  html = html.split(k).join(v);
}
```

I placeholder sono token tipo `__SUPABASE_URL__`, `__TURNSTILE_SITE_KEY__`,
`__COMPANY_LEGAL_NAME__`, `__LOGO_DATA_URI__`, ecc.

**7) Anti-stale-cache (3 livelli)**

Inline JavaScript nel bundle finale che gestisce:

* **bfcache flash**: `pageshow` event con `e.persisted=true` → hide HTML +
  `location.reload()`. Niente flash del bundle vecchio.
* **HTTP cache stantio**: fetch `build.txt?_=<timestamp>` con `cache:'no-store'`;
  se il `BUILD_HASH` server differisce dall'inlined → `location.replace`.
  Loop-guard: max 1 reload per 10s tramite `sessionStorage`.
* **localStorage marker**: `ghg_build` aggiornato a ogni boot per debug.

**8) Generazione file output**

```
site/
├── index.html       (~1.1 MB autocontenuto)
├── build.txt        (timestamp Unix per anti-stale check)
├── .nojekyll        (file vuoto: dice a GH Pages "non processare con Jekyll")
└── _headers         (per Cloudflare Pages/Netlify; ignorato da GH Pages)
```

## CSP (Content Security Policy)

Iniettata via `<meta http-equiv>` (per GitHub Pages che non supporta header
custom). Direttive:

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
img-src 'self' data:;
frame-src https://challenges.cloudflare.com;
base-uri 'self';
object-src 'none';
```

`frame-ancestors 'none'` + `X-Frame-Options: DENY` sono solo in `_headers`
(CSP `<meta>` ignora `frame-ancestors`).

## Namespace globali su `window.GHG`

Vedi anche [[Sorgenti-File-per-File]] per il dettaglio.

| Chiave | Origine | Cosa contiene |
|---|---|---|
| `GHG.fmt(n, dec)` | `constants.js` | formattatore numerico it-IT |
| `GHG.COLORS` | `constants.js` | palette brand (slate + cream) |
| `GHG.CATEGORICAL` | `constants.js` | palette 7 colori categorici |
| `GHG.SITE_COLORS` | `constants.js` | Proxy: 7 siti statici + hash deterministico per nuovi |
| `GHG.ROLE_LABELS` | `constants.js` | admin/editor/auditor/viewer/guest |
| `GHG.can` | `constants.js` | matrice permessi per ruolo |
| `GHG.CAT_NAMES` | `constants.js` | nomi 15 categorie S3 |
| `GHG.FAMIGLIE_FE` | `constants.js` | Combustibili/Elettricità/WTT/Materiali/Trasporti/Rifiuti |
| `GHG.QUALITY_BADGE` | `constants.js` | P (Primario) / S (Secondario) / E (Stimato) |
| `GHG.STATUS_BADGE` | `constants.js` | Definitivo / Provvisorio / Stimato |
| `GHG.EXPECTED_UNIT_S1` | `constants.js` | mapping categoria → unità attesa |
| `GHG.I18N` | `constants.js` | dictionary IT/EN della Public Dashboard |
| `GHG.TARGETS` | `constants.js` (runtime override) | piano decarbonizzazione |
| `GHG.LOGO_DATA_URI` | `logo.js` (build inject) | wordmark data-URI |
| `GHG.LOGO_MARK_DATA_URI` | `logo.js` (build inject) | brand mark compatto |
| `GHG.sanitize` | `sanitize.js` | `sanitizeForSpreadsheet(v)` |
| `GHG.calc` | `calc.js` | formule emissione + validazione + aggregazioni |
| `GHG.db` | `SupabaseDB.jsx` | client + tutte le RPC + traduzione + PII redact |
| `GHG.io` | `io.jsx` | import/export Excel + PPTX + backup ZIP |
| `GHG.ui` | `components/ui.jsx` | UI primitives + Toast + Confirm + ErrorBoundary |
| `GHG.charts` | `components/Charts.jsx` | wrapper Chart.js |
| `GHG.sectionsHelpers` | `sections/_shared.jsx` | isLoading, loadingSkeleton, emWithPct |
| `GHG.sections` | `sections/*.jsx` | 11 sezioni della console |
| `GHG.DM` | `sections/DataManager.*.jsx` | tab + modali + COLUMNS della Gestione Dati |
| `GHG.PublicDashboard` | `sections/PublicDashboard.jsx` | Faccia A |
| `GHG.AuthGate` | `AuthGate.jsx` | gate auth + MFA + Turnstile |
| `GHG.App` | `App.jsx` | shell console interna |

## Variabili globali volatili (`window.__GHG_*`)

| Variabile | Tipo | Scritta da | Letta da |
|---|---|---|---|
| `__GHG_ROLE` | string | `AuthGate.useAuth` (decoda JWT) | `App.jsx`, `G.db.role()`, sezioni |
| `__GHG_LOGOUT` | fn | `AuthGate` post-login | `App.jsx` (bottone Logout) |
| `__cfTurnstileReady` | fn | `AuthGate.LoginScreen` | callback Turnstile inline |
| `__GHG_TEST_MODE` | bool | `test/e2e/smoke.spec.mjs` | bundle (per assertion test) |
| `__GHG_INITIAL_LOGGED_OUT` | bool | `test/e2e/smoke.spec.mjs` | stub Supabase nei test |

## Anti-pattern volutamente evitati

1. **Niente `dangerouslySetInnerHTML`** — bloccato a build-time.
2. **Niente `eval` / `new Function`** — bloccato da ESLint + build.mjs.
3. **Niente `innerHTML =`** — usa sempre `React.createElement`.
4. **Niente librerie esterne dietro `<script src=https://...>` non-SRI** —
   tutto è inline o SRI-protected.
5. **Niente service-role key lato client** — `SUPABASE_PUBLISHABLE_KEY`
   (anon key) è l'unica chiave esposta; tutte le mutazioni passano da RLS.
6. **Niente segreti committati** — `build.mjs` accetta solo placeholder
   da env, e `build.yml` ha un secret scan grep-based come second gate.

## Risorse

- [[Sorgenti-File-per-File]] — dettaglio dei 28 file
- [[Build-e-Deploy]] — come eseguire la build localmente e in CI
- [[Sicurezza]] — CSP, SRI, MFA, hash chain, backup, snapshot HMAC
