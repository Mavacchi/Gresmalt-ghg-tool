# Piano di Decarbonizzazione 2024

Sintesi del Piano ufficiale Gresmalt (Rev. 1 del 18/11/2024), come
modellato nel tool.

> Riferimento documentale ufficiale (PDF pubblico):
> https://www.gresmalt.it/wp-content/uploads/2025/09/GRESMALT_PIANO_DI_DECARBONIZZAZIONE_2025_IT.pdf

## Storia delle versioni del Piano

| Versione | Data | Modifica |
|---|---|---|
| Sintetico | Giugno 2024 | Bozza con target -54% al 2034 (intensità in kgCO₂e/m²) |
| Rev. 1 | Novembre 2024 | Aggiornato a -59% al 2034 (allineamento SBTi 1.5°C), approccio market-based |

Il tool usa i valori della **Rev. 1**.

## Target nel tool (`G.TARGETS` in `constants.js`)

```js
const TARGETS = {
  scope:                  'Scope 1 + 2 Market-based',
  baselineYear:           2021,

  // Valori dal Piano Rev. 1 (Tabelle 3 e 12)
  baseline_tco2e:         99815,
  baseline_intensity:     5.10,   // kgCO2e/m² (Piano sintetico Giugno 2024)
                                  //  Rev.1 usa SDA in kgCO₂e/€, non direttamente comparabile

  shortTermYear:          2034,
  shortTerm_tco2e:        41124,  // -59% vs baseline
  shortTerm_intensity:    2.81,

  longTermYear:           2050,
  longTerm_tco2e:         9982,
  longTerm_intensity:     0.62,

  // Scope 3 — opzionali (null = non definito)
  s3_baseline_tco2e:      null,
  s3_shortTerm_tco2e:     null,
  s3_longTerm_tco2e:      null,

  alignment: 'Auto-allineato SBTi 1.5°C · European Climate Law · GHG Protocol · GRI'
};
```

Override runtime: i valori in `app_meta.targets` (jsonb) sovrascrivono
`G.TARGETS` al `loadAll()`. Admin può aggiornarli da UI → **Gestione Dati
> Target** senza redeploy del bundle.

## Perimetro

* **Approccio di consolidamento**: Operational Control GHG Protocol
* **Siti inclusi (7)**: IANO, VIANO, VIANO_GARGOLA, FRASSINORO, SASSUOLO,
  FIORANO, CASALGRANDE
* **Esclusi**: investimenti finanziari di minoranza senza controllo
  gestionale
* **Anno base**: 2021 (primo anno con dati verificabili sull'intero
  perimetro)
* **Periodo rendicontazione**: 1 gennaio – 31 dicembre

## Scope coperti

### Scope 1 — Emissioni dirette

* Combustione stazionaria: gas naturale (principale), GPL, olio combustibile
* Combustione mobile: gasolio (flotta aziendale, carrelli elevatori), benzina
* Emissioni fugitive: refrigeranti F-gas (R410A) negli impianti HVAC

### Scope 2 — Energia acquistata

* Elettricità acquistata (dual reporting LB + MB)
* Garanzie di Origine (GO) sul 100% dell'elettricità acquistata (in
  attuazione)
* Teleriscaldamento (se applicabile per alcuni siti)

### Scope 3 — Catena del valore

Categorie incluse:
* **Cat.1**: Beni e servizi acquistati (argilla, feldspato, smalti,
  inchiostri, packaging)
* **Cat.2**: Beni strumentali (CAPEX)
* **Cat.3**: WTT di gas naturale, gasolio, elettricità
* **Cat.4**: Trasporti upstream (materie prime in ingresso)
* **Cat.5**: Rifiuti operativi
* **Cat.6**: Viaggi di lavoro
* **Cat.7**: Pendolarismo dipendenti
* **Cat.9**: Trasporti downstream (prodotti finiti)
* **Cat.12**: Fine vita prodotti (EOL-model 18% landfill / 30% riciclo / 52% inerti)

Categorie escluse:
* **Cat.8** (leasing upstream): nessun contratto significativo
* **Cat.11** (use of sold products): piastrelle sono prodotto passivo

Categorie N.A.:
* **Cat.10** (processing of sold products): nessuna trasformazione downstream
* **Cat.13** (leasing downstream): N/A
* **Cat.14** (franchising): N/A

Da valutare:
* **Cat.15** (investimenti): da analizzare con PCAF v2.0 nel prossimo ciclo

## Soglia di ricalcolo

**5%** delle emissioni totali. La baseline viene ricalcolata in caso di
variazioni significative dovute a:
* Cambiamenti di perimetro
* Cambiamenti di metodi di calcolo
* Cambiamenti di approccio di consolidamento

