# Public Dashboard (Faccia A)

Pagina pubblica, **anonima** (no login), servita all'URL root del dominio
(es. `https://sustainability.gresmalt.it/`). È rivolta a clienti, partner,
analisti ESG, giornalisti e a qualunque visitatore curioso.

* **Componente**: `G.PublicDashboard` (`src/sections/PublicDashboard.jsx`, ~1450 righe)
* **Dati**: solo `get_public_dashboard(year)` RPC + view `s3_materiality_public` + `list_public_years` RPC
* **Routing**: tutte le URL diverse da `#app` mostrano questa pagina
* **Lingue**: IT (default) + EN, toggle persistito in `localStorage.ghg_lang`
* **Stampa**: bottone "⎙ Stampa" applica modalità A4 portrait

## Cosa NON vede il visitatore anonimo

* I volumi assoluti di produzione (`produzione_kg`, `produzione_m2`) — esposti
  solo come denominatore di intensità, **mai come numero**.
* I dati per singola riga di S1/S2/S3 — solo gli aggregati di
  `public_facts`.
* Tutti i campi `qualita_dato`, `stato_dato`, `note`, `fonte_dato`.
* L'`audit_log`, le email operatori, qualunque PII.
* La materialità ha solo `cat_id` + `status` (no `justification`,
  `methodological_ref`).

## Struttura della pagina

Lo scroll completo della Public Dashboard (vista IT):

```
┌──────────────────────────────────────────────────────────────────┐
│  [Logo Gresmalt]    [IT|EN]  [Anno: 2025 ▾]  [Accesso operatori →]│ Header sticky
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│         INVENTARIO EMISSIONI GHG                                 │ Hero
│         Le emissioni del Gruppo Ceramiche Gresmalt               │
│                                                                  │
│                    XX %                                          │
│       di riduzione delle emissioni Scope 1+2                     │
│       del 2025 vs baseline 2021                                  │
│                                                                  │
│       Verso il -59% entro il 2034 · Piano Decarbonizzazione 2024 │
│                                                                  │
│       [Caveat: il salto include sia riduzioni fisiche sia GO]    │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Metodo Scope 2:   [● Location-based]  [○ Market-based]    [?]  │ Toggle
├──────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ Tot anno │ │ Δ vs '24 │ │ 100% GO  │ │ Intens.  │             │ KPI strip
│  │ XXX tCO₂e│ │  −12%    │ │ rinnov.  │ │ X.X /m²  │             │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
├──────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────┐  ┌──────────────────────────┐      │
│  │ Donut composizione       │  │ Trend ultimi 5 anni      │      │
│  │ S1 / S2 / S3             │  │ bar stacked + line target│      │
│  └──────────────────────────┘  └──────────────────────────┘      │
├──────────────────────────────────────────────────────────────────┤
│  Scope 3: N/15 categorie incluse  · Dove pesa di più S3?         │
│  ┌──────────────────────────┐ ┌──────────────────────────┐       │
│  │ Hot 1 · Cat 1 — Materie  │ │ Hot 2 · Cat 4 — Trasp.up │  …    │
│  │ XX tCO₂e · XX% di S3     │ │ XX tCO₂e · XX% di S3     │       │
│  └──────────────────────────┘ └──────────────────────────┘       │
├──────────────────────────────────────────────────────────────────┤
│  COSA RENDICONTIAMO                                              │
│  Le emissioni di gas serra sono raggruppate in tre "Scope".      │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Scope 1 · Emissioni dirette                              │    │
│  │ Cosa bruciamo direttamente?                              │    │
│  │ Gas naturale, gasolio, benzina + emissioni di processo   │    │
│  │ dalla decarbonatazione dei carbonati nei forni ceramici. │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │ Scope 2 · Elettricità acquistata                         │    │
│  │ Quanta elettricità compriamo dalla rete?                 │    │
│  │ Calcolata Location-based e Market-based.                 │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │ Scope 3 · Catena del valore                              │    │
│  │ Cosa succede a monte e a valle?                          │    │
│  │ Materie prime, smalti, packaging, trasporti, viaggi,     │    │
│  │ pendolarismo, fine vita.                                 │    │
│  └──────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────┤
│  TERMINI CHIAVE (glossario)                                      │
│  · tCO₂e — tonnellate di CO₂ equivalente                         │
│  · GO — Garanzia di Origine                                      │
│  · Intensità carbon                                              │
│  · Location-based vs Market-based                                │
├──────────────────────────────────────────────────────────────────┤
│  MATERIALITÀ SCOPE 3                                             │
│  15 cards (cat 1..15) con status: Inclusa / Esclusa / N.A. /     │
│  Da valutare                                                     │
├──────────────────────────────────────────────────────────────────┤
│  I NOSTRI OBIETTIVI                                              │
│  Allineamento SBTi 1.5 °C + European Climate Law                 │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ Baseline │ │ Attuale  │ │  -59%    │ │  -90%    │             │
│  │   2021   │ │   2025   │ │   2034   │ │   2050   │             │
│  │ XX tCO2e │ │ XX tCO2e │ │ XX tCO2e │ │ XX tCO2e │             │
│  │ X.X kg/m²│ │ X.X kg/m²│ │ X.X kg/m²│ │ X.X kg/m²│             │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
├──────────────────────────────────────────────────────────────────┤
│  LE LEVE DELLA DECARBONIZZAZIONE                                 │
│  Piano 2034:                Vision 2050:                         │
│  1. Efficienza energetica  4. Elettrificazione di processo       │
│  2. Energia rinnovabile    5. Sostituzione del gas metano        │
│  3. Ottimizzazione process 6. Strumenti finanziari               │
├──────────────────────────────────────────────────────────────────┤
│  BASELINE, PERIMETRO E RICALCOLI                                 │
│  · Anno base 2021                                                │
│  · Approccio controllo operativo (7 siti)                        │
│  · Soglia di ricalcolo 5%                                        │
│  · Fattori di emissione: NIR / ISPRA / AIB / Terna / DEFRA       │
│  · Emissioni biogeniche escluse da Scope 1 (GHG Protocol)        │
├──────────────────────────────────────────────────────────────────┤
│  STANDARD DI RIFERIMENTO                                         │
│  [GHG Protocol] [GRI] [SBTi] [European Climate Law] [CSRD]       │
├──────────────────────────────────────────────────────────────────┤
│  APPROFONDISCI                                                   │
│  [Scarica Piano Decarb 2024]  [EPD prodotti]  [Sito Gresmalt]    │
│  [Scrivi all'Innovability Unit]  [Stampa]                        │
├──────────────────────────────────────────────────────────────────┤
│  LIMITI E PERIMETRO (disclaimer)                                 │
│  I dati pubblicati sono validati internamente prima della        │
│  pubblicazione e si riferiscono al perimetro di controllo        │
│  operativo dei 7 siti del Gruppo. (...)                          │
├──────────────────────────────────────────────────────────────────┤
│  Footer: privacy · cookie · link Bilancio di Sostenibilità       │
└──────────────────────────────────────────────────────────────────┘
```

