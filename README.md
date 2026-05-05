# GHG Tool — Sustainability Platform · Gruppo Ceramiche Gresmalt

Piattaforma single-page per l'inventario delle emissioni di gas serra
(Scope 1, 2 e 3) del gruppo, conforme a **GHG Protocol Corporate
Standard** e funzionale alla rendicontazione **CSRD**.

Doppia faccia:

- **Faccia A — Public Sustainability Dashboard**: pagina pubblica per
  i clienti del gruppo. Niente login, solo aggregati e intensità.
  Bilingue IT/EN.
- **Faccia B — Internal Operations Console**: console operativa per
  dipendenti e auditor con permessi per ruolo, audit log immutabile a
  hash chain, MFA TOTP per editor/auditor.

L'output è un singolo `site/index.html` (~1058 KB) generato da
`build.mjs` a partire dai sorgenti in `src/`. Nessun framework di
build (no webpack/vite); React, ReactDOM, Chart.js e
`@supabase/supabase-js` sono inlined come UMD nel bundle.

---

## Architettura in breve

```
┌────────────────────────────────────────────────────┐
│  Browser  →  site/index.html (autocontenuto)       │
│   • React 18 + ReactDOM (UMD inline)               │
│   • Chart.js (UMD inline)                          │
│   • @supabase/supabase-js (UMD inline)             │
│   • Bundle src/* compilato Babel                   │
│   • CSP via <meta http-equiv>                      │
│   • SRI per librerie CDN-lazy (xlsx, pptxgenjs)    │
└──────────────┬─────────────────────────────────────┘
               │ HTTPS + JWT/PKCE
               ▼
┌────────────────────────────────────────────────────┐
│  Supabase                                          │
│   • PostgreSQL (12 tabelle, RLS forced)            │
│   • Auth (email+password, MFA TOTP, Turnstile)     │
│   • Edge Functions Deno × 3                        │
│     (sign_snapshot, verify_snapshot,               │
│      verify_audit_chain)                           │
└──────────────┬─────────────────────────────────────┘
               ▲
               │
┌────────────────────────────────────────────────────┐
│  GitHub Actions (4 workflow)                       │
│   • build.yml      lint + test + smoke e2e         │
│   • deploy.yml     build + GitHub Pages (push main)│
│   • keepalive.yml  ping ogni 3 giorni              │
│   • backup.yml     pg_dump + GPG AES-256 (lun 04UTC)│
└────────────────────────────────────────────────────┘
```

---

## Struttura del repository

