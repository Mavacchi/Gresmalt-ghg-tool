# Glossario

Definizioni dei termini tecnici, metodologici e operativi usati nel
progetto.

## Emissioni & Carbon Accounting

### tCO₂e

**Tonnellate di CO₂ equivalente**. Unità di misura che converte tutti i
gas serra in "quante tonnellate di CO₂ avrebbero lo stesso effetto sul
clima nei prossimi 100 anni".

Esempio mnemonic: un volo Roma–New York di un passeggero ≈ 1 tCO₂e.

### GWP (Global Warming Potential)

Coefficiente che traduce 1 kg di un gas serra in `kg CO₂e`. Vedi tabelle
IPCC AR5 / AR6.

* CO₂: GWP = 1
* CH₄ (metano): GWP100 = 28-30
* N₂O: GWP100 = 265-298
* HFC-134a (refrigerante): GWP100 = 1300
* R410A (refrigerante): GWP100 = 2088
* SF₆: GWP100 = 22 800

### GHG Protocol Corporate

Standard di rendicontazione emissioni GHG aziendali. Diviso in:

* **Scope 1**: emissioni dirette (combustione propri impianti/veicoli +
  emissioni fugitive + emissioni di processo)
* **Scope 2**: emissioni indirette da energia acquistata (elettricità,
  vapore, calore, raffreddamento)
* **Scope 3**: emissioni indirette nella catena del valore upstream e
  downstream (15 categorie)

Riferimento: https://ghgprotocol.org/corporate-standard

### GHG Protocol Scope 3 — 15 categorie

Upstream (categorie 1-8):

1. **Purchased goods and services** — beni e servizi acquistati
2. **Capital goods** — beni strumentali (CAPEX)
3. **Fuel- and energy-related activities** — WTT, T&D losses
4. **Upstream transportation and distribution** — trasporti in ingresso
5. **Waste generated in operations** — rifiuti operativi
6. **Business travel** — viaggi di lavoro
7. **Employee commuting** — pendolarismo dipendenti
8. **Upstream leased assets** — beni in leasing upstream

Downstream (categorie 9-15):

9. **Downstream transportation and distribution** — trasporti in uscita
10. **Processing of sold products** — trasformazione prodotti venduti
11. **Use of sold products** — uso prodotti venduti
12. **End-of-life treatment of sold products** — fine vita prodotti
13. **Downstream leased assets** — beni in leasing downstream
14. **Franchises** — franchising
15. **Investments** — investimenti finanziari

Setup Gresmalt:
* **Incluse**: 1, 2, 3, 4, 5, 6, 7, 9, 12
* **Escluse**: 8, 11
* **N.A.**: 10, 13, 14
* **Da valutare**: 15

### Scope 2 dual reporting (LB vs MB)

**Location-Based (LB)**: usa il fattore di emissione medio della **rete
elettrica nazionale** del paese (es. ISPRA Terna per Italia).

**Market-Based (MB)**: usa il fattore di emissione del contratto specifico
dell'azienda (es. residual mix se non specificato, oppure 0 se ci sono
Garanzie di Origine).

CSRD obbliga il **dual reporting** (entrambi). La Public Dashboard ha un
toggle per scegliere.

### Garanzia di Origine (GO)

Certificato elettronico emesso dal GSE (Italia) o equivalenti esteri che
attesta la provenienza 100% rinnovabile dell'elettricità.

Per fini Market-Based: 1 GO consumata = 1 MWh "rinnovabile" → FE_market = 0.

Per fini Location-Based: irrilevante (LB ignora i contratti).

### TTW / WTW / WTT

* **TTW** (Tank-to-Wheel): solo emissioni di combustione del carburante
  (es. CO₂ dal motore quando il diesel brucia). Usato per Scope 1.
* **WTW** (Well-to-Wheel): emissioni totali dal pozzo al consumo, include
  estrazione + raffinazione + trasporto del carburante + combustione.