## I18N — IT/EN

Tutte le label vivono in `G.I18N[lang]` (definito in `constants.js`).
Lingua persistita in `localStorage.ghg_lang`. Default IT (rilevato anche
da `navigator.language`).

Interpolazione tramite token `{placeholder}`:

```js
I18N.it.heroStatLabel = 'emissioni Scope 1 + 2 del {cy} vs baseline {y}'
// usato come:
G.I18N.it.heroStatLabel
  .replace('{cy}', 2025)
  .replace('{y}', 2021)
// → 'emissioni Scope 1 + 2 del 2025 vs baseline 2021'
```

Le sezioni con i18n hanno **~150 chiavi** in IT + EN. Vedi `constants.js`
righe 207-489 per la lista completa.

## Toggle LB ↔ MB Scope 2

Hook `G.ui.useS2Method` condiviso con la Console interna:

```js
const [s2Method, setS2Method] = G.ui.useS2Method(); // 'lb' | 'mb'
// persistito in localStorage.ghg_s2method
```

Component `G.ui.S2MethodToggle` con tooltip esplicativo:

> *"Location-based usa il mix medio della rete elettrica italiana;
> Market-based usa i contratti reali dell'azienda, comprese le Garanzie
> di Origine."*

## Hero stat

Mostra la **% di riduzione** delle emissioni Scope 1 + 2 dell'anno corrente
rispetto alla baseline 2021. La logica:

```js
const baselineS1S2 = G.TARGETS.baseline_tco2e;  // 99815 di default
const currentS1S2 = totals.s1 + totals.s2lb;    // o s2mb se toggle MB
const pct = ((currentS1S2 - baselineS1S2) / baselineS1S2) * 100;
// se pct < 0 → "−XX% vs baseline"
// se pct > 0 → "+XX% vs baseline"
```

**Caveat importante**: il salto rispetto alla baseline include:

