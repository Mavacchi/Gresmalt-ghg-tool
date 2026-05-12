# Gestione Dati

Sezione amministrativa della console interna per CRUD su tutte le tabelle dati.

* **Path**: `src/sections/DataManager.jsx` (215 righe) — shell
* **Companion files** (caricati dal build PRIMA di DataManager.jsx):
  * `DataManager.shared.jsx` (835 righe) — helper + componenti riusabili
  * `DataManager.tabs.jsx` (890 righe) — tab Anagrafiche, Produzione, Targets, FE
  * `DataManager.scopeModals.jsx` (570 righe) — modal S1, S2, S3 EditModal
* **Namespace**: tutto su `G.DM`
* **Ruoli**: admin/editor (delete solo admin; editor + MFA aal2 obbligatorio)

## Tab (7)

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Anagrafiche] [Produzione] [S1] [S2] [S3] [FE] [Target]            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [+ Aggiungi]  [📤 Export Excel]  [📥 Import Excel]  [🔄 Clona anno]│
│                                                                     │
│  ╔══════════════════════════════════════════════════════════════╗   │
│  ║  Tabella corrente (DataTable componente)                     ║   │
│  ║  · ordinamento per colonna                                   ║   │
│  ║  · filtro testuale globale                                   ║   │
│  ║  · paginazione                                               ║   │
│  ║  · multi-select per bulk-delete                              ║   │
│  ║  · per-row "edit" e "delete" se permesso                     ║   │
│  ╚══════════════════════════════════════════════════════════════╝   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Tab "Anagrafiche"

Component: `G.DM.AnagraficheTab`. Modal: `G.DM.AnagraficaEditModal`.

* Tabella con: Codice_Sito (PK), Nome_Sito, Tipologia, CHP (✓/—),
  ETS (✓/—), Righe associate (S1/S2/Prod count), Note
* "Righe associate" calcola riferimenti FK in tempo reale:

  ```js
  ['s1', 's2', 'produzione'].forEach(t => (data[t]||[]).forEach(r => {
    const code = r.Codice_Sito;
    refCount[code][t]++;
  }));
  ```

* **FK protection on delete**: se total > 0 → toast errore "Cancella prima
  quelle righe", il delete viene bloccato.
* **Code lock on edit**: se Codice_Sito è già referenziato da altre righe,
  il campo è disabled in edit (per non rompere i FK).
* Modal validazione: codice solo `[A-Z0-9_]+`, no duplicati.

### Tab "Produzione"

Component: `G.DM.ProduzioneTab`. Modal: `G.DM.EditModal`.

Sfide PK composita (`codice_sito, anno`):

* Su edit, l'app traccia `origKey = {codice_sito, anno}` originali.
* Salva via `G.db.saveProduzione(newRow, originalKey)` che chiama la RPC
  atomica `save_produzione(...)`:

  ```sql
  -- in sql/13_hardening.sql
  CREATE FUNCTION save_produzione(
    p_codice_sito text, p_anno int, p_kg numeric, p_m2 numeric, p_note text,
    p_orig_sito text DEFAULT NULL, p_orig_anno int DEFAULT NULL
  ) RETURNS produzione AS $$
  BEGIN
    -- se la PK è cambiata, prima delete la vecchia
    IF p_orig_sito IS NOT NULL AND p_orig_anno IS NOT NULL
       AND (p_orig_sito <> p_codice_sito OR p_orig_anno <> p_anno) THEN
      DELETE FROM produzione WHERE codice_sito=p_orig_sito AND anno=p_orig_anno;
    END IF;
    INSERT INTO produzione ...
    ON CONFLICT (codice_sito, anno) DO UPDATE SET ...
  END;
  ```

  Tutto in una transazione → se l'UPSERT fallisce, il DELETE viene rolled
  back (no race window).
* Fallback legacy: se la RPC non c'è (DB pre-`13_hardening.sql`), fa
  DELETE + UPSERT non transazionale con warning in console.

* Validazione: almeno uno tra kg e m² > 0 (gestito sia DB-side via CHECK
  che app-side via `G.calc.validateRow`).

### Tab "S1" — Combustione diretta

Modal: `G.DM.S1EditModal` (`DataManager.scopeModals.jsx`).

Campi:
* Anno, Codice_Sito (dropdown da anagrafiche)
* Categoria_S1 (Combustione_Stazionaria | Combustione_Mobile | Fugitivi | Process)
* Combustibile (text + auto-complete dai codici FE esistenti)
* Quantità (numero) + Unità (text con warning se non corrisponde a `G.EXPECTED_UNIT_S1`)
* Fonte_Dato, Qualità_Dato (P/S/E), Stato_Dato (Definitivo/Provvisorio/Stimato), Note
* **Preview calcolo emissione in tempo reale**:
  ```
  ┌─────────────────────────────────────────────┐
  │ Anteprima calcolo                           │
  ├─────────────────────────────────────────────┤
  │ FE applicato: ISPRA 2024 — 1.984 kgCO2e/Sm3 │
  │ Em_tCO2e = 18 450 000 × 1.984 / 1000        │
  │         = 36 605 tCO2e                      │
  └─────────────────────────────────────────────┘
  ```