* **WTT** (Well-to-Tank): solo upstream del carburante (= WTW - TTW). Usato
  per Scope 3 Cat.3.

### Intensità carbon

Emissioni divise per unità di produzione:
* **kgCO₂e per kg** di prodotto (per industrie con peso variabile)
* **kgCO₂e per m²** di prodotto (specifico ceramica, dove m² ≈ unità venduta)

Utile per confrontare anni con produzioni diverse.

### Carbon Budget

Quantità residua di CO₂ che l'umanità può emettere per restare entro
+1.5 °C / +2.0 °C di riscaldamento globale rispetto al pre-industriale.

Riferimento: IPCC AR6 SR1.5.

## Standard & Framework

### SBTi (Science Based Targets initiative)

Iniziativa congiunta CDP, UN Global Compact, WRI e WWF che valida i
target di decarbonizzazione delle aziende contro la scienza climatica.

3 percorsi:
* **1.5 °C compatible** (preferito)
* **Well below 2 °C**
* **2 °C compatible**

Gresmalt si **auto-allinea** a SBTi 1.5 °C ma **non ha sottomesso** i
target per validazione formale.

### European Climate Law

Regolamento UE 2021/1119 che fissa l'obiettivo di **net-zero al 2050** e
**−55% entro il 2030** vs 1990.

### CSRD (Corporate Sustainability Reporting Directive)

Direttiva UE 2022/2464 che obbliga grandi aziende EU a rendicontare
sostenibilità seguendo gli ESRS (European Sustainability Reporting Standards).

Include emissioni GHG Scope 1+2+3, dual reporting Scope 2, materiality
assessment, target di decarbonizzazione.

### GRI (Global Reporting Initiative)

Framework di sustainability reporting più diffuso al mondo. GRI 305
specifico per emissioni:

* GRI 305-1: Direct (Scope 1) GHG emissions
* GRI 305-2: Energy indirect (Scope 2) GHG emissions
* GRI 305-3: Other indirect (Scope 3) GHG emissions
* GRI 305-4: GHG emissions intensity
* GRI 305-5: Reduction of GHG emissions

### PCAF (Partnership for Carbon Accounting Financials)

Standard per il calcolo delle emissioni GHG **finanziate** (investimenti,
prestiti). Usato per Scope 3 cat.15.

Versione corrente: 2.0 (Nov 2024).

### Operational Control vs Financial Control

**Principio di consolidamento** GHG Protocol:

* **Operational Control**: include attività dove l'azienda ha autorità
  per definire e applicare policy operative (anche se ha solo % minoranza)
* **Financial Control**: include attività dove l'azienda ha controllo
  finanziario (di solito > 50% equity)
* **Equity Share**: include emissioni proporzionate alla quota azionaria

Gresmalt usa **Operational Control** sui 7 siti del Gruppo. Esclude
investimenti finanziari di minoranza senza controllo gestionale.

## Tool-specific

### `__GHG_ROLE`

Variabile globale browser-side popolata da `AuthGate` dopo il login.
Letta da `App.jsx`, `G.db.role()`, e tutte le sezioni per gate UI.

Valori: `'admin' | 'editor' | 'auditor' | 'viewer' | 'guest'`.

### `aal` (Authenticator Assurance Level)

Standard NIST per livello di autenticazione MFA. Supabase usa:

* **aal1**: solo password
* **aal2**: password + secondo fattore (TOTP)

Le policy RLS (`14_mfa_editor.sql`, `15_mfa_auditor.sql`) richiedono
`aal=aal2` per editor (write) e auditor (read audit_log).

### Hash chain

Tecnica di tamper-evidence: ogni riga di audit_log contiene `prev_hash`
(hash della riga precedente) e `row_hash` = `sha256(prev_hash || data)`.

Manomettere una riga rompe la chain dalla riga in poi. La function
`verify_audit_chain()` ricalcola e segnala il primo break.

Vedi [[Audit-Trail]].

### Year lock / sign-off

