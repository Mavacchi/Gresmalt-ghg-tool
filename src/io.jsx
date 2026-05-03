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
  //  Excel Import — anteprima diff
  //  Hard limits: 5 MB max, solo .xlsx/.xls
  // ────────────────────────────────────────────────────────────────────
  async function importExcel (file) {
    if (!file) throw new Error('Nessun file selezionato');
    if (file.size > 5 * 1024 * 1024) throw new Error('File > 5 MB rifiutato');
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Solo file .xlsx o .xls');

    const XLSX = await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const TABLES = ['anagrafiche','produzione','fe','s1','s2','s3'];
    const result = { perTable: {}, fileName: file.name, totalRows: 0 };
    for (const t of TABLES) {
      const sheetName = wb.SheetNames.find(n => n.toLowerCase() === t.toLowerCase());
      if (!sheetName) {
        result.perTable[t] = {
          rows: [], validations: [],
          summary: { total: 0, ok: 0, withErrors: 0, withWarnings: 0 },
          note: 'foglio mancante'
        };
        continue;
      }
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      // Riga Excel: header su 1, prima riga dati su 2
      const validations = rows.map((r, idx) => {
        const v = validateImportRow(t, r);
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

  // Validazione import: usa G.calc.validateRow per s1/s2/s3/fe/produzione
  // e aggiunge un check minimo per anagrafiche.
  function validateImportRow (table, row) {
    if (table === 'anagrafiche') {
      const errors = [];
      const get = (k) => row[k] != null ? row[k] : row[k.toLowerCase()];
      if (!get('Codice_Sito')) errors.push('Codice_Sito mancante');
      if (!get('Nome_Sito'))   errors.push('Nome_Sito mancante');
      return { errors, warnings: [] };
    }
    if (G.calc && G.calc.validateRow) {
      return G.calc.validateRow(table, row);
    }
    return { errors: [], warnings: [] };
  }

  // Commit con skip righe errate + fallback per-riga su errore batch:
  // se la batchUpsert intera fallisce (es. RLS lock anno, vincolo DB),
  // ritenta riga-per-riga per poter localizzare l'errore esatto.
  async function commitImport (preview) {
    if (!preview || !preview.perTable) throw new Error('Anteprima non valida');
    const role = root.__GHG_ROLE || 'viewer';
    if (!G.can.edit(role)) throw new Error('Permesso negato (admin/editor)');

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

      const validRows = validIdx.map(i => rows[i]);

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
    const safe = sanitize();
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

    // Slide 1: Cover
    const s1 = pptx.addSlide();
    s1.background = { color: C.brand.replace('#','') };
    s1.addText('Sustainability Report', {
      x: 0.5, y: 2.5, w: 12.3, h: 1, color: 'FFFFFF',
      fontSize: 44, bold: true, fontFace: 'Sora'
    });
    s1.addText(`Inventario ${year} · GHG Protocol Corporate Standard`, {
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
      ['Intensità kg', intCur.perKg != null ? `${intCur.perKg.toFixed(0)} g CO₂e/kg` : 'n.d.']
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
      { text: 'ISPRA · AIB · DEFRA · ecoinvent (versioni di pubblicazione tracciate in FE Explorer).\n\n', options: { fontSize: 12 } },
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

  function fmt (n, dec = 0) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('it-IT',
      { minimumFractionDigits: dec, maximumFractionDigits: dec,
        useGrouping: 'always' });
  }

  G.io = { exportExcel, importExcel, commitImport, exportPPTX,
           loadSheetJS, loadPptxgen };
})(typeof window !== 'undefined' ? window : globalThis);