* **Auto-fill FE** dal catalogo: bottone "Compila dal FE catalogo" che
  cerca il FE con `combustibile == codice_voce && anno == anno_validita`
  (con fallback `lookupFE`)
* **Year-lock awareness**: se l'anno è in `locked_years` e role=editor,
  il modal mostra `LockBanner` + disabilita il submit.
* Validazione feedback inline (errori + warning).

### Tab "S2" — Elettricità acquistata

Modal: `G.DM.S2EditModal`.

Campi:
* Anno, Codice_Sito, Voce_S2 (EE_Acquistata | EE_Acquistata_GO | Teleriscaldamento | …)
* Quantità (kWh), Strumento_MB (GO/PPA/contract)
* **FE_Location** + **FE_Market** (auto-compilati da FE catalogo se vuoti)
* Preview duale: `Em_Loc_tCO2e = Q × FE_Loc / 1000` e `Em_Mkt_tCO2e = Q × FE_Mkt / 1000`
* Warning specifici S2:
  * FE_Location fuori range plausibile [0.10, 0.60] kgCO2e/kWh
  * Voce='EE_Acquistata_GO' && FE_Market > 0 ("EE con GO ma FE Market > 0: verificare classificazione")
  * Unità ≠ kWh

### Tab "S3" — Catena del valore

Modal: `G.DM.S3EditModal`.

Campi:
* Anno, Categoria_S3 (dropdown 1..15 con nomi GHG Protocol), Sottocategoria,
  Metodo (Spend-based | Activity-based | Distance-based | Avg-data | Calculated)
* Combustibile, Quantità, Unità
* **Codice_FE** (lookup su `FE_ID` o `Codice_Voce`) con auto-complete
* Tabella ("Main" default — espandibile per varianti)
* Preview emissione + FE applicato

### Tab "FE" — Fattori di emissione

Component: `G.DM.FETab`. Modal: `G.DM.FEEditModal`.

Campi:
* FE_ID (es. `FE_GN_2024`), Famiglia (dropdown 6 famiglie), Codice_Voce,
  Descrizione, Anno_Validità, Valore (kgCO2e/unità), Unità, Gas, Fonte, Nota
* **"Nuova versione"**: bottone che clona un FE esistente in nuovo
  Anno_Validità (utile per onboarding nuovo anno).
* **Cascade-update on save**:
  ```js
  const saved = await G.db.upsert('fe', payload);
  const result = await G.db.cascadeFEUpdate(saved);
  // result = { s1: N_aggiornate, s3: N_aggiornate }
  G.ui.pushToast(`FE aggiornato · S1: ${result.s1} righe, S3: ${result.s3} righe`);
  ```
* `cascadeFEUpdate` chiama la RPC atomica `cascade_fe_update(fe_id, codice_voce, anno_validita)`
  che ricalcola tutte le righe S1/S3 che fanno riferimento a quel FE (per
  anno) in una transazione. Fallback non transazionale se DB legacy.

### Tab "Target" — Piano di Decarbonizzazione

Component: `G.DM.TargetsTab`. Modal: `G.DM.TargetsView`.

Campi editabili:
* `scope` (es. "Scope 1 + 2 Market-based")
* `baselineYear`, `baseline_tco2e`, `baseline_intensity` (kg/m²)
* `shortTermYear`, `shortTerm_tco2e`, `shortTerm_intensity`
* `longTermYear`, `longTerm_tco2e`, `longTerm_intensity`
* `s3_baseline_tco2e`, `s3_shortTerm_tco2e`, `s3_longTerm_tco2e` (opzionali)
* `alignment` (es. "Auto-allineato SBTi 1.5°C · European Climate Law")

Salva via `G.db.saveTargets(targets)` → `UPSERT INTO app_meta (key='targets', value=targets)`.
Merge runtime in `G.TARGETS` al successivo `loadAll`. Niente redeploy necessario.

## Componenti riusabili (`DataManager.shared.jsx`)

### `OnboardingCard`

Card mostrato in cima alla Gestione Dati se l'utente è admin e il dataset
è "vuoto" (criteri tipo: nessuna anagrafica oppure nessun produzione).
Guida l'utente a:
1. Aggiungere i siti (Anagrafiche)
2. Aggiungere produzione per anno (Produzione)
3. Inserire FE (se non già seed)
4. Inserire S1/S2/S3

### `ImportPreviewModal`

Modal di anteprima dopo `G.io.importExcel(file, existingData)`. Mostra:
* Summary per tabella: `{ new: N, updated: N, unchanged: N }`
* Lista righe con errori (bloccano commit) + warning (informativi)
* Checkbox "Importa solo righe valide" per skip-row su errore
* Bottoni "Conferma import" / "Annulla"

### `CloneYearModal`

