# Build & Deploy

## Pre-requisiti

* **Node ≥ 18** (vedi `package.json:engines.node`)
* `npm install` per installare le dipendenze pinnate
* Progetto Supabase con le migrations `sql/01..18` applicate
* (Opzionale) Cloudflare Turnstile site key per captcha login
* (Opzionale) Secrets per Edge Functions (`SNAPSHOT_HMAC_KEY`, `GEMINI_API_KEY`)
* (Opzionale) Logo files in `assets/` (auto-detect: `logo.{svg,png,jpg,jpeg}`,
  `Logo-ridotto.{svg,png,jpg,jpeg}`, `favicon.{ico,png,svg,jpg,jpeg}`)

## Build locale

```bash
# Variabili obbligatorie
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# (legacy SUPABASE_ANON_KEY accettato come fallback)

# Variabili opzionali (build.mjs ha default)
export TURNSTILE_SITE_KEY=0xAAAA...
export COMPANY_LEGAL_NAME='Gruppo Ceramiche Gresmalt S.p.A.'
export COMPANY_VAT='IT00000000000'
export SUSTAINABILITY_EMAIL='sustainability@gresmalt.it'
export PUBLIC_DASHBOARD_URL='https://sustainability.gresmalt.it'
export SCHEMA_VERSION='1'

# Build
node build.mjs
# → ✓ site/index.html scritto · 1166.5 KB
# → ✓ build completato.

# Output
ls -la site/
# site/index.html       (~1.1 MB autocontenuto)
# site/build.txt        (timestamp Unix per anti-stale check)
# site/.nojekyll        (file vuoto: GH Pages non Jekyll-processa)
# site/_headers         (per Cloudflare/Netlify; ignorato da GH Pages)
```

## Dev server

```bash
npm run dev
# → node build.mjs && python3 -m http.server --directory site 8000
# Server statico Python su http://localhost:8000
```

Vantaggi:
- Zero hot-reload (è statico) ma totale fedeltà al production bundle
- Niente node_modules a runtime, niente Vite/Webpack/Rollup magia

Workflow durante sviluppo:
1. Modifica `src/*.jsx`
2. `npm run dev` (build + server)
3. Reload browser
4. Iterate

## Configurazione env vars

Vedi [[Configurazione]] per la lista completa. Riassunto:

| Variabile | Required | Default |
|---|---|---|
| `SUPABASE_URL` | Sì | — |
| `SUPABASE_PUBLISHABLE_KEY` | Sì | (fallback a `SUPABASE_ANON_KEY` legacy) |
| `TURNSTILE_SITE_KEY` | No | (vuoto: skip Turnstile) |
| `COMPANY_LEGAL_NAME` | No | `Gruppo Ceramiche Gresmalt S.p.A.` |
| `COMPANY_VAT` | No | `IT00000000000` |
| `SUSTAINABILITY_EMAIL` | No | `sustainability@gresmalt.it` |
| `PUBLIC_DASHBOARD_URL` | No | `https://sustainability.gresmalt.it` |
| `SCHEMA_VERSION` | No | `1` |
| `LOGO_PATH` | No | (auto-detect `assets/logo.*`) |
| `LOGO_MARK_PATH` | No | (auto-detect `assets/Logo-ridotto.*`) |

Se mancano `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`, il build emette
un warning ma **genera comunque l'output** (i placeholder `__SUPABASE_*__`
restano nel bundle e il client non potrà connettersi al backend). Utile
per build di test/e2e con env stub.

## Step di build (`build.mjs` in dettaglio)

