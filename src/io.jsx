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
    // Migrato a @e965/xlsx (fork community con CVE patchate). Il
    // pacchetto è API-compatibile con SheetJS upstream. Caricato
    // da jsdelivr (lo stesso CDN di pptxgenjs → meno origin in CSP).
    const url = `https://cdn.jsdelivr.net/npm/@e965/xlsx@${SHEETJS_VERSION}/dist/xlsx.full.min.js`;
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
    const T = G.TARGETS || {};
    const FONT = 'Calibri';   // più portabile di Sora; pptxgenjs usa fallback
    const TITLE_FONT = 'Calibri';

    // Helper colore: pptxgenjs accetta hex senza #
    const hex = (c) => (c || '').replace('#', '');

    // Aggregati anno corrente + anno precedente per delta YoY
    const tot = G.calc.totals(year, data.s1, data.s2, data.s3);
    const totPrev = G.calc.totals(year - 1, data.s1, data.s2, data.s3);
    const prod = (data.produzione || []).filter(p => +(p.Anno || p.anno) === +year);
    const totProd = prod.reduce((a, p) => ({
      kg: a.kg + G.calc.num(p.Produzione_kg || p.produzione_kg),
      m2: a.m2 + G.calc.num(p.Produzione_m2 || p.produzione_m2)
    }), { kg: 0, m2: 0 });
    const intCur = G.calc.intensity(tot, totProd);

    // Delta vs anno precedente
    const yoyAbs = totPrev.em_total_tco2e > 0
      ? ((tot.em_total_tco2e - totPrev.em_total_tco2e) / totPrev.em_total_tco2e * 100) : null;

    // Delta vs baseline 2021 (perimetro target Piano S1+S2 MB)
    const s12mb = tot.s1 + tot.s2mb;
    const baseTco = +T.baseline_tco2e || 0;
    const vsBase = baseTco > 0 ? ((s12mb - baseTco) / baseTco * 100) : null;
    const targetPctSt = (T.shortTerm_tco2e && baseTco)
      ? ((T.shortTerm_tco2e - baseTco) / baseTco * 100) : null;

    // GO coverage
    const s2y = (data.s2 || []).filter(r =>
      +(r.Anno || r.anno) === +year && (r.Unità || r.unita) === 'kWh');
    const totEE = s2y.reduce((a, r) => a + G.calc.num(r.Quantità || r.quantita), 0);
    const totGO = s2y.filter(r => (r.Voce_S2 || r.voce_s2) === 'EE_Acquistata_GO')
      .reduce((a, r) => a + G.calc.num(r.Quantità || r.quantita), 0);
    const goPct = totEE > 0 ? (totGO / totEE * 100) : 0;

    // Lingua (best-effort dal localStorage; fallback IT)
    const lang = (() => {
      try { return root.localStorage.getItem('ghg_lang') || 'it'; }
      catch (_) { return 'it'; }
    })();
    const isEN = lang === 'en';
    const t = isEN
      ? {
          title: 'GHG Emissions Inventory',
          subtitle: `Inventory ${year} · GHG Protocol Corporate Standard`,
          execTitle: 'Executive summary',
          kpiTitle: 'Key indicators',
          composition: 'Emissions composition',
          trend: 'Annual trend',
          siteCmp: 'Site comparison · Scope 1 + 2 LB',
          s3Cat: 'Scope 3 by category',
          materiality: 'Scope 3 materiality',
          methods: 'Methodology & sources',
          yoy: 'YoY (LB)',
          baseline: 'vs baseline ' + (T.baselineYear || ''),
          target: 'Target ' + (T.shortTermYear || '') + ' (S1+S2 MB)',
          totLB: 'Total GHG (LB)',
          totMB: 'Total GHG (MB)',
          intM2: 'Intensity per m²',
          intKg: 'Intensity per kg',
          go: 'GO coverage',
          included: 'included',
          excluded: 'excluded',
          notApp: 'N/A',
          toAssess: 'to assess'
        }
      : {
          title: 'Inventario emissioni GHG',
          subtitle: `Inventario ${year} · GHG Protocol Corporate Standard`,
          execTitle: 'Sintesi esecutiva',
          kpiTitle: 'Indicatori chiave',
          composition: 'Composizione emissioni',
          trend: 'Trend annuale',
          siteCmp: 'Confronto siti · Scope 1 + 2 LB',
          s3Cat: 'Scope 3 per categoria',
          materiality: 'Materialità Scope 3',
          methods: 'Metodologia e fonti',
          yoy: 'YoY (LB)',
          baseline: 'vs baseline ' + (T.baselineYear || ''),
          target: 'Target ' + (T.shortTermYear || '') + ' (S1+S2 MB)',
          totLB: 'Totale GHG (LB)',
          totMB: 'Totale GHG (MB)',
          intM2: 'Intensità per m²',
          intKg: 'Intensità per kg',
          go: 'Copertura GO',
          included: 'incluse',
          excluded: 'escluse',
          notApp: 'N.A.',
          toAssess: 'da valutare'
        };

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 inch
    pptx.author = 'Gruppo Ceramiche Gresmalt';
    pptx.title  = t.title + ' ' + year;

    // ── Slide master con band brand in alto + footer ─────────────
    pptx.defineSlideMaster({
      title: 'STD',
      background: { color: 'FFFFFF' },
      objects: [
        { rect: { x: 0, y: 0,    w: 13.33, h: 0.35, fill: { color: hex(C.brand) } } },
        { rect: { x: 0, y: 7.15, w: 13.33, h: 0.35, fill: { color: hex(C.cream) } } },
        { text: {
            text: `Gruppo Ceramiche Gresmalt · ${t.title} ${year}`,
            options: { x: 0.5, y: 7.18, w: 9, h: 0.3, fontSize: 9,
                       color: hex(C.textMid), fontFace: FONT }
        } },
        { text: {
            text: 'Slide ', // numero pagina aggiunto da pptxgen
            options: { x: 12.0, y: 7.18, w: 1.0, h: 0.3, fontSize: 9,
                       color: hex(C.textMid), fontFace: FONT, align: 'right' }
        } }
      ],
      slideNumber: { x: 12.55, y: 7.18, w: 0.4, h: 0.3, fontSize: 9,
                     color: hex(C.textMid), fontFace: FONT, align: 'right' }
    });

    function addSlide () { return pptx.addSlide({ masterName: 'STD' }); }
    function slideTitle (slide, text, sub) {
      slide.addText(text, {
        x: 0.5, y: 0.55, w: 12.3, h: 0.55,
        fontSize: 24, bold: true, color: hex(C.text),
        fontFace: TITLE_FONT
      });
      if (sub) slide.addText(sub, {
        x: 0.5, y: 1.05, w: 12.3, h: 0.4,
        fontSize: 12, color: hex(C.textMid), fontFace: FONT
      });
    }

    // ── Slide 1: Cover ─────────────────────────────────────────
    const sCover = pptx.addSlide();
    sCover.background = { color: hex(C.brand) };
    // Banda accento sinistra
    sCover.addShape('rect', { x: 0, y: 0, w: 0.5, h: 7.5,
      fill: { color: hex(C.accent) }, line: { color: hex(C.accent), width: 0 } });
    sCover.addText(t.title, {
      x: 1.2, y: 2.6, w: 11.5, h: 1.2, color: 'FFFFFF',
      fontSize: 48, bold: true, fontFace: TITLE_FONT
    });
    sCover.addText(t.subtitle, {
      x: 1.2, y: 3.8, w: 11.5, h: 0.6, color: hex(C.cream),
      fontSize: 20, fontFace: FONT
    });
    sCover.addText('Gruppo Ceramiche Gresmalt', {
      x: 1.2, y: 4.5, w: 11.5, h: 0.4, color: 'FFFFFF',
      fontSize: 14, fontFace: FONT, italic: true
    });
    sCover.addText(new Date().toLocaleDateString(isEN ? 'en-GB' : 'it-IT'), {
      x: 1.2, y: 6.6, w: 11.5, h: 0.4, color: hex(C.cream),
      fontSize: 11, fontFace: FONT
    });

    // ── Slide 2: Executive summary ─────────────────────────────
    const sExec = addSlide();
    slideTitle(sExec, t.execTitle, t.subtitle);
    // Hero stat box (delta vs baseline)
    const heroOk = vsBase != null && vsBase < 0;
    const heroColor = heroOk ? hex(C.success) : hex(C.warning);
    sExec.addShape('rect', { x: 0.5, y: 1.7, w: 6, h: 2.2,
      fill: { color: hex(C.cream) }, line: { color: hex(C.border), width: 1 } });
    sExec.addText(t.baseline, {
      x: 0.7, y: 1.85, w: 5.6, h: 0.4, fontSize: 11, bold: true,
      color: hex(C.textMid), fontFace: FONT
    });
    sExec.addText(vsBase != null
        ? `${vsBase >= 0 ? '+' : ''}${vsBase.toFixed(1)}%`
        : 'n.d.', {
      x: 0.7, y: 2.25, w: 5.6, h: 1.0, fontSize: 56, bold: true,
      color: heroColor, fontFace: TITLE_FONT
    });
    sExec.addText(`${G.fmt(s12mb, 0)} → ${G.fmt(baseTco, 0)} tCO₂e`, {
      x: 0.7, y: 3.35, w: 5.6, h: 0.4, fontSize: 12,
      color: hex(C.textMid), fontFace: FONT
    });
    // Bullet recap
    const bullets = [
      `${t.totLB}: ${G.fmt(tot.em_total_tco2e, 0)} tCO₂e (S1+S2 LB+S3)`,
      `${t.totMB}: ${G.fmt(s12mb, 0)} tCO₂e (S1+S2 MB)`,
      yoyAbs != null
        ? `${t.yoy}: ${yoyAbs >= 0 ? '+' : ''}${yoyAbs.toFixed(1)}% (${G.fmt(totPrev.em_total_tco2e, 0)} → ${G.fmt(tot.em_total_tco2e, 0)} tCO₂e)`
        : `${t.yoy}: n.d.`,
      `${t.go}: ${goPct.toFixed(0)}% · ${G.fmt(totEE, 0)} kWh`,
      intCur.perM2 != null ? `${t.intM2}: ${intCur.perM2.toFixed(2)} kgCO₂e/m²` : `${t.intM2}: n.d.`,
      targetPctSt != null
        ? `${t.target}: ${targetPctSt.toFixed(0)}% · ${G.fmt(T.shortTerm_tco2e, 0)} tCO₂e`
        : null
    ].filter(Boolean);
    sExec.addText(bullets.map(b => ({ text: b, options: { bullet: { code: '25A0' } } })), {
      x: 6.8, y: 1.7, w: 6.0, h: 4.0, fontSize: 13, fontFace: FONT,
      color: hex(C.text), paraSpaceAfter: 6, lineSpacingMultiple: 1.2
    });

    // ── Slide 3: KPI grid (3×2) ────────────────────────────────
    const sKPI = addSlide();
    slideTitle(sKPI, t.kpiTitle);
    const kpiData = [
      { label: t.totLB,  value: `${G.fmt(tot.em_total_tco2e, 0)}`, unit: 'tCO₂e', color: C.brand },
      { label: 'Scope 1',     value: `${G.fmt(tot.s1, 0)}`,    unit: 'tCO₂e', color: C.s1 },
      { label: 'Scope 2 LB',  value: `${G.fmt(tot.s2lb, 0)}`,  unit: 'tCO₂e', color: C.s2loc },
      { label: 'Scope 2 MB',  value: `${G.fmt(tot.s2mb, 0)}`,  unit: 'tCO₂e', color: C.s2mkt },
      { label: 'Scope 3',     value: `${G.fmt(tot.s3, 0)}`,    unit: 'tCO₂e', color: C.s3 },
      { label: t.intM2,
        value: intCur.perM2 != null ? intCur.perM2.toFixed(2) : 'n.d.',
        unit: intCur.perM2 != null ? 'kgCO₂e/m²' : '', color: C.accent }
    ];
    kpiData.forEach((k, i) => {
      const row = Math.floor(i / 3), col = i % 3;
      const x = 0.5 + col * 4.25, y = 1.7 + row * 2.6;
      // Card con border-left colorato (riprende il pattern UI)
      sKPI.addShape('rect', { x, y, w: 4, h: 2.3,
        fill: { color: 'FFFFFF' }, line: { color: hex(C.border), width: 0.75 } });
      sKPI.addShape('rect', { x, y, w: 0.08, h: 2.3,
        fill: { color: hex(k.color) }, line: { color: hex(k.color), width: 0 } });
      sKPI.addText(k.label, {
        x: x + 0.25, y: y + 0.2, w: 3.6, h: 0.4,
        fontSize: 11, bold: true, color: hex(C.textMid),
        fontFace: FONT, charSpacing: 1
      });
      sKPI.addText(k.value, {
        x: x + 0.25, y: y + 0.7, w: 3.6, h: 1.1,
        fontSize: 38, bold: true, color: hex(C.text),
        fontFace: TITLE_FONT
      });
      if (k.unit) sKPI.addText(k.unit, {
        x: x + 0.25, y: y + 1.75, w: 3.6, h: 0.35,
        fontSize: 12, color: hex(C.textMid), fontFace: FONT
      });
    });

    // ── Slide 4: Composizione (donut LB + valori MB a fianco) ──
    const sComp = addSlide();
    slideTitle(sComp, t.composition,
      isEN ? 'Location-based perimeter (S1 + S2 LB + S3)'
           : 'Perimetro Location-based (S1 + S2 LB + S3)');
    sComp.addChart(pptx.ChartType.doughnut, [{
      name: 'Scope', labels: ['Scope 1', 'Scope 2 LB', 'Scope 3'],
      values: [tot.s1, tot.s2lb, tot.s3]
    }], {
      x: 0.7, y: 1.6, w: 5.5, h: 5.0,
      chartColors: [hex(C.s1), hex(C.s2loc), hex(C.s3)],
      showLegend: true, legendPos: 'b', legendFontSize: 11, legendFontFace: FONT,
      dataLabelFormatCode: '0.0"%"', showPercent: true,
      dataLabelFontSize: 11, dataLabelFontFace: FONT
    });
    // Tabella riassuntiva LB vs MB a destra
    const totalLB = tot.s1 + tot.s2lb + tot.s3 || 1;
    const totalMB = tot.s1 + tot.s2mb + tot.s3 || 1;
    const compRows = [
      [{ text: '', options: { bold: true } },
       { text: 'tCO₂e', options: { bold: true, align: 'right' } },
       { text: '%', options: { bold: true, align: 'right' } }],
      [{ text: 'Scope 1' },
       { text: G.fmt(tot.s1, 0), options: { align: 'right' } },
       { text: `${(tot.s1 / totalLB * 100).toFixed(1)}%`, options: { align: 'right' } }],
      [{ text: 'Scope 2 LB' },
       { text: G.fmt(tot.s2lb, 0), options: { align: 'right' } },
       { text: `${(tot.s2lb / totalLB * 100).toFixed(1)}%`, options: { align: 'right' } }],
      [{ text: 'Scope 2 MB' },
       { text: G.fmt(tot.s2mb, 0), options: { align: 'right' } },
       { text: `${(tot.s2mb / totalMB * 100).toFixed(1)}%`, options: { align: 'right' } }],
      [{ text: 'Scope 3' },
       { text: G.fmt(tot.s3, 0), options: { align: 'right' } },
       { text: `${(tot.s3 / totalLB * 100).toFixed(1)}%`, options: { align: 'right' } }],
      [{ text: 'Tot. LB', options: { bold: true } },
       { text: G.fmt(totalLB, 0), options: { bold: true, align: 'right' } },
       { text: '100%', options: { bold: true, align: 'right' } }],
      [{ text: 'Tot. MB (S1+S2 MB)', options: { bold: true } },
       { text: G.fmt(s12mb, 0), options: { bold: true, align: 'right' } },
       { text: '—', options: { align: 'right' } }]
    ];
    sComp.addTable(compRows, {
      x: 7.0, y: 1.8, w: 5.8, colW: [2.6, 1.6, 1.6],
      fontSize: 12, fontFace: FONT, color: hex(C.text),
      border: { type: 'solid', pt: 0.5, color: hex(C.border) },
      rowH: 0.42
    });

    // ── Slide 5: Trend con traiettoria target ──────────────────
    const sTrend = addSlide();
    slideTitle(sTrend, t.trend,
      isEN ? 'S1 + S2 MB · vs Plan trajectory' : 'S1 + S2 MB · vs traiettoria Piano');
    const allYears = G.calc.availableYears(data.s1, data.s2, data.s3, data.produzione)
      .slice().sort((a, b) => a - b);
    const yearsForChart = [];
    const startY = Math.min(allYears[0] || +T.baselineYear || year, +T.baselineYear || year);
    const endY   = +T.longTermYear || (year + 5);
    for (let y = startY; y <= endY; y++) yearsForChart.push(y);
    const histMap = new Map();
    allYears.forEach(y => {
      const tt = G.calc.totals(y, data.s1, data.s2, data.s3);
      histMap.set(y, tt.s1 + tt.s2mb);
    });
    const histVals = yearsForChart.map(y => histMap.has(y) ? histMap.get(y) : null);
    // Target: interpolazione lineare baseline → 2034 → 2050
    const tgtVals = yearsForChart.map(y => {
      if (!T.baselineYear || !T.shortTermYear || !T.longTermYear) return null;
      if (y === +T.baselineYear)  return +T.baseline_tco2e || null;
      if (y === +T.shortTermYear) return +T.shortTerm_tco2e || null;
      if (y === +T.longTermYear)  return +T.longTerm_tco2e || null;
      if (y > +T.baselineYear && y < +T.shortTermYear) {
        const f = (y - T.baselineYear) / (T.shortTermYear - T.baselineYear);
        return T.baseline_tco2e + f * (T.shortTerm_tco2e - T.baseline_tco2e);
      }
      if (y > +T.shortTermYear && y < +T.longTermYear) {
        const f = (y - T.shortTermYear) / (T.longTermYear - T.shortTermYear);
        return T.shortTerm_tco2e + f * (T.longTerm_tco2e - T.shortTerm_tco2e);
      }
      return null;
    });
    sTrend.addChart(pptx.ChartType.line, [
      { name: isEN ? 'Historical S1+S2 MB' : 'Storico S1+S2 MB',
        labels: yearsForChart, values: histVals },
      { name: isEN ? 'Plan target trajectory' : 'Traiettoria target Piano',
        labels: yearsForChart, values: tgtVals }
    ], {
      x: 0.5, y: 1.6, w: 12.3, h: 5.2,
      chartColors: [hex(C.brand), hex(C.success)],
      showLegend: true, legendPos: 'b', legendFontSize: 11, legendFontFace: FONT,
      lineSize: 3, lineSmooth: false, lineDataSymbol: 'circle',
      lineDataSymbolSize: 6,
      catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
      valAxisTitle: 'tCO₂e', valAxisTitleFontSize: 11
    });

    // ── Slide 6: Confronto siti ────────────────────────────────
    const sSites = addSlide();
    slideTitle(sSites, t.siteCmp);
    const siteCodes = (data.anagrafiche || [])
      .map(a => a.Codice_Sito || a.codice_sito).filter(Boolean);
    const siteData = {};
    siteCodes.forEach(s => { siteData[s] = { s1: 0, s2: 0 }; });
    (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = r.Codice_Sito || r.codice_sito;
      if (siteData[k]) siteData[k].s1 += G.calc.num(r.Em_tCO2e || r.em_tco2e);
    });
    (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = r.Codice_Sito || r.codice_sito;
      if (siteData[k]) siteData[k].s2 += G.calc.num(r.Em_Loc_tCO2e || r.em_loc_tco2e);
    });
    const ordered = siteCodes.slice().sort((a, b) =>
      (siteData[b].s1 + siteData[b].s2) - (siteData[a].s1 + siteData[a].s2));
    sSites.addChart(pptx.ChartType.bar, [
      { name: 'Scope 1',    labels: ordered, values: ordered.map(s => siteData[s].s1) },
      { name: 'Scope 2 LB', labels: ordered, values: ordered.map(s => siteData[s].s2) }
    ], {
      x: 0.5, y: 1.6, w: 12.3, h: 5.2,
      chartColors: [hex(C.s1), hex(C.s2loc)],
      showLegend: true, legendPos: 'b', legendFontSize: 11, legendFontFace: FONT,
      barDir: 'bar', barGrouping: 'stacked',
      catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT
    });

    // ── Slide 7: Scope 3 per categoria ─────────────────────────
    const sS3 = addSlide();
    slideTitle(sS3, t.s3Cat);
    const s3Agg = {};
    (data.s3 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = +(r.Categoria_S3 || r.categoria_s3);
      s3Agg[k] = (s3Agg[k] || 0) + G.calc.num(r.Em_tCO2e || r.em_tco2e);
    });
    const s3Sorted = Object.entries(s3Agg).sort((a, b) => b[1] - a[1]);
    const s3Labels = s3Sorted.map(([k]) =>
      `Cat ${k}${G.CAT_NAMES && G.CAT_NAMES[k] ? ` · ${G.CAT_NAMES[k]}` : ''}`);
    sS3.addChart(pptx.ChartType.bar, [{
      name: 'tCO₂e', labels: s3Labels, values: s3Sorted.map(([_, v]) => v)
    }], {
      x: 0.5, y: 1.6, w: 12.3, h: 5.2, chartColors: [hex(C.s3)],
      showLegend: false, barDir: 'bar',
      catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT
    });

    // ── Slide 8: Materialità Scope 3 ──────────────────────────
    const matRows = data.s3_materiality || [];
    if (matRows.length > 0) {
      const sMat = addSlide();
      slideTitle(sMat, t.materiality);
      const inc = matRows.filter(m => m.status === 'Inclusa').length;
      const exc = matRows.filter(m => m.status === 'Esclusa').length;
      const na  = matRows.filter(m => m.status === 'N.A.').length;
      const dv  = matRows.filter(m => m.status === 'Da valutare').length;
      // Mini-card riepilogo
      const mini = [
        { label: t.included, value: inc, color: C.success },
        { label: t.excluded, value: exc, color: C.textMid },
        { label: t.notApp,   value: na,  color: C.textLow },
        { label: t.toAssess, value: dv,  color: C.warning }
      ];
      mini.forEach((m, i) => {
        const x = 0.5 + i * 3.2, y = 1.65;
        sMat.addShape('rect', { x, y, w: 2.95, h: 0.95,
          fill: { color: 'FFFFFF' }, line: { color: hex(C.border), width: 0.75 } });
        sMat.addText(m.label, {
          x: x + 0.2, y: y + 0.1, w: 2.6, h: 0.3,
          fontSize: 11, color: hex(C.textMid), fontFace: FONT, charSpacing: 1
        });
        sMat.addText(String(m.value), {
          x: x + 0.2, y: y + 0.4, w: 2.6, h: 0.5,
          fontSize: 28, bold: true, color: hex(m.color), fontFace: TITLE_FONT
        });
      });
      // Tabella categorie
      const matTable = [[
        { text: 'Cat', options: { bold: true } },
        { text: isEN ? 'Name' : 'Nome', options: { bold: true } },
        { text: isEN ? 'Status' : 'Stato', options: { bold: true } }
      ]];
      for (let cat = 1; cat <= 15; cat++) {
        const row = matRows.find(r => +r.cat_id === cat);
        const status = row ? row.status : t.toAssess;
        matTable.push([
          { text: String(cat) },
          { text: (G.CAT_NAMES && G.CAT_NAMES[cat]) || `Cat ${cat}` },
          { text: status }
        ]);
      }
      sMat.addTable(matTable, {
        x: 0.5, y: 2.85, w: 12.3, colW: [0.7, 8.6, 3.0],
        fontSize: 10, fontFace: FONT, color: hex(C.text),
        border: { type: 'solid', pt: 0.5, color: hex(C.border) },
        rowH: 0.27
      });
    }

    // ── Slide finale: Metodologia + fonti ─────────────────────
    const sMeth = addSlide();
    sMeth.background = { color: hex(C.cream) };
    slideTitle(sMeth, t.methods);
    const sitesTotal = (data.anagrafiche || []).length;
    const sitesWithData = new Set();
    ['s1','s2','s3','produzione'].forEach(tbl => {
      (data[tbl] || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
        const k = r.Codice_Sito || r.codice_sito;
        if (k) sitesWithData.add(k);
      });
    });
    const methText = isEN ? [
      { text: 'Standard\n', options: { bold: true, fontSize: 14 } },
      { text: 'GHG Protocol Corporate Accounting and Reporting Standard.\n', options: { fontSize: 12 } },
      { text: T.alignment ? `Alignment: ${T.alignment}\n\n` : '\n', options: { fontSize: 12 } },
      { text: 'Boundary\n', options: { bold: true, fontSize: 14 } },
      { text: `Operational control · ${sitesWithData.size}/${sitesTotal} sites with data in ${year}.\n\n`, options: { fontSize: 12 } },
      { text: 'Emission factors\n', options: { bold: true, fontSize: 14 } },
      { text: 'Fuels: NIR · Min. of Environment · ETS · ISPRA. Electricity: AIB · Terna. Versions tracked in FE Explorer.\n\n', options: { fontSize: 12 } },
      { text: 'Targets\n', options: { bold: true, fontSize: 14 } },
      { text: T.shortTerm_tco2e
          ? `${T.baselineYear}: ${G.fmt(T.baseline_tco2e, 0)} tCO₂e (baseline) · ${T.shortTermYear}: ${G.fmt(T.shortTerm_tco2e, 0)} tCO₂e · ${T.longTermYear}: ${G.fmt(T.longTerm_tco2e, 0)} tCO₂e.`
          : 'Targets not configured.', options: { fontSize: 12 } }
    ] : [
      { text: 'Standard\n', options: { bold: true, fontSize: 14 } },
      { text: 'GHG Protocol Corporate Accounting and Reporting Standard.\n', options: { fontSize: 12 } },
      { text: T.alignment ? `Allineamento: ${T.alignment}\n\n` : '\n', options: { fontSize: 12 } },
      { text: 'Perimetro\n', options: { bold: true, fontSize: 14 } },
      { text: `Controllo operativo · ${sitesWithData.size}/${sitesTotal} siti con dati nell'anno ${year}.\n\n`, options: { fontSize: 12 } },
      { text: 'Fattori emissivi\n', options: { bold: true, fontSize: 14 } },
      { text: 'Combustibili: NIR · Min. dell\'Ambiente · ETS · ISPRA. Elettricità: AIB · Terna. Versioni tracciate in FE Explorer.\n\n', options: { fontSize: 12 } },
      { text: 'Target di Piano\n', options: { bold: true, fontSize: 14 } },
      { text: T.shortTerm_tco2e
          ? `${T.baselineYear}: ${G.fmt(T.baseline_tco2e, 0)} tCO₂e (baseline) · ${T.shortTermYear}: ${G.fmt(T.shortTerm_tco2e, 0)} tCO₂e · ${T.longTermYear}: ${G.fmt(T.longTerm_tco2e, 0)} tCO₂e.`
          : 'Target non configurati.', options: { fontSize: 12 } }
    ];
    sMeth.addText(methText, {
      x: 0.7, y: 1.7, w: 12.0, h: 5.2, fontFace: FONT,
      color: hex(C.text), paraSpaceAfter: 4, lineSpacingMultiple: 1.2
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

  // fmt è centralizzato in G.fmt (constants.js); usalo direttamente
  // come G.fmt(...) dove serve. Questa riga era un alias non più usato.

  G.io = { exportExcel, exportTemplate, importExcel, commitImport, exportPPTX,
    exportBackup,
    // Esposto per test unitari (pure function, no side-effects).
    enrichForUpsert,
    // Esposti per test (pure utility).
    makeZip, crc32,
    loadSheetJS, loadPptxgen };
})(typeof window !== 'undefined' ? window : globalThis);
