/* GHG Tool — DataQuality.jsx
 *
 * DataQuality section della console interna.
 * Estratta dal vecchio Stub.jsx in PR di splitting.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;
  const fmt = G.fmt;

  function DataQuality ({ data, year }) {
    const [subtab, setSubtab] = useState('controls');
    const all = [...(data.s1||[]), ...(data.s2||[]), ...(data.s3||[])]
      .filter(r => +(r.Anno || r.anno) === +year);
    const p = all.filter(r => (r.Qualità_Dato || r.qualita_dato) === 'P').length;
    const s = all.filter(r => (r.Qualità_Dato || r.qualita_dato) === 'S').length;
    const e = all.filter(r => (r.Qualità_Dato || r.qualita_dato) === 'E').length;
    const score = all.length > 0 ? (p * 100 + s * 60 + e * 30) / all.length : 0;

    const missingProd = (data.anagrafiche || [])
      .filter(a => !(data.produzione || []).some(pr =>
        (pr.Codice_Sito || pr.codice_sito) === a.Codice_Sito
        && +(pr.Anno || pr.anno) === +year))
      .map(a => a.Codice_Sito);

    const def = all.filter(r => (r.Stato_Dato || r.stato_dato) === 'Definitivo').length;
    const stim = all.filter(r => (r.Stato_Dato || r.stato_dato) === 'Stimato').length;

    // Controlli consigliati: warnings sui range
    const warnings = [];
    (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const fe = +(r.FE_Location || r.fe_location || 0);
      if (fe > 0 && (fe < 0.10 || fe > 0.60)) {
        warnings.push({ level: 'warning', table: 's2',
          msg: `${r.Codice_Sito || r.codice_sito} · FE_Location ${fe} fuori range plausibile`
        });
      }
    });
    if (missingProd.length) warnings.push({
      level: 'error', table: 'produzione',
      msg: `Produzione mancante per anno ${year}, siti: ${missingProd.join(', ')}`
    });
    if (e > 0) warnings.push({
      level: 'info', table: 's*',
      msg: `${e} righe con qualità dato 'Stimato' (E) — consigliato passaggio a S o P`
    });

    // FE da aggiornare: FE con anno_validità < year - 2
    const oldFE = (data.fe || []).filter(f => {
      const av = +(f.Anno_Validità || f.anno_validita || 0);
      return av && av < year - 2;
    });

    // Note metodologiche
    const notes = all.filter(r => (r.Note || r.note || '').toString().trim().length > 0);

    // ─── ANOMALIE YoY ───────────────────────────────────
    // Per ogni riga S1/S2/S3/Produzione dell'anno corrente, cerchiamo
    // la corrispondente riga dell'anno precedente per stesso sito
    // (e categoria/voce/codice_fe). Se la quantità varia oltre la
    // soglia e la riga non ha note metodologiche, è una variazione
    // anomala da spiegare prima del sign-off.
    const ANOMALY_THRESHOLD = 30; // % in valore assoluto
    const yoyAnomalies = computeYoYAnomalies(data, year, ANOMALY_THRESHOLD);

    const subtabs = [
      { key: 'controls', label: 'Controlli consigliati', n: warnings.length },
      { key: 'verify',   label: 'Dati da verificare',    n: all.filter(r => (r.Qualità_Dato || r.qualita_dato) === 'S' || (r.Qualità_Dato || r.qualita_dato) === 'E').length },
      { key: 'yoy',      label: 'Anomalie YoY',          n: yoyAnomalies.length },
      { key: 'fe',       label: 'FE da aggiornare',      n: oldFE.length },
      { key: 'notes',    label: 'Note metodologiche',    n: notes.length }
    ];

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Data Quality · ${year}`),
      // 6 mini-card di riepilogo
      h('div', {
        style: {
          display: 'grid', gap: 12, marginBottom: 24,
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))'
        }
      }, [
        h(G.ui.KPICard, { key: 'p',   title: 'Primari (P)', value: p, color: C.success }),
        h(G.ui.KPICard, { key: 's',   title: 'Secondari (S)', value: s, color: C.warning }),
        h(G.ui.KPICard, { key: 'e',   title: 'Stimati (E)', value: e, color: C.critical }),
        h(G.ui.KPICard, { key: 'd',   title: 'Definitivi', value: def, color: C.brand }),
        h(G.ui.KPICard, { key: 'st',  title: 'Stimati (stato)', value: stim, color: C.warning }),
        h(G.ui.KPICard, { key: 'wn',  title: 'Warnings', value: warnings.length,
          color: warnings.length > 0 ? C.warning : C.success })
      ]),
      // Barra punteggio qualità
      h(G.ui.Card, { style: { marginBottom: 16 } }, [
        h('div', {
          style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 }
        }, [
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, 'Punteggio qualità complessivo'),
          h('span', { style: {
            fontSize: 14, fontWeight: 700,
            color: score >= 80 ? C.success : score >= 50 ? C.warning : C.critical
          }}, `${score.toFixed(0)}/100`)
        ]),
        h('div', { style: { height: 8, background: C.borderSoft, borderRadius: 4, overflow: 'hidden' } },
          h('div', { style: {
            height: '100%', width: `${Math.max(0, Math.min(100, score))}%`,
            background: score >= 80 ? C.success : score >= 50 ? C.warning : C.critical,
            transition: 'width .2s'
          }}))
      ]),
      // Sotto-tab
      h('div', {
        role: 'tablist', 'aria-label': 'Sotto-sezioni Data Quality',
        style: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}` }
      }, subtabs.map(st => h('button', {
        key: st.key, type: 'button',
        role: 'tab',
        'aria-selected': subtab === st.key,
        'aria-controls': `dq-panel-${st.key}`,
        id: `dq-tab-${st.key}`,
        onClick: () => setSubtab(st.key),
        style: {
          padding: '10px 16px', border: 'none', background: 'transparent',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
          color: subtab === st.key ? C.text : C.textMid,
          borderBottom: `2px solid ${subtab === st.key ? C.brand : 'transparent'}`,
          textTransform: 'uppercase', letterSpacing: .5
        }
      }, [st.label, ' ', h('span', {
        'aria-label': `${st.n} elementi`,
        style: {
          padding: '1px 6px', borderRadius: 99, fontSize: 10,
          background: st.n > 0 ? C.accentSoft : 'transparent', color: C.text
        }
      }, st.n)]))),
      h('div', {
        role: 'tabpanel',
        id: `dq-panel-${subtab}`,
        'aria-labelledby': `dq-tab-${subtab}`
      }, [
        subtab === 'controls' && h(SubtabControls, { key: 'controls', warnings }),
        subtab === 'verify'   && h(SubtabVerify,   { key: 'verify', rows: all.filter(r =>
          ['S','E'].includes(r.Qualità_Dato || r.qualita_dato)) }),
        subtab === 'yoy'      && h(SubtabYoY,      { key: 'yoy', rows: yoyAnomalies, threshold: ANOMALY_THRESHOLD }),
        subtab === 'fe'       && h(SubtabFE,       { key: 'fe', rows: oldFE, year }),
        subtab === 'notes'    && h(SubtabNotes,    { key: 'notes', rows: notes })
      ])
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  YoY anomaly detection — match per-row su (sito, categoria/voce)
  //  Skippa righe con note (assunte già spiegate). Skippa nuove voci
  //  (key non presente l'anno precedente) e righe con quantità prev = 0.
  // ────────────────────────────────────────────────────────────────────
  function rowKey (table, r) {
    if (table === 's1') return [r.Codice_Sito, r.Categoria_S1, r.Combustibile].join('|');
    if (table === 's2') return [r.Codice_Sito, r.Voce_S2].join('|');
    if (table === 's3') return [r.Categoria_S3, r.Sottocategoria, r.Codice_FE || ''].join('|');
    return r.Codice_Sito || '';
  }

  function computeYoYAnomalies (data, year, threshold) {
    const out = [];
    const num = (G.calc && G.calc.num) ? G.calc.num : (v => +v || 0);

    ['s1', 's2', 's3'].forEach(table => {
      const cur  = (data[table] || []).filter(r => +(r.Anno || r.anno) === +year);
      const prev = (data[table] || []).filter(r => +(r.Anno || r.anno) === +year - 1);
      if (!prev.length) return;
      const prevByKey = new Map();
      prev.forEach(p => {
        const k = rowKey(table, p);
        if (!prevByKey.has(k)) prevByKey.set(k, []);
        prevByKey.get(k).push(p);
      });
      cur.forEach(r => {
        if ((r.Note || '').toString().trim()) return;
        const ps = prevByKey.get(rowKey(table, r)) || [];
        if (!ps.length) return;
        const prevQty = ps.reduce((a, p) => a + num(p.Quantità), 0);
        const curQty  = num(r.Quantità);
        if (prevQty === 0) return;
        const pct = (curQty - prevQty) / prevQty * 100;
        if (Math.abs(pct) < threshold) return;
        out.push({
          table: table.toUpperCase(),
          sito:  r.Codice_Sito || '—',
          descr: r.Categoria_S1 || r.Voce_S2
                 || `Cat ${r.Categoria_S3}: ${r.Sottocategoria || ''}`,
          prev:  prevQty,
          cur:   curQty,
          pct,
          unit:  r.Unità || ''
        });
      });
    });

    // Produzione: kg e m² controllati separatamente
    const prodCur  = (data.produzione || []).filter(r => +(r.Anno || r.anno) === +year);
    const prodPrev = (data.produzione || []).filter(r => +(r.Anno || r.anno) === +year - 1);
    prodCur.forEach(r => {
      if ((r.Note || '').toString().trim()) return;
      const prev = prodPrev.find(p =>
        (p.Codice_Sito || p.codice_sito) === (r.Codice_Sito || r.codice_sito));
      if (!prev) return;
      [
        { field: 'Produzione_kg', label: 'Produzione kg', unit: 'kg' },
        { field: 'Produzione_m2', label: 'Produzione m²', unit: 'm²' }
      ].forEach(({ field, label, unit }) => {
        const cv = num(r[field]);
        const pv = num(prev[field]);
        if (pv === 0) return;
        const pct = (cv - pv) / pv * 100;
        if (Math.abs(pct) < threshold) return;
        out.push({
          table: 'PROD', sito: r.Codice_Sito,
          descr: label, prev: pv, cur: cv, pct, unit
        });
      });
    });

    out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    return out;
  }

  function SubtabYoY ({ rows, threshold }) {
    if (!rows.length) return h(G.ui.Card, null,
      h('p', { style: { color: C.textLow, textAlign: 'center', padding: 32 } },
        `Nessuna variazione anomala (oltre ±${threshold}%) priva di nota metodologica ✓`));
    return h(G.ui.DataTable, {
      rows,
      columns: [
        { key: 'table', label: 'Tab' },
        { key: 'sito',  label: 'Sito' },
        { key: 'descr', label: 'Voce' },
        { key: 'prev',  label: 'Anno –1', align: 'right',
          render: (v, r) => `${fmt(v, 2)} ${r.unit}` },
        { key: 'cur',   label: 'Anno', align: 'right',
          render: (v, r) => `${fmt(v, 2)} ${r.unit}` },
        { key: 'pct',   label: 'Δ %', align: 'right',
          render: v => h('span', {
            style: {
              color: Math.abs(v) >= 60 ? C.critical : C.warning,
              fontWeight: 700, fontVariantNumeric: 'tabular-nums'
            }
          }, `${v > 0 ? '+' : ''}${fmt(v, 1)}%`)
        }
      ]
    });
  }
  function SubtabControls ({ warnings }) {
    if (!warnings.length) return h(G.ui.Card, null,
      h('p', { style: { color: C.textLow, textAlign: 'center', padding: 32 } },
        'Nessun controllo da segnalare ✓'));
    return h(G.ui.DataTable, {
      rows: warnings,
      columns: [
        { key: 'level', label: 'Livello',
          render: v => h('span', {
            style: {
              padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase',
              background: v === 'error' ? C.criticalPale
                       : v === 'warning' ? C.warningPale : C.infoPale,
              color: v === 'error' ? C.critical
                   : v === 'warning' ? C.warning : C.info
            }
          }, v)
        },
        { key: 'table', label: 'Tabella' },
        { key: 'msg', label: 'Messaggio' }
      ]
    });
  }
  function SubtabVerify ({ rows }) {
    if (!rows.length) return h(G.ui.Card, null,
      h('p', { style: { color: C.textLow, textAlign: 'center', padding: 32 } },
        'Tutte le righe sono primarie (P) ✓'));
    return h(G.ui.DataTable, {
      rows,
      columns: [
        { key: 'Anno', label: 'Anno', align: 'right' },
        { key: 'Codice_Sito', label: 'Sito' },
        { key: 'Categoria_S1', label: 'Categoria',
          render: (_, r) => r.Categoria_S1 || r.Voce_S2 || `S3 cat ${r.Categoria_S3}` },
        { key: 'Qualità_Dato', label: 'Qualità', align: 'right' },
        { key: 'Em_tCO2e', label: 'tCO₂e', align: 'right',
          render: (v, r) => fmt(v || r.Em_Loc_tCO2e, 2) }
      ]
    });
  }
  function SubtabFE ({ rows, year }) {
    if (!rows.length) return h(G.ui.Card, null,
      h('p', { style: { color: C.textLow, textAlign: 'center', padding: 32 } },
        `Tutti i FE sono recenti (validità ≥ ${year - 2}) ✓`));
    return h(G.ui.DataTable, {
      rows,
      columns: [
        { key: 'FE_ID', label: 'FE_ID', mono: true },
        { key: 'Famiglia', label: 'Famiglia' },
        { key: 'Descrizione', label: 'Descrizione' },
        { key: 'Anno_Validità', label: 'Anno', align: 'right' },
        { key: 'Fonte', label: 'Fonte' }
      ]
    });
  }
  function SubtabNotes ({ rows }) {
    if (!rows.length) return h(G.ui.Card, null,
      h('p', { style: { color: C.textLow, textAlign: 'center', padding: 32 } },
        'Nessuna nota metodologica registrata.'));
    return h(G.ui.DataTable, {
      rows,
      columns: [
        { key: 'Anno', label: 'Anno', align: 'right' },
        { key: 'Codice_Sito', label: 'Sito' },
        { key: 'Note', label: 'Nota' }
      ]
    });
  }

  // ────────────────────────────────────────────────────────────────────
  //  FEExplorer
  // ────────────────────────────────────────────────────────────────────

  G.sections = G.sections || {};
  Object.assign(G.sections, { DataQuality });
})(typeof window !== 'undefined' ? window : globalThis);
