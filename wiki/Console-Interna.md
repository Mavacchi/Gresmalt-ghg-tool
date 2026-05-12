# Console interna (Faccia B)

Accessibile da `https://<host>/#app`. Login Supabase email+password,
opzionale captcha Cloudflare Turnstile, opzionale MFA TOTP (forzato per
editor/auditor lato DB via policy RLS).

* **Componente root**: `G.AuthGate` (`AuthGate.jsx`) gestisce il login/MFA,
  poi delega a `G.App` (`App.jsx`) la console
* **Sidebar + topbar + main**
* **Routing**: hash-based (`#app` per entrare, qualunque altro → Public Dashboard)
* **Responsive**: sidebar collassabile (desktop) o drawer overlay (mobile <768px)

## Layout

```
┌─────────┬──────────────────────────────────────────────────────────┐
│ Gresmalt│ ☰  Console / Dashboard         [Cerca…] [⌘K]  Anno 2025 ●│  Topbar (56px)
│ GROUP   ├──────────────────────────────────────────────────────────┤
│         │                                                          │
│ ── Anno │   Sezione corrente (Dashboard / Site / Scope / ...)      │
│  2024   │                                                          │  Main scroll
│  2023   │                                                          │
│ ──Nav── │                                                          │
│ ◈ Dash  │                                                          │
│ ⊞ Site  │                                                          │
│ ⊕ Scope │                                                          │
│ ⌥ Mat'y │                                                          │
│ ⚠ Qual. │                                                          │
│ ⊡ FE    │                                                          │
│ ◎ Scen. │                                                          │
│ ↗ Dwnl. │                                                          │
│ ✎ Data  │                                                          │
│ ⊛ Audit │                                                          │
│ ⊕ Diag  │                                                          │
│         │                                                          │
│⤴Public  │                                                          │
│         │                                                          │
│ [ADMIN] │                                                          │
│ Logout  │                                                          │
└─────────┴──────────────────────────────────────────────────────────┘
sidebar 230 px (collassa a 64 px su click ☰)
```

## Sezioni (11)

Tutte sono componenti React in `src/sections/*.jsx`. Visibilità per ruolo
nella matrice `G.can` (in `constants.js`).

### 1. Dashboard — `G.sections.Dashboard`

* **Path**: `src/sections/Dashboard.jsx` (840 righe)
* **Ruoli**: tutti tranne guest

#### KPI strip (9 cards)

| KPI | Sottoinfo |
|---|---|
| Totale emissioni anno | S1 + S2 (LB/MB) + S3 |
| Variazione vs anno prec | % YoY su totale |
| Scope 1 | con donut mini |
| Scope 2 LB | location-based |
| Scope 2 MB | market-based (di solito ≈ 0 con GO) |
| Scope 3 | + N° categorie incluse |
| Copertura GO | % di EE acquistata con Garanzia di Origine |
| Intensità per m² | kgCO₂e/m² (S1+S2+S3) |
| Intensità per kg | kgCO₂e/kg |

#### Donut composizione

S1 / S2 (LB o MB) / S3 con percentuali. Click su slice → drill-down modal
con tabella delle righe.

#### Per-site bar comparison

Bar stacked S1 + S2 per sito, ordinato decrescente. Click → drill-down sul
sito specifico (mostra dettaglio S1/S2 di quel sito).

#### Trend forecast

Linear regression sugli ultimi 5 anni → proiezione al 2034. Mostra anche
linea target 2034 (S1+S2 MB). Etichetta "on-track" / "off-track" in base
al gap.

```js
function linReg (points) {
  const n = points.length;
  const sumX = points.reduce((a,p) => a + p.x, 0);
  const sumY = points.reduce((a,p) => a + p.y, 0);
  const sumXY = points.reduce((a,p) => a + p.x * p.y, 0);
  const sumXX = points.reduce((a,p) => a + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}
```

#### AI chat "Spiega bilancio"

