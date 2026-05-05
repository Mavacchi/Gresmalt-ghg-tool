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
  //  PPTX Export — Sustainability Report 22 slide
  //
  //  Architettura: helper interni riutilizzabili (kpiBox, sectionBlock,
  //  miniCards, dataTable, statBlock) + sezioni ordinate per flusso
  //  narrativo: Cover → Indice → Executive → KPI → Scope deep dive →
  //  Sites → Quality → Targets → Methodology → Glossary → Closing.
  //
  //  Tutti i dati provengono dal modello (data.s1/s2/s3/fe/produzione/
  //  s3_materiality/anagrafiche). Niente claim non verificabili.
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

    // Totale perimetro Market-based (S1 + S2 MB + S3) — riusato in più slide
    const totMBComplete = tot.s1 + tot.s2mb + tot.s3;

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
          toc: 'Contents',
          execTitle: 'Executive summary',
          kpiTitle: 'Key indicators',
          composition: 'Emissions composition',
          trend: 'Annual trend & target pathway',
          targetGap: 'Performance vs targets',
          s1Deep: 'Scope 1 deep dive',
          s2Deep: 'Scope 2 deep dive',
          s3Hot: 'Scope 3 hot spots',
          siteCmp: 'Site comparison · Scope 1 + 2 LB',
          siteTable: 'Sites overview',
          s3Cat: 'Scope 3 by category',
          materiality: 'Scope 3 materiality assessment',
          intensity: 'Carbon intensity',
          quality: 'Data quality assessment',
          methods: 'Methodology & standards',
          boundary: 'Boundary & reporting period',
          feRef: 'Emission factors reference',
          governance: 'Auditability & governance',
          glossary: 'Glossary',
          limits: 'Disclaimer & limitations',
          contact: 'Contacts',
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
          toAssess: 'to assess',
          page: 'p.'
        }
      : {
          title: 'Inventario emissioni GHG',
          subtitle: `Inventario ${year} · GHG Protocol Corporate Standard`,
          toc: 'Indice',
          execTitle: 'Sintesi esecutiva',
          kpiTitle: 'Indicatori chiave',
          composition: 'Composizione emissioni',
          trend: 'Trend annuale e traiettoria target',
          targetGap: 'Performance vs target',
          s1Deep: 'Scope 1 — approfondimento',
          s2Deep: 'Scope 2 — approfondimento',
          s3Hot: 'Scope 3 — hot spot',
          siteCmp: 'Confronto siti · Scope 1 + 2 LB',
          siteTable: 'Panoramica siti',
          s3Cat: 'Scope 3 per categoria',
          materiality: 'Materialità Scope 3',
          intensity: 'Intensità carbon',
          quality: 'Qualità del dato',
          methods: 'Metodologia e standard',
          boundary: 'Perimetro e periodo di rendicontazione',
          feRef: 'Riferimenti fattori di emissione',
          governance: 'Audit e governance',
          glossary: 'Glossario',
          limits: 'Disclaimer e limitazioni',
          contact: 'Contatti',
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
          toAssess: 'da valutare',
          page: 'p.'
        };

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 inch
    pptx.author = 'Gruppo Ceramiche Gresmalt';
    pptx.title  = t.title + ' ' + year;

    // ── Slide master raffinato: linea accent sottile in alto +
    //    footer con linea separatrice cream ────────────────────
    pptx.defineSlideMaster({
      title: 'STD',
      background: { color: 'FFFFFF' },
      objects: [
        // Top accent line (sottile, brand-allineata)
        { rect: { x: 0, y: 0, w: 13.33, h: 0.08,
                  fill: { color: hex(C.brand) } } },
        // Footer band cream (sottile)
        { rect: { x: 0, y: 7.32, w: 13.33, h: 0.18,
                  fill: { color: hex(C.cream) } } },
        // Footer separator linea
        { rect: { x: 0.5, y: 7.20, w: 12.33, h: 0.012,
                  fill: { color: hex(C.border) } } },
        // Footer text
        { text: {
            text: `Gruppo Ceramiche Gresmalt · ${t.title} ${year}`,
            options: { x: 0.5, y: 7.22, w: 9, h: 0.3, fontSize: 9,
                       color: hex(C.textMid), fontFace: FONT,
                       charSpacing: 0.5 }
        } }
      ],
      slideNumber: { x: 12.55, y: 7.22, w: 0.4, h: 0.3, fontSize: 9,
                     color: hex(C.textMid), fontFace: FONT, align: 'right' }
    });

    function addSlide () { return pptx.addSlide({ masterName: 'STD' }); }

    // Header slide raffinato: titolo bold + linea sottile accent +
    // sottotitolo in textMid con leggera spaziatura
    function slideTitle (slide, text, sub) {
      slide.addText(text, {
        x: 0.5, y: 0.45, w: 12.3, h: 0.55,
        fontSize: 26, bold: true, color: hex(C.text),
        fontFace: TITLE_FONT, charSpacing: -0.5
      });
      // Linea accent sotto il titolo (~2 cm)
      slide.addShape('rect', {
        x: 0.5, y: 1.04, w: 0.7, h: 0.04,
        fill: { color: hex(C.accent) },
        line: { color: hex(C.accent), width: 0 }
      });
      if (sub) slide.addText(sub, {
        x: 0.5, y: 1.15, w: 12.3, h: 0.35,
        fontSize: 12, color: hex(C.textMid), fontFace: FONT, italic: true
      });
    }

    // Helper: stat card con border-top accent (più elegante del border-left)
    function statCard (slide, opts) {
      const { x, y, w, h = 2.45, label, value, unit, sub, color } = opts;
      // Card base
      slide.addShape('rect', { x, y, w, h,
        fill: { color: 'FFFFFF' },
        line: { color: hex(C.border), width: 0.5 } });
      // Top accent strip (3pt brand-color)
      slide.addShape('rect', { x, y, w, h: 0.04,
        fill: { color: hex(color || C.brand) },
        line: { color: hex(color || C.brand), width: 0 } });
      // Label uppercase
      slide.addText(label, {
        x: x + 0.22, y: y + 0.18, w: w - 0.4, h: 0.3,
        fontSize: 9, bold: true, color: hex(C.textMid),
        fontFace: FONT, charSpacing: 1.5
      });
      // Value (large)
      slide.addText(value, {
        x: x + 0.22, y: y + 0.58, w: w - 0.4, h: 0.95,
        fontSize: 30, bold: true, color: hex(C.text),
        fontFace: TITLE_FONT
      });
      if (unit) slide.addText(unit, {
        x: x + 0.22, y: y + 1.55, w: w - 0.4, h: 0.3,
        fontSize: 11, color: hex(C.textMid), fontFace: FONT
      });
      if (sub) slide.addText(sub, {
        x: x + 0.22, y: y + 1.92, w: w - 0.4, h: 0.4,
        fontSize: 9, color: hex(C.textLow), fontFace: FONT, italic: true
      });
    }

    // Helper: tabella con header bg cream e righe alternate
    function styledTable (slide, rows, opts) {
      // Aggiunge zebra stripes su righe (eccetto header)
      const styled = rows.map((row, i) => row.map(cell => {
        if (i === 0) {
          // header bg cream
          const o = Object.assign({}, cell.options || {});
          o.fill = { color: hex(C.cream) };
          o.bold = true;
          return Object.assign({}, cell, { options: o });
        }
        if (i % 2 === 0) {
          // riga pari → bg leggerissimo
          const o = Object.assign({}, cell.options || {});
          o.fill = { color: 'F8F8F8' };
          return Object.assign({}, cell, { options: o });
        }
        return cell;
      }));
      slide.addTable(styled, Object.assign({
        fontFace: FONT, color: hex(C.text),
        border: { type: 'solid', pt: 0.4, color: hex(C.border) }
      }, opts));
    }

    // ── Slide 1: Cover (raffinata, brand-driven) ──────────────
    const sCover = pptx.addSlide();
    sCover.background = { color: hex(C.brand) };
    // Linea accent verticale sottile (decorativa, brand-mark)
    sCover.addShape('rect', { x: 0.8, y: 2.2, w: 0.06, h: 4.5,
      fill: { color: hex(C.accent) }, line: { color: hex(C.accent), width: 0 } });
    // Eyebrow (small uppercase)
    sCover.addText(isEN ? 'GHG INVENTORY · ANNUAL REPORT' : 'INVENTARIO GHG · REPORT ANNUALE', {
      x: 1.2, y: 2.3, w: 11.0, h: 0.4, color: hex(C.accent),
      fontSize: 11, bold: true, fontFace: FONT, charSpacing: 4
    });
    // Titolo principale
    sCover.addText(t.title, {
      x: 1.2, y: 2.85, w: 11.0, h: 1.5, color: 'FFFFFF',
      fontSize: 52, bold: true, fontFace: TITLE_FONT, charSpacing: -1
    });
    // Anno grande sottostante (sub-titolo visivo)
    sCover.addText(String(year), {
      x: 1.2, y: 4.45, w: 11.0, h: 1.1, color: hex(C.cream),
      fontSize: 80, bold: true, fontFace: TITLE_FONT, charSpacing: -2
    });
    // Standard di riferimento
    sCover.addText('GHG Protocol Corporate Standard', {
      x: 1.2, y: 5.7, w: 11.0, h: 0.4, color: 'FFFFFF',
      fontSize: 16, fontFace: FONT, italic: true
    });
    // Footer cover
    sCover.addText('Gruppo Ceramiche Gresmalt', {
      x: 1.2, y: 6.6, w: 6.0, h: 0.4, color: 'FFFFFF',
      fontSize: 13, bold: true, fontFace: FONT, charSpacing: 1
    });
    sCover.addText(new Date().toLocaleDateString(isEN ? 'en-GB' : 'it-IT'), {
      x: 7.2, y: 6.6, w: 5.0, h: 0.4, color: hex(C.cream),
      fontSize: 11, fontFace: FONT, align: 'right'
    });

    // ── Slide 2: Indice ────────────────────────────────────────
    const sToc = addSlide();
    slideTitle(sToc, t.toc);
    const tocItems = [
      { p:  3, label: t.execTitle },
      { p:  4, label: t.kpiTitle },
      { p:  5, label: t.composition },
      { p:  6, label: t.trend },
      { p:  7, label: t.targetGap },
      { p:  8, label: t.s1Deep },
      { p:  9, label: t.s2Deep },
      { p: 10, label: t.s3Hot },
      { p: 11, label: t.siteCmp },
      { p: 12, label: t.siteTable },
      { p: 13, label: t.materiality + ' — ' + (isEN ? 'included' : 'incluse') },
      { p: 14, label: t.materiality + ' — ' + (isEN ? 'excluded · N/A · to assess' : 'escluse · N.A. · da valutare') },
      { p: 15, label: t.intensity },
      { p: 16, label: t.quality },
      { p: 17, label: t.methods },
      { p: 18, label: t.boundary },
      { p: 19, label: t.feRef },
      { p: 20, label: t.governance },
      { p: 21, label: t.glossary },
      { p: 22, label: t.limits },
      { p: 23, label: t.contact }
    ];
    // 2 colonne, layout raffinato
    const halfCount = Math.ceil(tocItems.length / 2);
    tocItems.forEach((it, i) => {
      const col = i < halfCount ? 0 : 1;
      const row = i < halfCount ? i : i - halfCount;
      const x = col === 0 ? 0.5 : 6.95;
      const y = 1.7 + row * 0.45;
      // Numero pagina in accent color
      sToc.addText(String(it.p).padStart(2, '0'), {
        x, y, w: 0.65, h: 0.4, fontSize: 13, bold: true,
        color: hex(C.accent), fontFace: TITLE_FONT
      });
      // Label sezione
      sToc.addText(it.label, {
        x: x + 0.7, y, w: 5.5, h: 0.4, fontSize: 12,
        color: hex(C.text), fontFace: FONT
      });
      // Linea sottile divisoria
      sToc.addShape('rect', {
        x: x + 0.7, y: y + 0.40, w: 5.5, h: 0.008,
        fill: { color: hex(C.borderSoft || C.border) },
        line: { color: hex(C.borderSoft || C.border), width: 0 }
      });
    });

    // ── Slide 3: Executive summary ─────────────────────────────
    const sExec = addSlide();
    slideTitle(sExec, t.execTitle, t.subtitle);
    // Hero stat box: delta vs baseline (perimetro target Piano S1+S2 MB)
    const heroOk = vsBase != null && vsBase < 0;
    const heroColor = heroOk ? hex(C.success) : hex(C.warning);
    sExec.addShape('rect', { x: 0.45, y: 1.65, w: 6.2, h: 2.55,
      fill: { color: hex(C.cream) },
      line: { color: hex(C.cream), width: 0 } });
    sExec.addShape('rect', { x: 0.45, y: 1.65, w: 6.2, h: 0.05,
      fill: { color: heroColor }, line: { color: heroColor, width: 0 } });
    sExec.addText((isEN ? 'PROGRESS VS BASELINE ' : 'PROGRESSO VS BASELINE ') + (T.baselineYear || ''), {
      x: 0.7, y: 1.82, w: 5.7, h: 0.35, fontSize: 10, bold: true,
      color: hex(C.textMid), fontFace: FONT, charSpacing: 2
    });
    sExec.addText(vsBase != null
        ? `${vsBase >= 0 ? '+' : ''}${vsBase.toFixed(1)}%`
        : 'n.d.', {
      x: 0.7, y: 2.2, w: 5.7, h: 1.3, fontSize: 64, bold: true,
      color: heroColor, fontFace: TITLE_FONT, charSpacing: -1
    });
    sExec.addText(`${G.fmt(s12mb, 0)} ${isEN ? 'today' : 'oggi'}  →  ${G.fmt(baseTco, 0)} ${isEN ? 'baseline' : 'baseline'} (tCO₂e)`, {
      x: 0.7, y: 3.5, w: 5.7, h: 0.4, fontSize: 11,
      color: hex(C.textMid), fontFace: FONT, italic: true
    });
    sExec.addText(isEN
      ? 'Scope 1 + Scope 2 Market-based perimeter (decarbonization plan boundary)'
      : 'Perimetro Scope 1 + Scope 2 Market-based (target del Piano di Decarbonizzazione)', {
      x: 0.7, y: 3.85, w: 5.7, h: 0.3, fontSize: 9,
      color: hex(C.textLow), fontFace: FONT
    });
    // Bullet recap a destra (con LB e MB completi)
    const bullets = [
      `${t.totLB}: ${G.fmt(tot.em_total_tco2e, 0)} tCO₂e (S1+S2 LB+S3)`,
      `${t.totMB}: ${G.fmt(totMBComplete, 0)} tCO₂e (S1+S2 MB+S3)`,
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

    // ── Slide 4: KPI grid (4×2 = 8 KPI con sia LB che MB) ──────
    const sKPI = addSlide();
    slideTitle(sKPI, t.kpiTitle, isEN
      ? `Year ${year} · primary data · dual reporting Scope 2 LB / MB`
      : `Anno ${year} · dati primari · doppio reporting Scope 2 LB / MB`);
    const kpiData = [
      // Riga 1: totali e perimetri
      { label: t.totLB, value: G.fmt(tot.em_total_tco2e, 0), unit: 'tCO₂e', color: C.brand,
        sub: 'S1 + S2 LB + S3' },
      { label: t.totMB, value: G.fmt(totMBComplete, 0), unit: 'tCO₂e', color: C.brandLight || C.brand,
        sub: 'S1 + S2 MB + S3' },
      { label: t.go, value: `${goPct.toFixed(0)}%`, unit: '', color: C.success,
        sub: totEE > 0 ? `${G.fmt(totEE/1000, 0)} MWh` : '' },
      { label: t.yoy,
        value: yoyAbs != null ? `${yoyAbs >= 0 ? '+' : ''}${yoyAbs.toFixed(1)}%` : 'n.d.',
        unit: '',
        color: yoyAbs != null && yoyAbs < 0 ? C.success : (yoyAbs > 0 ? C.warning : C.textMid),
        sub: totPrev.em_total_tco2e ? `vs ${year - 1} (LB)` : '' },
      // Riga 2: dettaglio per scope
      { label: 'Scope 1', value: G.fmt(tot.s1, 0), unit: 'tCO₂e', color: C.s1,
        sub: tot.em_total_tco2e ? `${(tot.s1 / tot.em_total_tco2e * 100).toFixed(1)}% del totale (LB)` : '' },
      { label: 'Scope 2 LB', value: G.fmt(tot.s2lb, 0), unit: 'tCO₂e', color: C.s2loc,
        sub: isEN ? 'Grid average' : 'Mix di rete IT' },
      { label: 'Scope 2 MB', value: G.fmt(tot.s2mb, 0), unit: 'tCO₂e', color: C.s2mkt,
        sub: isEN ? 'Contracts (incl. GO)' : 'Contratti (incl. GO)' },
      { label: 'Scope 3', value: G.fmt(tot.s3, 0), unit: 'tCO₂e', color: C.s3,
        sub: tot.em_total_tco2e ? `${(tot.s3 / tot.em_total_tco2e * 100).toFixed(1)}% del totale (LB)` : '' }
    ];
    kpiData.forEach((k, i) => {
      const row = Math.floor(i / 4), col = i % 4;
      const x = 0.45 + col * 3.16, y = 1.7 + row * 2.65;
      statCard(sKPI, { x, y, w: 2.95, h: 2.4, ...k });
    });

    // ── Slide 5: Composizione (donut LB + valori MB a fianco) ──
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
      dataLabelFormatCode: '0.0%', showPercent: true,
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

    // ── Slide 6: Trend con traiettoria target ──────────────────
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

    // ── Slide 7: Performance vs Targets (gap analysis) ─────────
    const sGap = addSlide();
    slideTitle(sGap, t.targetGap, isEN
      ? `Scope 1 + 2 MB perimeter · vs Decarbonization Plan ${T.baselineYear || ''}`
      : `Perimetro Scope 1 + 2 MB · vs Piano di Decarbonizzazione ${T.baselineYear || ''}`);
    // 3 stat blocks: baseline, current, short-term target
    const gapBlocks = [
      { label: isEN ? `Baseline ${T.baselineYear || ''}` : `Baseline ${T.baselineYear || ''}`,
        value: G.fmt(T.baseline_tco2e || 0, 0), unit: 'tCO₂e', color: C.textMid,
        sub: T.baseline_intensity ? `${T.baseline_intensity} kgCO₂e/m²` : '' },
      { label: isEN ? `Current ${year}` : `Anno corrente ${year}`,
        value: G.fmt(s12mb, 0), unit: 'tCO₂e',
        color: vsBase != null && vsBase < 0 ? C.success : C.warning,
        sub: vsBase != null
          ? `${vsBase >= 0 ? '+' : ''}${vsBase.toFixed(1)}% ${isEN ? 'vs baseline' : 'vs baseline'}`
          : '' },
      { label: isEN ? `Target ${T.shortTermYear || ''}` : `Target ${T.shortTermYear || ''}`,
        value: G.fmt(T.shortTerm_tco2e || 0, 0), unit: 'tCO₂e', color: C.brand,
        sub: T.shortTerm_intensity ? `${T.shortTerm_intensity} kgCO₂e/m²` : '' },
      { label: isEN ? `Vision ${T.longTermYear || ''}` : `Vision ${T.longTermYear || ''}`,
        value: G.fmt(T.longTerm_tco2e || 0, 0), unit: 'tCO₂e', color: C.accent,
        sub: T.longTerm_intensity ? `${T.longTerm_intensity} kgCO₂e/m²` : '' }
    ];
    gapBlocks.forEach((b, i) => {
      const x = 0.45 + i * 3.16, y = 1.7;
      statCard(sGap, { x, y, w: 2.95, h: 2.0, ...b });
    });
    // Gap residuo & note metodologiche
    const gapToShort = (T.shortTerm_tco2e && s12mb)
      ? s12mb - +T.shortTerm_tco2e : null;
    const gapNote = isEN ? [
      { text: 'Gap analysis\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: gapToShort != null
        ? `· Gap to short-term target ${T.shortTermYear}: ${G.fmt(Math.abs(gapToShort), 0)} tCO₂e ${gapToShort > 0 ? 'over' : 'below'}.\n`
        : '· Short-term target not configured.\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: targetPctSt != null
        ? `· Required reduction at ${T.shortTermYear}: ${Math.abs(targetPctSt).toFixed(0)}% vs baseline ${T.baselineYear}.\n`
        : '',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: vsBase != null
        ? `· Achieved reduction so far: ${Math.abs(vsBase).toFixed(1)}% vs baseline.\n`
        : '',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: T.alignment ? `\nAlignment: ${T.alignment}` : '',
        options: { fontSize: 11, color: hex(C.textMid), italic: true } }
    ] : [
      { text: 'Analisi del gap\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: gapToShort != null
        ? `· Gap al target ${T.shortTermYear}: ${G.fmt(Math.abs(gapToShort), 0)} tCO₂e ${gapToShort > 0 ? 'in eccesso' : 'sotto'}.\n`
        : '· Target a breve termine non configurato.\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: targetPctSt != null
        ? `· Riduzione richiesta al ${T.shortTermYear}: ${Math.abs(targetPctSt).toFixed(0)}% vs baseline ${T.baselineYear}.\n`
        : '',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: vsBase != null
        ? `· Riduzione raggiunta finora: ${Math.abs(vsBase).toFixed(1)}% vs baseline.\n`
        : '',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: T.alignment ? `\nAllineamento: ${T.alignment}` : '',
        options: { fontSize: 11, color: hex(C.textMid), italic: true } }
    ];
    sGap.addText(gapNote, {
      x: 0.5, y: 4.0, w: 12.3, h: 2.8, fontFace: FONT,
      paraSpaceAfter: 4, lineSpacingMultiple: 1.3
    });

    // ── Slide 8: Scope 1 deep dive ─────────────────────────────
    const sS1 = addSlide();
    slideTitle(sS1, t.s1Deep,
      isEN ? `Direct emissions from owned operations · ${year}`
           : `Emissioni dirette da operazioni in controllo · ${year}`);
    // S1 per categoria
    const s1ByCat = {};
    const s1ByFuel = {};
    const s1BySite = {};
    (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const cat = r.Categoria_S1 || r.categoria_s1 || 'N.D.';
      const fuel = r.Combustibile || r.combustibile || 'N.D.';
      const site = r.Codice_Sito || r.codice_sito || 'N.D.';
      const em = G.calc.num(r.Em_tCO2e || r.em_tco2e);
      s1ByCat[cat] = (s1ByCat[cat] || 0) + em;
      s1ByFuel[fuel] = (s1ByFuel[fuel] || 0) + em;
      s1BySite[site] = (s1BySite[site] || 0) + em;
    });
    const s1CatSorted = Object.entries(s1ByCat).sort((a, b) => b[1] - a[1]);
    const s1FuelSorted = Object.entries(s1ByFuel).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const s1SiteSorted = Object.entries(s1BySite).sort((a, b) => b[1] - a[1]).slice(0, 5);
    // Pie chart per categoria
    if (s1CatSorted.length > 0) {
      sS1.addChart(pptx.ChartType.pie, [{
        name: 'S1', labels: s1CatSorted.map(([k]) => k),
        values: s1CatSorted.map(([_, v]) => v)
      }], {
        x: 0.4, y: 1.6, w: 5.5, h: 5.0,
        chartColors: [hex(C.s1), hex(C.accent), hex(C.brand), hex(C.s3), hex(C.warning)],
        showLegend: true, legendPos: 'b', legendFontSize: 10, legendFontFace: FONT,
        showPercent: true, dataLabelFormatCode: '0.0%', dataLabelFontSize: 10
      });
    }
    // Top 5 combustibili tabella
    const s1FuelTbl = [[
      { text: isEN ? 'Top fuels' : 'Top combustibili', options: { bold: true, fontSize: 11 } },
      { text: 'tCO₂e', options: { bold: true, fontSize: 11, align: 'right' } },
      { text: '%', options: { bold: true, fontSize: 11, align: 'right' } }
    ]];
    s1FuelSorted.forEach(([fuel, em]) => {
      const pct = tot.s1 > 0 ? (em / tot.s1 * 100) : 0;
      s1FuelTbl.push([
        { text: fuel },
        { text: G.fmt(em, 1), options: { align: 'right' } },
        { text: pct.toFixed(1) + '%', options: { align: 'right' } }
      ]);
    });
    sS1.addTable(s1FuelTbl, {
      x: 6.3, y: 1.6, w: 6.5, colW: [3.5, 1.5, 1.5],
      fontSize: 11, fontFace: FONT, color: hex(C.text),
      border: { type: 'solid', pt: 0.5, color: hex(C.border) },
      rowH: 0.32
    });
    // Top 5 siti tabella
    const s1SiteTbl = [[
      { text: isEN ? 'Top sites' : 'Top siti', options: { bold: true, fontSize: 11 } },
      { text: 'tCO₂e', options: { bold: true, fontSize: 11, align: 'right' } },
      { text: '%', options: { bold: true, fontSize: 11, align: 'right' } }
    ]];
    s1SiteSorted.forEach(([site, em]) => {
      const pct = tot.s1 > 0 ? (em / tot.s1 * 100) : 0;
      s1SiteTbl.push([
        { text: site },
        { text: G.fmt(em, 1), options: { align: 'right' } },
        { text: pct.toFixed(1) + '%', options: { align: 'right' } }
      ]);
    });
    sS1.addTable(s1SiteTbl, {
      x: 6.3, y: 4.4, w: 6.5, colW: [3.5, 1.5, 1.5],
      fontSize: 11, fontFace: FONT, color: hex(C.text),
      border: { type: 'solid', pt: 0.5, color: hex(C.border) },
      rowH: 0.32
    });

    // ── Slide 9: Scope 2 deep dive (LB vs MB + GO) ─────────────
    const sS2 = addSlide();
    slideTitle(sS2, t.s2Deep,
      isEN ? `Purchased electricity · LB vs MB · GO coverage · ${year}`
           : `Elettricità acquistata · LB vs MB · copertura GO · ${year}`);
    // Bar chart LB vs MB
    sS2.addChart(pptx.ChartType.bar, [
      { name: 'LB', labels: ['Scope 2'], values: [tot.s2lb] },
      { name: 'MB', labels: ['Scope 2'], values: [tot.s2mb] }
    ], {
      x: 0.4, y: 1.6, w: 5.5, h: 3.0,
      chartColors: [hex(C.s2loc), hex(C.s2mkt)],
      showLegend: true, legendPos: 'b', legendFontSize: 11, legendFontFace: FONT,
      barDir: 'col', barGrouping: 'clustered',
      catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
      valAxisTitle: 'tCO₂e', valAxisTitleFontSize: 10
    });
    // Hero MB savings
    const mbSavings = tot.s2lb - tot.s2mb;
    sS2.addText(isEN ? 'MB advantage' : 'Vantaggio MB', {
      x: 0.4, y: 4.85, w: 5.5, h: 0.4,
      fontSize: 11, bold: true, color: hex(C.textMid), fontFace: FONT
    });
    sS2.addText(`${mbSavings >= 0 ? '−' : '+'}${G.fmt(Math.abs(mbSavings), 0)} tCO₂e`, {
      x: 0.4, y: 5.25, w: 5.5, h: 0.7,
      fontSize: 30, bold: true,
      color: hex(mbSavings >= 0 ? C.success : C.warning),
      fontFace: TITLE_FONT
    });
    sS2.addText(isEN
      ? 'Avoided emissions thanks to renewable contracts (GO)'
      : 'Emissioni evitate grazie a contratti rinnovabili (GO)', {
      x: 0.4, y: 5.95, w: 5.5, h: 0.4,
      fontSize: 10, color: hex(C.textLow), fontFace: FONT, italic: true
    });
    // Tabella S2 breakdown a destra
    const s2Y = (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year);
    const s2VoceAgg = {};
    s2Y.forEach(r => {
      const v = r.Voce_S2 || r.voce_s2 || 'N.D.';
      const q = G.calc.num(r.Quantità || r.quantita);
      const lb = G.calc.num(r.Em_Loc_tCO2e || r.em_loc_tco2e);
      const mb = G.calc.num(r.Em_Mkt_tCO2e || r.em_mkt_tco2e);
      if (!s2VoceAgg[v]) s2VoceAgg[v] = { q: 0, lb: 0, mb: 0 };
      s2VoceAgg[v].q += q;
      s2VoceAgg[v].lb += lb;
      s2VoceAgg[v].mb += mb;
    });
    const s2VoceTbl = [[
      { text: isEN ? 'Item' : 'Voce', options: { bold: true, fontSize: 10 } },
      { text: 'kWh', options: { bold: true, fontSize: 10, align: 'right' } },
      { text: 'LB', options: { bold: true, fontSize: 10, align: 'right' } },
      { text: 'MB', options: { bold: true, fontSize: 10, align: 'right' } }
    ]];
    Object.entries(s2VoceAgg).sort((a, b) => b[1].lb - a[1].lb).forEach(([v, d]) => {
      s2VoceTbl.push([
        { text: v },
        { text: G.fmt(d.q, 0), options: { align: 'right' } },
        { text: G.fmt(d.lb, 1), options: { align: 'right' } },
        { text: G.fmt(d.mb, 1), options: { align: 'right' } }
      ]);
    });
    sS2.addTable(s2VoceTbl, {
      x: 6.3, y: 1.6, w: 6.5, colW: [2.5, 1.4, 1.3, 1.3],
      fontSize: 10, fontFace: FONT, color: hex(C.text),
      border: { type: 'solid', pt: 0.5, color: hex(C.border) },
      rowH: 0.32
    });
    // GO coverage indicator
    sS2.addText(isEN
      ? `Renewable energy coverage (GO): ${goPct.toFixed(0)}% of ${G.fmt(totEE/1000, 0)} MWh purchased`
      : `Copertura energia rinnovabile (GO): ${goPct.toFixed(0)}% su ${G.fmt(totEE/1000, 0)} MWh acquistati`, {
      x: 6.3, y: 5.5, w: 6.5, h: 0.6,
      fontSize: 11, color: hex(C.success), fontFace: FONT,
      bold: true
    });
    sS2.addText(isEN
      ? '«MB» reflects the actual contractual mix; «LB» uses the national grid average.'
      : '«MB» riflette il mix contrattuale reale; «LB» usa la media della rete nazionale.', {
      x: 6.3, y: 6.0, w: 6.5, h: 0.6,
      fontSize: 9, color: hex(C.textMid), fontFace: FONT, italic: true
    });

    // ── Slide 10: Scope 3 hot spots ────────────────────────────
    const sS3hot = addSlide();
    slideTitle(sS3hot, t.s3Hot,
      isEN ? `Top categories of value chain emissions · ${year}`
           : `Top categorie della catena del valore · ${year}`);
    const s3HotAgg = {};
    (data.s3 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = +(r.Categoria_S3 || r.categoria_s3);
      s3HotAgg[k] = (s3HotAgg[k] || 0) + G.calc.num(r.Em_tCO2e || r.em_tco2e);
    });
    const s3HotSorted = Object.entries(s3HotAgg)
      .map(([k, v]) => ({ cat: +k, em: v }))
      .sort((a, b) => b.em - a.em);
    const s3Top5 = s3HotSorted.slice(0, 5);
    const s3TotalY = s3HotSorted.reduce((a, x) => a + x.em, 0);
    // Bar chart top 5
    if (s3Top5.length > 0) {
      sS3hot.addChart(pptx.ChartType.bar, [{
        name: 'tCO₂e',
        labels: s3Top5.map(x =>
          `${x.cat} · ${(G.CAT_NAMES && G.CAT_NAMES[x.cat]) || ''}`),
        values: s3Top5.map(x => x.em)
      }], {
        x: 0.4, y: 1.6, w: 7.2, h: 5.0,
        chartColors: [hex(C.s3)],
        showLegend: false, barDir: 'bar',
        catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
        catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
        valAxisTitle: 'tCO₂e', valAxisTitleFontSize: 10,
        showValue: true, dataLabelFontSize: 9
      });
    }
    // Pannello laterale: stat + metodologia per categoria
    sS3hot.addText(isEN ? 'Top 5 share of S3' : 'Top 5 quota di S3', {
      x: 8.0, y: 1.6, w: 4.8, h: 0.4,
      fontSize: 11, bold: true, color: hex(C.textMid), fontFace: FONT, charSpacing: 1
    });
    const top5Sum = s3Top5.reduce((a, x) => a + x.em, 0);
    sS3hot.addText(s3TotalY > 0 ? `${(top5Sum / s3TotalY * 100).toFixed(0)}%` : 'n.d.', {
      x: 8.0, y: 2.0, w: 4.8, h: 0.9,
      fontSize: 44, bold: true, color: hex(C.s3), fontFace: TITLE_FONT
    });
    sS3hot.addText(isEN
      ? `${G.fmt(top5Sum, 0)} of ${G.fmt(s3TotalY, 0)} tCO₂e`
      : `${G.fmt(top5Sum, 0)} su ${G.fmt(s3TotalY, 0)} tCO₂e`, {
      x: 8.0, y: 2.95, w: 4.8, h: 0.4,
      fontSize: 11, color: hex(C.textMid), fontFace: FONT
    });
    // Metodologie usate per categoria
    const s3Methods = {};
    (data.s3 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = +(r.Categoria_S3 || r.categoria_s3);
      const m = r.Metodo || r.metodo || 'N.D.';
      if (!s3Methods[k]) s3Methods[k] = new Set();
      s3Methods[k].add(m);
    });
    const methText = s3Top5.length > 0 ? [
      { text: (isEN ? 'Methods used\n' : 'Metodologie usate\n'),
        options: { bold: true, fontSize: 12, color: hex(C.text) } },
      ...s3Top5.map(x => ({
        text: `· Cat ${x.cat}: ${[...(s3Methods[x.cat] || ['N.D.'])].join(', ')}\n`,
        options: { fontSize: 10, color: hex(C.text) }
      }))
    ] : [{ text: '' }];
    sS3hot.addText(methText, {
      x: 8.0, y: 3.6, w: 4.8, h: 3.0, fontFace: FONT,
      paraSpaceAfter: 2, lineSpacingMultiple: 1.2
    });

    // ── Slide 11: Confronto siti — LB e MB side-by-side ────────
    const sSites = addSlide();
    slideTitle(sSites, isEN
      ? 'Site comparison · Scope 1 + 2'
      : 'Confronto siti · Scope 1 + 2',
      isEN ? `Stacked bars: Scope 1 + Scope 2. Left chart Location-based · Right chart Market-based · ${year}`
           : `Barre impilate: Scope 1 + Scope 2. Sinistra Location-based · Destra Market-based · ${year}`);
    const siteCodes = (data.anagrafiche || [])
      .map(a => a.Codice_Sito || a.codice_sito).filter(Boolean);
    const siteData = {};
    siteCodes.forEach(s => { siteData[s] = { s1: 0, s2lb: 0, s2mb: 0 }; });
    (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = r.Codice_Sito || r.codice_sito;
      if (siteData[k]) siteData[k].s1 += G.calc.num(r.Em_tCO2e || r.em_tco2e);
    });
    (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = r.Codice_Sito || r.codice_sito;
      if (siteData[k]) {
        siteData[k].s2lb += G.calc.num(r.Em_Loc_tCO2e || r.em_loc_tco2e);
        siteData[k].s2mb += G.calc.num(r.Em_Mkt_tCO2e || r.em_mkt_tco2e);
      }
    });
    // Ordine fisso (per LB) → coerente tra i 2 chart
    const ordered = siteCodes.slice().sort((a, b) =>
      (siteData[b].s1 + siteData[b].s2lb) - (siteData[a].s1 + siteData[a].s2lb));
    // Chart LB (sinistra)
    sSites.addText(isEN ? 'Location-based' : 'Location-based', {
      x: 0.5, y: 1.55, w: 6.0, h: 0.35, fontSize: 12, bold: true,
      color: hex(C.s2loc), fontFace: FONT, charSpacing: 1
    });
    sSites.addChart(pptx.ChartType.bar, [
      { name: 'Scope 1',    labels: ordered, values: ordered.map(s => siteData[s].s1) },
      { name: 'Scope 2 LB', labels: ordered, values: ordered.map(s => siteData[s].s2lb) }
    ], {
      x: 0.4, y: 1.95, w: 6.3, h: 4.9,
      chartColors: [hex(C.s1), hex(C.s2loc)],
      showLegend: true, legendPos: 'b', legendFontSize: 10, legendFontFace: FONT,
      barDir: 'bar', barGrouping: 'stacked',
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
      valAxisTitle: 'tCO₂e', valAxisTitleFontSize: 9
    });
    // Chart MB (destra)
    sSites.addText(isEN ? 'Market-based' : 'Market-based', {
      x: 7.0, y: 1.55, w: 6.0, h: 0.35, fontSize: 12, bold: true,
      color: hex(C.s2mkt), fontFace: FONT, charSpacing: 1
    });
    sSites.addChart(pptx.ChartType.bar, [
      { name: 'Scope 1',    labels: ordered, values: ordered.map(s => siteData[s].s1) },
      { name: 'Scope 2 MB', labels: ordered, values: ordered.map(s => siteData[s].s2mb) }
    ], {
      x: 6.9, y: 1.95, w: 6.3, h: 4.9,
      chartColors: [hex(C.s1), hex(C.s2mkt)],
      showLegend: true, legendPos: 'b', legendFontSize: 10, legendFontFace: FONT,
      barDir: 'bar', barGrouping: 'stacked',
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
      valAxisTitle: 'tCO₂e', valAxisTitleFontSize: 9
    });

    // ── Slide 12: Sites overview table ─────────────────────────
    const sSitesTbl = addSlide();
    slideTitle(sSitesTbl, t.siteTable, isEN
      ? `Per-site detail · year ${year}` : `Dettaglio per sito · anno ${year}`);
    // Costruisce dataset per sito
    const sitesDetail = (data.anagrafiche || []).map(a => {
      const code = a.Codice_Sito || a.codice_sito;
      const name = a.Nome_Sito || a.nome_sito || code;
      const tipo = a.Tipologia || a.tipologia || '';
      const chp = a.Presenza_CHP || a.presenza_chp;
      const ets = a.Regime_ETS || a.regime_ets;
      const s1 = (data.s1 || []).filter(r =>
        (r.Codice_Sito || r.codice_sito) === code &&
        +(r.Anno || r.anno) === +year)
        .reduce((a, r) => a + G.calc.num(r.Em_tCO2e || r.em_tco2e), 0);
      const s2lb = (data.s2 || []).filter(r =>
        (r.Codice_Sito || r.codice_sito) === code &&
        +(r.Anno || r.anno) === +year)
        .reduce((a, r) => a + G.calc.num(r.Em_Loc_tCO2e || r.em_loc_tco2e), 0);
      const s2mb = (data.s2 || []).filter(r =>
        (r.Codice_Sito || r.codice_sito) === code &&
        +(r.Anno || r.anno) === +year)
        .reduce((a, r) => a + G.calc.num(r.Em_Mkt_tCO2e || r.em_mkt_tco2e), 0);
      const p = (data.produzione || []).find(r =>
        (r.Codice_Sito || r.codice_sito) === code &&
        +(r.Anno || r.anno) === +year);
      const kg = p ? G.calc.num(p.Produzione_kg || p.produzione_kg) : 0;
      const m2 = p ? G.calc.num(p.Produzione_m2 || p.produzione_m2) : 0;
      return { code, name, tipo, chp, ets, s1, s2lb, s2mb, kg, m2 };
    });
    const sitesTbl = [[
      { text: isEN ? 'Site' : 'Sito',          options: { bold: true, fontSize: 10 } },
      { text: isEN ? 'Type' : 'Tipologia',     options: { bold: true, fontSize: 10 } },
      { text: 'CHP', options: { bold: true, fontSize: 10, align: 'center' } },
      { text: 'ETS', options: { bold: true, fontSize: 10, align: 'center' } },
      { text: 'S1',     options: { bold: true, fontSize: 10, align: 'right' } },
      { text: 'S2 LB',  options: { bold: true, fontSize: 10, align: 'right' } },
      { text: 'S2 MB',  options: { bold: true, fontSize: 10, align: 'right' } },
      { text: isEN ? 'Prod (kg)' : 'Prod. kg', options: { bold: true, fontSize: 10, align: 'right' } },
      { text: isEN ? 'Prod (m²)' : 'Prod. m²', options: { bold: true, fontSize: 10, align: 'right' } }
    ]];
    sitesDetail.forEach(s => {
      sitesTbl.push([
        { text: s.code,          options: { bold: true } },
        { text: s.tipo },
        { text: s.chp ? '✓' : '—', options: { align: 'center' } },
        { text: s.ets ? '✓' : '—', options: { align: 'center' } },
        { text: G.fmt(s.s1, 0),   options: { align: 'right' } },
        { text: G.fmt(s.s2lb, 0), options: { align: 'right' } },
        { text: G.fmt(s.s2mb, 0), options: { align: 'right' } },
        { text: s.kg > 0 ? G.fmt(s.kg/1e6, 2) + ' M' : '—', options: { align: 'right' } },
        { text: s.m2 > 0 ? G.fmt(s.m2/1e6, 2) + ' M' : '—', options: { align: 'right' } }
      ]);
    });
    // Riga totale
    const totsRow = sitesDetail.reduce((a, s) => ({
      s1: a.s1 + s.s1, s2lb: a.s2lb + s.s2lb, s2mb: a.s2mb + s.s2mb,
      kg: a.kg + s.kg, m2: a.m2 + s.m2
    }), { s1: 0, s2lb: 0, s2mb: 0, kg: 0, m2: 0 });
    sitesTbl.push([
      { text: isEN ? 'TOTAL' : 'TOTALE', options: { bold: true } },
      { text: '' }, { text: '' }, { text: '' },
      { text: G.fmt(totsRow.s1, 0),   options: { bold: true, align: 'right' } },
      { text: G.fmt(totsRow.s2lb, 0), options: { bold: true, align: 'right' } },
      { text: G.fmt(totsRow.s2mb, 0), options: { bold: true, align: 'right' } },
      { text: totsRow.kg > 0 ? G.fmt(totsRow.kg/1e6, 2) + ' M' : '—',
        options: { bold: true, align: 'right' } },
      { text: totsRow.m2 > 0 ? G.fmt(totsRow.m2/1e6, 2) + ' M' : '—',
        options: { bold: true, align: 'right' } }
    ]);
    styledTable(sSitesTbl, sitesTbl, {
      x: 0.4, y: 1.6, w: 12.5,
      colW: [1.6, 1.6, 0.7, 0.7, 1.4, 1.4, 1.4, 1.6, 1.7],
      fontSize: 10, rowH: 0.32
    });
    sSitesTbl.addText(isEN
      ? 'CHP = Combined Heat & Power · ETS = EU Emissions Trading System participant'
      : 'CHP = Cogenerazione · ETS = Sito soggetto al sistema EU ETS', {
      x: 0.4, y: 6.7, w: 12.5, h: 0.4, fontSize: 9,
      color: hex(C.textLow), italic: true, fontFace: FONT
    });

    // ── Slide 13: Materialità Scope 3 — Categorie INCLUSE ──────
    const matRows = data.s3_materiality || [];
    if (matRows.length > 0) {
      const inc = matRows.filter(m => m.status === 'Inclusa').length;
      const exc = matRows.filter(m => m.status === 'Esclusa').length;
      const na  = matRows.filter(m => m.status === 'N.A.').length;
      const dv  = matRows.filter(m => m.status === 'Da valutare').length;

      const sMat = addSlide();
      slideTitle(sMat, t.materiality + ' — ' + (isEN ? 'included' : 'incluse'),
        isEN ? `Reported categories with primary or secondary data · ${inc} of 15`
             : `Categorie rendicontate con dati primari o secondari · ${inc} su 15`);
      // Mini-card riepilogo (presenti in entrambe le slide per orientamento)
      const mini = [
        { label: t.included, value: inc, color: C.success },
        { label: t.excluded, value: exc, color: C.textMid },
        { label: t.notApp,   value: na,  color: C.textLow },
        { label: t.toAssess, value: dv,  color: C.warning }
      ];
      mini.forEach((m, i) => {
        const x = 0.5 + i * 3.2, y = 1.65;
        sMat.addShape('rect', { x, y, w: 2.95, h: 0.85,
          fill: { color: 'FFFFFF' }, line: { color: hex(C.border), width: 0.75 } });
        sMat.addText(m.label, {
          x: x + 0.2, y: y + 0.08, w: 2.6, h: 0.28,
          fontSize: 10, color: hex(C.textMid), fontFace: FONT, charSpacing: 1
        });
        sMat.addText(String(m.value), {
          x: x + 0.2, y: y + 0.32, w: 2.6, h: 0.5,
          fontSize: 24, bold: true, color: hex(m.color), fontFace: TITLE_FONT
        });
      });

      // Tabella categorie INCLUSE con giustificazione completa
      const matTableInc = [[
        { text: 'Cat',  options: { bold: true, fontSize: 10 } },
        { text: isEN ? 'Name' : 'Nome', options: { bold: true, fontSize: 10 } },
        { text: isEN ? 'Methodological reference' : 'Riferimento metodologico', options: { bold: true, fontSize: 10 } },
        { text: isEN ? 'Justification' : 'Giustificazione', options: { bold: true, fontSize: 10 } }
      ]];
      const includedRows = matRows
        .filter(m => m.status === 'Inclusa')
        .sort((a, b) => +a.cat_id - +b.cat_id);
      includedRows.forEach(row => {
        matTableInc.push([
          { text: String(row.cat_id), options: { bold: true } },
          { text: (G.CAT_NAMES && G.CAT_NAMES[+row.cat_id]) || `Cat ${row.cat_id}` },
          { text: row.methodological_ref || '—', options: { fontSize: 9 } },
          { text: row.justification || '—', options: { fontSize: 9 } }
        ]);
      });
      styledTable(sMat, matTableInc, {
        x: 0.4, y: 2.65, w: 12.5,
        colW: [0.5, 2.6, 3.2, 6.2],
        fontSize: 9, rowH: 0.4
      });

      // ── Slide 14: Materialità Scope 3 — ESCLUSE / N.A. / Da valutare
      const sMat2 = addSlide();
      slideTitle(sMat2, t.materiality + ' — ' + (isEN ? 'excluded · N/A · to assess' : 'escluse · N.A. · da valutare'),
        isEN ? `Categories not (yet) reported · ${exc + na + dv} of 15 with documented rationale`
             : `Categorie non (ancora) rendicontate · ${exc + na + dv} su 15 con razionale documentato`);
      // Stesse mini-card per orientamento
      mini.forEach((m, i) => {
        const x = 0.5 + i * 3.2, y = 1.65;
        sMat2.addShape('rect', { x, y, w: 2.95, h: 0.85,
          fill: { color: 'FFFFFF' }, line: { color: hex(C.border), width: 0.75 } });
        sMat2.addText(m.label, {
          x: x + 0.2, y: y + 0.08, w: 2.6, h: 0.28,
          fontSize: 10, color: hex(C.textMid), fontFace: FONT, charSpacing: 1
        });
        sMat2.addText(String(m.value), {
          x: x + 0.2, y: y + 0.32, w: 2.6, h: 0.5,
          fontSize: 24, bold: true, color: hex(m.color), fontFace: TITLE_FONT
        });
      });
      // Tabella categorie ESCLUSE / N.A. / Da valutare
      const matTableOut = [[
        { text: 'Cat',  options: { bold: true, fontSize: 10 } },
        { text: isEN ? 'Name' : 'Nome', options: { bold: true, fontSize: 10 } },
        { text: isEN ? 'Status' : 'Stato', options: { bold: true, fontSize: 10 } },
        { text: isEN ? 'Justification' : 'Giustificazione', options: { bold: true, fontSize: 10 } }
      ]];
      const otherRows = matRows
        .filter(m => m.status !== 'Inclusa')
        .sort((a, b) => +a.cat_id - +b.cat_id);
      otherRows.forEach(row => {
        matTableOut.push([
          { text: String(row.cat_id), options: { bold: true } },
          { text: (G.CAT_NAMES && G.CAT_NAMES[+row.cat_id]) || `Cat ${row.cat_id}` },
          { text: row.status, options: { fontSize: 9, bold: true } },
          { text: row.justification || '—', options: { fontSize: 9 } }
        ]);
      });
      styledTable(sMat2, matTableOut, {
        x: 0.4, y: 2.65, w: 12.5,
        colW: [0.5, 3.0, 1.5, 7.5],
        fontSize: 9, rowH: 0.45
      });
    }

    // ── Slide 14: Carbon intensity (multi-year trend) ──────────
    const sInt = addSlide();
    slideTitle(sInt, t.intensity, isEN
      ? 'Emissions normalized by physical output'
      : 'Emissioni normalizzate sull\'output fisico');
    // Multi-year: per ogni anno calcola intensità per kg e per m²
    const intYears = G.calc.availableYears(data.s1, data.s2, data.s3, data.produzione)
      .slice().sort((a, b) => a - b);
    const intPerKg = [];
    const intPerM2 = [];
    intYears.forEach(y => {
      const tt = G.calc.totals(y, data.s1, data.s2, data.s3);
      const pp = (data.produzione || []).filter(p => +(p.Anno || p.anno) === +y);
      const tp = pp.reduce((a, p) => ({
        kg: a.kg + G.calc.num(p.Produzione_kg || p.produzione_kg),
        m2: a.m2 + G.calc.num(p.Produzione_m2 || p.produzione_m2)
      }), { kg: 0, m2: 0 });
      const intY = G.calc.intensity(tt, tp);
      intPerKg.push(intY.perKg);
      intPerM2.push(intY.perM2);
    });
    if (intYears.length > 0 && (intPerKg.some(v => v != null) || intPerM2.some(v => v != null))) {
      sInt.addChart(pptx.ChartType.line, [
        { name: 'kgCO₂e/m²', labels: intYears, values: intPerM2 },
        { name: 'kgCO₂e/kg', labels: intYears, values: intPerKg }
      ], {
        x: 0.5, y: 1.6, w: 12.3, h: 4.8,
        chartColors: [hex(C.brand), hex(C.accent)],
        showLegend: true, legendPos: 'b', legendFontSize: 11, legendFontFace: FONT,
        lineSize: 3, lineDataSymbol: 'circle', lineDataSymbolSize: 6,
        catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
        catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT
      });
    } else {
      sInt.addText(isEN
        ? 'Production data not available for the configured years.'
        : 'Dati di produzione non disponibili per gli anni configurati.', {
        x: 0.5, y: 3.0, w: 12.3, h: 1.0, fontSize: 14,
        color: hex(C.textMid), fontFace: FONT, align: 'center'
      });
    }
    // Calcolo intensità anche perimetro MB (S1 + S2 MB + S3)
    const totMBnum = tot.s1 + tot.s2mb + tot.s3;
    const intMBperM2 = totProd.m2 > 0 ? (totMBnum * 1000 / totProd.m2) : null;
    const intMBperKg = totProd.kg > 0 ? (totMBnum * 1000 / totProd.kg) : null;
    sInt.addText(isEN
      ? `Year ${year} · LB perimeter (S1+S2 LB+S3): ${intCur.perM2 != null ? intCur.perM2.toFixed(2) : 'n.d.'} kgCO₂e/m² · ${intCur.perKg != null ? intCur.perKg.toFixed(3) : 'n.d.'} kgCO₂e/kg.   MB perimeter (S1+S2 MB+S3): ${intMBperM2 != null ? intMBperM2.toFixed(2) : 'n.d.'} kgCO₂e/m² · ${intMBperKg != null ? intMBperKg.toFixed(3) : 'n.d.'} kgCO₂e/kg.`
      : `Anno ${year} · perimetro LB (S1+S2 LB+S3): ${intCur.perM2 != null ? intCur.perM2.toFixed(2) : 'n.d.'} kgCO₂e/m² · ${intCur.perKg != null ? intCur.perKg.toFixed(3) : 'n.d.'} kgCO₂e/kg.   Perimetro MB (S1+S2 MB+S3): ${intMBperM2 != null ? intMBperM2.toFixed(2) : 'n.d.'} kgCO₂e/m² · ${intMBperKg != null ? intMBperKg.toFixed(3) : 'n.d.'} kgCO₂e/kg.`, {
      x: 0.5, y: 6.4, w: 12.3, h: 0.7, fontSize: 10,
      color: hex(C.textMid), fontFace: FONT, italic: true
    });

    // ── Slide 15: Data quality assessment ──────────────────────
    const sQ = addSlide();
    slideTitle(sQ, t.quality, isEN
      ? `Tier breakdown by data origin · ${year}`
      : `Distribuzione del dato per origine · ${year}`);
    // Conteggi P/S/E e Definitivo/Provvisorio/Stimato
    const allRecords = [
      ...(data.s1 || []).filter(r => +(r.Anno || r.anno) === +year),
      ...(data.s2 || []).filter(r => +(r.Anno || r.anno) === +year),
      ...(data.s3 || []).filter(r => +(r.Anno || r.anno) === +year)
    ];
    const qualCount = { P: 0, S: 0, E: 0, _: 0 };
    const statCount = { Definitivo: 0, Provvisorio: 0, Stimato: 0, _: 0 };
    allRecords.forEach(r => {
      const q = r.Qualità_Dato || r.qualita_dato;
      const s = r.Stato_Dato || r.stato_dato;
      if (qualCount[q] != null) qualCount[q]++; else qualCount._++;
      if (statCount[s] != null) statCount[s]++; else statCount._++;
    });
    const totRec = allRecords.length;
    // Pie sinistra: qualità (P/S/E)
    if (totRec > 0) {
      sQ.addChart(pptx.ChartType.pie, [{
        name: 'Q', labels: [
          isEN ? 'Primary (P)' : 'Primario (P)',
          isEN ? 'Secondary (S)' : 'Secondario (S)',
          isEN ? 'Estimated (E)' : 'Stimato (E)',
          isEN ? 'Unspecified' : 'Non spec.'
        ],
        values: [qualCount.P, qualCount.S, qualCount.E, qualCount._]
      }], {
        x: 0.4, y: 1.6, w: 5.5, h: 4.5,
        chartColors: [hex(C.success), hex(C.warning), hex(C.critical), hex(C.textLow)],
        showLegend: true, legendPos: 'b', legendFontSize: 10, legendFontFace: FONT,
        showPercent: true, dataLabelFormatCode: '0%',
        dataLabelFontSize: 10, dataLabelFontFace: FONT
      });
      sQ.addText(isEN ? 'Data origin (Q tier)' : 'Origine del dato (qualità Q)', {
        x: 0.4, y: 6.2, w: 5.5, h: 0.4, fontSize: 11, bold: true,
        color: hex(C.textMid), fontFace: FONT, align: 'center'
      });
      // Pie destra: stato dato
      sQ.addChart(pptx.ChartType.pie, [{
        name: 'S',
        labels: [
          isEN ? 'Final' : 'Definitivo',
          isEN ? 'Provisional' : 'Provvisorio',
          isEN ? 'Estimated' : 'Stimato',
          isEN ? 'Unspecified' : 'Non spec.'
        ],
        values: [statCount.Definitivo, statCount.Provvisorio, statCount.Stimato, statCount._]
      }], {
        x: 6.4, y: 1.6, w: 5.5, h: 4.5,
        chartColors: [hex(C.success), hex(C.warning), hex(C.critical), hex(C.textLow)],
        showLegend: true, legendPos: 'b', legendFontSize: 10, legendFontFace: FONT,
        showPercent: true, dataLabelFormatCode: '0%',
        dataLabelFontSize: 10, dataLabelFontFace: FONT
      });
      sQ.addText(isEN ? 'Data status' : 'Stato del dato', {
        x: 6.4, y: 6.2, w: 5.5, h: 0.4, fontSize: 11, bold: true,
        color: hex(C.textMid), fontFace: FONT, align: 'center'
      });
      sQ.addText(isEN
        ? `Total records analyzed: ${totRec}. Primary share: ${(qualCount.P / totRec * 100).toFixed(0)}% · Final share: ${(statCount.Definitivo / totRec * 100).toFixed(0)}%.`
        : `Record analizzati: ${totRec}. Quota primaria: ${(qualCount.P / totRec * 100).toFixed(0)}% · Quota definitiva: ${(statCount.Definitivo / totRec * 100).toFixed(0)}%.`, {
        x: 0.5, y: 6.7, w: 12.3, h: 0.4, fontSize: 10,
        color: hex(C.textLow), italic: true, align: 'center', fontFace: FONT
      });
    } else {
      sQ.addText(isEN ? 'No records for the selected year.' : 'Nessun record per l\'anno selezionato.', {
        x: 0.5, y: 3.0, w: 12.3, h: 1.0, fontSize: 14,
        color: hex(C.textMid), fontFace: FONT, align: 'center'
      });
    }

    // ── Slide 16: Methodology & standards ──────────────────────
    const sMeth = addSlide();
    slideTitle(sMeth, t.methods);
    const methText2 = isEN ? [
      { text: 'Reporting standard\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'GHG Protocol Corporate Accounting and Reporting Standard (revised edition).\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: T.alignment ? `Alignment: ${T.alignment}\n\n` : '\n',
        options: { fontSize: 12, color: hex(C.textMid) } },
      { text: 'Calculation model\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'Activity data × Emission Factor / 1000 → tCO₂e. The same algebraic kernel is used for Scope 1, Scope 2 (Location-based and Market-based) and Scope 3 contributions.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Scope 2 dual reporting\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '· Location-based: applies the average emission factor of the national grid.\n· Market-based: applies the actual contractual mix, including Guarantees of Origin (GO).\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'GWP horizon\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'GWP-100 (IPCC AR6) for non-CO₂ gases (CH₄, N₂O, HFCs).\n\n',
        options: { fontSize: 12, color: hex(C.text) } }
    ] : [
      { text: 'Standard di rendicontazione\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'GHG Protocol Corporate Accounting and Reporting Standard (revised edition).\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: T.alignment ? `Allineamento: ${T.alignment}\n\n` : '\n',
        options: { fontSize: 12, color: hex(C.textMid) } },
      { text: 'Modello di calcolo\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'Dato di attività × Fattore di emissione / 1000 → tCO₂e. Stesso kernel algebrico per Scope 1, Scope 2 (LB e MB) e Scope 3.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Doppio reporting Scope 2\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '· Location-based: usa il fattore medio della rete elettrica nazionale.\n· Market-based: usa il mix contrattuale reale, incluse le Garanzie di Origine (GO).\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Orizzonte GWP\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'GWP-100 (IPCC AR6) per i gas non-CO₂ (CH₄, N₂O, HFC).\n\n',
        options: { fontSize: 12, color: hex(C.text) } }
    ];
    sMeth.addText(methText2, {
      x: 0.5, y: 1.55, w: 12.3, h: 5.4, fontFace: FONT,
      paraSpaceAfter: 4, lineSpacingMultiple: 1.25
    });

    // ── Slide 17: Boundary & reporting period ──────────────────
    const sBnd = addSlide();
    slideTitle(sBnd, t.boundary);
    const sitesTotal = (data.anagrafiche || []).length;
    const sitesWithData = new Set();
    ['s1','s2','s3','produzione'].forEach(tbl => {
      (data[tbl] || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
        const k = r.Codice_Sito || r.codice_sito;
        if (k) sitesWithData.add(k);
      });
    });
    const yearsCovered = G.calc.availableYears(data.s1, data.s2, data.s3, data.produzione);
    const bndText = isEN ? [
      { text: 'Consolidation approach\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'Operational control. The Group reports 100% of the emissions from operations under its operational control, regardless of equity share.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Geographic boundary\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: `Italy. ${sitesTotal} site${sitesTotal === 1 ? '' : 's'} mapped, ${sitesWithData.size} with operational data in ${year}.\n\n`,
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Reporting period\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: `Calendar year ${year}. Years covered in inventory: ${yearsCovered.length > 0 ? yearsCovered.slice().sort().join(', ') : 'n.d.'}.\n\n`,
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Sites in scope\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      ...sitesDetail.map(s => ({
        text: `· ${s.code} — ${s.name} (${s.tipo})${s.chp ? ' · CHP' : ''}${s.ets ? ' · EU ETS' : ''}\n`,
        options: { fontSize: 11, color: hex(C.text) }
      }))
    ] : [
      { text: 'Approccio di consolidamento\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'Controllo operativo. Il Gruppo rendiconta il 100% delle emissioni delle operazioni in controllo operativo, indipendentemente dalla quota di partecipazione.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Perimetro geografico\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: `Italia. ${sitesTotal} sit${sitesTotal === 1 ? 'o mappato' : 'i mappati'}, ${sitesWithData.size} con dati operativi nell'anno ${year}.\n\n`,
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Periodo di rendicontazione\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: `Anno solare ${year}. Anni coperti dall'inventario: ${yearsCovered.length > 0 ? yearsCovered.slice().sort().join(', ') : 'n.d.'}.\n\n`,
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Siti in perimetro\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      ...sitesDetail.map(s => ({
        text: `· ${s.code} — ${s.name} (${s.tipo})${s.chp ? ' · CHP' : ''}${s.ets ? ' · EU ETS' : ''}\n`,
        options: { fontSize: 11, color: hex(C.text) }
      }))
    ];
    sBnd.addText(bndText, {
      x: 0.5, y: 1.55, w: 12.3, h: 5.4, fontFace: FONT,
      paraSpaceAfter: 3, lineSpacingMultiple: 1.2
    });

    // ── Slide 19: Emission Factors Reference ───────────────────
    // Note: i valori numerici dei FE non sono inclusi perché alcuni sono
    //       proprietari (ecoinvent) o coperti da licenza che ne limita la
    //       ridistribuzione pubblica. Mostriamo struttura, anno di
    //       validità, unità e fonte: sufficiente per dimostrare rigore
    //       metodologico senza esporre coefficienti riservati.
    const sFE = addSlide();
    slideTitle(sFE, t.feRef, isEN
      ? `Inventory of emission factors used for ${year}`
      : `Inventario dei fattori di emissione utilizzati nei calcoli ${year}`);
    // Trova i FE ID effettivamente usati nei record dell'anno
    const usedFE = new Set();
    (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      if (r.Combustibile || r.combustibile) usedFE.add(r.Combustibile || r.combustibile);
    });
    (data.s3 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      if (r.Codice_FE || r.codice_fe) usedFE.add(r.Codice_FE || r.codice_fe);
    });
    // FE rilevanti: filtra per anno_validità == year
    const feRows = (data.fe || [])
      .filter(f => +(f.Anno_Validità || f.anno_validita) === +year)
      .filter(f => usedFE.has(f.Codice_Voce || f.codice_voce) || usedFE.has(f.FE_ID || f.fe_id))
      .slice(0, 22);
    const feTbl = [[
      { text: 'FE_ID',           options: { bold: true, fontSize: 10 } },
      { text: isEN ? 'Family' : 'Famiglia',  options: { bold: true, fontSize: 10 } },
      { text: isEN ? 'Code' : 'Codice voce', options: { bold: true, fontSize: 10 } },
      { text: isEN ? 'Validity year' : 'Anno validità', options: { bold: true, fontSize: 10, align: 'center' } },
      { text: isEN ? 'Unit' : 'Unità',       options: { bold: true, fontSize: 10 } },
      { text: isEN ? 'Source' : 'Fonte',     options: { bold: true, fontSize: 10 } }
    ]];
    feRows.forEach(f => {
      feTbl.push([
        { text: (f.FE_ID || f.fe_id || '—'), options: { fontSize: 9 } },
        { text: f.Famiglia || f.famiglia || '—', options: { fontSize: 9 } },
        { text: f.Codice_Voce || f.codice_voce || '—', options: { fontSize: 9 } },
        { text: String(f.Anno_Validità || f.anno_validita || '—'), options: { fontSize: 9, align: 'center' } },
        { text: f.Unità || f.unita || '—', options: { fontSize: 9 } },
        { text: f.Fonte || f.fonte || '—', options: { fontSize: 9 } }
      ]);
    });
    if (feRows.length === 0) {
      sFE.addText(isEN
        ? `No emission factors found for year ${year}. The full FE registry is browsable from the FE Explorer section of the internal console.`
        : `Nessun fattore di emissione trovato per l'anno ${year}. Il registro completo è esplorabile da sezione FE Explorer della console interna.`, {
        x: 0.5, y: 3.0, w: 12.3, h: 1.0, fontSize: 13,
        color: hex(C.textMid), fontFace: FONT, align: 'center'
      });
    } else {
      sFE.addTable(feTbl, {
        x: 0.4, y: 1.6, w: 12.5,
        colW: [2.4, 1.8, 2.8, 1.2, 1.7, 2.6],
        fontSize: 9, fontFace: FONT, color: hex(C.text),
        border: { type: 'solid', pt: 0.5, color: hex(C.border) },
        rowH: 0.28
      });
      sFE.addText(isEN
        ? 'Sources: ISPRA (national fuels), AIB (Italian electricity), DEFRA (transport), ecoinvent (materials). Coefficient values are not disclosed in this report due to licensing restrictions on parts of the dataset (notably ecoinvent). Full version history and numerical values are tracked internally in the FE Explorer.'
        : 'Fonti: ISPRA (combustibili nazionali), AIB (elettricità italiana), DEFRA (trasporti), ecoinvent (materiali). I coefficienti numerici non sono divulgati in questo report per via dei vincoli di licenza su parte del dataset (in particolare ecoinvent). Lo storico delle versioni e i valori numerici sono tracciati internamente in FE Explorer.', {
        x: 0.4, y: 6.5, w: 12.5, h: 0.5, fontSize: 9,
        color: hex(C.textLow), italic: true, fontFace: FONT
      });
    }

    // ── Slide 19: Auditability & governance ────────────────────
    const sGov = addSlide();
    slideTitle(sGov, t.governance);
    const govText = isEN ? [
      { text: 'Tamper-evident audit log\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'All write operations on operational tables (anagrafiche, produzione, fe, s1, s2, s3, s3_materiality, app_meta) are recorded in an audit log with SHA-256 hash chain. Each row stores prev_hash + row_hash; any subsequent tampering would break the chain.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Continuous integrity verification\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'A scheduled job (every Monday at 03:30 UTC) re-walks the chain and stores the result in audit_chain_check. The 10 most recent runs are visible in the Diagnostics section.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Role-based access control\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '5 roles (admin, editor, auditor, viewer, guest). Row Level Security forced on all private tables. Privilege escalation prevented by reading roles from app_metadata only.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Strong authentication for write & audit access\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'TOTP (RFC 6238) MFA enforced at the database level for editors (writes) and auditors (audit log access). Without MFA at AAL2, the database denies the operation.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Year sign-off\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'Once an inventory year is approved, editors lose write access to that year. Only the admin can override (logged for audit).\n',
        options: { fontSize: 12, color: hex(C.text) } }
    ] : [
      { text: 'Audit log immutabile\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'Tutte le operazioni di scrittura sulle tabelle operative (anagrafiche, produzione, fe, s1, s2, s3, s3_materiality, app_meta) sono registrate in un audit log con hash chain SHA-256. Ogni riga memorizza prev_hash + row_hash; qualunque manomissione successiva spezza la catena.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Verifica continua dell\'integrità\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'Un job schedulato (lunedì 03:30 UTC) riesegue il calcolo della catena e memorizza il risultato in audit_chain_check. Gli ultimi 10 run sono visibili nella sezione Diagnostica.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Controllo accessi per ruolo\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '5 ruoli (admin, editor, auditor, viewer, guest). Row Level Security forzata su tutte le tabelle private. Escalation di privilegio prevenuta leggendo i ruoli solo da app_metadata.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Autenticazione forte per write e accesso audit\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'MFA TOTP (RFC 6238) imposta a livello DB per editor (scrittura) e auditor (lettura audit log). Senza MFA a livello AAL2, il database respinge l\'operazione.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Sign-off dell\'anno\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: 'Una volta approvato un anno di inventario, gli editor perdono i diritti di scrittura su quell\'anno. Solo l\'admin può forzare modifiche (registrate in audit).\n',
        options: { fontSize: 12, color: hex(C.text) } }
    ];
    sGov.addText(govText, {
      x: 0.5, y: 1.55, w: 12.3, h: 5.4, fontFace: FONT,
      paraSpaceAfter: 3, lineSpacingMultiple: 1.2
    });

    // ── Slide 20: Glossary ─────────────────────────────────────
    const sGlo = addSlide();
    slideTitle(sGlo, t.glossary);
    const glossary = isEN ? [
      ['tCO₂e', 'Tonnes of CO₂ equivalent. Unit converting all greenhouse gases into "how many tonnes of CO₂ would have the same climate effect" (GWP-100).'],
      ['Scope 1', 'Direct GHG emissions from sources owned or controlled by the company (e.g. fuel combustion in furnaces, fugitive F-gas).'],
      ['Scope 2', 'Indirect GHG emissions from purchased energy (electricity, district heating). Reported in dual approach: Location-based and Market-based.'],
      ['Scope 3', 'Indirect GHG emissions across the value chain (15 categories per the GHG Protocol).'],
      ['LB / MB', 'Location-based / Market-based. LB uses the average grid factor; MB uses the contractual mix, including Guarantees of Origin.'],
      ['GO', 'Guarantee of Origin. A certificate proving 100% renewable origin of purchased electricity (issued by GSE in Italy).'],
      ['FE', 'Emission Factor. Coefficient that converts an activity (e.g. kWh, kg of fuel) into kgCO₂e.'],
      ['GWP', 'Global Warming Potential. Coefficient relating the climate effect of a gas to that of CO₂ over a 100-year horizon.'],
      ['CHP', 'Combined Heat and Power. Cogeneration plant producing electricity and useful heat from a single fuel input.'],
      ['EU ETS', 'European Emissions Trading System. Cap-and-trade scheme regulating energy-intensive sectors including ceramics.'],
      ['SBTi', 'Science Based Targets initiative. Validates corporate climate targets aligned with Paris Agreement pathways.'],
      ['CSRD', 'Corporate Sustainability Reporting Directive (EU). Mandates standardized sustainability disclosure for large EU companies.']
    ] : [
      ['tCO₂e', 'Tonnellate di CO₂ equivalente. Unità che converte tutti i gas serra in "quante tonnellate di CO₂ avrebbero lo stesso effetto sul clima" (GWP-100).'],
      ['Scope 1', 'Emissioni dirette di GHG da sorgenti possedute o controllate dall\'azienda (es. combustione di gas naturale nei forni, gas fluorurati fuggitivi).'],
      ['Scope 2', 'Emissioni indirette di GHG dall\'energia acquistata (elettricità, teleriscaldamento). Doppio reporting: Location-based e Market-based.'],
      ['Scope 3', 'Emissioni indirette lungo la catena del valore (15 categorie del GHG Protocol).'],
      ['LB / MB', 'Location-based / Market-based. LB usa il fattore medio di rete; MB usa il mix contrattuale reale, incluse le Garanzie di Origine.'],
      ['GO', 'Garanzia di Origine. Certificato che attesta la provenienza 100% rinnovabile dell\'elettricità acquistata (emessa da GSE in Italia).'],
      ['FE', 'Fattore di Emissione. Coefficiente che converte un\'attività (es. kWh, kg di combustibile) in kgCO₂e.'],
      ['GWP', 'Global Warming Potential. Coefficiente che mette in relazione l\'effetto climatico di un gas con quello della CO₂ su orizzonte 100 anni.'],
      ['CHP', 'Combined Heat and Power. Impianto di cogenerazione che produce elettricità e calore utile da un\'unica fonte combustibile.'],
      ['EU ETS', 'Sistema di scambio quote di emissione UE. Cap-and-trade che regolamenta i settori energivori, inclusa la ceramica.'],
      ['SBTi', 'Science Based Targets initiative. Valida i target climatici aziendali allineati ai percorsi dell\'Accordo di Parigi.'],
      ['CSRD', 'Corporate Sustainability Reporting Directive (UE). Impone alle grandi aziende UE una rendicontazione di sostenibilità standardizzata.']
    ];
    const gloTbl = [[
      { text: isEN ? 'Term' : 'Termine', options: { bold: true, fontSize: 11 } },
      { text: isEN ? 'Definition' : 'Definizione', options: { bold: true, fontSize: 11 } }
    ]];
    glossary.forEach(([term, def]) => {
      gloTbl.push([
        { text: term, options: { bold: true, fontSize: 10, color: hex(C.brand) } },
        { text: def, options: { fontSize: 10 } }
      ]);
    });
    sGlo.addTable(gloTbl, {
      x: 0.5, y: 1.6, w: 12.3, colW: [1.6, 10.7],
      fontSize: 10, fontFace: FONT, color: hex(C.text),
      border: { type: 'solid', pt: 0.5, color: hex(C.border) },
      rowH: 0.4
    });

    // ── Slide 21: Disclaimer & limitations ─────────────────────
    const sLim = addSlide();
    slideTitle(sLim, t.limits);
    const limText = isEN ? [
      { text: 'Reporting limitations\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '· The inventory is calculated using the best primary data available at the time of reporting.\n· Some Scope 3 categories rely on secondary or estimated data (denoted by status "S" or "E"); see the Data Quality slide.\n· Categories marked as N/A or excluded are documented in the materiality assessment with explicit justification.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Methodological caveats\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '· The GHG Protocol allows revision of historical inventories when significant boundary changes or methodology improvements occur. The latest revision date is tracked.\n· Emission factors are versioned by year; we use the FE corresponding to the activity year, with documented fallback when the exact year is unavailable.\n· Scope 2 dual reporting is provided so the reader can assess both the physical electricity mix and the contractual reality (GO purchases).\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Future improvements\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '· Progressive substitution of secondary data with primary suppliers data (target Scope 3 cat. 1 and 4).\n· Annual review of materiality assessment for category 15 (financial investments) per PCAF v2.0.\n· Inclusion of bundled FV self-consumption in the Scope 2 perimeter when on-site PV plants come online.\n',
        options: { fontSize: 12, color: hex(C.text) } }
    ] : [
      { text: 'Limiti del report\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '· L\'inventario è calcolato usando i migliori dati primari disponibili al momento della rendicontazione.\n· Alcune categorie Scope 3 si basano su dati secondari o stimati (stato "S" o "E"); vedi la slide Qualità del Dato.\n· Le categorie marcate N.A. o escluse sono documentate nella materialità con giustificazione esplicita.\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Caveat metodologici\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '· Il GHG Protocol consente la revisione degli inventari storici in caso di cambi significativi del perimetro o di miglioramenti metodologici. La data dell\'ultima revisione è tracciata.\n· I fattori di emissione sono versionati per anno; usiamo il FE dell\'anno di attività, con fallback documentato quando l\'anno esatto non è disponibile.\n· Il doppio reporting Scope 2 consente al lettore di valutare sia il mix elettrico fisico sia la realtà contrattuale (acquisti di GO).\n\n',
        options: { fontSize: 12, color: hex(C.text) } },
      { text: 'Miglioramenti futuri\n', options: { bold: true, fontSize: 14, color: hex(C.text) } },
      { text: '· Sostituzione progressiva dei dati secondari con dati primari da fornitori (target Scope 3 cat. 1 e 4).\n· Revisione annuale della materialità per la categoria 15 (investimenti finanziari) secondo PCAF v2.0.\n· Inclusione dell\'autoconsumo FV bundled nel perimetro Scope 2 al go-live degli impianti FV interni.\n',
        options: { fontSize: 12, color: hex(C.text) } }
    ];
    sLim.addText(limText, {
      x: 0.5, y: 1.55, w: 12.3, h: 5.4, fontFace: FONT,
      paraSpaceAfter: 3, lineSpacingMultiple: 1.2
    });

    // ── Slide 23: Contact & closing (raffinata, brand-driven) ──
    const sEnd = pptx.addSlide();
    sEnd.background = { color: hex(C.brand) };
    // Linea accent verticale
    sEnd.addShape('rect', { x: 0.8, y: 2.2, w: 0.06, h: 4.0,
      fill: { color: hex(C.accent) }, line: { color: hex(C.accent), width: 0 } });
    sEnd.addText(isEN ? 'CLOSING' : 'CHIUSURA', {
      x: 1.2, y: 2.3, w: 11.0, h: 0.4, color: hex(C.accent),
      fontSize: 11, bold: true, fontFace: FONT, charSpacing: 4
    });
    sEnd.addText(isEN ? 'Thank you' : 'Grazie', {
      x: 1.2, y: 2.85, w: 11.0, h: 1.3, color: 'FFFFFF',
      fontSize: 60, bold: true, fontFace: TITLE_FONT, charSpacing: -1
    });
    sEnd.addText(isEN
      ? 'For questions or to request the full inventory data set,\nthe Sustainability Office is at your disposal.'
      : 'Per domande o per richiedere il dataset completo,\nl\'Ufficio Sostenibilità è a vostra disposizione.', {
      x: 1.2, y: 4.3, w: 11.0, h: 0.9, color: hex(C.cream),
      fontSize: 15, fontFace: FONT, italic: true, lineSpacingMultiple: 1.3
    });
    // Email + URL pubblica (placeholder build-time)
    const contactEmail = '__SUSTAINABILITY_EMAIL__';
    const publicUrl    = '__PUBLIC_DASHBOARD_URL__';
    if (!contactEmail.startsWith('__')) {
      sEnd.addText('✉  ' + contactEmail, {
        x: 1.2, y: 5.4, w: 11.0, h: 0.35, color: 'FFFFFF',
        fontSize: 13, bold: true, fontFace: FONT
      });
    }
    if (!publicUrl.startsWith('__')) {
      sEnd.addText('🔗  ' + publicUrl, {
        x: 1.2, y: 5.8, w: 11.0, h: 0.35, color: hex(C.cream),
        fontSize: 12, fontFace: FONT
      });
    }
    sEnd.addText('Sustainability Office · Gruppo Ceramiche Gresmalt', {
      x: 1.2, y: 6.6, w: 7.0, h: 0.35, color: 'FFFFFF',
      fontSize: 11, bold: true, fontFace: FONT, charSpacing: 1
    });
    sEnd.addText(isEN
      ? `Generated ${new Date().toLocaleDateString('en-GB')} · Audit chain SHA-256 verified`
      : `Generato il ${new Date().toLocaleDateString('it-IT')} · Catena audit SHA-256 verificata`, {
      x: 8.2, y: 6.6, w: 4.5, h: 0.35, color: hex(C.cream),
      fontSize: 10, italic: true, fontFace: FONT, align: 'right'
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