```
.
├── README.md                       ← questo file
├── build.mjs                       Pipeline build (Babel + UMD inline + CSP + SRI)
├── package.json                    Dipendenze pinnate; scripts npm
├── playwright.config.js            Config smoke test runtime
├── .eslintrc.json                  Regole anti eval/innerHTML/Function
├── .gitignore                      Esclude site/, sql/09-12, private/
│
├── .github/
│   ├── dependabot.yml              Update minor+patch in group; major in PR singole
│   └── workflows/
│       ├── build.yml               CI: lint + secret scan + audit + unit + smoke e2e
│       ├── deploy.yml              CD: build + GitHub Pages
│       ├── keepalive.yml           cron 0 12 */3 * *
│       └── backup.yml              cron 0 4 * * 1 (pg_dump cifrato)
│
├── assets/
│   ├── logo.png                    Logo aziendale (inline data URI nel build)
│   ├── favicon.png                 Favicon (inline data URI)
│   └── README.md                   Spiegazione formato + override LOGO_PATH
│
├── docs/
│   ├── RUNBOOK.md                  Setup iniziale, operazioni ricorrenti, disaster recovery
│   └── SECURITY.md                 Threat model, controlli implementati, checklist
│
├── sql/                            12 file di migrazione (eseguire in ordine)
│   ├── 01_schema.sql               9 tabelle base + audit hash chain
│   ├── 02_data_seed.sql            7 anagrafiche siti + 80 FE + S1/S2/S3 esempio
│   ├── 03_roles.sql                RLS forced + current_role() + verify_audit_chain()
│   ├── 04_public_view.sql          public_facts MV + RPC pubbliche + no-leak self-check
│   ├── 05_app_meta.sql             app_meta + keepalive_ping()
│   ├── 06_client_errors.sql        Logging errori client + retention 90gg
│   ├── 07_invite_operators.sql     role_map + trigger di propagazione ruoli
│   ├── 08_year_lock.sql            Sign-off anno (editor blocked, admin override)
│   ├── 13_hardening.sql            RPC atomiche + GDPR + 3 cron pg_cron
│   ├── 14_mfa_editor.sql           MFA TOTP obbligatoria editor (aal2 in RLS)
│   ├── 15_mfa_auditor.sql          MFA TOTP obbligatoria auditor (aal2 su audit_log)
│   └── 16_audit_chain_cron.sql     verify_audit_chain settimanale + storico
│
├── supabase/functions/             Edge Functions Deno (server-side)
│   ├── sign_snapshot/index.ts      Firma HMAC-SHA256, role admin, body 1MB max
│   ├── verify_snapshot/index.ts    Verifica firma con constant-time compare
│   └── verify_audit_chain/index.ts Wrapper RPC verify_audit_chain
│
├── src/                            Sorgenti frontend (~10k righe JSX/JS)
│   ├── constants.js                COLORS, ROLE_LABELS, TARGETS, I18N (it/en), can{}
│   ├── logo.js                     SVG fallback (override via LOGO_PATH)
│   ├── sanitize.js                 sanitizeForSpreadsheet (anti formula injection)
│   ├── calc.js                     emS1/S2/S3, lookupFE, validateRow, totals, intensity
│   ├── SupabaseDB.jsx              Client + traduzione DB↔App + RPC + redactPII
│   ├── AuthGate.jsx                Login + MFA + Turnstile + hash routing
│   ├── App.jsx                     Shell console interna (sidebar 11 voci)
│   ├── io.jsx                      Excel/PPTX/CSV I/O (lazy CDN con SRI)
│   │
│   ├── components/
│   │   ├── ui.jsx                  Card, KPICard, Toast, Confirm, ErrorBoundary, S2MethodToggle
│   │   ├── DataTable.jsx           Tabella riusabile sort/filter
│   │   └── Charts.jsx              Wrapper Chart.js
│   │
│   └── sections/                   12 sezioni applicative
│       ├── _shared.jsx             Helper isLoading, emWithPct, pctOf
│       ├── PublicDashboard.jsx     Faccia A (pagina pubblica IT/EN)
│       ├── Dashboard.jsx           Faccia B home
│       ├── SiteAnalysis.jsx        Breakdown per stabilimento
│       ├── ScopeAnalysis.jsx       Breakdown S1/S2/S3 con LB vs MB
│       ├── Materiality.jsx         Status 15 categorie GHG Protocol
│       ├── DataQuality.jsx         Quality (P/S/E) e completezza
│       ├── FEExplorer.jsx          Browse FE
│       ├── Scenarios.jsx           What-if scenari di riduzione
│       ├── Output.jsx              Export Excel/PPTX/PDF + snapshot firmato
│       ├── DataManager.jsx         Gestione Dati (shell + 7 tab)
│       ├── DataManager.shared.jsx  GenericTab, ImportPreviewModal, helpers
│       ├── DataManager.tabs.jsx    Anagrafiche, Produzione, Targets, FE tabs
│       ├── DataManager.scopeModals.jsx  S1/S2/S3 EditModal
│       ├── AuditTrail.jsx          Lista audit_log filtrata
│       └── Diagnostics.jsx         Reconciliation, Anon Probe, year lock, audit chain
│
└── test/
    ├── index.mjs                   npm test entry
    ├── _runner.mjs                 Test runner custom (no framework esterno)
    ├── _load.mjs                   Polyfill globalThis per IIFE
    ├── calc.test.mjs               39 test (formule, lookup, validateRow, totals, intensity)
    ├── io.test.mjs                 13 test (enrichForUpsert)
    ├── redactpii.test.mjs           8 test (redactPII)
    ├── zip.test.mjs                 7 test (utility)
    └── e2e/smoke.spec.mjs          15 smoke test runtime Playwright
```

---

## Quickstart

> **Repo pubblico**: i file SQL `09_replace_data_*.sql`, `10_delete_user.sql`,
> `11_reset_password.sql`, `12_update_materiality.sql` (con dati operativi
> reali del cliente) e la cartella `site/` (con `SUPABASE_*` sostituiti)
> non sono committati. Vedi `.gitignore`.

### 1. Backend Supabase (one-time)

SQL Editor → eseguire **in ordine** i file di `sql/` (nell'ordine
numerico, senza saltare). Ogni file è idempotente — ri-eseguibile
senza side-effects. Procedura completa in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

### 2. Build

```bash
npm install
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
TURNSTILE_SITE_KEY=0xAAAA... \
node build.mjs
```

`SUPABASE_PUBLISHABLE_KEY` è il nome attuale (formato `sb_publishable_...`).
`build.mjs:45-50` accetta anche il vecchio `SUPABASE_ANON_KEY` come
fallback durante la migrazione, con warning.

Output: `site/index.html` (~1058 KB autocontenuto).

### 3. Sviluppo locale

```bash
npm run dev
# Esegue: node build.mjs && python3 -m http.server --directory site 8000
```

Apri http://localhost:8000.

### 4. Test

```bash
npm test                # 67 unit test (calc, io, zip, redactPII)
npm run lint            # ESLint 0 errors, max 50 warnings
npm run lint:no-dangerous-html
npm run test:e2e        # 15 smoke test Playwright (richiede chromium)
```

### 5. Deploy

Deploy automatico su GitHub Pages al push su `main` via
`.github/workflows/deploy.yml`. Setup secret + opzioni custom domain
in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

---

## Ruoli e permessi

