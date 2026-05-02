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
  //  Formule
  // ───────────────────────────────────────────────────────────────────
  function emS1 (quantita, fe) {
    return num(quantita) * num(fe) / 1000;
  }
  function emS2Loc (quantita, feLoc) {
    return num(quantita) * num(feLoc) / 1000;
  }
  function emS2Mkt (quantita, feMkt) {
    return num(quantita) * num(feMkt) / 1000;
  }
  function emS3 (quantita, fe) {
    return num(quantita) * num(fe) / 1000;
  }

  function num (v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const x = parseFloat(String(v).replace(',', '.'));
    return isFinite(x) ? x : 0;
  }

  // ───────────────────────────────────────────────────────────────────
  //  lookupFE(table, row, feData) → { fe, warn?, err? }
  // ───────────────────────────────────────────────────────────────────
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
  function validateRow (table, row) {
    const errors = [], warnings = [];
    const get = (k) => row[k] != null ? row[k] : row[k.toLowerCase()];

    if (table === 's1') {
      if (!get('Codice_Sito')) errors.push('Codice sito mancante');
      if (!get('Anno'))         errors.push('Anno mancante');
      if (!get('Categoria_S1')) errors.push('Categoria S1 mancante');
      if (num(get('Quantità')) < 0) errors.push('Quantità negativa');
    } else if (table === 's2') {
      if (!get('Codice_Sito')) errors.push('Codice sito mancante');
      if (!get('Anno'))         errors.push('Anno mancante');
      if (!get('Voce_S2'))      errors.push('Voce S2 mancante');
      if (num(get('Quantità')) < 0) errors.push('Quantità negativa');
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
  function intensity (totals, prod) {
    // totals: { em_total_tco2e } — già in tonnellate
    // prod:   { kg, m2 }
    const em = num(totals && totals.em_total_tco2e);
    const kg = num(prod && prod.kg);
    const m2 = num(prod && prod.m2);
    return {
      perKg: kg > 0 ? em * 1e6 / kg : null,   // g CO₂e / kg
      perM2: m2 > 0 ? em * 1e3 / m2 : null    // kg CO₂e / m²
    };
  }

  function intensityPerSite (s1Rows, s2Rows, prodRow) {
    // emissione di sito = S1 + S2_LB
    const em = (s1Rows || []).reduce((a, r) => a + num(r.Em_tCO2e || r.em_tco2e), 0)
             + (s2Rows || []).reduce((a, r) => a + num(r.Em_Loc_tCO2e || r.em_loc_tco2e), 0);
    const kg = num(prodRow && (prodRow.Produzione_kg || prodRow.produzione_kg));
    const m2 = num(prodRow && (prodRow.Produzione_m2 || prodRow.produzione_m2));
    return {
      em_total_tco2e: em,
      perKg: kg > 0 ? em * 1e6 / kg : null,
      perM2: m2 > 0 ? em * 1e3 / m2 : null
    };
  }

  // ───────────────────────────────────────────────────────────────────
  //  Aggregazioni
  // ───────────────────────────────────────────────────────────────────
  function totals (year, s1Rows, s2Rows, s3Rows) {
    const filtY = (a) => (a || []).filter(r => +(r.Anno || r.anno) === +year);
    const s1 = filtY(s1Rows).reduce((a,r) => a + num(r.Em_tCO2e || r.em_tco2e), 0);
    const s2lb = filtY(s2Rows).reduce((a,r) => a + num(r.Em_Loc_tCO2e || r.em_loc_tco2e), 0);
    const s2mb = filtY(s2Rows).reduce((a,r) => a + num(r.Em_Mkt_tCO2e || r.em_mkt_tco2e), 0);
    const s3 = filtY(s3Rows).reduce((a,r) => a + num(r.Em_tCO2e || r.em_tco2e), 0);
    return {
      s1, s2lb, s2mb, s3,
      em_total_tco2e: s1 + s2lb + s3
    };
  }

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