1. Riduzioni fisiche (efficienza energetica, primi FV)
2. Cambio metodologico (acquisto di **Garanzie di Origine sul 100%** dell'elettricità)

Il copy chiarisce questo punto per evitare greenwashing. Vedi
`G.I18N.it.heroStatCaveat`.

## Hotspots Scope 3

Top 3 categorie S3 ordinate per emissioni assolute decrescenti.
Mostra per ciascuna:
- Nome categoria GHG Protocol (1..15) in lingua scelta
- Emissioni in tCO₂e
- Quota % sul totale S3

Renderizzato da `renderScope3Hotspots()`.

## Materialità

15 cards (cat 1..15) con stato:

| Stato | Colore | Descrizione UI |
|---|---|---|
| `Inclusa` | verde | "rendicontata nell'inventario" |
| `Esclusa` | grigio | "non rilevante per il settore" |
| `N.A.` | grigio chiaro | "non applicabile al business" |
| `Da valutare` | arancio | "in revisione per il prossimo ciclo" |

La query è su `s3_materiality_public` (view che espone solo `cat_id` e `status`,
NON la giustificazione testuale).

## Targets

Sezione "I nostri obiettivi" con 4 KPI cards in fila:

1. **Anno base 2021** — baseline assoluto + intensità per m²
2. **Ultimo anno rendicontato** — valori correnti
3. **Target 2034** — emissioni target + intensità target
4. **Vision 2050** — emissioni vision + intensità vision

I valori provengono da `G.TARGETS` che a sua volta è sovrascritto runtime
da `app_meta.targets` se presente (admin può aggiornare via UI senza
redeploy del bundle).

## Iniziative (decarbonization levers)

6 cards divise in due gruppi:

**Piano 2034**:
1. Efficienza energetica (IE2→IE4, pompe di calore, recupero calore forni, LED)
2. Energia rinnovabile (4° impianto FV 1.6 MWp, GO sull'elettricità acquistata)
3. Ottimizzazione di processo (riduzione spessori piastrelle)

**Vision 2050**:
4. Elettrificazione di processo e logistica (bruciatori → elettrico, flotte EV)
5. Sostituzione del gas metano (biocombustibili, gas rinnovabili)
6. Strumenti finanziari (GO + PPA + compensazioni + CCUS)

## Baseline & perimetro

Pannello che documenta i 5 capisaldi metodologici:

| Capitolo | Contenuto |
|---|---|
| Anno base | 2021, primo anno con dati verificabili sull'intero perimetro |
| Approccio consolidamento | Controllo operativo (7 siti, escl. minoranze finanziarie) |
| Soglia ricalcolo | 5% delle emissioni totali |
| Fattori di emissione | NIR/ISPRA/Min.Amb./ETS per combustibili + AIB/Terna per EE (anni 2021-2024) |
| Emissioni biogeniche | Escluse dal totale Scope 1 (GHG Protocol Corporate) |

## CTA finale

Bottoni di azione:
- 📄 Scarica il Piano di Decarbonizzazione 2024 (PDF Gresmalt.it)
- 🎯 Trova le EPD dei nostri prodotti (link esterno)
- 🌐 Visita il sito Gresmalt
- ✉️ Scrivi all'Innovability Unit (`mailto:sustainability@gresmalt.it`)
- ⎙ Stampa questa pagina

## Disclaimer e footer

> *"I dati pubblicati sono validati internamente prima della pubblicazione
> e si riferiscono al perimetro di controllo operativo dei 7 siti del
> Gruppo. Possono essere aggiornati dopo la chiusura definitiva
> dell'inventario annuale; variazioni dei fattori di emissione, del
> perimetro di consolidamento o dei metodi di calcolo possono comportare
> ricalcoli della baseline (soglia 5%). Per la rendicontazione completa
> si rimanda al Bilancio di Sostenibilità del Gruppo."*

Footer: privacy, cookie policy, link Bilancio di Sostenibilità.

## Stampa (A4 portrait)

Click "⎙ Stampa" → `body.classList.add('ghg-print-mode')` + `window.print()`.

CSS in `build.mjs`:
- Nasconde header / sidebar (`display: none !important`)
- Background bianco
- `@page { size: A4; margin: 18mm 14mm; }`
- `page-break-inside: avoid` su section/article/canvas
- `a[href]:after { content: " (" attr(href) ")"; }` per stampare i link

Dopo `window.print()`, una `setTimeout(0)` rimuove `ghg-print-mode`.

## Performance

Tempo di render:
- ~150 ms al primo paint (bundle parsato + React mount + RPC `get_public_dashboard`)
- ~50 ms per re-render su cambio anno (solo nuovo RPC, no rebuild bundle)

Pesi:
- Bundle HTML 1.1 MB (95% React + Chart.js + Supabase + business code)
- 0 fetch CDN al primo paint
- 1 fetch RPC `get_public_dashboard(year)` (~10 KB di JSON)
- 1 fetch view `s3_materiality_public` (~1 KB)
- 1 fetch RPC `list_public_years` (~50 byte)

## SEO

- `<title>`: "Inventario emissioni GHG — Gruppo Ceramiche Gresmalt"
- `<meta name=description>`: descrizione 200 char IT
- `<meta property=og:*>`: Open Graph completo (title, description, url, locale, site_name)
- `<meta name=twitter:*>`: Twitter Card "summary"
- `<link rel=canonical>`: `PUBLIC_DASHBOARD_URL` env
- **JSON-LD** `<script type="application/ld+json">` con `Organization` +
  `WebPage` schema.org. Aiuta indicizzazione Google + link preview LinkedIn/Slack.

## Risorse

- [[Architettura]] — namespace globali, build pipeline
- [[Console-Interna]] — Faccia B per operatori
- [[Sicurezza]] — RLS public_facts + s3_materiality_public