Solo admin/editor. Due task verso Edge Function `ai_assist`:

1. **`explain_balance`** (initial): genera riassunto narrativo del bilancio
   GHG dell'anno (panoramica + osservazioni + raccomandazioni).
2. **`chat_balance`** (follow-up): chat multi-turn con context del bilancio.
   L'utente può chiedere "perché S3 è cresciuto?", "quali siti contribuiscono
   di più?", ecc.

Tutti i turn sono loggati in `ai_assist_log` per audit.

### 2. Analisi per Sede — `G.sections.SiteAnalysis`

* **Path**: `src/sections/SiteAnalysis.jsx`
* **Ruoli**: tutti tranne guest

Confronto S1+S2 dei 7 siti dell'anno selezionato.

* Toggle LB/MB tramite `useS2Method` hook
* Bar stacked S1 + S2 per sito (ordinato decrescente)
* Bar intensità per sito (kgCO₂e/m²) — se produzione disponibile
* Table con dettaglio per sito + YoY (variazione vs anno precedente)
* KPI per sito (S1, S2 LB, S2 MB, intensità) usando `intensityPerSite`

### 3. Analisi per Scope — `G.sections.ScopeAnalysis`

* **Path**: `src/sections/ScopeAnalysis.jsx`
* **Ruoli**: tutti tranne guest

Tab S1 / S2 / S3 con per ogni tab:
* KPI strip (totale, % di tutto, top categoria, ecc.)
* Composizione (donut per S1 = combustibili; per S2 = LB vs MB vs GO; per S3 = 15 categorie)
* Per-site stacked (S1, S2; S3 non per-site)
* Ranking top contributori

### 4. Materialità S3 — `G.sections.Materiality`

* **Path**: `src/sections/Materiality.jsx` (200 righe)
* **Ruoli**: tutti tranne guest (edit solo admin/editor)

Grid di 15 cards (cat 1..15) con:
* Nome categoria GHG Protocol
* Status (Inclusa / Esclusa / N.A. / Da valutare)
* Justification testuale
* Methodological ref (es. "PCAF v2.0", "GHG Protocol cat.4")
* Review year

Click su una card (admin/editor) → modal di edit con dropdown status +
textarea justification.

### 5. Data Quality — `G.sections.DataQuality`

* **Path**: `src/sections/DataQuality.jsx` (325 righe)
* **Ruoli**: non viewer/guest

**Score qualità**: somma pesata `P×100 + S×60 + E×30` divisa per totale.
Mostra il punteggio in alto come KPI con interpretazione colorata.

5 sub-tab:

1. **Controlli consigliati**: check automatici (FE pre-1970, Quantità=0,
   unità non standard rispetto a `G.EXPECTED_UNIT_S1`, ecc.)