Modal con due dropdown (anno sorgente, anno destinazione) + bottone "Clona".
Chiama `G.db.cloneYear(srcYear, dstYear)` che:

1. Per ogni tabella (S1, S2, S3, Produzione):
   - Carica righe dell'anno sorgente
   - Per ognuna, verifica se esiste già nel dst per stessa "chiave business"
     (es. per S1 = `codice_sito + categoria_s1 + combustibile`)
   - Se non esiste: clona la riga con:
     - Nuovo `id` (UUID auto-generato dal DB)
     - `anno = dstYear`
     - Campi FE/Em **azzerati a null** (vanno ri-applicati con FE nuovo anno)
     - `stato_dato = 'Provvisorio'` (forza la verifica)
2. Batch INSERT a chunk di 500 righe
3. Restituisce summary `{ perTable: {s1: {inserted, skipped, sourceRows}, …}, totalInserted, totalSkipped }`

Mostra il summary in toast al termine.

### `Field`

Wrapper consistente per label + input nei modali. Garantisce spacing
e style uniformi.

### `GenericTab`

Tab generico riusato per S1/S2/S3: mostra DataTable + bar import/export +
bottoni "+ Aggiungi" + modal edit specifico passato come prop.

### `LockBanner`

Banner giallo mostrato in cima al modal di edit se l'anno è bloccato e
role=editor.

### `COLUMNS`

Mapping che definisce le colonne della DataTable per ogni tab. Ogni
colonna ha `{ key, label?, mono?, align?, render? }`.

### `exportCSV(rows, filename)`

Export CSV utility. BOM UTF-8, separatore `;` (compat Excel IT), sanitize
via `G.sanitize.sanitizeForSpreadsheet` per anti-formula-injection.

### Style helper

Costanti riusate dai modali: `modalScrim`, `modalCard`, `titleStyle`,
`modalGrid`, `calcPanel`, `calcLabel`, `calcRow`, `calcResult`, `errBox`,
`warnBox`, `btnRow`, `feFillBtnStyle`.

### `QD_OPTS` / `SD_OPTS`

Array di opzioni per dropdown Qualità_Dato (P/S/E) e Stato_Dato
(Definitivo/Provvisorio/Stimato).

## Import / Export Excel

### Export

```js
G.io.exportExcel(data)
// produce ghg_data_YYYY-MM-DD.xlsx con 6 fogli:
// - Anagrafiche, Produzione, FE, S1, S2, S3
// (S3 materiality NO — è gestita dalla tab Materialità a parte)
```

Sanitize stringhe con `G.sanitize.sanitizeForSpreadsheet` (anti formula
injection: stringhe che iniziano con `=`, `+`, `-`, `@`, `\t`, `\r` vengono
prefissate con `'`).

### Export Template

```js
G.io.exportTemplate()
// produce ghg_template_YYYY-MM-DD.xlsx
// stesso schema dell'export ma con 1 riga di esempio per ogni foglio
// utile per onboarding nuovi anni/operatori
```

### Import (preview + commit)

```js
// 1) Preview
const result = await G.io.importExcel(file, existingData);
// result = {
//   perTable: {
//     s1: { new: 12, updated: 3, unchanged: 5, errors: [...], warnings: [...] },
//     s2: { ... },
//     ...
//   },
//   fileName: 'ghg_data_2025-03-01.xlsx',
//   totalRows: 95
// }

// 2) UI mostra ImportPreviewModal con result
// 3) Conferma utente
// 4) Commit
const committed = await G.io.commitImport(result, {
  skipRowsWithErrors: true,
  onProgress: (table, done, total) => updateProgressBar(table, done/total)
});
```

Validazione per riga:
* `G.calc.validateRow(table, row)` → `{ errors, warnings }`
* Cross-ref con `existingData`:
  * Codice_Sito esistente in anagrafiche?
  * `Codice_FE` esistente in fe (per S3)?
  * Anno non bloccato?

Hard limits:
* File ≤ 5 MB
* Solo `.xlsx` / `.xls`

Commit:
* Batch upsert via `G.db.batchUpsert(table, rows)`
* Skip-on-error per riga (se attivato dall'utente)
* Toast finale con summary

## Bulk delete

DataTable supporta multi-select via checkbox sulle righe (solo righe con
`id` UUID — Produzione e S3_materiality hanno PK diversa).

Header checkbox è tri-state (none/some/all). Sui "select all" si selezionano
tutte le righe **filtrate** (non l'intero dataset).

Banner sopra la tabella appare quando ci sono N selezionati:

```
[N selezionati]  [🗑 Elimina selezionati]  [✕ Deseleziona]
```

Click "Elimina selezionati" → confirm modal → `G.db.batchDelete(table, ids)`
che chunked-DELETE a 200 ids/chiamata per restare sotto i limiti di URL
length di PostgREST.

## Risorse

- [[Console-Interna]] — overview della console
- [[Modello-dati]] — tabelle e RLS sottostanti
- [[Sicurezza]] — MFA + year lock
