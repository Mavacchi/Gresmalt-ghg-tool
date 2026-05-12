/* GHG Tool — calcoli & validazione (modulo unico)
 *
 * Esposto su window.GHG.calc.
 *  - emS1, emS2, emS3   formule emissione
 *  - lookupFE           lookup FE con fallback per anno
 *  - validateRow        validatore per s1/s2/s3/produzione/fe
 *  - intensity          intensità di gruppo e per sito
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});

  // ───────────────────────────────────────────────────────────────────
  //  Formule emissione: tCO₂e = Quantità × FE_kgCO₂e_per_unità / 1000
  // ───────────────────────────────────────────────────────────────────
  /** @param {number|string} quantita @param {number} fe @returns {number} tCO₂e */
  function emS1 (quantita, fe) {
    return num(quantita) * num(fe) / 1000;
  }
  /** @param {number|string} quantita @param {number} feLoc @returns {number} tCO₂e */
  function emS2Loc (quantita, feLoc) {
    return num(quantita) * num(feLoc) / 1000;
  }
  /** @param {number|string} quantita @param {number} feMkt @returns {number} tCO₂e */
  function emS2Mkt (quantita, feMkt) {
    return num(quantita) * num(feMkt) / 1000;
  }
  /** @param {number|string} quantita @param {number} fe @returns {number} tCO₂e */
  function emS3 (quantita, fe) {
    return num(quantita) * num(fe) / 1000;
  }

  /**
   * Parsing numerico resiliente: null/empty/NaN/Infinity → 0, virgola
   * decimale italiana ("12,5" → 12.5) accettata. Non gestisce sepa-
   * ratore migliaia: "1.234,5" sarebbe 1.0 (parseFloat si ferma al
   * 2° punto). Il template Excel non usa separatore migliaia.
   * @param {*} v @returns {number}
   */
  function num (v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const x = parseFloat(String(v).replace(',', '.'));
    return isFinite(x) ? x : 0;
  }

  // ───────────────────────────────────────────────────────────────────
  //  lookupFE(table, row, feData) → { fe, warn?, err? }
  // ───────────────────────────────────────────────────────────────────
  /**
   * Trova il fattore di emissione applicabile a una riga.
   * Match esatto su anno; fallback al più recente disponibile per quel
   * codice con warn (Δ=2 anni) o err (Δ>2 anni). Vedi typedef FE in
   * SupabaseDB.jsx.
   * @param {'s1'|'s2'|'s3'} table
   * @param {Object} row
   * @param {Array<Object>} feData
   * @returns {{fe: Object|null, warn?: string, err?: string}}
   */
  function lookupFE (table, row, feData) {
    if (!feData || !feData.length) return { fe: null, err: 'FE non disponibili' };
    const targetAnno = +row.Anno || +row.anno;
    let candidates = [];

    if (table === 's1' && row.Combustibile) {
      candidates = feData.filter(f =>
        (f.Codice_Voce || f.codice_voce) === row.Combustibile);
    } else if (table === 's3' && (row.Codice_FE || row.codice_fe)) {
      const code = row.Codice_FE || row.codice_fe;
      candidates = feData.filter(f =>
        (f.FE_ID || f.fe_id) === code ||
        (f.Codice_Voce || f.codice_voce) === code);
    }
    if (!candidates.length) return { fe: null, err: 'FE non trovato' };

    // Match esatto su anno
    const exact = candidates.find(f =>
      +(f.Anno_Validità || f.anno_validita) === targetAnno);
    if (exact) {
      return { fe: exact };
    }

    // Fallback al più recente disponibile per quel codice
    candidates.sort((a, b) =>
      (b.Anno_Validità || b.anno_validita || 0) - (a.Anno_Validità || a.anno_validita || 0));
    const fallback = candidates[0];
    const fAnno = +(fallback.Anno_Validità || fallback.anno_validita || 0);
    const delta = Math.abs(targetAnno - fAnno);

    if (delta <= 1) return { fe: fallback };
    if (delta === 2) return { fe: fallback, warn: `FE anno ${fAnno} usato per anno ${targetAnno}` };
    return { fe: fallback, err: `FE troppo vecchio: anno ${fAnno} per ${targetAnno} (Δ ${delta} anni)` };
  }

  // ───────────────────────────────────────────────────────────────────
  //  validateRow(table, row) → { errors: [], warnings: [] }
  // ───────────────────────────────────────────────────────────────────
  /**
   * Valida una riga prima dell'upsert. Errori bloccano il commit;
   * i warning sono informativi. Accetta sia chiavi App-named
   * (PascalCase con accenti) che DB-named (snake_case).
   * @param {'s1'|'s2'|'s3'|'fe'|'produzione'} table
   * @param {Object} row
   * @returns {{errors: string[], warnings: string[]}}
   */
  function validateRow (table, row) {
    const errors = [], warnings = [];
    // Accesso resiliente a entrambe le convenzioni di naming:
    //   App-named (PascalCase con accenti):  Quantità, Unità, Qualità_Dato
    //   DB-named (snake_case senza accenti): quantita, unita, qualita_dato
    // toLowerCase() da solo non basta per chiavi accentate
    // (es. 'Quantità'.toLowerCase() === 'quantità' ≠ 'quantita').
    const DB_KEYS = {
      'Quantità': 'quantita', 'Unità': 'unita',
      'Qualità_Dato': 'qualita_dato', 'Stato_Dato': 'stato_dato',
      'Anno_Validità': 'anno_validita'
    };
    const get = (k) => {
      if (row[k] != null) return row[k];
      const lower = k.toLowerCase();           // funziona per chiavi senza accento
      if (row[lower] != null) return row[lower];
      const dbKey = DB_KEYS[k];                // mapping esplicito per chiavi accentate
      if (dbKey && row[dbKey] != null) return row[dbKey];
      return undefined;
    };

    if (table === 's1') {
      if (!get('Codice_Sito')) errors.push('Codice sito mancante');
      if (!get('Anno'))         errors.push('Anno mancante');
      if (!get('Combustibile')) errors.push('Combustibile mancante');
      // Categoria_S1 non è più richiesta: il modal la imposta uguale al
      // Combustibile (alias), quindi se Combustibile c'è anche
      // Categoria_S1 c'è. Tenere il check qui avrebbe generato un
      // errore duplicato/ambiguo.
      if (num(get('Quantità')) < 0) errors.push('Quantità negativa');
    } else if (table === 's2') {
      if (!get('Codice_Sito')) errors.push('Codice sito mancante');
      if (!get('Anno'))         errors.push('Anno mancante');
      if (!get('Voce_S2'))      errors.push('Voce S2 mancante');
      if (num(get('Quantità')) < 0) errors.push('Quantità negativa');
      // Range plausibile FE Location: il check vale per tutte le righe
      // S2 (anche se Unità ≠ kWh — un FE fuori range va comunque
      // segnalato perché probabilmente è un input errato).
      const feLoc = num(get('FE_Location'));
      if (feLoc > 0 && (feLoc < 0.10 || feLoc > 0.60)) {
        warnings.push(`FE Location ${feLoc} kgCO₂e/kWh fuori range plausibile [0.10, 0.60]`);
      }
      if (get('Voce_S2') === 'EE_Acquistata_GO' && num(get('FE_Market')) > 0) {
        warnings.push('EE con GO ma FE Market > 0: verificare la classificazione');
      }
      if (get('Unità') && get('Unità') !== 'kWh') {
        warnings.push(`Unità ${get('Unità')} ≠ kWh per voce S2`);
      }
    } else if (table === 's3') {
      const cat = +get('Categoria_S3');
      if (!cat || cat < 1 || cat > 15) errors.push('Categoria S3 ∈ [1,15]');
      if (!get('Anno')) errors.push('Anno mancante');
      if (num(get('Quantità')) < 0) errors.push('Quantità negativa');
    } else if (table === 'fe') {
      if (!get('FE_ID') && !get('Codice_Voce')) errors.push('FE_ID o Codice_Voce richiesto');
      if (num(get('Valore')) < 0) errors.push('Valore negativo');
    } else if (table === 'produzione') {
      if (!get('Codice_Sito')) errors.push('Codice sito mancante');
      if (!get('Anno'))         errors.push('Anno mancante');
      const kg = num(get('Produzione_kg'));
      const m2 = num(get('Produzione_m2'));
      if (kg < 0 || m2 < 0) errors.push('Valori di produzione non possono essere negativi');
      if (kg <= 0 && m2 <= 0) errors.push('Almeno uno tra kg e m² deve essere > 0');
      if (kg > 0 && m2 <= 0) warnings.push('kg presente ma m² mancante: intensità per m² non calcolabile');
      if (m2 > 0 && kg <= 0) warnings.push('m² presente ma kg mancante: intensità per kg non calcolabile');
    }
    return { errors, warnings };
  }

  // ───────────────────────────────────────────────────────────────────
  //  Intensità di gruppo & per sito
  // ───────────────────────────────────────────────────────────────────
  /**
   * Intensità di gruppo: kgCO₂e per kg/m² di prodotto.
   * @param {{em_total_tco2e: number}} totals
   * @param {{kg: number, m2: number}} prod
   * @returns {{perKg: number|null, perM2: number|null}}
   */
  function intensity (totals, prod) {
    // totals: { em_total_tco2e } — emissioni in tonnellate
    // prod:   { kg, m2 }       — volumi assoluti
    // Output: kgCO₂e per unità di prodotto (sia kg sia m²),
    // unità coerente con il resto del tool.
    const em = num(totals && totals.em_total_tco2e);
    const kg = num(prod && prod.kg);
    const m2 = num(prod && prod.m2);
    return {
      perKg: kg > 0 ? em * 1000 / kg : null,   // kgCO₂e / kg (era ×1e6 = g/kg)
      perM2: m2 > 0 ? em * 1000 / m2 : null    // kgCO₂e / m²
    };
  }

  /**
   * Intensità per singolo sito. S3 escluso (organizzativo).
   * @param {Array<Object>} s1Rows
   * @param {Array<Object>} s2Rows
   * @param {Object} prodRow
   * @param {{s2Method?: 'lb'|'mb'}} [opts]  default 'lb' (back-compat)
   * @returns {{em_total_tco2e: number, perKg: number|null, perM2: number|null}}
   */
  function intensityPerSite (s1Rows, s2Rows, prodRow, opts) {
    const isMB = opts && opts.s2Method === 'mb';
    const s2Field = isMB ? 'Em_Mkt_tCO2e' : 'Em_Loc_tCO2e';
    const s2FieldLow = isMB ? 'em_mkt_tco2e' : 'em_loc_tco2e';
    const em = (s1Rows || []).reduce((a, r) => a + num(r.Em_tCO2e || r.em_tco2e), 0)
             + (s2Rows || []).reduce((a, r) => a + num(r[s2Field] || r[s2FieldLow]), 0);
    const kg = num(prodRow && (prodRow.Produzione_kg || prodRow.produzione_kg));
    const m2 = num(prodRow && (prodRow.Produzione_m2 || prodRow.produzione_m2));
    return {
      em_total_tco2e: em,
      perKg: kg > 0 ? em * 1000 / kg : null,
      perM2: m2 > 0 ? em * 1000 / m2 : null
    };
  }

  // ───────────────────────────────────────────────────────────────────
  //  Aggregazioni
  // ───────────────────────────────────────────────────────────────────
  /**
   * Totale emissioni per anno. em_total_tco2e usa S2 LB (default GHG
   * Protocol storico per intensità). Per il MB: t.s1 + t.s2mb + t.s3.
   * @param {number} year
   * @param {Array<Object>} s1Rows
   * @param {Array<Object>} s2Rows
   * @param {Array<Object>} s3Rows
   * @param {{site?: string}} [opts]  opts.site filtra S1/S2 per Codice_Sito; S3=0 (organizzativo)
   * @returns {{s1: number, s2lb: number, s2mb: number, s3: number, em_total_tco2e: number}}
   */
  function totals (year, s1Rows, s2Rows, s3Rows, opts) {
    const site = opts && opts.site;
    const filtY = (a) => (a || []).filter(r => {
      if (+(r.Anno || r.anno) !== +year) return false;
      if (site && (r.Codice_Sito || r.codice_sito) !== site) return false;
      return true;
    });
    const s1 = filtY(s1Rows).reduce((a,r) => a + num(r.Em_tCO2e || r.em_tco2e), 0);
    const s2lb = filtY(s2Rows).reduce((a,r) => a + num(r.Em_Loc_tCO2e || r.em_loc_tco2e), 0);
    const s2mb = filtY(s2Rows).reduce((a,r) => a + num(r.Em_Mkt_tCO2e || r.em_mkt_tco2e), 0);
    // S3 non ha Codice_Sito — se si filtra per sito, S3 = 0
    const s3 = site ? 0 : (s3Rows || [])
      .filter(r => +(r.Anno || r.anno) === +year)
      .reduce((a,r) => a + num(r.Em_tCO2e || r.em_tco2e), 0);
    return {
      s1, s2lb, s2mb, s3,
      em_total_tco2e: s1 + s2lb + s3
    };
  }

  /**
   * Anni disponibili in uno o più array di righe, dedup, sort desc.
   * @param {...Array<Object>} arrs
   * @returns {number[]}
   */
  function availableYears (...arrs) {
    const set = new Set();
    arrs.forEach(arr => (arr || []).forEach(r => {
      const y = +(r.Anno || r.anno);
      if (y && isFinite(y)) set.add(y);
    }));
    return Array.from(set).sort((a,b) => b - a);
  }

  G.calc = {
    emS1, emS2Loc, emS2Mkt, emS3,
    lookupFE, validateRow,
    intensity, intensityPerSite,
    totals, availableYears, num
  };
})(typeof window !== 'undefined' ? window : globalThis);
