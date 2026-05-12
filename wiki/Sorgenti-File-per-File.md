# Sorgenti — guida file per file

Inventario completo dei 28 file in `src/` + 5 Edge Functions + altri file
chiave. Ogni voce ha: **path**, **dimensione**, **namespace globale
esposto**, **dipendenze**, **export chiave**, **note implementative**.

## Albero `src/`

```
src/
├── App.jsx                            (~645 righe)
├── AuthGate.jsx                       (~600 righe)
├── SupabaseDB.jsx                     (~790 righe dopo cleanup)
├── calc.js                            (~270 righe)
├── constants.js                       (~500 righe)
├── io.jsx                            (~2150 righe)
├── logo.js                            (~42 righe)
├── sanitize.js                        (~20 righe dopo cleanup)
├── components/
│   ├── Charts.jsx                     (~215 righe)
│   ├── DataTable.jsx                  (~335 righe)
│   └── ui.jsx                         (~455 righe dopo cleanup)
└── sections/
    ├── AuditTrail.jsx                 (~345 righe)
    ├── Dashboard.jsx                  (~840 righe)
    ├── DataManager.jsx                (~215 righe)
    ├── DataManager.scopeModals.jsx    (~570 righe)
    ├── DataManager.shared.jsx         (~835 righe)
    ├── DataManager.tabs.jsx           (~890 righe)
    ├── DataQuality.jsx                (~325 righe)
    ├── Diagnostics.jsx                (~285 righe)
    ├── FEExplorer.jsx                 (~80 righe)
    ├── Materiality.jsx                (~200 righe)
    ├── Output.jsx                     (~155 righe)
    ├── PublicDashboard.jsx            (~1450 righe)
    ├── Scenarios.jsx                  (~450 righe)
    ├── ScopeAnalysis.jsx              (~425 righe)
    ├── SiteAnalysis.jsx               (~230 righe)
    └── _shared.jsx                    (~50 righe)
```

Totale: ~13 200 righe di codice sorgente.

## File top-level

### `build.mjs`

**Path**: `build.mjs`
**Dim**: ~670 righe
**Esportato**: niente — è uno script