Lock di un anno di inventario dopo l'approvazione (es. Bilancio
Sostenibilità pubblicato). Implementato come array JSONB in
`app_meta.locked_years`. Editor non possono più modificare quell'anno,
admin mantiene override.

Vedi [[Operazioni-Comuni#chiudere-un-anno-sign-off--lock]].

### Anti-stale-cache

Sistema a 3 livelli che garantisce che il visitatore veda sempre il bundle
più recente:

1. bfcache restore → hide + reload
2. fetch `build.txt` vs BUILD_HASH inlined → hard reload se mismatch
3. localStorage marker per Diagnostica

Vedi [[Architettura#anti-stale-cache]].

### IIFE pattern

Immediately-Invoked Function Expression. Pattern usato da tutti i sorgenti
`src/*` per attaccarsi al namespace globale `window.GHG`:

```js
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  // ... codice ...
  G.modulo = { /* exports */ };
})(typeof window !== 'undefined' ? window : globalThis);
```

Vedi [[Architettura]].

### SRI (Subresource Integrity)

Attributo HTML per verificare l'integrità dei file scaricati da CDN. Il
browser calcola l'hash del file e lo confronta con quello dichiarato; se
divergono, blocca l'esecuzione.

```html
<script src="https://cdn.../file.js"
        integrity="sha384-...="
        crossorigin="anonymous">
</script>
```

`@e965/xlsx` e `pptxgenjs` sono caricati lazy con SRI. L'hash è calcolato
a build-time da `build.mjs`.

### CSP (Content Security Policy)

Header HTTP (o `<meta>` nel HTML) che istruisce il browser su quali
risorse può caricare. Difesa contro XSS e injection.

Vedi [[Sicurezza#csp]] per la CSP applicata.

### RLS (Row Level Security)

Feature Postgres che permette di definire policy a livello di **riga**.
Ogni `SELECT/INSERT/UPDATE/DELETE` viene filtrato dalla policy in base al
ruolo dell'utente (estratto dal JWT in Supabase).

`FORCE ROW LEVEL SECURITY` impone le policy anche al table owner (no
bypass accidentale con superuser).

Vedi [[Sicurezza#row-level-security-rls]].

### Materialized View (MV)

Vista che memorizza fisicamente il risultato della query (a differenza di
una `VIEW` normale che la ricalcola ad ogni accesso). Richiede `REFRESH
MATERIALIZED VIEW [CONCURRENTLY]` per aggiornarsi.

`public_facts` è una MV refreshed on-write (trigger su s1/s2/s3/produzione)
+ schedulato weekly come safety-net.

### Audit chain SHA-256

Sequenza di righe in `audit_log` legate da hash crittografici:

```
riga 1:  prev_hash=NULL,         row_hash=sha256("" || data1)
riga 2:  prev_hash=row_hash(1),  row_hash=sha256(prev_hash || data2)
riga 3:  prev_hash=row_hash(2),  row_hash=sha256(prev_hash || data3)
...
```

Tamper-evidence: se modifichi `data2`, il `row_hash` della riga 2 cambia,
ma quello della riga 3 (calcolato sul vecchio `row_hash(2)`) non
combacia più → chain "broken".

### HMAC (Hash-based Message Authentication Code)

Algoritmo crittografico che produce una firma su un messaggio usando una
chiave segreta condivisa. La firma non può essere generata senza la chiave.

Usato per `sign_snapshot` Edge Function:
```
signature = HMAC-SHA256(SNAPSHOT_HMAC_KEY, payload || "|" || sha256(payload))
```

### Constant-time equality

Tecnica per confrontare 2 stringhe (signature, password) **senza** leakare
informazioni temporali. Una `===` normale ritorna `false` al primo
carattere diverso → un attacker può misurare il tempo per dedurre quanti
caratteri ha indovinato.

```js
function constantTimeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
```

Tempo proporzionale alla **lunghezza** della stringa, non al numero di
match.

## File / Tabelle / Sezioni

### `app_meta`

Tabella chiave-valore per configurazioni mutabili runtime: `targets`,
`locked_years`, `schema_version`, `last_keepalive`. Solo admin scrive.

### `audit_log`

Log immutabile con hash chain di tutte le mutazioni su 8 tabelle.

### `public_facts`

MV aggregato per anno (totali per scope, % per sito, intensità). Senza
volumi assoluti di produzione.

### Faccia A / Faccia B

* **Faccia A**: Public Dashboard, pagina anonima per i clienti
* **Faccia B**: Console interna, login per operatori

### `G.db.dbToApp` / `appToDb`

Mapping snake_case (DB) ↔ PascalCase con accenti italiani (UI). Es.
`anno → Anno`, `quantita → Quantità`, `qualita_dato → Qualità_Dato`,
`em_loc_tco2e → Em_Loc_tCO2e`.

### `G.calc.lookupFE`

Cerca un FE per chiave + anno. Match esatto su anno; fallback al più
recente (warn se Δ=2, err se Δ>2).

### `G.calc.totals`

Aggrega emissioni per anno con filtri (sito, anno). S3 è organizzativo:
se si filtra per sito, S3 = 0.

### Tab "FE Explorer" — "Cerca FE online (IA)"

Card **disabilitata** in UI che usava la Edge Function `search_fe` per
proporre FE da fonti pubbliche via Gemini + Grounding. Risultati erano
inaffidabili. Backend (Edge Function + tabella audit `fe_search_log`)
rimane pronto per uso futuro.

## Sigle frequenti

| Sigla | Espansione |
|---|---|
| **AAL** | Authenticator Assurance Level (NIST) |
| **AIB** | Association of Issuing Bodies (residual mix electricity EU) |
| **CHP** | Combined Heat and Power |
| **CSRD** | Corporate Sustainability Reporting Directive |
| **DDL** | Data Definition Language (CREATE TABLE, …) |
| **EOL** | End Of Life |
| **EPD** | Environmental Product Declaration |
| **ESRS** | European Sustainability Reporting Standards |
| **ETS** | Emissions Trading Scheme (EU) |
| **FE** | Fattore di Emissione (Emission Factor) |
| **GHG** | Greenhouse Gas |
| **GO** | Garanzia di Origine |
| **GSE** | Gestore Servizi Energetici (Italia) |
| **GWP** | Global Warming Potential |
| **HGV** | Heavy Goods Vehicle |
| **HMAC** | Hash-based Message Authentication Code |
| **IPCC** | Intergovernmental Panel on Climate Change |
| **ISPRA** | Istituto Superiore per la Protezione e la Ricerca Ambientale |
| **LB** | Location-Based |
| **LCV** | Light Commercial Vehicle |
| **MB** | Market-Based |
| **MFA** | Multi-Factor Authentication |
| **MV** | Materialized View (Postgres) |
| **NIR** | National Inventory Report (UN-FCCC) |
| **PCAF** | Partnership for Carbon Accounting Financials |
| **PII** | Personally Identifiable Information |
| **PKCE** | Proof Key for Code Exchange (OAuth flow) |
| **PPA** | Power Purchase Agreement |
| **RLS** | Row Level Security |
| **RPC** | Remote Procedure Call (Supabase / PostgREST) |
| **RPD** | Requests Per Day |
| **SBTi** | Science Based Targets initiative |
| **SRI** | Subresource Integrity |
| **TPM** | Tokens Per Minute |
| **TOTP** | Time-based One-Time Password |
| **TTW** | Tank-to-Wheel |
| **UMD** | Universal Module Definition |
| **VAT** | Value Added Tax (Partita IVA) |
| **WTT** | Well-to-Tank |
| **WTW** | Well-to-Wheel |
| **YoY** | Year-over-Year |

## Risorse

- [[Architettura]] — IIFE, namespace, build pipeline
- [[Sicurezza]] — CSP, RLS, MFA, hash chain
- [[Modello-dati]] — tabelle, RPC, vista MV
