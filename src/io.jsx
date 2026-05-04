/* GHG Tool — io.jsx
 *
 * Import/Export Excel (SheetJS) e PPTX (pptxgenjs) lazy-loaded da CDN
 * con SRI integrity (gli hash sono calcolati a build-time da
 * build.mjs e iniettati come __SHEETJS_SRI__ / __PPTXGENJS_SRI__).
 *
 * Espone su window.GHG.io:
 *   exportExcel(data)         — 6 fogli: anagrafiche, produzione, fe, s1, s2, s3
 *   importExcel(file)         — torna { preview: { new, updated, unchanged } }
 *                               L'import effettivo è scelto dall'utente
 *                               via la preview (commitImport).
 *   commitImport(preview)     — esegue gli upsert sul DB, rispettando le
 *                               policy RLS (admin/editor only).
 *   exportPPTX(data, year)    — slide deck "Sustainability Report"
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const SHEETJS_VERSION = '__SHEETJS_VERSION__';
  const PPTXGENJS_VERSION = '__PPTXGENJS_VERSION__';
  const SHEETJS_SRI = '__SHEETJS_SRI__';
  const PPTXGENJS_SRI = '__PPTXGENJS_SRI__';

  const sanitize = () =>
    (G.sanitize && G.sanitize.sanitizeForSpreadsheet) || (v => v);

  // ────────────────────────────────────────────────────────────────────
  //  Lazy script loader con SRI
  // ────────────────────────────────────────────────────────────────────
  const _loaded = {};
  function loadScript (url, integrity) {
    if (_loaded[url]) return _loaded[url];
    _loaded[url] = new Promise((resolve, reject) => {
      const sc = root.document.createElement('script');
      sc.src = url;
      sc.async = true;
      sc.crossOrigin = 'anonymous';
      if (integrity && !integrity.startsWith('__')) sc.integrity = integrity;
      sc.onload = () => resolve();
      sc.onerror = () => {
        delete _loaded[url];
        reject(new Error('Caricamento fallito: ' + url));
      };
      root.document.head.appendChild(sc);
    });
    return _loaded[url];
  }

  async function loadSheetJS () {
    if (root.XLSX) return root.XLSX;
    const url = `https://cdn.sheetjs.com/xlsx-${SHEETJS_VERSION}/package/dist/xlsx.full.min.js`;
    await loadScript(url, SHEETJS_SRI);
    if (!root.XLSX) throw new Error('SheetJS non caricato');
    return root.XLSX;
  }

  async function loadPptxgen () {
    if (root.PptxGenJS) return root.PptxGenJS;
    const url = `https://cdn.jsdelivr.net/npm/pptxgenjs@${PPTXGENJS_VERSION}/dist/pptxgen.bundle.js`;
    await loadScript(url, PPTXGENJS_SRI);
    if (!root.PptxGenJS) throw new Error('pptxgenjs non caricato');
    return root.PptxGenJS;
  }

  // ────────────────────────────────────────────────────────────────────
  //  Excel Export
  // ────────────────────────────────────────────────────────────────────
  async function exportExcel (data) {
    const XLSX = await loadSheetJS();
    const safe = sanitize();
    const wb = XLSX.utils.book_new();

    function sheet (name, rows) {
      if (!rows || rows.length === 0) {
        const ws = XLSX.utils.aoa_to_sheet([['(nessun dato)']]);
        XLSX.utils.book_append_sheet(wb, ws, name);
        return;
      }
      // Sanitize stringhe
      const cleaned = rows.map(r => {
        const o = {};
        for (const k of Object.keys(r)) {
          o[k] = typeof r[k] === 'string' ? safe(r[k]) : r[k];
        }
        return o;
      });
      const ws = XLSX.utils.json_to_sheet(cleaned);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }

    sheet('Anagrafiche', data.anagrafiche || []);
    sheet('Produzione',  data.produzione  || []);
    sheet('FE',          data.fe          || []);
    sheet('S1',          data.s1          || []);
    sheet('S2',          data.s2          || []);
    sheet('S3',          data.s3          || []);

    const filename = `ghg_data_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    return { filename, sheets: 6 };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Excel Template — file con headers per ogni tabella + 1 riga di
  //  esempio. Per onboarding nuovi anni o nuovi operatori.
  // ────────────────────────────────────────────────────────────────────
  async function exportTemplate () {
    const XLSX = await loadSheetJS();
    const wb = XLSX.utils.book_new();

    // Headers per tabella, allineati ai nomi App-style usati dal tool.
    // Ogni foglio inizia con una riga di esempio commentata che si può
    // sovrascrivere o cancellare.
    const TEMPLATES = {
      anagrafiche: [{
        Codice_Sito: 'IANO', Nome_Sito: 'Iano', Tipologia: 'Stabilimento produttivo',
        Presenza_CHP: false, Regime_ETS: true, Note_Produzione: ''
      }],
      produzione: [{
        Codice_Sito: 'IANO', Anno: new Date().getFullYear(),
        Produzione_kg: 0, Produzione_m2: 0, Note: ''
      }],
      fe: [{
        FE_ID: 'FE_GN_2025', Famiglia: 'Combustibili',
        Codice_Voce: 'Gas_Naturale', Descrizione: 'Gas naturale combustione',
        Anno_Validità: new Date().getFullYear(),
        Valore: 1.978, Unità: 'kgCO2e/Sm3', Gas: 'CO2e',
        Fonte: 'ISPRA', Nota: ''
      }],
      s1: [{
        Anno: new Date().getFullYear(), Codice_Sito: 'IANO',
        Categoria_S1: 'Combustione_Stazionaria', Combustibile: 'Gas_Naturale',
        Quantità: 0, Unità: 'Sm3', Fonte_Dato: 'Bolletta',
        Qualità_Dato: 'P', Stato_Dato: 'Definitivo', Note: '',
        FE_Valore: null, Em_tCO2e: null
      }],
      s2: [{
        Anno: new Date().getFullYear(), Codice_Sito: 'IANO',
        Voce_S2: 'EE_Acquistata', Quantità: 0, Unità: 'kWh',
        Strumento_MB: '', Fonte_Dato: 'Bolletta',
        Qualità_Dato: 'P', Stato_Dato: 'Definitivo', Note: '',
        FE_Location: 0.272, FE_Market: 0.452,
        Em_Loc_tCO2e: null, Em_Mkt_tCO2e: null
      }],
      s3: [{
        Anno: new Date().getFullYear(), Categoria_S3: 1,
        Sottocategoria: 'Materie prime', Metodo: 'Activity-based',
        Combustibile: '', Quantità: 0, Unità: 'kg',
        Codice_FE: '', Fonte_Dato: 'Fornitore',
        Qualità_Dato: 'S', Stato_Dato: 'Provvisorio', Note: '',
        FE_Valore: null, Em_tCO2e: null, Tabella: 'Main'
      }]
    };

    Object.entries(TEMPLATES).forEach(([name, rows]) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      // Imposta una larghezza colonna ragionevole
      ws['!cols'] = Object.keys(rows[0]).map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    });

    const filename = `ghg_template_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    return { filename, sheets: Object.keys(TEMPLATES).length };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Excel Import — anteprima diff
  //  Hard limits: 5 MB max, solo .xlsx/.xls
  // ────────────────────────────────────────────────────────────────────
  // importExcel(file, [existingData])
  //   existingData (opzionale): snapshot del DB corrente per
  //   cross-validazione (sito esiste, FE esiste, anno non bloccato…).
  //   Se omesso, validazione solo intra-file.
  async function importExcel (file, existingData) {
    if (!file) throw new Error('Nessun file selezionato');
    if (file.size > 5 * 1024 * 1024) throw new Error('File > 5 MB rifiutato');
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Solo file .xlsx o .xls');

    const XLSX = await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const TABLES = ['anagrafiche','produzione','fe','s1','s2','s3'];
    const result = { perTable: {}, fileName: file.name, totalRows: 0 };

    // Pre-load: anagrafiche e FE da combinare (file + DB) per ref check
    const sheetRows = {};
    for (const t of TABLES) {
      const sheetName = wb.SheetNames.find(n => n.toLowerCase() === t.toLowerCase());
      sheetRows[t] = sheetName
        ? XLSX.utils.sheet_to_json(wb.Sheets[sheetName])
        : null;
    }

    // Build cross-ref context: siti noti (file + DB), FE codes (file + DB)
    const ctx = buildImportCtx(sheetRows, existingData);

    for (const t of TABLES) {
      if (sheetRows[t] === null) {
        result.perTable[t] = {
          rows: [], validations: [],
          summary: { total: 0, ok: 0, withErrors: 0, withWarnings: 0 },
          note: 'foglio mancante'
        };
        continue;
      }
      const rows = sheetRows[t];
      const validations = rows.map((r, idx) => {
        const v = validateImportRow(t, r, ctx);
        return { idx: idx + 2, row: r, errors: v.errors, warnings: v.warnings };
      });
      const withErrors   = validations.filter(v => v.errors.length).length;
      const withWarnings = validations.filter(v => v.warnings.length).length;
      result.perTable[t] = {
        rows, validations,
        summary: { total: rows.length, ok: rows.length - withErrors,
                   withErrors, withWarnings },
        note: `${rows.length} righe lette`
      };
      result.totalRows += rows.length;
    }
    return result;
  }

  function buildImportCtx (sheetRows, existingData) {
    const sites = new Set();
    const feCodes = new Set();   // accetta sia FE_ID sia Codice_Voce
    const lockedYears = new Set();

    // Da DB esistente
    if (existingData) {
      (existingData.anagrafiche || []).forEach(a =>
        sites.add(a.Codice_Sito || a.codice_sito));
      (existingData.fe || []).forEach(f => {
        if (f.FE_ID || f.fe_id)              feCodes.add(f.FE_ID || f.fe_id);
        if (f.Codice_Voce || f.codice_voce)  feCodes.add(f.Codice_Voce || f.codice_voce);
      });
      const ly = existingData.app_meta && existingData.app_meta.locked_years;
      if (Array.isArray(ly)) ly.forEach(y => lockedYears.add(+y));
    }
    // Da file (in arrivo): anche queste rendono valida la riga riferita
    (sheetRows.anagrafiche || []).forEach(a => sites.add(a.Codice_Sito));
    (sheetRows.fe || []).forEach(f => {
      if (f.FE_ID)       feCodes.add(f.FE_ID);
      if (f.Codice_Voce) feCodes.add(f.Codice_Voce);
    });
    return { sites, feCodes, lockedYears };
  }

  // Validazione: campi base via G.calc.validateRow + cross-ref con ctx.
  function validateImportRow (table, row, ctx) {
    let result = { errors: [], warnings: [] };
    if (table === 'anagrafiche') {
      const get = (k) => row[k] != null ? row[k] : row[k.toLowerCase()];
      if (!get('Codice_Sito')) result.errors.push('Codice_Sito mancante');
      if (!get('Nome_Sito'))   result.errors.push('Nome_Sito mancante');
    } else if (G.calc && G.calc.validateRow) {
      result = G.calc.validateRow(table, row);
    }

    if (!ctx) return result;

    const get = (k) => row[k] != null ? row[k] : row[k.toLowerCase()];

    // Cross-ref: sito esiste (s1, s2, produzione)
    if (['s1','s2','produzione'].includes(table)) {
      const site = get('Codice_Sito');
      if (site && !ctx.sites.has(site)) {
        result.errors.push(`Sito '${site}' non in anagrafiche (file o DB)`);
      }
    }

    // Cross-ref: FE esiste (s1.Combustibile, s3.Codice_FE)
    if (table === 's1') {
      const comb = get('Combustibile');
      if (comb && ctx.feCodes.size > 0 && !ctx.feCodes.has(comb)) {
        result.warnings.push(`Combustibile '${comb}' non trovato nei FE — valore em_tco2e potrebbe essere null`);
      }
    }
    if (table === 's3') {
      const cf = get('Codice_FE');
      if (cf && ctx.feCodes.size > 0 && !ctx.feCodes.has(cf)) {
        result.warnings.push(`Codice_FE '${cf}' non trovato nei FE — valore em_tco2e potrebbe essere null`);
      }
    }

    // Cross-ref: anno bloccato (S1/S2/S3/produzione)
    if (['s1','s2','s3','produzione'].includes(table)) {
      const yr = +(get('Anno') || 0);
      if (yr && ctx.lockedYears.has(yr)) {
        result.warnings.push(`Anno ${yr} bloccato — solo admin può importare in questo anno`);
      }
    }

    return result;
  }

  // Auto-calc em / FE_Valore per righe S1/S2/S3 in cui sono null.
  // Senza questo step, un import "minimale" (solo quantità +
  // combustibile/codice_fe) inserirebbe righe con em_tco2e null,
  // facendole sparire da tutti gli aggregati. Viene fatto qui
  // (commit time) e non in importExcel (preview) per non gonfiare
  // la preview con campi calcolati.
  function enrichForUpsert (table, rows, fePool) {
    if (!fePool) return rows;
    const calc = G.calc;
    if (!calc) return rows;
    const num = calc.num;
    // Em è SEMPRE derivato da Q × FE / 1000 quando i due input sono
    // disponibili (la formula è canonica). Eventuali Em pre-esistenti
    // nel file di import vengono sovrascritti per garantire consistenza
    // numerica con FE applicato. Se l'utente vuole un Em "custom" deve
    // forzare un FE_Valore tale che Q × FE = Em desiderato.
    // Solo righe SENZA quantità mantengono l'Em pre-esistente (non si
    // può ricalcolare).
    return rows.map(r => {
      const out = { ...r };
      const q = num(out.Quantità);
      if (table === 's1' || table === 's3') {
        // FE viene da FE_Valore se fornito, altrimenti da lookup.
        let fv = (out.FE_Valore != null && out.FE_Valore !== '')
          ? num(out.FE_Valore) : null;
        if (fv == null) {
          const lk = calc.lookupFE(table, out, fePool);
          if (lk.fe) fv = num(lk.fe.Valore);
        }
        if (fv != null) {
          out.FE_Valore = fv;
          if (q > 0 || (out.Em_tCO2e == null || out.Em_tCO2e === '')) {
            out.Em_tCO2e = q * fv / 1000;
          }
        }
      } else if (table === 's2') {
        if (out.FE_Location != null && out.FE_Location !== ''
            && (q > 0 || (out.Em_Loc_tCO2e == null || out.Em_Loc_tCO2e === ''))) {
          out.Em_Loc_tCO2e = q * num(out.FE_Location) / 1000;
        }
        if (out.FE_Market != null && out.FE_Market !== ''
            && (q > 0 || (out.Em_Mkt_tCO2e == null || out.Em_Mkt_tCO2e === ''))) {
          out.Em_Mkt_tCO2e = q * num(out.FE_Market) / 1000;
        }
      }
      return out;
    });
  }

  // Commit con skip righe errate + fallback per-riga su errore batch:
  // se la batchUpsert intera fallisce (es. RLS lock anno, vincolo DB),
  // ritenta riga-per-riga per poter localizzare l'errore esatto.
  // existingData (opzionale): per arricchire le righe S1/S2/S3 con
  // FE lookup + em calcolata, ricavando il pool FE da DB+import file.
  async function commitImport (preview, existingData) {
    if (!preview || !preview.perTable) throw new Error('Anteprima non valida');
    const role = root.__GHG_ROLE || 'viewer';
    if (!G.can.edit(role)) throw new Error('Permesso negato (admin/editor)');

    // Pool FE per auto-calc: combina FE già nel DB + FE in import.
    // Se l'utente importa nuovi FE insieme a S1/S3, il calc trova
    // anche quelli (anche se non ancora nel DB).
    const importedFe = (preview.perTable.fe && preview.perTable.fe.rows) || [];
    const dbFe = (existingData && existingData.fe) || [];
    const fePool = [...dbFe, ...importedFe];

    const stats = {
      inserted: 0, skippedErrors: 0, dbErrors: 0,
      perTable: {}
    };
    for (const [table, payload] of Object.entries(preview.perTable)) {
      const rows = payload.rows || [];
      const vals = payload.validations || [];
      if (!rows.length) continue;

      // Filtra le righe valide (senza errori di validazione)
      const validIdx = vals.map((v, i) => v.errors.length === 0 ? i : -1)
                          .filter(i => i >= 0);
      const skipped = rows.length - validIdx.length;
      stats.skippedErrors += skipped;
      if (!validIdx.length) {
        stats.perTable[table] = { inserted: 0, skipped, dbErrors: 0 };
        continue;
      }

      // Arricchimento: solo per s1/s2/s3
      const baseRows = validIdx.map(i => rows[i]);
      const validRows = ['s1','s2','s3'].includes(table)
        ? enrichForUpsert(table, baseRows, fePool)
        : baseRows;

      let inserted = 0;
      let dbErrs = [];
      try {
        await G.db.batchUpsert(table, validRows);
        inserted = validRows.length;
      } catch (_batchErr) {
        // Fallback per-riga per identificare il colpevole.
        for (let k = 0; k < validRows.length; k++) {
          try {
            await G.db.upsert(table, validRows[k]);
            inserted++;
          } catch (e) {
            dbErrs.push({
              idx: vals[validIdx[k]].idx,
              msg: e.message || String(e)
            });
          }
        }
      }
      stats.inserted += inserted;
      stats.dbErrors += dbErrs.length;
      stats.perTable[table] = {
        inserted, skipped,
        dbErrors: dbErrs.length, dbErrorRows: dbErrs
      };
    }
    return stats;
  }

  // ────────────────────────────────────────────────────────────────────
  //  PPTX Export — 6 slide
  // ────────────────────────────────────────────────────────────────────
  async function exportPPTX (data, year) {
    const PptxGenJS = await loadPptxgen();
    const C = G.COLORS;
    const tot = G.calc.totals(year, data.s1, data.s2, data.s3);
    const prod = (data.produzione || []).filter(p => +(p.Anno || p.anno) === +year);
    const totProd = prod.reduce((a, p) => ({
      kg: a.kg + G.calc.num(p.Produzione_kg || p.produzione_kg),
      m2: a.m2 + G.calc.num(p.Produzione_m2 || p.produzione_m2)
    }), { kg: 0, m2: 0 });
    const intCur = G.calc.intensity(tot, totProd);

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 inch

    // Slide 1: Cover — titolo localizzato (fallback IT)
    const lang = (() => {
      try { return root.localStorage.getItem('ghg_lang') || 'it'; }
      catch (_) { return 'it'; }
    })();
    const titleStr = lang === 'en'
      ? 'GHG Emissions Inventory'
      : 'Inventario emissioni GHG';
    const subtitleStr = lang === 'en'
      ? `${year} inventory · GHG Protocol Corporate Standard`
      : `Inventario ${year} · GHG Protocol Corporate Standard`;
    const s1 = pptx.addSlide();
    s1.background = { color: C.brand.replace('#','') };
    s1.addText(titleStr, {
      x: 0.5, y: 2.5, w: 12.3, h: 1, color: 'FFFFFF',
      fontSize: 44, bold: true, fontFace: 'Sora'
    });
    s1.addText(subtitleStr, {
      x: 0.5, y: 3.6, w: 12.3, h: 0.6, color: C.cream.replace('#',''),
      fontSize: 18, fontFace: 'Sora'
    });
    s1.addText('Gruppo Ceramiche Gresmalt', {
      x: 0.5, y: 6.5, w: 12.3, h: 0.5, color: 'FFFFFF',
      fontSize: 12, fontFace: 'Sora'
    });

    // Slide 2: KPI strip
    const s2 = pptx.addSlide();
    s2.addText('Inventario in sintesi', { x: 0.5, y: 0.4, fontSize: 24, bold: true, fontFace: 'Sora' });
    const kpis = [
      ['Totale LB', `${fmt(tot.em_total_tco2e, 0)} tCO₂e`],
      ['Scope 1', `${fmt(tot.s1, 0)} tCO₂e`],
      ['Scope 2 LB', `${fmt(tot.s2lb, 0)} tCO₂e`],
      ['Scope 3', `${fmt(tot.s3, 0)} tCO₂e`],
      ['Intensità m²', intCur.perM2 != null ? `${intCur.perM2.toFixed(2)} kgCO₂e/m²` : 'n.d.'],
      ['Intensità kg', intCur.perKg != null ? `${intCur.perKg.toFixed(2)} kgCO₂e/kg` : 'n.d.']
    ];
    kpis.forEach((k, i) => {
      const row = Math.floor(i / 3), col = i % 3;
      const x = 0.5 + col * 4.3, y = 1.4 + row * 2.5;
      s2.addShape('rect', {
        x, y, w: 4, h: 2,
        fill: { color: 'FFFFFF' },
        line: { color: C.border.replace('#',''), width: 1 }
      });
      s2.addText(k[0], {
        x: x + 0.2, y: y + 0.2, w: 3.6, h: 0.4,
        fontSize: 11, color: C.textMid.replace('#',''),
        bold: true, fontFace: 'Sora'
      });
      s2.addText(k[1], {
        x: x + 0.2, y: y + 0.8, w: 3.6, h: 0.8,
        fontSize: 24, color: C.brand.replace('#',''),
        bold: true, fontFace: 'Sora'
      });
    });

    // Slide 3: Scope breakdown
    const s3sl = pptx.addSlide();
    s3sl.addText('Composizione delle emissioni', { x: 0.5, y: 0.4, fontSize: 24, bold: true, fontFace: 'Sora' });
    const totalAll = tot.s1 + tot.s2lb + tot.s3 || 1;
    s3sl.addChart(pptx.ChartType.doughnut, [{
      name: 'Scope', labels: ['Scope 1', 'Scope 2 LB', 'Scope 3'],
      values: [tot.s1, tot.s2lb, tot.s3]
    }], {
      x: 1, y: 1.5, w: 5, h: 5,
      chartColors: [C.s1.replace('#',''), C.s2loc.replace('#',''), C.s3.replace('#','')],
      showLegend: true, legendPos: 'r', dataLabelFormatCode: '0.0"%"',
      showPercent: true
    });
    s3sl.addText([
      { text: `Scope 1: ${(tot.s1/totalAll*100).toFixed(1)}%\n`, options: { color: C.s1.replace('#','') } },
      { text: `Scope 2 LB: ${(tot.s2lb/totalAll*100).toFixed(1)}%\n`, options: { color: C.s2loc.replace('#','') } },
      { text: `Scope 3: ${(tot.s3/totalAll*100).toFixed(1)}%`, options: { color: C.s3.replace('#','') } }
    ], { x: 7, y: 2.5, w: 5, h: 3, fontSize: 18, fontFace: 'Sora', bold: true });

    // Slide 4: Trend
    const s4 = pptx.addSlide();
    s4.addText('Trend annuale', { x: 0.5, y: 0.4, fontSize: 24, bold: true, fontFace: 'Sora' });
    const allYears = G.calc.availableYears(data.s1, data.s2, data.s3, data.produzione)
      .slice(0, 5).reverse();
    const trend = allYears.map(y => G.calc.totals(y, data.s1, data.s2, data.s3).em_total_tco2e);
    s4.addChart(pptx.ChartType.line, [{
      name: 'tCO₂e LB', labels: allYears, values: trend
    }], {
      x: 0.5, y: 1.5, w: 12, h: 5,
      chartColors: [C.brand.replace('#','')],
      showLegend: false, lineSize: 3, lineSmooth: false
    });

    // Slide 5: S3 per categoria
    const s5 = pptx.addSlide();
    s5.addText('Scope 3 per categoria', { x: 0.5, y: 0.4, fontSize: 24, bold: true, fontFace: 'Sora' });
    const s3Agg = {};
    (data.s3 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = +(r.Categoria_S3 || r.categoria_s3);
      s3Agg[k] = (s3Agg[k] || 0) + G.calc.num(r.Em_tCO2e || r.em_tco2e);
    });
    const s3Sorted = Object.entries(s3Agg).sort((a,b) => b[1] - a[1]);
    s5.addChart(pptx.ChartType.bar, [{
      name: 'tCO₂e', labels: s3Sorted.map(([k]) => `Cat ${k}`),
      values: s3Sorted.map(([_, v]) => v)
    }], {
      x: 0.5, y: 1.5, w: 12, h: 5, chartColors: [C.s3.replace('#','')],
      showLegend: false, barDir: 'bar'
    });

    // Slide 6: Note metodologiche
    const s6 = pptx.addSlide();
    s6.background = { color: C.cream.replace('#','') };
    s6.addText('Note metodologiche', { x: 0.5, y: 0.4, fontSize: 24, bold: true, fontFace: 'Sora' });
    s6.addText([
      { text: 'Standard adottato\n', options: { bold: true, fontSize: 14 } },
      { text: 'GHG Protocol Corporate Accounting and Reporting Standard.\n\n', options: { fontSize: 12 } },
      { text: 'Boundary\n', options: { bold: true, fontSize: 14 } },
      { text: 'Controllo operativo · 7 siti del Gruppo.\n\n', options: { fontSize: 12 } },
      { text: 'Fattori emissivi\n', options: { bold: true, fontSize: 14 } },
      { text: 'Combustibili: NIR · Min. Ambiente · ETS · ISPRA. Elettricità: AIB · Terna. (Versioni tracciate in FE Explorer.)\n\n', options: { fontSize: 12 } },
      { text: 'Categorie Scope 3\n', options: { bold: true, fontSize: 14 } },
      { text: 'Vedi tabella di Materialità nel report dettagliato.', options: { fontSize: 12 } }
    ], {
      x: 0.5, y: 1.3, w: 12, h: 5.5, fontFace: 'Sora',
      color: C.text.replace('#','')
    });

    const filename = `ghg_report_${year}_${new Date().toISOString().slice(0,10)}.pptx`;
    await pptx.writeFile({ fileName: filename });
    return { filename };
  }

  // ────────────────────────────────────────────────────────────────────
  //  ZIP STORE encoder (zero-dep)
  //  Wikipedia ref: ZIP file format. Solo metodo 0 (store, no compres-
  //  sione): per un backup è OK — XLSX è già compresso internamente,
  //  JSON/TXT sono piccoli. Niente JSZip/CDN script da caricare.
  // ────────────────────────────────────────────────────────────────────
  let _crc32Table;
  function crc32 (bytes) {
    if (!_crc32Table) {
      _crc32Table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        _crc32Table[i] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = _crc32Table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeZip (entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name);
      const data = e.data;
      const crc  = crc32(data);
      const size = data.length;
      const lh = new Uint8Array(30 + name.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);            // method=0 store
      dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);  // dos time/date
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh);
      parts.push(data);
      const ch = new Uint8Array(46 + name.length);
      const cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0, true);  cdv.setUint16(10, 0, true);
      cdv.setUint16(12, 0, true); cdv.setUint16(14, 0, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true); cdv.setUint32(24, size, true);
      cdv.setUint16(28, name.length, true);
      cdv.setUint16(30, 0, true); cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true); cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const cdOffset = offset;
    for (const c of central) parts.push(c);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    ev.setUint16(20, 0, true);
    parts.push(eocd);
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    return out;
  }

  // ────────────────────────────────────────────────────────────────────
  //  exportBackup — ZIP completo lato client (disaster recovery utente)
  //  Contiene:
  //   - data.xlsx       (stessi 6 fogli di exportExcel)
  //   - metadata.json   (versione schema, anno export, conteggi,
  //                      app_meta, materialità S3 — non in xlsx)
  //   - README.txt      (cosa c'è dentro + come ripristinare)
  // ────────────────────────────────────────────────────────────────────
  async function exportBackup (data) {
    const XLSX = await loadSheetJS();
    const safe = sanitize();
    const wb = XLSX.utils.book_new();
    const sheet = (name, rows) => {
      if (!rows || rows.length === 0) {
        XLSX.utils.book_append_sheet(wb,
          XLSX.utils.aoa_to_sheet([['(nessun dato)']]), name);
        return;
      }
      const cleaned = rows.map(r => {
        const o = {};
        for (const k of Object.keys(r)) {
          o[k] = typeof r[k] === 'string' ? safe(r[k]) : r[k];
        }
        return o;
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cleaned), name);
    };
    sheet('Anagrafiche', data.anagrafiche || []);
    sheet('Produzione',  data.produzione  || []);
    sheet('FE',          data.fe          || []);
    sheet('S1',          data.s1          || []);
    sheet('S2',          data.s2          || []);
    sheet('S3',          data.s3          || []);
    const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const xlsxBytes = new Uint8Array(xlsxBuf);

    const today = new Date().toISOString().slice(0, 10);
    const meta = {
      tool: 'GHG Tool — Gresmalt',
      schema_version: G.SCHEMA_VERSION || '1',
      exported_at: new Date().toISOString(),
      exported_by_role: (G.db && G.db.role && G.db.role()) || 'unknown',
      counts: {
        anagrafiche:    (data.anagrafiche    || []).length,
        produzione:     (data.produzione     || []).length,
        fe:             (data.fe             || []).length,
        s1:             (data.s1             || []).length,
        s2:             (data.s2             || []).length,
        s3:             (data.s3             || []).length,
        s3_materiality: (data.s3_materiality || []).length
      },
      // Materialità + app_meta non sono nel xlsx (non sono dati di
      // attività): includili nel JSON per backup completo.
      s3_materiality: data.s3_materiality || [],
      app_meta:       data.app_meta       || {}
    };
    const readme =
`Backup GHG Tool — Gruppo Ceramiche Gresmalt
Data export: ${today}

Contenuto:
  data.xlsx       Inventario completo: 6 fogli
                  (Anagrafiche, Produzione, FE, S1, S2, S3).
                  Ri-importabile dal Tool tramite "Importa Excel".
  metadata.json   Materialità Scope 3 (15 categorie) + app_meta
                  (target, configurazioni). NON re-importato auto-
                  maticamente: per ripristinarlo serve l'admin.
  README.txt      Questo file.

Ripristino:
  1. Decomprimere lo ZIP.
  2. In Gestione Dati → "⤴ Importa Excel" caricare data.xlsx.
     Il preview mostra new/updated/unchanged per ogni foglio.
  3. Per metadata.json, l'admin può importare la materialità via
     SQL Editor Supabase oppure inserendola manualmente da
     Materialità S3 → Modifica.

Nota: questo backup è una snapshot client-side, NON sostituisce
i backup server lato Supabase (vedi docs/RUNBOOK.md).
`;

    const enc = new TextEncoder();
    const zip = makeZip([
      { name: 'data.xlsx',     data: xlsxBytes },
      { name: 'metadata.json', data: enc.encode(JSON.stringify(meta, null, 2)) },
      { name: 'README.txt',    data: enc.encode(readme) }
    ]);

    // Trigger download
    const blob = new Blob([zip], { type: 'application/zip' });
    const url = root.URL.createObjectURL(blob);
    const a = root.document.createElement('a');
    a.href = url;
    a.download = `ghg_backup_${today}.zip`;
    root.document.body.appendChild(a);
    a.click();
    root.document.body.removeChild(a);
    setTimeout(() => root.URL.revokeObjectURL(url), 1000);

    return { filename: a.download, bytes: zip.length };
  }

  // fmt è centralizzato in G.fmt (constants.js)
  const fmt = G.fmt;

  G.io = { exportExcel, exportTemplate, importExcel, commitImport, exportPPTX,
    exportBackup,
    // Esposto per test unitari (pure function, no side-effects).
    enrichForUpsert,
    // Esposti per test (pure utility).
    makeZip, crc32,
    loadSheetJS, loadPptxgen };
})(typeof window !== 'undefined' ? window : globalThis);