5 ruoli. Il ruolo è letto da `auth.jwt() -> 'app_metadata' ->> 'role'`
(`sql/03_roles.sql:17-29`), **mai** da `user_metadata` (che è
scrivibile dall'utente).

| Capacità                     | admin | editor | auditor | viewer | guest |
|------------------------------|:-----:|:------:|:-------:|:------:|:-----:|
| Public Dashboard             |  ✓    |   ✓    |   ✓     |   ✓    |   ✓   |
| Internal Dashboard           |  ✓    |   ✓    |   ✓     |   ✓    |   ✗   |
| Materialità S3               |  ✓    |   ✓    |   ✓     |   ✓    |   ✗   |
| Data Quality                 |  ✓    |   ✓    |   ✓     |   ✗    |   ✗   |
| FE Explorer                  |  ✓    |   ✓    |   ✓     |   ✗    |   ✗   |
| Scenari · Output             |  ✓    |   ✓    |   ✓     |   ✓    |   ✗   |
| Gestione Dati (CRUD)         |  ✓    |   ✓    |   ✗     |   ✗    |   ✗   |
| Audit Trail                  |  ✓    |   ✗    |   ✓     |   ✗    |   ✗   |
| Diagnostica                  |  ✓    |   ✗    |   ✗     |   ✗    |   ✗   |
| DELETE su tabelle dati       |  ✓    |   ✗    |   ✗     |   ✗    |   ✗   |

Matrice in `src/constants.js:182-192`. Rendering NAV in
`src/App.jsx:13-25`.

**MFA TOTP obbligatoria**:
- `editor` → enforced DB-side via RLS (`sql/14_mfa_editor.sql`).
  Editor a `aal=aal1` → INSERT/UPDATE rifiutate.
- `auditor` → enforced DB-side via RLS (`sql/15_mfa_auditor.sql`).
  Auditor a `aal=aal1` → SELECT su `audit_log` rifiutato.
- `admin` → non c'è enforcement DB (override d'emergenza per evitare
  lockout in caso di MFA device perso); l'enrollment manuale resta
  buona prassi.

UI wizard di enrollment forzato in `src/AuthGate.jsx:103-140` (sia
editor sia auditor; copy del wizard è ruolo-sensibile dalla PR #38).

---

## Configurazione del cliente

Valori configurati in `sql/02_data_seed.sql` e `src/constants.js`:

| Voce                       | Valore                                                |
|----------------------------|-------------------------------------------------------|
| Anni di inventario seed    | 2024 + 2025                                           |
| Categorie S3 incluse       | 1, 2, 3, 4, 5, 6, 7, 9, 12 (9 categorie)              |
| Categorie S3 escluse       | 8, 11 (2 categorie)                                   |
| Categorie S3 N.A.          | 10, 13, 14 (3 categorie)                              |
| Categorie S3 Da valutare   | 15 (1 categoria — investimenti, da PCAF v2.0)         |
| FE seed                    | 80 fattori (ISPRA / DEFRA / ecoinvent)                |
| Anagrafiche siti seed      | 7 (IANO, VIANO, VIANO_GARGOLA, FRASSINORO, SASSUOLO,  |
|                            |   FIORANO, CASALGRANDE)                               |
| Lingue Public Dashboard    | Italiano (default) + Inglese                          |
| Hosting                    | GitHub Pages (HTTPS forzato + HSTS da GitHub)         |

I target di decarbonizzazione sono in `src/constants.js:154-180`
(baseline 2021, short-term 2034, long-term 2050; allineati SBTi 1,5°C,
non sottomessi formalmente). Sono sovrascrivibili runtime da admin
via `app_meta.targets` senza redeploy.

---

## Stack tecnologico

| Categoria        | Componente                          | Versione    |
|------------------|-------------------------------------|-------------|
| Framework UI     | React + ReactDOM                    | 18.3.1      |
| Grafici          | Chart.js                            | 4.5.1       |
| Backend client   | @supabase/supabase-js               | 2.105.3     |
| Excel I/O        | @e965/xlsx (lazy CDN)               | 0.20.3      |
| PowerPoint I/O   | pptxgenjs (lazy CDN)                | 4.0.1       |
| Build            | @babel/core + preset-react classic  | 7.29.0      |
| Lint             | ESLint                              | 8.57.1      |
| E2E              | @playwright/test                    | ^1.59.1     |
| Edge Functions   | Deno + supabase-js                  | 2.105.3     |
| DB               | PostgreSQL via Supabase             | (PG 15+)    |

Versioni dipendenze runtime **pinnate (no caret)** per build
deterministica e SRI hash stabili (`package.json:29`). ESLint 8.57.x
è l'ultima LTS che supporta `.eslintrc.json` legacy (la 9.x usa flat
config, non ancora migrato).

---

## Documentazione

- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — setup iniziale, operazioni
  ricorrenti, disaster recovery, troubleshooting.
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, controlli
  implementati, gap noti, procedure incidente, checklist pre-deploy.
- [`assets/README.md`](assets/README.md) — formato logo/favicon e
  override `LOGO_PATH`.

---

## Licenza

Proprietà Gruppo Ceramiche Gresmalt S.p.A. Tutti i diritti riservati.