2. **Dati da verificare**: righe con `stato_dato='Provvisorio'` o `'Stimato'`
3. **YoY anomalies**: righe con |Δ%| > 30% rispetto alla stessa chiave
   nell'anno precedente. Soglia configurabile via slider. Skippa righe con
   Note (l'operatore ha già annotato).
4. **FE da aggiornare**: lista FE con `anno_validita < anno_corrente - 2`
5. **Note metodologiche**: tutte le righe con campo `Note` popolato

### 6. FE Explorer — `G.sections.FEExplorer`

* **Path**: `src/sections/FEExplorer.jsx` (80 righe)
* **Ruoli**: non viewer/guest

Tabella read-only dei FE con filtri:
* Pill per famiglia (Combustibili / Elettricità / WTT / Materiali / Trasporti / Rifiuti)
* Input ricerca testuale su FE_ID e Descrizione

> **Nota storica**: questa sezione conteneva anche una card "Cerca FE
> online (IA)" che chiamava l'Edge Function `search_fe`. **Disabilitata**
> perché i risultati erano sistematicamente inaffidabili (mismatch
> anno/edizione, ambiguità TTW vs WTW). L'Edge Function rimane nel repo
> per uso futuro.

### 7. Scenario Tool — `G.sections.Scenarios`

* **Path**: `src/sections/Scenarios.jsx` (450 righe)
* **Ruoli**: tutti tranne guest

Simulatore decarbonizzazione "what-if".

* **11 sliders** per leve singole (es. % efficienza energetica, % FV,
  % GO, % elettrificazione, % biocombustibili, % riduzione spessori, …)
* **2 preset** (Piano 2034, Vision 2050) che impostano i sliders ai valori
  target del piano ufficiale
* **Calcolo scenario**: emissioni risultanti applicando le leve
* **Gap vs target**: distanza dallo short-term/long-term target
* **Ranking leve**: ordine di contributo alla riduzione (delta tCO₂e)
* **Impatto intensità**: come cambia kg/m² applicando lo scenario

### 8. Download — `G.sections.Output`

* **Path**: `src/sections/Output.jsx` (155 righe)
* **Ruoli**: tutti tranne guest (snapshot firmato solo admin)

Due card di export:

1. **Report PPTX** — ~22 slide. Toggle IT/EN. Chiama `G.io.exportPPTX(data, year, {lang})`.
   Lazy-load di `pptxgenjs` da CDN con SRI.
2. **Snapshot JSON firmato** (admin only) — serializza tutti i dati
   dell'anno, chiama Edge Function `sign_snapshot` per HMAC-SHA256, scarica
   un JSON `{ payload, signature, data_sha256, signed_at, signer_email, algorithm }`.

Pulsante "Stampa pagina" applica `ghg-print-mode` e chiama `window.print()`.

### 9. Gestione Dati — `G.sections.DataManager`

* **Path**: `src/sections/DataManager.jsx` (215 righe) + companion files
* **Ruoli**: admin/editor

Vedi [[Gestione-Dati]] per dettagli completi. 7 tab CRUD: Anagrafiche, S1,
S2, S3, FE, Produzione, Target. Modali per edit. Import/Export Excel.
Clone-year.

### 10. Audit Trail — `G.sections.AuditTrail`

* **Path**: `src/sections/AuditTrail.jsx` (345 righe)
* **Ruoli**: admin/auditor (auditor richiede MFA aal2 lato DB)

Vedi [[Audit-Trail]] per dettagli. Log paginato + filtri + diff JSON +
verifica hash chain + export CSV/JSON firmato.

### 11. Diagnostica — `G.sections.Diagnostics`

* **Path**: `src/sections/Diagnostics.jsx` (285 righe)
* **Ruoli**: admin only

Pannello "ops" admin con:

* **Anon-probe**: test RLS leak (crea client Supabase separato senza
  sessione, prova SELECT su tabelle protette, riporta eventuali leak)
* **Verifica hash chain** (manuale): chiama `verify_audit_chain()` RPC
* **History audit chain**: ultimi 10 record da `audit_chain_status` view
* **Year sign-off lock**: toggle per ogni anno (admin può bloccare/sbloccare)
* **Supabase keep-alive ping**: chiama `keepalive_ping()` manualmente
* **Indicatori di riconciliazione**: count righe per tabella, ultima
  modifica, ecc.

## Auth flow

```
1. Utente apre https://<host>/#app
2. AuthGate.useAuth → sb.auth.getSession()
   ├─ nessuna sessione → render LoginScreen
   │   ├─ submit email/pwd (+ Turnstile token se configurato)
   │   ├─ sb.auth.signInWithPassword({email, password, options: {captchaToken}})
   │   ├─ sb.auth.mfa.getAuthenticatorAssuranceLevel()
   │   │   ├─ nextLevel='aal2' && currentLevel='aal1' && totp factor enrolled
   │   │   │   → render challenge TOTP
   │   │   │   ├─ submit 6 cifre
   │   │   │   └─ sb.auth.mfa.verify({factorId, challengeId, code})
   │   │   │       → onLoggedIn(session)
   │   │   └─ già aal2 o no factor → onLoggedIn(session)
   │   └─ readRoleFromSession(session) → 'admin'|'editor'|'auditor'|'viewer'
   │
   └─ sessione presente
       ├─ readRoleFromSession → __GHG_ROLE
       └─ render <App />
```

### MFA enrollment forzato per editor/auditor

```
1. Login OK ma role ∈ {editor, auditor} && aal=aal1 && no verified factor
2. AuthGate render MFAEnrollScreen
3. sb.auth.mfa.enroll({factorType:'totp'}) → {id, qr_code, secret}
4. Utente scansiona QR con Google Authenticator/Authy/1Password
5. Submit 6 cifre
6. sb.auth.mfa.verify({factorId, challengeId, code})
   → JWT aggiornato con aal=aal2
7. AuthGate refresh sessione + setNeedsEnroll(false) → render <App />
```

Lato DB (`14_mfa_editor.sql` + `15_mfa_auditor.sql`):
- Editor a aal1 → INSERT/UPDATE rifiutati su tutte le tabelle dati
- Auditor a aal1 → SELECT su audit_log rifiutato

Admin **non** è forzato a MFA (override d'emergenza per device perso).

## Keyboard shortcuts globali (`App.jsx`)

| Shortcut | Azione |
|---|---|
| `Cmd/Ctrl + K` | apre ricerca globale (`SearchModal`) |
| `Cmd/Ctrl + S` | click sul bottone "Salva" nel modal aperto (se c'è) |
| `?` | apre/chiude overlay scorciatoie (`HelpModal`) |
| `Esc` | chiude modal/overlay/dialog |

## Ricerca globale (Cmd+K)

Component `SearchModal` (inline in `App.jsx`).

Cerca su tutto `data` (s1, s2, s3, fe, produzione) per:
- `Codice_Sito`
- `Combustibile`
- `Voce_S2`
- `Sottocategoria`
- `FE_ID` / `Codice_FE`
- `Descrizione`
- `Note`

Max 20 risultati (5 per tabella). Click su un risultato →
`navigate(section, tab)` che apre la sezione giusta (es. DataManager con
tab S1 attiva).

## Indicatore DB connection

Topbar in alto destra: pallino piccolo verde/rosso. Ogni 30s `App.jsx`
fa una select banale:

```js
const { error } = await sb.from('app_meta').select('key').limit(1);
setPingState({ ok: !error, ts: Date.now() });
```

Hover sul pallino → tooltip con timestamp ultima ping.

## Selettore anno

* Pillole con tutti gli anni disponibili (`G.calc.availableYears(s1, s2, s3, produzione)`)
* Persistito in `localStorage.ghg_year`
* Se l'anno persistito non è più disponibile (dataset cambiato), auto-select
  del più recente
* Cambio anno → re-render di tutte le sezioni con il nuovo `year` prop

## Sidebar responsive

| Breakpoint | Comportamento |
|---|---|
| ≥ 768px | sidebar inline collassabile (230 ↔ 64 px); su collasso, brand mark compatto + solo icone |
| < 768px | drawer overlay (260 px) con backdrop oscuro; toggle via ☰; click su nav chiude il drawer |

Listener `matchMedia('(max-width: 768px)')` con `addEventListener('change')`
(fallback `addListener` per Safari < 14).

## Logout

```js
root.__GHG_LOGOUT = async () => {
  await G.db.getClient().auth.signOut({ scope: 'global' });
  navTo('');  // location.hash = '' → torna a Public Dashboard
};
```

`scope: 'global'` invalida la sessione su tutti i device dell'utente.

## Risorse

- [[Architettura]]
- [[Public-Dashboard]]
- [[Gestione-Dati]] — dettaglio dei 7 tab
- [[Audit-Trail]] — dettaglio audit
- [[Sicurezza]] — MFA, RLS, hash chain