Vedi [[Architettura#build-pipeline]] per la descrizione completa. Riassunto
degli step:

1. **Risoluzione asset**: cerca `assets/logo.*`, `assets/Logo-ridotto.*`,
   `assets/favicon.*`. Tutti inlined come data-URI base64.
2. **Forbidden tokens check**: blocca il build se trova
   `dangerouslySetInnerHTML`, `eval(`, `new Function(`, `document.write(`,
   `innerHTML =` nei sorgenti `src/`.
3. **Compile**: Babel transform di tutti i `.jsx` con preset-react classic
   runtime. I `.js` copiati raw.
4. **Lib loader**: legge React/ReactDOM/Chart.js/Supabase UMD da `node_modules`.
   Applica `patchInlinedUMD` (regex sostituisce il throw "Automatic publicPath
   is not supported" con `publicPath = "/"`).
5. **SRI calculation**: SHA-384 di `@e965/xlsx` e `pptxgenjs` bundle.
6. **Placeholder substitution**: sostituisce `__SUPABASE_URL__`,
   `__TURNSTILE_SITE_KEY__`, ecc.
7. **Anti-stale-cache JS inline**: bfcache flash + HTTP cache stantio +
   localStorage marker.
8. **Output**: `site/index.html` + `site/build.txt` + `site/.nojekyll` +
   `site/_headers`.

## Deploy GitHub Pages

### Setup iniziale

1. **Settings → Pages → Source = GitHub Actions**.
2. Settings → Secrets and variables → Actions → New secret:
   - `SUPABASE_URL` = https://xxx.supabase.co
   - `SUPABASE_PUBLISHABLE_KEY` = sb_publishable_…
   - (opzionale) `TURNSTILE_SITE_KEY`
   - (opzionale) `SUPABASE_DB_URL` per backup
   - (opzionale) `BACKUP_PASSPHRASE` per backup criptato
3. Push su `main` → deploy automatico.

### Workflow `.github/workflows/deploy.yml`

```yaml
on:
  push: { branches: [main] }
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - name: Build site
        env:
          SUPABASE_URL:             ${{ secrets.SUPABASE_URL }}
          SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY || secrets.SUPABASE_ANON_KEY }}
          TURNSTILE_SITE_KEY:       ${{ secrets.TURNSTILE_SITE_KEY }}
          COMPANY_LEGAL_NAME:       ${{ vars.COMPANY_LEGAL_NAME   || 'Gruppo Ceramiche Gresmalt S.p.A.' }}
          ...
        run: node build.mjs && ls -la site/
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with: { path: site }

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v5
        id: deployment
```

Concurrency `cancel-in-progress: false` significa: una sola build/deploy
alla volta; nuovi push **non** cancellano quello in corso.

### Custom domain (opzionale)

* Aggiungi un record `CNAME` nel DNS che punti a `<github_user>.github.io`.
* Settings → Pages → Custom domain = `sustainability.gresmalt.it`.
* Crea `assets/CNAME` con il nome del dominio (GitHub lo legge e lo copia
  nel deploy).
* HTTPS automatico via Let's Encrypt (può richiedere 1-24h al primo setup).

### Dietro Cloudflare proxy (raccomandato)

GitHub Pages **non** supporta header HTTP custom. Per applicare
`X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`,
ecc., serve un CDN davanti.

1. Configura `sustainability.gresmalt.it` come Cloudflare CNAME proxied.
2. Cloudflare legge `site/_headers` (formato Cloudflare Pages compatibile):

```
/build.txt
  Cache-Control: no-store, no-cache, must-revalidate
  Pragma: no-cache

/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
```

> Nota: GitHub Pages **ignora** `_headers`. Il file è applicato solo se
> davanti a Pages c'è Cloudflare/Netlify.

## Anti-stale-cache

Vedi [[Architettura#anti-stale-cache]] per i 3 livelli. Riassunto:

1. **`pageshow` event** con `persisted=true` (bfcache restore) → hide HTML
   + `location.reload()` (no flash del bundle vecchio).
2. **fetch `build.txt`** con cache-buster query param + `cache:'no-store'`:
   se l'hash server-side differisce dal `BUILD_HASH` inlined nel bundle in
   esecuzione → `location.replace(?_b=<new_hash>)`. Loop-guard: max 1
   reload per 10s tramite `sessionStorage`.
3. **`localStorage.ghg_build`** marker per Diagnostica admin.

## Build hash

`build.mjs` usa `Date.now()` come `BUILD_HASH` (timestamp Unix ms):

```js
const BUILD_HASH = String(Date.now());
```

Inlined come:
- `<meta name="ghg-build" content="${BUILD_HASH}">`
- `var BH = "${BUILD_HASH}";` nello script anti-stale inline
- `site/build.txt` content

Verificato a runtime contro `build.txt` server-side.

## CSP via meta

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; ..." />
```

Vedi [[Sicurezza#csp]] per le direttive complete.

## Smoke test post-build

In CI (`.github/workflows/build.yml`) il job `e2e` esegue Playwright Chromium
sui 12 sezioni della console + login flow. Vedi [[Test#e2e]].

## Troubleshooting

### "Cannot find package '@babel/core'"

Hai eseguito `node build.mjs` senza prima `npm install`.

```bash
npm install
node build.mjs
```

### "Mancano env vars richieste: SUPABASE_URL, ..."

`build.mjs` emette warning ma produce comunque l'output. Il client non
potrà connettersi finché non esporti le env e rilanci.

### Bundle "rotto" — `window.supabase` undefined

L'errore tipico è webpack auto-publicPath. `patchInlinedUMD` in `build.mjs`
dovrebbe gestirlo. Se vedi nei devtools un throw `"Automatic publicPath is
not supported in this browser"`, verifica che la regex di patch sia ancora
valida (cambi nella minified Webpack 5).

### "ERESOLVE while resolving: react@..."

Hai aggiornato React manualmente senza aggiornare anche `react-dom`. Le
due versioni devono combaciare esattamente. Usa solo Dependabot per i bump.

### Build hash uguale tra deploy successivi

`build.mjs` usa `Date.now()` — ogni invocazione genera un timestamp diverso
in ms. Se vedi lo stesso hash, hai messo in cache l'output? Pulisci `site/`
e ribuilda.

### Deploy GitHub Pages fallito 403

* Verifica che Settings → Pages → Source sia "GitHub Actions" (non
  "Deploy from branch").
* Permission requirements: `pages: write`, `id-token: write` nel workflow.

### Site live non si aggiorna dopo push

* Cloudflare cache: aspetta 5-10 min o forza purge dal pannello CF.
* L'anti-stale-cache forzerà comunque il browser a reload appena l'utente
  apre la pagina dopo l'update di `build.txt`.

## Build size benchmark

```
site/index.html       1166.5 KB   (autocontenuto)
├─ React + ReactDOM    180 KB     (UMD production)
├─ Chart.js            220 KB     (UMD)
├─ Supabase JS         265 KB     (UMD)
├─ Compiled src/       420 KB     (~13k righe → Babel JSX→JS)
├─ Logo data-URI        2 KB      (png base64)
├─ Favicon data-URI     2 KB
├─ Inline CSS         ~10 KB
├─ Inline script       50 KB     (anti-stale + bootstrap)
└─ HTML/meta           5 KB
```

Tutto in un singolo HTTPS request al primo paint.

Lazy (su click "Export Excel" o "Export PPTX"):
- `@e965/xlsx` bundle: ~600 KB (SRI sha384)
- `pptxgenjs` bundle: ~700 KB (SRI sha384)

## Risorse

- [[Architettura]] — dettaglio build pipeline
- [[GitHub-Actions]] — workflow CI/CD
- [[Configurazione]] — env vars complete
- [[Test]] — unit + e2e