## Fattori di emissione

* **Combustibili**: NIR, Ministero dell'Ambiente, ETS, ISPRA (anni 2021-2024)
* **Elettricità Location-Based**: ISPRA Inventario Nazionale, Terna
* **Elettricità Market-Based**: AIB European Residual Mix
* **WTT**: DEFRA Conversion Factors 2024
* **Materiali**: ecoinvent 3.10/3.11, EPD pubbliche, ministero ambiente IT
* **Trasporti**: DEFRA Conversion Factors 2024
* **Rifiuti**: ISPRA, DEFRA

Aggiornamenti dei fattori comportano ricalcolo dell'inventario (cascade
via `G.db.cascadeFEUpdate` → tutti gli S1/S3 referenziati).

## Emissioni biogeniche

CO₂ da combustibili biogenici (biomassa, biogas, biodiesel) **esclusa**
dal totale Scope 1 come previsto dal GHG Protocol Corporate Standard.
Tracciate separatamente nei sistemi interni.

## Le 6 leve di decarbonizzazione

### Piano 2034 (short-term)

**1. Efficienza energetica**
* Sostituzione integrale dei motori IE2 con motori IE4 ad alta efficienza
* Pompe di calore e caldaie a condensazione per uffici/servizi
* Recupero del calore nei forni industriali (preriscaldo aria comburente,
  preriscaldo aria essiccatoi)
* Relamping LED in stabilimenti e magazzini

**2. Energia rinnovabile**
* Quarto impianto fotovoltaico da 1.6 MWp in arrivo → totale ~4 MWp installati
* Adozione di Garanzie di Origine (GO) sul 100% dell'elettricità acquistata
  → Scope 2 MB ≈ 0

**3. Ottimizzazione di processo**
* Riprogettazione del processo orientata alla riduzione degli spessori
  delle piastrelle:
  * Meno materie prime (~10-15%)
  * Meno energia per m² prodotto (cottura più rapida con minor massa)
  * Minor impatto della logistica (più m² per camion)

### Vision 2050 (long-term)

**4. Elettrificazione di processo e logistica**
* Sostituzione progressiva dei bruciatori a combustibile di forni e
  atomizzatori con tecnologie elettriche
* Flotte aziendali EV (auto, furgoni)
* Carrelli elevatori elettrici
* Trattori elettrici per piazzali

**5. Sostituzione del gas metano**
* Transizione progressiva dal gas metano a biocombustibili e gas rinnovabili:
  * Turbine a biogas / biometano
  * Elettrolizzatori per H₂ verde
  * Bruciatori compatibili dual-fuel (gas + H₂)

**6. Strumenti finanziari**
* GO (in attuazione, in piano completo entro short-term)
* PPA (Power Purchase Agreement) per energia rinnovabile aggiuntiva
  (long-term)
* Compensazioni volontarie certificate per la quota residua (cautela: solo
  progetti high-quality, non offset di base mass-market)
* CCUS (Carbon Capture, Utilization and Storage) sulla quota residua
  post-2034 (long-term, dipende da maturità tecnologica)

## Allineamento SBTi

Gresmalt **non ha sottomesso** i target a SBTi per validazione formale,
ma il piano è **auto-allineato** ai criteri SBTi 1.5 °C:

* Riduzione assoluta -59% al 2034 → >4.2% lineare/anno (criterio 1.5°C)
* Net-zero al 2050 con riduzione assoluta ≥-90% + offset residual ≤10%
* Scope 1+2 inclusi (Scope 3 da definire formalmente)

## Riferimenti standard

| Standard | Riferimento |
|---|---|
| GHG Protocol Corporate Standard | https://ghgprotocol.org/corporate-standard |
| GHG Protocol Scope 2 Guidance | https://ghgprotocol.org/scope-2-guidance |
| GHG Protocol Scope 3 Standard | https://ghgprotocol.org/standards/scope-3-standard |
| GRI 305 (Emissions) | https://www.globalreporting.org/standards/ |
| SBTi 1.5°C Criteria | https://sciencebasedtargets.org/resources/legacy/2021/04/SBTi-criteria.pdf |
| European Climate Law | https://eur-lex.europa.eu/eli/reg/2021/1119/oj |
| CSRD | https://eur-lex.europa.eu/eli/dir/2022/2464/oj |
| ESRS E1 (Climate change) | https://www.efrag.org/lab6 |
| PCAF Standard v2.0 | https://carbonaccountingfinancials.com/standard |

## Risorse

- [[Public-Dashboard]] — visualizzazione target + iniziative
- [[Modello-dati#app_meta]] — storage runtime dei target
- [[Operazioni-Comuni#modificare-i-target-del-piano]] — playbook update
