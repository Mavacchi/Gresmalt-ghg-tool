# Gresmalt GHG Tool

Inventario delle emissioni di gas serra del **Gruppo Ceramiche Gresmalt** —
piattaforma di sustainability per gestire l'inventario Scope 1 + 2 + 3
secondo lo standard **GHG Protocol Corporate**, con dashboard pubblica per
trasparenza verso i clienti e console interna per operatori.

* **Hosting frontend**: GitHub Pages (single-file `site/index.html`)
* **Backend**: Supabase (Postgres + Auth + Edge Functions + Storage)
* **Stack**: React 18 (UMD), Chart.js 4, SheetJS/pptxgenjs (lazy via CDN+SRI)
* **Build**: `node build.mjs` produce un bundle autocontenuto, pre-compilato con Babel

---

## Indice

1. [Architettura](#architettura)
2. [Modello dati (Supabase)](#modello-dati-supabase)
3. [Faccia A — Public Dashboard](#faccia-a--public-dashboard)
4. [Faccia B — Console interna](#faccia-b--console-interna)
5. [Build & deploy](#build--deploy)
6. [Sicurezza](#sicurezza)
7. [Edge Functions](#edge-functions)
8. [GitHub Actions](#github-actions)
9. [Test](#test)
10. [Sorgenti — guida file per file](#sorgenti--guida-file-per-file)
11. [Configurazione (env vars / secrets)](#configurazione-env-vars--secrets)
12. [Operazioni comuni](#operazioni-comuni)

---

## Architettura

Lo stack è volutamente "no-bundler": tutti i sorgenti `src/*.js` e `src/**/*.jsx`
sono **IIFE** che si attaccano a un namespace globale `window.GHG`. Lo script
`build.mjs`:

1. **Pre-compila** i `.jsx` con Babel (`@babel/preset-react`, runtime classic).
2. **Inlinea** React, ReactDOM, Chart.js e `@supabase/supabase-js` UMD da
   `node_modules` dentro `<script>` nel `site/index.html` (nessun fetch a runtime
   per le librerie core).
3. **Sostituisce i placeholder** build-time (`__SUPABASE_URL__`,
   `__SUPABASE_PUBLISHABLE_KEY__`, `__TURNSTILE_SITE_KEY__`, info azienda, logo,
   versioni e SRI hash delle librerie lazy).
4. **Calcola gli SRI hash** dei bundle SheetJS (`@e965/xlsx`) e `pptxgenjs`
   pinnati in `package-lock.json`; questi sono lazy-loaded da `cdn.jsdelivr.net`
   con `integrity=sha384-…` (export Excel/PPTX on demand).
5. **Inietta una CSP** restrittiva via `<meta http-equiv>` (vedi `_headers` per
   gli header HTTP quando dietro Cloudflare/Netlify).
6. **Anti-stale cache**: scrive `site/build.txt` con il timestamp; lo script
   inline confronta a runtime il `BUILD_HASH` con `build.txt` e fa hard-reload
   se il bundle in esecuzione è obsoleto (utile su CDN/bfcache).

Il bundle finale è circa **1,1 MB** ed è 100% statico → deployabile su GitHub
Pages senza CI custom oltre alle GitHub Actions in `.github/workflows/`.

### Routing client-side

Hash-based:

- `https://.../` → **Public Dashboard** (Faccia A, anon)
- `https://.../#app` → **Console interna** (Faccia B, login richiesto)

`AuthGate.jsx` legge `location.hash` e renderizza l'una o l'altra.

### Namespace globali esposti su `window.GHG`

| Chiave | Origine | Contenuto |
|---|---|---|
| `GHG.fmt` | `constants.js` | formattatore numerico `it-IT` |
| `GHG.COLORS` | `constants.js` | palette brand (slate + cream) |
| `GHG.SITE_COLORS` | `constants.js` | Proxy: colori per sito, fallback hash deterministico |
| `GHG.ROLE_LABELS`, `GHG.can` | `constants.js` | mapping ruoli + matrice permessi |
| `GHG.CAT_NAMES`, `GHG.FAMIGLIE_FE`, `GHG.QUALITY_BADGE`, `GHG.STATUS_BADGE`, `GHG.EXPECTED_UNIT_S1`, `GHG.CATEGORICAL` | `constants.js` | enum + palette |
| `GHG.I18N` | `constants.js` | label IT/EN della Public Dashboard |
| `GHG.TARGETS` | `constants.js` | piano di decarbonizzazione (baseline + 2034 + 2050), runtime override via `app_meta.targets` |
| `GHG.LOGO_DATA_URI`, `GHG.LOGO_MARK_DATA_URI` | `logo.js` | data-URI logo (build-time injection) |
| `GHG.sanitize` | `sanitize.js` | `sanitizeForSpreadsheet(v)` anti-formula-injection |
| `GHG.calc` | `calc.js` | formule emissione, validazione, aggregazioni |
| `GHG.db` | `SupabaseDB.jsx` | client Supabase + tutte le RPC/CRUD |
| `GHG.io` | `io.jsx` | import/export Excel, export PPTX, backup ZIP |
| `GHG.ui` | `components/ui.jsx` | UI primitives + Toast + Confirm + ErrorBoundary |
| `GHG.charts` | `components/Charts.jsx` | wrapper Chart.js (Bar, Donut, Line) |
| `GHG.sectionsHelpers` | `sections/_shared.jsx` | helper di loading/skeleton/format |
| `GHG.sections` | tutte le `sections/*.jsx` | componenti per sezione console |
| `GHG.DM` | `sections/DataManager.*.jsx` | tab + modal della Gestione Dati |
| `GHG.PublicDashboard` | `sections/PublicDashboard.jsx` | Faccia A |
| `GHG.AuthGate` | `AuthGate.jsx` | gate auth + Cloudflare Turnstile + MFA |
| `GHG.App` | `App.jsx` | shell della console interna |

### Variabili globali volatili (`window.__GHG_*`)

| Variabile | Tipo | Origine | Lettori |
|---|---|---|---|
| `__GHG_ROLE` | string | `AuthGate.useAuth` decoda JWT | App.jsx, `G.db.role()`, sezioni |
| `__GHG_LOGOUT` | fn | `AuthGate` post-login | App.jsx (bottone Logout) |
| `__cfTurnstileReady` | fn | `AuthGate.LoginScreen` | callback Turnstile inline-loaded |

---

## Modello dati (Supabase)

Le migrazioni SQL sono numerate in `sql/`. Vanno eseguite **una sola volta**
sul SQL Editor di Supabase, in ordine `01 → 02 → 03 → … → 18`. Ogni file è
**idempotente** (drop-if-exists / create-if-not-exists / ON CONFLICT DO NOTHING),
quindi è sicuro ri-eseguirlo.

### Tabelle (10)

| Tabella | PK | Scopo |
|---|---|---|
| `anagrafiche` | `codice_sito` | Anagrafica dei 7 siti del Gruppo (`IANO`, `VIANO`, …). Booleani per `presenza_chp` e `regime_ets`. |
| `produzione` | `(codice_sito, anno)` | Volumi produttivi (kg + m²) per sito/anno. CHECK: almeno uno fra kg e m² > 0. |
| `fe` | `id` UUID + UK su `(fe_id, anno_validita)` | Fattori di emissione versionati per anno; famiglie Combustibili/Elettricità/WTT/Materiali/Trasporti/Rifiuti. |
| `s1` | `id` UUID | Emissioni dirette (combustione stazionaria/mobile + fugitivi). `em_tco2e` = quantità × fe_valore / 1000. |
| `s2` | `id` UUID | Elettricità acquistata; **dual reporting** Location-Based (`em_loc_tco2e`) + Market-Based (`em_mkt_tco2e`). |
| `s3` | `id` UUID | Catena del valore (15 categorie GHG Protocol). Solo le categorie incluse hanno righe. |
| `s3_materiality` | `cat_id` (1..15) | Status delle 15 categorie S3: `Inclusa` / `Esclusa` / `N.A.` / `Da valutare` con giustificazione. |
| `audit_log` | `id` bigserial | Log con **hash chain SHA-256** di ogni INSERT/UPDATE/DELETE; PII (`user_email`) pseudonimizzabile. |
| `app_meta` | `key` | Storage chiave-valore per `targets`, `locked_years`, `last_keepalive`, `schema_version`. |
| `client_errors` | `id` bigserial | Errori JS dal client (insert-only, retention 90 giorni). |
| `role_map` | `email` | Mappa email → ruolo. Trigger su `auth.users` applica `app_metadata.role` al login. |
| `audit_chain_check` | `id` bigserial | Log dei check schedulati della hash chain (settimanali via pg_cron o GH Actions). |
| `fe_search_log` | `id` bigserial | Audit delle ricerche FE via LLM (feature attualmente disattivata in UI). |
| `ai_assist_log` | `id` bigserial | Audit delle chiamate all'Edge Function `ai_assist` (explain_balance, normalize_unit, …). |

### Vista materializzata

- `public_facts` (creata in `04_public_view.sql`) — aggregato per anno con totali
  per scope, breakdown per categoria S3, percentuali per sito, copertura GO,
  intensità per m² e per kg. **Non espone** i volumi assoluti di produzione,
  solo i due rapporti di intensità. Self-check post-DDL verifica che `total_kg`
  e `total_m2` non siano colonne esposte.
- `s3_materiality_public` — vista filtrata `(cat_id, status)` per la dashboard
  anonima.
- `audit_chain_status` — top 10 record di `audit_chain_check` per UI Diagnostica.

### Funzioni (RPC)

| Funzione | Auth | Scopo |
|---|---|---|
| `current_role()` | anon/auth | legge `app_metadata.role` dal JWT, fallback `viewer` |
| `current_aal()` | auth | legge `aal` (`aal1`/`aal2`) dal JWT — UI MFA |
| `verify_audit_chain()` | admin / auditor a aal2 | ricalcola la hash chain, ritorna primo break |
| `verify_audit_chain_scheduled()` | postgres/pg_cron only | versione no-role-check + log su `audit_chain_check` |
| `is_year_locked(year)` | auth | true se l'anno è in `app_meta.locked_years` |
| `save_produzione(...)` | admin/editor | DELETE+UPSERT atomico per PK composita |
| `cascade_fe_update(fe_id, codice_voce, anno_validita)` | admin/editor | ricalcola S1+S3 referenziati, transazionale |
| `keepalive_ping()` | anon | aggiorna `app_meta.last_keepalive` — cron per evitare pause Free tier |
| `purge_old_client_errors()` | admin (cron) | retention 90 giorni su `client_errors` |
| `pseudonymize_audit_email(uuid)` | admin | hash-sostituzione email PII in `audit_log` (GDPR) |
| `purge_audit_emails_for_disabled_users()` | postgres/pg_cron | pseudonimizza utenti cessati o dormienti > 24 mesi |
| `count_failed_logins(window_minutes)` | admin/auditor | sentinella brute-force su `auth.audit_log_entries` |
| `force_refresh_public_facts()` | auth | safety-net per refresh della MV |
| `get_public_dashboard(year)` | anon | RPC pubblica per Faccia A — JSON di tutti i campi della MV |
| `list_public_years()` | anon | anni disponibili in `public_facts` |
| `log_fe_search(...)`, `mark_fe_search_selected(...)` | admin/editor | audit ricerca FE via LLM |
| `log_ai_assist(...)` | admin/editor | audit chiamate `ai_assist` |
| `apply_role_from_map()` | trigger | applica `app_metadata.role` al login basandosi su `role_map` |
| `propagate_role_map_change()` | trigger | propaga `role_map` updates a `auth.users` |
| `audit_hash_chain()`, `write_audit()` | trigger | costruisce la hash chain e logga ogni mutazione |
| `set_updated_at()`, `refresh_public_facts()` | trigger | manutenzione automatica |

### Row Level Security (RLS)

Tutte le tabelle dati hanno `ENABLE + FORCE ROW LEVEL SECURITY`:

- **SELECT**: aperto a `authenticated` (i ruoli vedono tutto in lettura).
- **INSERT / UPDATE**: solo `admin` / `editor`.
- **DELETE**: solo `admin`.
- **Year lock** (`08_year_lock.sql`): un `editor` non può modificare anni
  presenti in `app_meta.locked_years`; `admin` mantiene override d'emergenza.
- **MFA enforcement** (`14_mfa_editor.sql` + `15_mfa_auditor.sql`):
  - `editor` deve essere a `aal2` (JWT con MFA TOTP verificato) per fare write.
  - `auditor` deve essere a `aal2` per leggere `audit_log`, `audit_chain_check`,
    `fe_search_log`, `ai_assist_log`.
- **`anon`**: ha solo `SELECT` su `public_facts`, `s3_materiality_public` e
  `INSERT` su `client_errors` (con `user_id IS NULL`). Tutto il resto è
  esplicitamente revocato (default deny).
- **`audit_log`**: nessun INSERT/UPDATE/DELETE diretto — passa solo dal
  trigger `write_audit()` (security definer).

### Hash chain audit

Ogni riga in `audit_log` ha:

- `prev_hash` = `row_hash` della riga precedente
- `row_hash` = `sha256(prev_hash || ts || table || op || new_data || old_data)`

`verify_audit_chain()` ricalcola tutta la catena e ritorna l'`id` della prima
riga con hash diverso (o nessuna riga se la catena è integra). Schedulato
settimanalmente via `pg_cron` o GitHub Actions (sql `16_audit_chain_cron.sql`).

### Gestione operatori (`role_map`)

Tabella `(email, role)` con due trigger:

1. `apply_role_from_map_trg` su `auth.users` (BEFORE INSERT/UPDATE OF email) —
   quando un utente si registra o cambia email, applica il ruolo da `role_map`.
2. `propagate_role_map_change_trg` su `role_map` (AFTER INSERT/UPDATE/DELETE) —
   quando un admin modifica una entry, propaga a `auth.users.raw_app_meta_data`.

Risultato: l'ordine di operazioni "invita utente" vs "mappa ruolo" non importa.
Per ragioni di privacy le email reali non sono committate qui — si popolano via
SQL Editor in privato.

---

## Faccia A — Public Dashboard

Pagina pubblica (anonima, no login) servita all'URL root. Read-only sulla vista
materializzata `public_facts` via `get_public_dashboard(year)` e su
`s3_materiality_public`.

### Contenuti

1. **Header**: logo + lingua IT/EN + anno selezionabile + accesso operatori.
2. **Hero**: titolo + statistica % di riduzione vs baseline 2021 + caveat
   metodologico (le GO sono un cambio di metodologia, non solo riduzione fisica).
3. **Toggle Scope 2**: Location-Based vs Market-Based, con tooltip esplicativo.
4. **KPI strip**: totale tCO₂e anno + variazione vs anno precedente +
   % GO + intensità per m².
5. **Donut composizione**: S1 / S2 / S3 con etichette.
6. **Trend ultimi 5 anni**: bar stacked + line target 2034 + caveat baseline.
7. **Scope 3 hotspots**: top 3 categorie per impatto assoluto + % di S3.
8. **Cosa rendicontiamo**: spiegazione Scope 1/2/3 in linguaggio non tecnico.
9. **Glossario**: tCO₂e, GO, intensità carbon, LB vs MB.
10. **Materialità Scope 3**: 15 cards con status (Inclusa/Esclusa/N.A./Da valutare).
11. **Target**: baseline 2021 → target 2034 → vision 2050 (assoluti + intensità).
12. **Iniziative**: 6 leve di decarbonizzazione (efficienza energetica, FV,
    elettrificazione, …) divise tra Piano 2034 e Vision 2050.
13. **Baseline & perimetro**: anno base, approccio di consolidamento,
    soglia di ricalcolo, fonti FE, emissioni biogeniche.
14. **Trust signals**: GHG Protocol, GRI, SBTi, European Climate Law.
15. **CTA finale**: download piano + EPD + sito + email + stampa.
16. **Disclaimer + footer**: privacy, cookie, link Bilancio di Sostenibilità.

### Lingua

IT default. Persistita in `localStorage.ghg_lang`. Le label sono in
`G.I18N[lang]` con interpolazione `{placeholder}`. Toggle istantaneo.

### Print

Il bottone "⎙ Stampa" applica `body.classList.add('ghg-print-mode')` e poi
`window.print()`. Il CSS in `build.mjs` nasconde sidebar/topbar/toolbar e
forza A4 portrait con `page-break-inside: avoid` su section/article/canvas.

---

## Faccia B — Console interna

Sidebar + topbar + main. Accessibile da `#app`. Login email/password +
opzionale Cloudflare Turnstile + opzionale MFA TOTP (forzato per
editor/auditor).

### Sezioni (11)

| Sezione | Componente | Ruoli con accesso | Scopo |
|---|---|---|---|
| **Dashboard** | `G.sections.Dashboard` | tutti tranne guest | KPI strip (9 cards) + donut + per-site bar + trend con forecast + drill-down + chat AI "Spiega bilancio" |
| **Analisi per Sede** | `G.sections.SiteAnalysis` | tutti tranne guest | Confronto siti S1+S2 con toggle LB/MB, bar stacked, intensità, table YoY |
| **Analisi per Scope** | `G.sections.ScopeAnalysis` | tutti tranne guest | Tab S1/S2/S3 con KPI strip + composizione + per-site stacked + ranking |
| **Materialità S3** | `G.sections.Materiality` | tutti tranne guest | Grid 15 cards con status + justification + edit modal |
| **Data Quality** | `G.sections.DataQuality` | non viewer/guest | Score qualità + 5 sub-tab (Controlli, Verifica, YoY anomalies, FE da aggiornare, Note) |
| **FE Explorer** | `G.sections.FEExplorer` | non viewer/guest | Tabella FE con filtri famiglia + ricerca testuale |
| **Scenario Tool** | `G.sections.Scenarios` | tutti tranne guest | Simulatore decarbonizzazione: 11 sliders + preset Piano 2034 / Vision 2050 |
| **Download** | `G.sections.Output` | tutti tranne guest | Export PPTX (~22 slide) + snapshot JSON firmato HMAC (admin) |
| **Gestione Dati** | `G.sections.DataManager` | admin/editor | CRUD su 7 tab: anagrafiche, S1, S2, S3, FE, produzione, targets. Import/Export Excel, Clone-Year |
| **Audit Trail** | `G.sections.AuditTrail` | admin/auditor | Log paginato + filtri + diff JSON + verifica hash chain + export CSV/JSON firmato |
| **Diagnostica** | `G.sections.Diagnostics` | admin | Anon-probe RLS + hash chain + year-lock + keep-alive + history check |

### Selettore anno

Persistito in `localStorage.ghg_year`. Auto-select del più recente se l'anno
persistito non è più disponibile.

### Keyboard shortcuts

- `Cmd/Ctrl + K` → ricerca globale (cerca su s1/s2/s3/fe/produzione)
- `Cmd/Ctrl + S` → click sul bottone "Salva" nel modal aperto
- `?` → overlay con elenco shortcuts
- `Esc` → chiudi modal/overlay

### Indicatore DB

Pallino verde/rosso in topbar che fa una `select` banale ogni 30s.

### Sidebar responsive

- ≥ 768px: sidebar inline collassabile (230 ↔ 64 px), brand mark compatto
  quando collassata.
- < 768px: drawer overlay (260 px) con backdrop + slide-in.

### MFA enrollment

Editor/auditor al primo login senza factor TOTP vedono `MFAEnrollScreen`:

1. QR code da scansionare con Google Authenticator / Authy / 1Password
2. Codice manuale (alternativa)
3. Verifica codice 6 cifre

Gli admin **non** sono forzati (override d'emergenza per device perso).
Lato DB le policy `14_mfa_editor.sql` + `15_mfa_auditor.sql` bloccano comunque
le mutazioni se `aal != 'aal2'`.

### Sign-off / lock anno

Da Diagnostica admin può lockare/sbloccare anni. Una volta lockato:

- `editor` non può più modificare quell'anno (RLS via `is_year_locked()`).
- `admin` mantiene override per correzioni straordinarie.

Stato salvato in `app_meta.locked_years` come array JSONB.

### AI assist (Edge Function `ai_assist`)

Disponibile per editor/admin. Tre task in produzione + uno chat:

- `explain_balance`: riassunto narrativo del bilancio GHG di un anno.
- `chat_balance`: chat multi-turn sul bilancio, primo turn = riassunto.
- `normalize_unit`: porta una unità raw alla forma canonica (es.
  `"kg co2 eq per kwh"` → `"kgCO2e/kWh"`).
- `suggest_code`: suggerisce `codice_voce` + `famiglia` coerenti con i FE
  esistenti.

Tutte le chiamate sono loggate in `ai_assist_log` per audit.

### Ricerca FE online (DISATTIVATA)

La sezione FE Explorer aveva una card "Cerca FE online via IA" che usava
l'Edge Function `search_fe` (Gemini + Google Search Grounding) per proporre
candidati FE da fonti pubbliche (ISPRA/DEFRA/EPA/AIB/IPCC). **Disabilitata**
perché i risultati erano sistematicamente inaffidabili (mismatch anno/edizione,
ambiguità TTW vs WTW, sintesi di valori letti senza il numero esatto).
La Edge Function e la tabella di audit `fe_search_log` restano nel
repo/DB per uso futuro.

---

## Build & deploy

### Pre-requisiti

- Node ≥ 18
- `npm install` (dipendenze pinnate, no caret → SRI hash deterministici)
- Project Supabase con migrazioni `sql/01..18` applicate
- (Opzionale) Cloudflare Turnstile site key
- (Opzionale) Secrets per Edge Functions (`SNAPSHOT_HMAC_KEY`, `GEMINI_API_KEY`)

### Build locale

```bash
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # nuovo nome
# legacy SUPABASE_ANON_KEY accettato come fallback
export TURNSTILE_SITE_KEY=0xAAAA...                  # opzionale
export COMPANY_LEGAL_NAME='Gruppo Ceramiche Gresmalt S.p.A.'
export COMPANY_VAT='IT00000000000'
export SUSTAINABILITY_EMAIL='sustainability@gresmalt.it'
export PUBLIC_DASHBOARD_URL='https://sustainability.gresmalt.it'
node build.mjs
# → site/index.html (autocontenuto, ~1.1 MB)
# → site/.nojekyll, site/build.txt, site/_headers
```

### Dev server

```bash
npm run dev
# build + python3 -m http.server --directory site 8000
```

### Deploy automatico (GitHub Pages)

Push su `main` → `.github/workflows/deploy.yml`:

1. `npm ci`
2. `node build.mjs` con i secrets configurati
3. Upload artifact `site/`
4. `actions/deploy-pages@v5` → live su GitHub Pages

### Anti-stale cache (3 livelli)

1. **bfcache flash**: listener `pageshow` con `e.persisted=true` → hide HTML
   + `location.reload()` (no flash del bundle vecchio).
2. **HTTP cache stantio**: fetch `build.txt` con cache-buster; se l'hash
   server-side differisce dal `BUILD_HASH` inlined → hard reload (`location.replace`).
   Loop-guard: max 1 reload per 10s tramite `sessionStorage`.
3. **localStorage marker** `ghg_build` per visualizzazione in Diagnostica.

### Forbidden tokens (defense in depth)

`build.mjs` blocca il build se trova nei sorgenti `src/`:

- `dangerouslySetInnerHTML` (React unsafe rendering)
- `eval(`, `new Function(` (code injection)
- `document.write(` (DOM legacy)
- `innerHTML =` (XSS-prone)

E lo script `npm run lint:no-dangerous-html` controlla il pattern principale
in CI come secondo gate.

---

## Sicurezza

### Content Security Policy

Iniettata via `<meta http-equiv>` (per GitHub Pages, che non supporta header
custom) + `_headers` (per Cloudflare/Netlify):

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

`frame-ancestors 'none'` + `X-Frame-Options: DENY` sono in `_headers` (CSP
`<meta>` ignora `frame-ancestors`).

### SRI (Subresource Integrity)

SheetJS e pptxgenjs sono caricati lazy da `cdn.jsdelivr.net` con
`integrity=sha384-…` calcolato a build-time sui bundle pinnati locali.
Se la CDN serve un file con hash diverso, il browser blocca il load.

### PII redaction

`G.db.redactPII(s)` in `SupabaseDB.jsx` filtra prima dell'insert in
`client_errors`:

- email → `[email]`
- JWT (eyJ…) → `[jwt]`
- `Bearer …` → `Bearer [redacted]`
- IBAN → `[iban]`
- codice fiscale italiano → `[cf]`
- telefono internazionale → `[tel]`

Anche se la tabella è admin-only via RLS, è una difesa in profondità GDPR.

### MFA enforcement

Definito a livello di **policy SQL**, non solo UI:

- Editor a `aal1` → INSERT/UPDATE rifiutati su tutte le tabelle dati.
- Auditor a `aal1` → SELECT su `audit_log`, `fe_search_log`, `ai_assist_log`,
  `audit_chain_check` rifiutato.
- Admin → invariato (no lockout in caso di MFA device perso).

### Rate limit client-side

`SupabaseDB.jsx` rate-limit sliding window: max 30 mutazioni in 10s. Difesa
in profondità contro loop accidentali. Il DB ha comunque i suoi rate limit
gestiti da Supabase.

### Snapshot HMAC

L'export "Snapshot JSON firmato" chiama l'Edge Function `sign_snapshot`:

- Solo admin.
- HMAC-SHA256 con `SNAPSHOT_HMAC_KEY` (env, mai esposta al client).
- Output: `{ payload, signature, data_sha256, signed_at, signer_email }`.
- Verifica via `verify_snapshot` (constant-time eq).

### Pseudonimizzazione audit

`pseudonymize_audit_email(uuid)` sostituisce `user_email` in `audit_log` con
`pseudo:<sha256-16char>` per utenti cessati o dormienti > 24 mesi. La hash
chain NON viene ricalcolata (immutability); è documentato che lo stato
"broken" del primo record pseudonimizzato è atteso.

### Anon-probe (test RLS leak)

Da Diagnostica admin può lanciare un check: crea un client Supabase
*separato* senza sessione (solo `apikey` anon) e prova `SELECT * LIMIT 1`
su tutte le tabelle protette. Se anche solo una ritorna ≥ 1 riga, è un
leak RLS. Lista tabelle protette: `s1, s2, s3, fe, anagrafiche, produzione,
audit_log, s3_materiality, app_meta, role_map`.

### Backup criptato

Workflow `.github/workflows/backup.yml`: ogni lunedì 04:00 UTC fa `pg_dump`
del DB, lo gzippa, lo cripta con `gpg --symmetric --cipher-algo AES256` usando
`BACKUP_PASSPHRASE`, e (opzionale) replica su S3.

---

## Edge Functions

In `supabase/functions/`. Deploy:

```bash
supabase functions deploy <name> --no-verify-jwt
supabase secrets set GEMINI_API_KEY=AIza...
supabase secrets set SNAPSHOT_HMAC_KEY=<random-32-bytes-hex>
supabase secrets set ALLOWED_ORIGINS=https://sustainability.gresmalt.it
```

### `sign_snapshot`

Firma HMAC-SHA256 di un payload JSON di snapshot inventario.

- **Auth**: admin only (verificato leggendo `app_metadata.role` dal JWT).
- **Origin allowlist**: `ALLOWED_ORIGINS` (CSV), fallback `*` solo dev.
- **Body size**: max 1 MB.
- **Output**: `{ ok, signature, data_sha256, signed_at, signer_email, algorithm: 'HMAC-SHA256' }`.

### `verify_snapshot`

Verifica una signature in input. Constant-time eq.

- **Auth**: qualunque utente autenticato.
- **Output**: `{ valid, sha_match, signature_match, verified_at, verifier_email }`.
- HTTP 200 se valid, 422 altrimenti.

### `verify_audit_chain`

Wrapper Edge della SQL function `verify_audit_chain()`. Restituisce
`{ integrity: 'ok' | 'broken', first_broken_id, expected_hash, actual_hash, verified_at }`.

### `ai_assist`

Task LLM senza grounding. Modello default `gemini-3.1-flash-lite` (500 RPD
free, no grounding richiesto).

- **Auth**: admin/editor.
- **Body size limits per task** (KB):
  - `explain_balance`: 16
  - `chat_balance`: 28
  - `suggest_code`: 8
  - `normalize_unit`: 1
- **Retry**: solo su 503/5xx generici (mai su 429, consumerebbe quota).
- **Audit log**: ogni chiamata loggata in `ai_assist_log` (anche errori).
- **Output**: `{ ok, log_id, task, output, duration_ms }`.

Task chiamabili lato client via `G.db.aiAssist(task, payload)`.

### `search_fe`

Ricerca FE via Gemini 2.5 Flash + Google Search Grounding. **Disabilitata
in UI** (vedi sopra). Implementa:

- Whitelist domini autorevoli (ISPRA, DEFRA, EPA, IPCC, AIB, ecc.).
- Query expansion italiano → sinonimi inglesi per ancorare grounding.
- Scope-specific prompt guidance (S1/S2/S3 transport/S3 purchased/S3 other).
- Parser JSON tollerante (fence ```json, brace-balance, salvage parziale).
- Audit log su `fe_search_log` con `sources_used`, response raw + parsed.

---

## GitHub Actions

In `.github/workflows/`:

### `build.yml`

Push su `main` o `claude/**`, PR su `main`, paths `src/**`, `test/**`, `sql/**`,
`package.json`, `build.mjs`:

1. **Lint**: `npm run lint:no-dangerous-html` + ESLint con max 50 warnings.
2. **Secret scan**: grep per pattern JWT, `service_role.*eyJ`,
   `SUPABASE_DB_URL=postgres://`, `SNAPSHOT_HMAC_KEY=hex`.
3. **npm audit** (level high+critical, `--omit=dev`).
4. **Unit tests**: `npm test`.
5. **Build** con env stub.
6. **Upload artifact** `site/` (retention 7 giorni).
7. **e2e** (job separato): Playwright Chromium smoke test, 12 sezioni + login
   flow + tutte le 7 tab di Gestione Dati. Stub `window.supabase` via
   `addInitScript`.

### `deploy.yml`

Push su `main` (oppure manuale via workflow_dispatch):

1. `npm ci`
2. `node build.mjs` con i secrets reali.
3. `actions/configure-pages@v6` + `upload-pages-artifact@v5`.
4. `deploy-pages@v5` → publish.

Concurrency: una sola esecuzione di deploy alla volta.

### `keepalive.yml`

Cron ogni 3 giorni alle 12:00 UTC: chiama `POST /rest/v1/rpc/keepalive_ping`
con curl. Evita la pausa automatica del Supabase Free Tier dopo 7 giorni di
inattività. Retry 3× con backoff.

### `backup.yml`

Cron ogni lunedì 04:00 UTC: `pg_dump` + gzip + GPG AES256 + upload artifact
(retention 30 giorni). Replica opzionale su S3 (se i secrets AWS sono presenti).

### `dependabot.yml`

PR settimanali (lunedì 06:00 Europe/Rome):

- Bump runtime (react, react-dom, chart.js, @supabase/supabase-js) raggruppati
  per minor/patch only.
- Bump SRI-libs (@e965/xlsx, pptxgenjs) raggruppati — richiedono ricalcolo SRI.
- Bump babel raggruppati.
- Bump major **mai raggruppati** (lesson learned PR #9 — un React 18→19
  mascherato come "minor" ruppe la Public Dashboard).
- `ignore` major su react/react-dom finché audit dedicato.

---

## Test

### Unit tests — `npm test`

Runner zero-dep custom (`test/_runner.mjs`) con API tipo Jest (`describe`,
`test`, `expect.toBe / toEqual / toBeCloseTo / toBeNull / toContain / toHaveLength`).

I sorgenti `src/*` sono IIFE che si attaccano a `window`/`globalThis`; il
loader `test/_load.mjs` legge il file come stringa e lo esegue via
`vm.runInThisContext` con un namespace `globalThis.GHG = {}`.

Suite (67 test totali):

- `test/calc.test.mjs` — formule emS1/S2/S3, num, lookupFE (esatto +
  fallback ±1/±2/>2 anni), validateRow (s1/s2/s3/produzione/fe), intensity,
  intensityPerSite (LB e MB), totals (filtro per sito + S3 organizzativo),
  availableYears.
- `test/io.test.mjs` — `enrichForUpsert` per S1/S2/S3 (sentinella anti-regressione
  sul bug storico Em_tCO2e null dopo import minimale).
- `test/zip.test.mjs` — `crc32` (vettori standard) + `makeZip` (signature ZIP,
  end-of-central-directory).
- `test/redactpii.test.mjs` — `redactPII` su email, JWT, Bearer, IBAN, CF,
  telefono.

### Smoke test runtime — `npm run test:e2e`

Playwright Chromium (`test/e2e/smoke.spec.mjs`). Cattura ReferenceError
runtime dopo split di file (vedi commit history per i bug storici).

Strategia: `addInitScript` inietta uno stub di `window.supabase` con
`getSession()` finto, RPC stub, e `Object.defineProperty(window, 'supabase',
{configurable:false, set(){}}` per evitare che l'UMD reale sovrascriva lo stub.

Test:

- Public Dashboard si carica senza errori console critici.
- Console interna apre **tutte e 11 le sezioni** della sidebar senza
  ReferenceError.
- Gestione Dati apre **tutte e 7 le tab** interne.
- Login flow: LoginScreen render + submit → console interna.

### Lint

```bash
npm run lint              # ESLint legacy .eslintrc.json
npm run lint:no-dangerous-html
```

Regole notevoli (`.eslintrc.json`):

- `no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url`: error
- `no-unused-vars`: warn (con `argsIgnorePattern: ^_`)
- `no-console`: warn (consente `warn`, `error`, `info`)
- `eqeqeq`: warn (smart)
- `no-debugger`, `no-alert`: error
- `no-throw-literal`: error
- `no-return-assign`: error (except-parens)

---

## Sorgenti — guida file per file

### `build.mjs`

Lo script di build. Vedi `Architettura` sopra. ~670 righe. Le sezioni
notevoli:

- Risoluzione logo/favicon: cerca `assets/logo.{svg,png,jpg,jpeg}` (case-insensitive
  per macOS/Windows), `assets/Logo-ridotto.*` per il brand mark compatto,
  `assets/favicon.*`. Tutti inlined come data-URI base64.
- `patchInlinedUMD`: webpack 5 emette un runtime "auto publicPath" che chiama
  `document.currentScript.src` → in un `<script>` inlined è `""` e webpack lancia
  un error fatale che blocca `window.supabase`. Una regex sostituisce il
  `throw` con `publicPath = "/"`.
- `loadLib`: cerca i bundle UMD in `node_modules/react/umd/`,
  `node_modules/react-dom/umd/`, `node_modules/chart.js/dist/`,
  `node_modules/@supabase/supabase-js/dist/umd/`.
- `compile`: Babel transform su ogni `.jsx` (preset-react classic). I `.js` sono
  copiati raw.
- `sri`: `createHash('sha384').update(file).digest('base64')` → `sha384-<...>`.
- Anti-stale cache (3 livelli), descritto sopra.

### `src/constants.js` (499 righe)

`G.fmt(n, dec)`, palette `COLORS`, `CATEGORICAL` (palette 7 colori categorici),
`SITE_COLORS` (Proxy con hash deterministico fallback per siti non statici),
`ROLE_LABELS`, `CAT_NAMES` (15 categorie S3 in italiano),
`FAMIGLIE_FE`, `QUALITY_BADGE` (P/S/E), `STATUS_BADGE` (Definitivo/Provvisorio/Stimato),
`EXPECTED_UNIT_S1` (mapping categoria → unità attesa per warning),
`TARGETS` (piano di decarbonizzazione, sovrascrivibile runtime da `app_meta.targets`),
`I18N` (label IT/EN della Public Dashboard, con sezioni hero/glossary/targets/
initiatives/baseline/trust/CTA/disclaimer/footer/materiality),
`can` (matrice permessi per ruolo).

### `src/logo.js` (42 righe)

SVG wordmark "gresmalt GROUP" come fallback. Placeholder `__LOGO_DATA_URI__`
e `__LOGO_MARK_DATA_URI__` sostituiti da `build.mjs` se gli asset PNG/SVG
sono presenti in `assets/`.

### `src/sanitize.js` (20 righe)

`G.sanitize.sanitizeForSpreadsheet(v)`: prefissa con `'` qualunque stringa
che inizia con `=`, `+`, `-`, `@`, `\t`, `\r`. Difesa contro CSV/Excel
formula injection.

### `src/calc.js` (270 righe)

Formule emissione (`emS1`, `emS2Loc`, `emS2Mkt`, `emS3` — tutte
`quantità × FE / 1000`), `num()` resiliente (virgola decimale italiana),
`lookupFE` con fallback per anno (Δ=0 ok, Δ≤1 silenzioso, Δ=2 warn,
Δ>2 err), `validateRow` per s1/s2/s3/produzione/fe (accetta sia chiavi
App-named accentate che DB snake_case), `intensity` (kgCO₂e/kg + kgCO₂e/m²),
`intensityPerSite` (S3 escluso, opt `s2Method`), `totals` (filtro per sito,
S3 organizzativo se filtrato), `availableYears` (dedup + sort desc).

### `src/SupabaseDB.jsx` (790 righe dopo cleanup)

Client Supabase + traduzione DB↔App (snake_case ↔ PascalCase accentato) +
rate limit + tutte le RPC/CRUD. Vedi tabella `G.db.*` sopra.

`dbToApp` / `appToDb` usano una mapping table `DB_TO_APP`. Aggiungere un campo
nuovo al DB richiede aggiungere la riga in quella mappa, altrimenti il campo
arriva raw alla UI e nessuno lo trova.

`saveProduzione` chiama la RPC atomica `save_produzione`; fallback legacy
DELETE+UPSERT non transazionale con warning in console se la RPC non c'è
(DB pre-`13_hardening.sql`).

`cascadeFEUpdate` chiama la RPC atomica `cascade_fe_update`; fallback legacy
carica S1+S3+FE in memoria e ricalcola via `G.calc.lookupFE`.

`cloneYear(srcYear, dstYear)`: per S1/S2/S3/produzione copia le righe
sorgente al dst nullificando i campi FE/Em (vanno ri-applicati con i FE
del nuovo anno) e forzando `stato_dato='Provvisorio'`. Dedup logico per
"chiave business" (sito+voce per S1/S2, categoria+sottocat+codice_fe per S3,
sito per produzione). Operazione multi-step non transazionale.

### `src/io.jsx` (2150 righe)

Import/Export Excel (SheetJS) + Export PPTX (~22 slide, pptxgenjs) + Export
backup ZIP (encoder STORE inline, no dipendenze). Tutto lazy-loaded da CDN
con SRI.

`exportExcel`: 6 fogli (Anagrafiche, Produzione, FE, S1, S2, S3),
sanitizzati.

`exportTemplate`: stesso schema ma con 1 riga di esempio per ogni foglio.
Per onboarding nuovi anni/operatori.

`importExcel`: legge il file, valida ogni riga con `G.calc.validateRow`,
fa cross-ref con `existingData` (siti noti, FE codes, anni bloccati),
classifica le righe in `{ new, updated, unchanged, errors, warnings }`,
ritorna un preview che l'utente conferma in `ImportPreviewModal`.

`commitImport`: esegue gli upsert in batch, skip-on-error per riga.

`enrichForUpsert`: ricalcola `Em_tCO2e` da Q×FE/1000 sempre che Q+FE
siano disponibili. Test in `test/io.test.mjs` sentinella anti-regressione.

`exportPPTX(data, year, { lang })`: ~22 slide IT/EN incluse cover, TOC,
KPI, composizione, trend, target gap, S1/S2/S3 deep dive, materiality,
intensity, quality, methodology, boundary, FE reference (multi-page),
disclaimer, closing. Stile coerente con la palette brand.

`exportBackup`: ZIP STORE inline contenente `data.xlsx` + `metadata.json`
(`exported_by_role`, build hash, ecc.) + `README.txt`.

### `src/components/Charts.jsx` (215 righe)

Wrapper Chart.js 4. `ChartBar` (con `stacked`, `horizontal`, `onElementClick`),
`ChartDonut`, `ChartLine`, `ChartEmpty`. Cleanup esplicito su unmount (memory
leak). Tooltip Italian-locale con unità. `ctx.raw` invece di `ctx.parsed.y`
per fix bug horizontal-bar che mostrava indici al posto dei valori.

### `src/components/DataTable.jsx` (335 righe)

Tabella generica con sort/filter/pagination + multi-select + bulk-actions
banner. Rows senza `id` (es. produzione con PK composita) non possono essere
bulk-selected (checkbox disabled). A11y: `aria-sort`, keyboard `<th>` enter/space,
`aria-live` count, paging label.

### `src/components/ui.jsx` (455 righe)

UI primitives: `Card`, `KPICard` (memoised), `EmissionBadge`, `Skeleton`,
`ToastHost` + `pushToast`, `ConfirmHost` + `confirm(message, opts)`,
`Button`, `Input`, `Select`, `Pill`, `S2MethodToggle` + `useS2Method` (hook
+ persistenza `localStorage.ghg_s2method`), `ErrorBoundary` (logga errori
client redacted), `btnStyle`. Toast duration dinamica per length/kind.

### `src/sections/_shared.jsx` (50 righe)

Helper condivisi tra le sezioni della console: `isLoading(data)`,
`loadingSkeleton(title)`, `emWithPct(em, total, scopeLabel)` (formato
`"{em} tCO₂e · {pct}% di {scope}"`).

### `src/sections/PublicDashboard.jsx` (1450 righe)

Faccia A. Vedi sezione [Faccia A](#faccia-a--public-dashboard). Internamente
ha `renderScope3Hotspots`, `renderTargets`, `renderInitiatives`, `renderBaseline`,
`renderGlossary`, `renderCTA`, `renderTrust`, `renderDisclaimer`. Sketch in
caso `error` → banner fisso top.

### `src/sections/Dashboard.jsx` (840 righe)

Dashboard interna: KPI strip 9-card, donut composizione, per-site bar
comparison, trend con forecast (linear regression sugli ultimi 5 anni),
gap vs target, drill-down modal su click di slice/bar, AI chat "Spiega
bilancio" (tasks `explain_balance` + `chat_balance` su `G.db.aiAssist`).

### `src/sections/SiteAnalysis.jsx` (230 righe)

Confronto siti S1+S2 con toggle LB/MB (`useS2Method`), bar stacked,
intensità per m² + per kg, table con YoY.

### `src/sections/ScopeAnalysis.jsx` (425 righe)

Tab S1/S2/S3 con KPI strip + composizione + per-site stacked + ranking.

### `src/sections/Materiality.jsx` (200 righe)

Grid 15 cards per categoria S3 con status (Inclusa/Esclusa/N.A./Da valutare),
giustificazione, riferimento metodologico, anno review. Edit modal per card
(admin/editor).

### `src/sections/DataQuality.jsx` (325 righe)

Score qualità (P×100 + S×60 + E×30 / total) + 5 sub-tab:

- **Controlli consigliati**: lista di check automatici (FE pre-1970, Q=0,
  unità non standard, ecc.).
- **Dati da verificare**: righe con stato 'Provvisorio' o 'Stimato'.
- **YoY anomalies**: variazione |Δ%| > 30% (configurabile) rispetto all'anno
  precedente per stessa chiave.
- **FE da aggiornare**: lista FE in scadenza (anno_validita < anno corrente - 2).
- **Note metodologiche**: tutte le righe con campo Note popolato.

### `src/sections/FEExplorer.jsx` (80 righe)

Tabella FE con filtri famiglia + ricerca su FE_ID/Descrizione. La feature
"Cerca FE online via IA" è stata rimossa (vedi sopra).

### `src/sections/Scenarios.jsx` (450 righe)

Simulatore decarbonizzazione: 11 sliders per leve (efficienza energetica,
elettrificazione, PV, GO, riduzione spessori, ecc.), 2 preset (Piano 2034,
Vision 2050). Calcolo emissioni scenario + gap vs target + ranking delle
leve + impatto su intensità.

### `src/sections/Output.jsx` (155 righe)

Download centre. Export PPTX con toggle lingua IT/EN. Export snapshot JSON
firmato HMAC (admin only) via Edge Function `sign_snapshot`. Stampa pagina.

### `src/sections/DataManager.jsx` (215 righe)

Shell della "Gestione Dati": onboarding card + bar import/export + tab nav
+ clone-year modal. Delega ai 4 file companion:

- `DataManager.shared.jsx` — `OnboardingCard`, `ImportPreviewModal`,
  `CloneYearModal`, `Field`, `GenericTab`, `COLUMNS` (definizioni colonne
  per tabella), helper di stile per modali, `exportCSV`.
- `DataManager.tabs.jsx` — `AnagraficheTab`, `ProduzioneTab`, `TargetsTab`,
  `FETab` + i rispettivi edit modal. Anagrafiche: count referencing rows
  per FK protection. Produzione: tracking `origKey` per PK composita.
  Targets: full CRUD su `G.TARGETS` via `G.db.saveTargets`. FETab: clone
  "nuova versione" + cascade via `G.db.cascadeFEUpdate`.
- `DataManager.scopeModals.jsx` — `S1EditModal`, `S2EditModal`, `S3EditModal`
  con preview emissione in tempo reale + auto-fill FE dal catalogo +
  year-lock awareness + feedback di validazione.

Le 7 tab finali sono: Anagrafiche, Produzione, S1, S2, S3, FE, Target.

### `src/sections/AuditTrail.jsx` (345 righe)

Log paginato (500 righe/pagina, "Load more"), filtri (table/user/op/range),
diff summary per row, JSON diff modal, hash chain status pill (via
`G.db.verifyAuditChain`), export CSV + export JSON firmato HMAC via
Edge Function `sign_snapshot`.

### `src/sections/Diagnostics.jsx` (285 righe)

Admin-only. Indicatori di riconciliazione, audit chain status + history
schedulato, anon-probe RLS, year sign-off lock toggle, Supabase keep-alive
ping (manuale).

### `src/AuthGate.jsx` (600 righe)

Gate auth Supabase. `useAuth` hook che legge `auth.getSession()` + listener
`onAuthStateChange`, decoda il JWT per estrarre `app_metadata.role`,
restituisce `{ session, role, loading, error }`. `LoginScreen` con
opzionale Turnstile captcha + opzionale challenge MFA TOTP.
`MFAEnrollScreen` con QR code Google Authenticator + codice manuale + verifica
6 cifre. Gestisce factor unverified residui da tentativi precedenti
(unenroll + re-enroll per ottenere QR fresco).

### `src/App.jsx` (645 righe)

Shell console interna. Sidebar (responsive desktop/mobile drawer), topbar
(toggle sidebar, breadcrumb, search Cmd+K, anno corrente, ping indicator),
main content (renderizza una delle 11 sezioni in base a `route.section`).
`SearchModal` globale (Cmd+K, max 20 risultati, search su s1/s2/s3/fe/produzione).
`HelpModal` con keyboard shortcuts.

---

## Configurazione (env vars / secrets)

### Build-time (build.mjs)

| Variabile | Tipo | Default | Note |
|---|---|---|---|
| `SUPABASE_URL` | secret | — | richiesta |
| `SUPABASE_PUBLISHABLE_KEY` | secret | — | richiesta; legacy `SUPABASE_ANON_KEY` accettata |
| `TURNSTILE_SITE_KEY` | secret | (vuoto = skip Turnstile) | opzionale |
| `COMPANY_LEGAL_NAME` | var | `Gruppo Ceramiche Gresmalt S.p.A.` | usata in JSON-LD + footer |
| `COMPANY_VAT` | var | `IT00000000000` | usata in JSON-LD |
| `SUSTAINABILITY_EMAIL` | var | `sustainability@gresmalt.it` | CTA "Scrivi all'Innovability Unit" |
| `PUBLIC_DASHBOARD_URL` | var | `https://sustainability.gresmalt.it` | `<link rel=canonical>` + OG url |
| `SCHEMA_VERSION` | var | `1` | usato in `app_meta.schema_version` e in `metadata.json` del backup |
| `LOGO_PATH` | var | (auto-detect `assets/logo.*`) | override esplicito |
| `LOGO_MARK_PATH` | var | (auto-detect `assets/Logo-ridotto.*`) | override esplicito |

### Edge Functions (Supabase secrets)

```bash
supabase secrets set SUPABASE_URL=https://xxx.supabase.co
supabase secrets set SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
supabase secrets set ALLOWED_ORIGINS=https://sustainability.gresmalt.it,https://gresmalt.github.io
supabase secrets set SNAPSHOT_HMAC_KEY=<random-32-bytes-hex>
supabase secrets set GEMINI_API_KEY=AIza...
supabase secrets set GEMINI_MODEL=gemini-2.5-flash-lite           # opzionale (search_fe)
supabase secrets set GEMINI_MODEL_PLAIN=gemini-3.1-flash-lite     # opzionale (ai_assist)
```

### GitHub Actions secrets

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (o legacy `SUPABASE_ANON_KEY`)
- `TURNSTILE_SITE_KEY` (opzionale)
- `SUPABASE_DB_URL` — Postgres URI per `pg_dump` weekly backup
- `BACKUP_PASSPHRASE` — passphrase GPG AES256
- `AWS_S3_BACKUP_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_DEFAULT_REGION` — opzionali per replica backup off-GitHub

### GitHub Actions vars (non secret)

- `COMPANY_LEGAL_NAME`, `COMPANY_VAT`, `SUSTAINABILITY_EMAIL`,
  `PUBLIC_DASHBOARD_URL`, `SCHEMA_VERSION` — fallback in workflow

---

## Operazioni comuni

### Aggiungere un nuovo anno di inventario

1. Pop. `Produzione` per ogni sito (kg + m²) in **Gestione Dati > Produzione**.
2. (Opzionale) Clone da anno precedente via "Clona da anno…" — copia
   struttura S1/S2/S3 azzerando FE/Em e forzando `stato_dato='Provvisorio'`.
3. Aggiornare FE nuovo anno in **Gestione Dati > FE** (clone "Nuova versione"
   da FE anno precedente è disponibile, modifica `Valore` + `Anno_Validità` →
   il cascade ricalcola S1/S3 automaticamente).
4. Compilare/verificare le righe S1, S2, S3 (Quantità reali); l'`Em_tCO2e`
   si calcola in automatico.

### Chiudere un anno (sign-off)

Da **Diagnostica > Year sign-off lock** (admin), toggle ON sull'anno. Da quel
momento gli editor non possono più modificare quell'anno. L'admin mantiene
override d'emergenza.

### Pubblicare un nuovo report

1. Verifica i numeri sul Dashboard interno.
2. **Output > Scarica PPTX** (toggle lingua se serve).
3. **Output > Snapshot JSON firmato** (admin only). Conserva il JSON e
   la signature per audit esterno.
4. Push su `main` → GitHub Actions ricostruisce e ridepoy il sito.

### Aggiungere un nuovo operatore

1. SQL Editor Supabase:
   ```sql
   insert into public.role_map (email, role)
     values ('nuovo.utente@gresmalt.it', 'editor');
   ```
2. Inviare invito da Supabase Auth → Users.
3. Al primo login il trigger applica automaticamente `app_metadata.role`.
4. Editor/auditor verranno forzati all'enrollment MFA TOTP al primo login.

### Cambiare i target di Piano

Da **Gestione Dati > Target** (admin). I valori salvati in `app_meta.targets`
sovrascrivono `G.TARGETS` di `constants.js` al successivo `loadAll`. Nessun
redeploy richiesto.

### Verificare integrità audit chain

Da **Audit Trail** badge in alto a destra. Manuale via **Diagnostica > Audit
chain**. Schedulato weekly via pg_cron (se disponibile sul tier Supabase) o
via GitHub Actions.

### Rollback in caso di problemi

1. **Bundle**: il workflow `deploy.yml` mantiene gli artifacts per 7 giorni —
   re-deploy manuale del precedente.
2. **DB**: backup settimanale criptato su artifact GitHub Actions (30 gg) +
   eventuale replica S3. Decifra con:
   ```bash
   gpg --decrypt -o ghg_dump.sql.gz ghg_dump_YYYYMMDD_HHMM.sql.gz.gpg
   gunzip ghg_dump.sql.gz
   psql $SUPABASE_DB_URL < ghg_dump.sql
   ```