Lo script di build. Vedi [[Architettura#build-pipeline]] e [[Build-e-Deploy]]
per i dettagli. Sezioni:

* Risoluzione asset (logo, logo-ridotto, favicon) con auto-detect
* `compile()` Babel per `.jsx`
* `loadLib()` UMD da `node_modules` + `patchInlinedUMD()` per webpack auto-publicPath
* `sri()` SHA-384 per CDN-lazy libs
* Forbidden tokens check (dangerouslySetInnerHTML, eval, etc.)
* Placeholder substitution (`__SUPABASE_URL__`, `__LOGO_DATA_URI__`, …)
* Generazione HTML con CSP inline, meta SEO, JSON-LD, anti-stale-cache JS
* Output `site/index.html`, `site/build.txt`, `site/.nojekyll`, `site/_headers`

### `package.json`

```json
{
  "name": "gresmalt-ghg-tool",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "dev": "node build.mjs && python3 -m http.server --directory site 8000",
    "test": "node test/index.mjs",
    "test:e2e": "playwright test",
    "lint": "eslint --ext .js,.jsx,.mjs --max-warnings 50 src/ test/ build.mjs",
    "lint:no-dangerous-html": "! grep -r --include='*.jsx' --include='*.js' 'dangerouslySetInnerHTML' src/"
  },
  "dependencies": {
    "@babel/core": "7.29.0",
    "@babel/preset-react": "7.28.5",
    "@e965/xlsx": "0.20.3",
    "@supabase/supabase-js": "2.105.4",
    "chart.js": "4.5.1",
    "pptxgenjs": "4.0.1",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.59.1",
    "eslint": "10.3.0"
  }
}
```

Versioni **pinnate** (no caret) per build deterministica e SRI stabili.

## `src/` file dettaglio

### `src/constants.js`

**Dim**: ~500 righe
**Namespace**: `G.fmt`, `G.COLORS`, `G.CATEGORICAL`, `G.SITE_COLORS`, `G.ROLE_LABELS`, `G.CAT_NAMES`, `G.FAMIGLIE_FE`, `G.QUALITY_BADGE`, `G.STATUS_BADGE`, `G.can`, `G.EXPECTED_UNIT_S1`, `G.I18N`, `G.TARGETS`

**Export chiave**:

* `fmt(n, dec=0)` — formattatore numerico it-IT
* `COLORS` — palette brand (slate + cream)
* `SITE_COLORS` — Proxy: 7 siti statici + hash deterministico per nuovi siti
* `CATEGORICAL` — palette 7 colori
* `ROLE_LABELS` — admin/editor/auditor/viewer/guest mapping
* `CAT_NAMES` — nomi 15 categorie S3 in italiano
* `FAMIGLIE_FE` — Combustibili/Elettricità/WTT/Materiali/Trasporti/Rifiuti
* `QUALITY_BADGE` — P/S/E
* `STATUS_BADGE` — Definitivo/Provvisorio/Stimato
* `EXPECTED_UNIT_S1` — mapping categoria S1 → unità attesa
* `can` — matrice permessi per ruolo (`edit`, `delete`, `viewAudit`, `viewFE`, `viewQuality`, `viewMgmt`, `viewInternal`, `viewDiag`)
* `I18N` — dictionary IT/EN (~150 chiavi) per Public Dashboard
* `TARGETS` — piano decarbonizzazione (override runtime via `app_meta.targets`)

**Pattern interessante**: `SITE_COLORS` è un Proxy che ritorna colori
statici per i 7 siti del Gruppo, e per qualunque altro codice ritorna un
colore deterministico via hash:

```js
function _siteColorFallback (code) {
  let h = 0;
  const s = String(code);
  for (let i = 0; i < s.length; i++)
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return CATEGORICAL[Math.abs(h) % CATEGORICAL.length];
}
```

### `src/logo.js`

**Dim**: ~42 righe
**Namespace**: `G.LOGO_DATA_URI`, `G.LOGO_MARK_DATA_URI`

SVG wordmark "gresmalt GROUP" come fallback. Placeholder
`__LOGO_DATA_URI__` e `__LOGO_MARK_DATA_URI__` sostituiti da `build.mjs`
se gli asset PNG/SVG sono presenti in `assets/`.

### `src/sanitize.js`

**Dim**: ~20 righe
**Namespace**: `G.sanitize`

**Export**: `sanitizeForSpreadsheet(v)` — prefissa con `'` qualunque
stringa che inizia con `=`, `+`, `-`, `@`, `\t`, `\r`. Anti CSV/Excel
formula injection.

### `src/calc.js`

**Dim**: ~270 righe
**Namespace**: `G.calc`

**Export**:
* `emS1`, `emS2Loc`, `emS2Mkt`, `emS3` — formule `q × fe / 1000`
* `num(v)` — parser resiliente (virgola decimale italiana, null → 0)
* `lookupFE(table, row, feData)` — match esatto + fallback per anno
* `validateRow(table, row)` — validatore per s1/s2/s3/produzione/fe
* `intensity(totals, prod)` — intensità di gruppo
* `intensityPerSite(s1, s2, prod, opts)` — intensità per sito (S3 escluso)
* `totals(year, s1, s2, s3, opts)` — aggregazioni
* `availableYears(...arrs)` — dedup + sort desc

Pure functions, no React, no Supabase. Massima testability.

### `src/SupabaseDB.jsx`

**Dim**: ~790 righe
**Namespace**: `G.db`

**Export**:
* Client management: `getClient()`, `isConfigured()`, `role()`
* Load: `loadAll()`
* CRUD generico: `upsert`, `batchUpsert`, `del`, `batchDelete`
* Specifico: `delProduzione`, `saveProduzione`, `delAnagrafica`, `saveMateriality`, `cloneYear`
* Security: `anonProbe`
* Cascade: `cascadeFEUpdate`
* Public RPC: `getPublicDashboard`, `listPublicYears`, `getMaterialityPublic`
* Misc: `keepalivePing`, `verifyAuditChain`, `getAuditChainHistory`
* AI: `aiAssist`
* Year lock: `getLockedYears`, `setLockedYears`, `toggleYearLock`, `saveTargets`
* Logging: `logClientError`
* Internals esposti per test: `dbToApp`, `appToDb`, `redactPII`

**Pattern critici**:

* **Rate limit client-side**: sliding window 30 mut/10s
* **DB ↔ App translation**: `DB_TO_APP` mapping (snake_case ↔ PascalCase con accenti)
* **PII redaction**: `redactPII()` su email/JWT/Bearer/IBAN/CF/telefono
* **Fallback non-transazionali**: `saveProduzione` e `cascadeFEUpdate`
  preferiscono RPC atomiche; fallback con warning se DB legacy

### `src/io.jsx`

**Dim**: ~2150 righe
**Namespace**: `G.io`

**Export**:
* `exportExcel(data)` — 6 fogli (Anagrafiche/Produzione/FE/S1/S2/S3)
* `exportTemplate()` — Excel con 1 riga di esempio per ogni foglio
* `importExcel(file, existingData)` — preview con diff
* `commitImport(preview)` — upsert batch dopo conferma utente
* `exportPPTX(data, year, opts)` — ~22 slide IT/EN
* `exportBackup(data)` — ZIP STORE inline (no zlib dependency)
* `enrichForUpsert(table, rows, fePool)` — ricalcola Em da Q×FE/1000
* `makeZip(entries)`, `crc32(uint8array)` — ZIP encoder inline
* `loadSheetJS()`, `loadPptxgen()` — lazy CDN loader con SRI

**Pattern critici**:

* **Lazy CDN load con SRI**: SheetJS e pptxgenjs caricati on-demand
* **Preview-then-commit** flow per import
* **PPTX builder**: ~22 slide con cover, TOC, KPI strip, donut, trend,
  target gap, S1/S2/S3 deep dive, materiality, intensity, quality,
  methodology, boundary, FE reference multi-page, disclaimer, closing
* **ZIP STORE encoder** zero-dep: ~50 righe di Uint8Array manipulation,
  testato in `test/zip.test.mjs`

### `src/AuthGate.jsx`

**Dim**: ~600 righe
**Namespace**: `G.AuthGate`

**Export**: il componente React `AuthGate` che wrappa `<App />` o `<PublicDashboard />`

**Componenti interni**:
* `useAuth()` hook
* `readRoleFromSession(session)` — decoda JWT per estrarre role
* `LoginScreen` — form email/password + Turnstile + challenge MFA
* `MFAEnrollScreen` — wizard QR code TOTP

**Logica chiave**:
* Hash routing: `#app` → console, altro → public
* Detect MFA enrollment requirement per editor/auditor
* Gestione factor "unverified" residuo (unenroll + re-enroll)

### `src/App.jsx`

**Dim**: ~645 righe (dopo cleanup)
**Namespace**: `G.App`

Shell della console interna. Vedi [[Console-Interna]] per UX.

**Stato React**:
* `data` — payload completo da `loadAll()`
* `loading`, `error`
* `year`, `setYear` (persistito in `localStorage.ghg_year`)
* `route` (`{section, tab}`)
* `isMobile`, `sidebarOpen` (responsive)
* `searchOpen`, `helpOpen`
* `pingState` (DB ping ogni 30s)

**Componenti interni**:
* `SearchModal` (Cmd+K global search)
* `HelpModal` (keyboard shortcuts overlay)

**Listener globali**:
* `keydown` per Cmd+K, Cmd+S, ?, Esc
* `matchMedia` per breakpoint mobile

### `src/components/Charts.jsx`

**Dim**: ~215 righe
**Namespace**: `G.charts`

**Export**:
* `ChartBar` (stacked/horizontal, onElementClick)
* `ChartDonut` (cutout 62%, tooltip con %)
* `ChartLine` (line tension .35)
* `ChartEmpty` (empty state)

**Pattern**:
* `useChart(refCanvas, makeConfig, deps)` hook con cleanup esplicito
  (`chartRef.current.destroy()`) per evitare memory leak
* `reducedMotion()` check per `prefers-reduced-motion` → disabilita animation
* `makeClickHandlers(cbRef)` builder per onClick/onHover con cursor pointer
* `tooltipUnit(unit)` e `tooltipDonut(unit)` — locale Italian, usa `ctx.raw`
  (fix bug horizontal-bar che mostrava indici al posto dei valori)

### `src/components/DataTable.jsx`

**Dim**: ~335 righe
**Namespace**: `G.ui.DataTable`

Tabella generica con sort/filter/pagination + multi-select + bulk-actions.

**Props**:
* `rows`, `columns`
* `canEdit`, `canDelete`
* `onEdit`, `onDelete`
* `bulkActions` — array di `{label, onClick}` per banner multi-select

**A11y**: `aria-sort` su `<th>`, keyboard activation enter/space,
`aria-live` per count, paging label.

**Multi-select**: tri-state header checkbox (none/some/all). Le righe
senza `id` (es. Produzione con PK composita) sono disabled.

### `src/components/ui.jsx`

**Dim**: ~455 righe (dopo cleanup)
**Namespace**: `G.ui`

**Export**:
* `Card` — wrapper card con padding, borderLeft optional
* `KPICard` (memoised con React.memo) — KPI display
* `EmissionBadge` — badge colorato per emissioni
* `Skeleton` — loading state animation
* `ToastHost` + `pushToast(message, kind, duration?)` — sistema toast globale
* `ConfirmHost` + `confirm({title, message, danger, ...})` — dialog promise-based
* `Button` (kind: primary/ghost/danger)
* `Input`, `Select`, `Pill`
* `ErrorBoundary` — cattura errori React, loga via `logClientError` (PII-redacted)
* `S2MethodToggle` + `useS2Method` — hook + componente per LB/MB
  (persistito in `localStorage.ghg_s2method`)
* `btnStyle` — style constants riusati

**Pattern**:
* Toast queue management con duration dinamica
* Confirm dialog usa una promise module-level (`_confirmFn`)
* ErrorBoundary `componentDidCatch` → `G.db.logClientError(route, message, stack)`

### `src/sections/_shared.jsx`

**Dim**: ~50 righe
**Namespace**: `G.sectionsHelpers`

Helper riusati dalle sezioni della console:

* `isLoading(data)` — true se tutti i datasets sono vuoti
* `loadingSkeleton(title)` — JSX standard di skeleton + titolo
* `emWithPct(em, total, scopeLabel)` — formato `"{em} tCO₂e · {pct}% di {scope}"`

(Dopo cleanup: `pctOf` è solo locale al file, non più esportato.)

### `src/sections/PublicDashboard.jsx`

**Dim**: ~1450 righe
**Namespace**: `G.PublicDashboard`

Faccia A. Vedi [[Public-Dashboard]] per UX completa.

**Hook React**:
* `useState` per `year`, `data`, `materiality`, `years`, `loading`,
  `error`, `lang`, `s2Method`
* `useEffect` per fetch iniziale (`get_public_dashboard`, `list_public_years`,
  `s3_materiality_public`)
* `useS2Method` hook condiviso con la console interna

**Sub-render**:
* `renderScope3Hotspots(data, lang)` — top 3 categorie
* `renderTargets(data, lang)` — 4 cards baseline/current/short/long
* `renderInitiatives(lang)` — 6 cards (3 Piano 2034 + 3 Vision 2050)
* `renderBaseline(lang)` — pannello metodologia
* `renderGlossary(lang)` — definizioni tecniche
* `renderTrust(lang)` — standard di riferimento
* `renderCTA(lang)` — bottoni download/email/print
* `renderDisclaimer(lang)` — limiti e perimetro
* `detectLang()` — `localStorage.ghg_lang` o `navigator.language`
* `matStyle(status)` — colore + label per status materialità

### `src/sections/Dashboard.jsx`

**Dim**: ~840 righe
**Namespace**: `G.sections.Dashboard`

Vedi [[Console-Interna#1-dashboard]].

**Helper interni**:
* `renderDrillModal(year, slice, data, s2Method, onClose)` — modal con
  tabella di dettaglio
* `renderTrendForecast(years, totalsByYear, s2Method, T)` — linReg + target
* `linReg(points)` — linear regression OLS
* `renderSiteComparison(year, data, s2Method, navigate, onDrill)` — bar
  stacked

**AI chat**:
* Stato: `chatState = { open, messages: [{role, text}], busy, error }`
* `handleExplain()` → `G.db.aiAssist('explain_balance', payload)`
* `handleSendChat(text)` → `G.db.aiAssist('chat_balance', {balance_context, messages})`

### `src/sections/SiteAnalysis.jsx`

**Dim**: ~230 righe
**Namespace**: `G.sections.SiteAnalysis`

Vedi [[Console-Interna#2-analisi-per-sede]].

**Computation chiave**: `useMemo` con `[data, year, s2Method]` per
ricalcolare `bySite` (per ogni sito: s1, s2lb, s2mb, intensityPerSite).

### `src/sections/ScopeAnalysis.jsx`

**Dim**: ~425 righe (dopo cleanup)
**Namespace**: `G.sections.ScopeAnalysis`

Vedi [[Console-Interna#3-analisi-per-scope]].

**Sub-render**:
* `barRanking(items, color, maxItems)` — barre orizzontali ordinate
* `renderScope1(year, data)` — composizione combustibili + per-site stacked
* `renderScope2(year, data)` — LB vs MB vs GO + per-site
* `renderScope3(year, data)` — composizione 15 categorie

### `src/sections/Materiality.jsx`

**Dim**: ~200 righe
**Namespace**: `G.sections.Materiality`

Grid 15 cards per categoria S3.

**Componente interno**: `MaterialityCard` con edit modal.

### `src/sections/DataQuality.jsx`

**Dim**: ~325 righe (dopo cleanup)
**Namespace**: `G.sections.DataQuality`

Vedi [[Console-Interna#5-data-quality]].

**Sub-tab**:
* `SubtabControls` — controlli automatici
* `SubtabVerify` — righe da verificare
* `SubtabYoY` — anomalies YoY (slider threshold)
* `SubtabFE` — FE in scadenza
* `SubtabNotes` — righe con Note

**Helper**:
* `rowKey(table, row)` — chiave logica per dedup
* `computeYoYAnomalies(s1, s2, s3, threshold)` — calcolo anomalies cross-year

### `src/sections/FEExplorer.jsx`

**Dim**: ~80 righe
**Namespace**: `G.sections.FEExplorer`

Tabella read-only FE con filtri famiglia + ricerca.

> La sezione conteneva anche "Cerca FE online (IA)" via Edge Function
> `search_fe`. Disabilitata in UI (vedi commento header). Backend pronto.

### `src/sections/Scenarios.jsx`

**Dim**: ~450 righe (dopo cleanup)
**Namespace**: `G.sections.Scenarios`

Vedi [[Console-Interna#7-scenario-tool]].

**Stato**: 11 sliders (`effizienza`, `pv`, `go`, `elettrificazione`, …) +
preset (`piano2034`, `vision2050`).

### `src/sections/Output.jsx`

**Dim**: ~155 righe
**Namespace**: `G.sections.Output`

Card export PPTX + snapshot JSON firmato. Vedi [[Console-Interna#8-download]].

### `src/sections/DataManager.jsx`

**Dim**: ~215 righe
**Namespace**: `G.sections.DataManager`

Shell della Gestione Dati. Vedi [[Gestione-Dati]].

**Stato**:
* `tab` (anagrafiche/s1/s2/s3/fe/produzione/targets)
* `showImport`, `showClone`

### `src/sections/DataManager.shared.jsx`

**Dim**: ~835 righe
**Namespace**: `G.DM` (parziale — caricato per primo dai 4 file companion)

**Export su G.DM**:
* Helper year lock: `getLockedYears(data)`, `isYearLocked(data, year)`, `LockBanner`
* `makeConfirmedClose(original, current, onClose)` — chiede conferma se ci
  sono modifiche non salvate
* `OnboardingCard` — guida per setup iniziale
* `ImportPreviewModal` — anteprima diff import
* `CloneYearModal` — UI per clone year
* `Field` — wrapper label+input riusato nei modali
* `GenericTab` — tab generico per S1/S2/S3
* `COLUMNS` — definizioni colonne per tabella
* `exportCSV(rows, filename)`, `csvCell(value)` — CSV utility
* Constants UI: `feFillBtnStyle`, `modalScrim`, `modalCard`, `titleStyle`,
  `modalGrid`, `calcPanel`, `calcLabel`, `calcRow`, `calcResult`, `errBox`,
  `warnBox`, `btnRow`
* `QD_OPTS`, `SD_OPTS` — dropdown options

### `src/sections/DataManager.tabs.jsx`

**Dim**: ~890 righe (dopo cleanup)
**Namespace**: `G.DM` (estensione)

**Export su G.DM**:
* `AnagraficheTab`, `AnagraficaEditModal` — gestione siti
* `ProduzioneTab`, `EditModal` — gestione produzione (kg+m²)
* `TargetsTab`, `TargetsView` — gestione target piano
* `FETab`, `FEEditModal` — gestione FE + clone "Nuova versione" + cascade

### `src/sections/DataManager.scopeModals.jsx`

**Dim**: ~570 righe
**Namespace**: `G.DM` (estensione)

**Export su G.DM**:
* `S1EditModal` — modal S1 con preview emissione + auto-fill FE
* `S2EditModal` — modal S2 con dual reporting LB+MB
* `S3EditModal` — modal S3 con lookup codice_fe

Tutti hanno year-lock awareness + LockBanner + validation feedback inline.

### `src/sections/AuditTrail.jsx`

**Dim**: ~345 righe
**Namespace**: `G.sections.AuditTrail`

Vedi [[Audit-Trail]].

**Sub-render**:
* `summarizeDiff(old, new)` — diff conciso (es. `quantita: X → Y`)
* `exportAuditSigned(rows)` — chiama `sign_snapshot` + download JSON
* `exportAuditCSV(rows)` — CSV download
* `DiffModal` — pretty-printed JSON diff con highlighting

### `src/sections/Diagnostics.jsx`

**Dim**: ~285 righe
**Namespace**: `G.sections.Diagnostics`

Vedi [[Console-Interna#11-diagnostica]]. Admin-only.

## `supabase/functions/` (Deno)

### `sign_snapshot/index.ts`

**Dim**: ~123 righe

HMAC-SHA256 di un payload JSON. Admin only. Vedi [[Edge-Functions#sign_snapshot]].

### `verify_snapshot/index.ts`

**Dim**: ~112 righe

Verifica HMAC con constant-time eq. Vedi [[Edge-Functions#verify_snapshot]].

### `verify_audit_chain/index.ts`

**Dim**: ~63 righe

Wrapper Edge della SQL function. Vedi [[Edge-Functions#verify_audit_chain]].

### `ai_assist/index.ts`

**Dim**: ~620 righe

Task LLM senza grounding. 4 task: `explain_balance`, `chat_balance`,
`normalize_unit`, `suggest_code`. Vedi [[Edge-Functions#ai_assist]].

### `search_fe/index.ts`

**Dim**: ~700 righe

Ricerca FE via Gemini + Google Search Grounding. UI disabilitata.
Vedi [[Edge-Functions#search_fe]].

## `sql/` migrations

Vedi [[Migrazioni-SQL]] per dettaglio.

## `test/` files

### `test/_runner.mjs`

Runner zero-dep tipo Jest (~110 righe).

### `test/_load.mjs`

Loader IIFE per Node via `vm.runInThisContext`.

### `test/index.mjs`

Entrypoint: importa le 4 suite + chiama `run()`.

### `test/calc.test.mjs`

35 test su `G.calc.*` formule + lookup + validation.

### `test/io.test.mjs`

15 test su `G.io.enrichForUpsert`.

### `test/zip.test.mjs`

7 test su `G.io.crc32` + `G.io.makeZip`.

### `test/redactpii.test.mjs`

8 test su `G.db.redactPII` PII redaction.

### `test/e2e/smoke.spec.mjs`

Playwright e2e: Public Dashboard render, 11 sezioni console, 7 tab Gestione
Dati, login flow.

## Asset

```
assets/
├── logo.png          (6.6 KB) — wordmark Gresmalt
├── Logo-ridotto.png  (1.5 KB) — brand mark compatto per sidebar
└── favicon.png       (1.5 KB) — favicon 64x64
```

Tutti inlined come data-URI base64 da `build.mjs`.

## Risorse

- [[Architettura]] — pattern IIFE, build pipeline, namespace globali
- [[Console-Interna]] — UX delle 11 sezioni
- [[Public-Dashboard]] — UX Faccia A
- [[Gestione-Dati]] — UX della Gestione Dati (7 tab)
- [[Audit-Trail]] — UX audit log + verifica chain
- [[Edge-Functions]] — dettaglio 5 functions Deno
- [[Test]] — strategia unit + e2e
