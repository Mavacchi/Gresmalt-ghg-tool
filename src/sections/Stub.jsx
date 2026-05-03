/* GHG Tool — Stub.jsx
 *
 * Sezioni "snelle" che riusano DataTable + KPI per le altre voci di
 * navigazione: SiteAnalysis, ScopeAnalysis, DataQuality, FEExplorer,
 * Scenarios, Output. Implementazioni complete vivono nel monolite
 * index.html; questi wrapper espongono il loro contratto pubblico.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useMemo } = root.React;
  const C = G.COLORS;

  function fmt (n, dec = 0) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('it-IT',
      { minimumFractionDigits: dec, maximumFractionDigits: dec,
        useGrouping: 'always' });
  }

  // ────────────────────────────────────────────────────────────────────
  //  SiteAnalysis
  // ────────────────────────────────────────────────────────────────────
  function SiteAnalysis ({ data, year }) {
    const sites = (data.anagrafiche || []).map(a => ({
      code: a.Codice_Sito, name: a.Nome_Sito, type: a.Tipologia
    }));
    const rows = useMemo(() => sites.map(s => {
      const s1 = (data.s1 || []).filter(r =>
        +(r.Anno || r.anno) === +year && (r.Codice_Sito || r.codice_sito) === s.code);
      const s2 = (data.s2 || []).filter(r =>
        +(r.Anno || r.anno) === +year && (r.Codice_Sito || r.codice_sito) === s.code);
      const prod = (data.produzione || []).find(p =>
        +(p.Anno || p.anno) === +year && (p.Codice_Sito || p.codice_sito) === s.code);
      const it = G.calc.intensityPerSite(s1, s2, prod);
      return {
        Codice_Sito: s.code, Nome: s.name, Tipologia: s.type,
        S1:    s1.reduce((a,r) => a + G.calc.num(r.Em_tCO2e || r.em_tco2e), 0),
        S2_LB: s2.reduce((a,r) => a + G.calc.num(r.Em_Loc_tCO2e || r.em_loc_tco2e), 0),
        S2_MB: s2.reduce((a,r) => a + G.calc.num(r.Em_Mkt_tCO2e || r.em_mkt_tco2e), 0),
        Prod_kg: prod ? G.calc.num(prod.Produzione_kg || prod.produzione_kg) : null,
        Prod_m2: prod ? G.calc.num(prod.Produzione_m2 || prod.produzione_m2) : null,
        Int_m2: it.perM2,
        Int_kg: it.perKg
      };
    }), [data, year]);

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Analisi per Sede · ${year}`),
      h(G.ui.DataTable, {
        rows,
        columns: [
          { key: 'Codice_Sito', label: 'Sito',
            render: (v, r) => h('div', null, [
              h('div', { style: { fontWeight: 600 } }, v),
              h('div', { style: { fontSize: 11, color: C.textLow } }, r.Nome)
            ]) },
          { key: 'Tipologia' },
          { key: 'S1',    label: 'S1',    align: 'right', render: v => fmt(v, 1) },
          { key: 'S2_LB', label: 'S2 LB', align: 'right', render: v => fmt(v, 1) },
          { key: 'S2_MB', label: 'S2 MB', align: 'right', render: v => fmt(v, 1) },
          { key: 'Prod_kg', label: 'Prod kg', align: 'right',
            render: v => v == null ? '—' : fmt(v) },
          { key: 'Prod_m2', label: 'Prod m²', align: 'right',
            render: v => v == null ? '—' : fmt(v) },
          { key: 'Int_m2', label: 'kgCO₂e/m²', align: 'right',
            render: v => v == null ? 'n.d.' : v.toFixed(2) },
          { key: 'Int_kg', label: 'kgCO₂e/kg', align: 'right',
            render: v => v == null ? 'n.d.' : v.toFixed(2) }
        ]
      })
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  ScopeAnalysis
  // ────────────────────────────────────────────────────────────────────
  function ScopeAnalysis ({ data, year }) {
    const [scope, setScope] = useState('s1');
    const tot = G.calc.totals(year, data.s1, data.s2, data.s3);
    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Analisi per Scope · ${year}`),
      h('div', {
        style: { display: 'flex', gap: 8, marginBottom: 16 }
      }, ['s1','s2','s3'].map(s => h('button', {
        key: s, onClick: () => setScope(s),
        style: G.ui.btnStyle({ kind: scope === s ? 'primary' : 'ghost' })
      }, s.toUpperCase()))),
      h('div', {
        style: {
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))'
        }
      }, scope === 's1' ? [
        h(G.ui.KPICard, { key: 't', title: 'Totale S1', value: fmt(tot.s1, 1), unit: 'tCO₂e', color: C.s1 })
      ] : scope === 's2' ? [
        h(G.ui.KPICard, { key: 'l', title: 'S2 LB', value: fmt(tot.s2lb, 1), unit: 'tCO₂e', color: C.s2loc }),
        h(G.ui.KPICard, { key: 'm', title: 'S2 MB', value: fmt(tot.s2mb, 1), unit: 'tCO₂e', color: C.s2mkt })
      ] : [
        h(G.ui.KPICard, { key: 't', title: 'Totale S3', value: fmt(tot.s3, 1), unit: 'tCO₂e', color: C.s3 })
      ])
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  DataQuality — 4 sotto-tab come da spec
  //   1. Controlli consigliati
  //   2. Dati da verificare
  //   3. FE da aggiornare
  //   4. Note metodologiche
  // ────────────────────────────────────────────────────────────────────
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
        style: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}` }
      }, subtabs.map(st => h('button', {
        key: st.key, onClick: () => setSubtab(st.key),
        style: {
          padding: '10px 16px', border: 'none', background: 'transparent',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
          color: subtab === st.key ? C.text : C.textMid,
          borderBottom: `2px solid ${subtab === st.key ? C.brand : 'transparent'}`,
          textTransform: 'uppercase', letterSpacing: .5
        }
      }, [st.label, ' ', h('span', {
        style: {
          padding: '1px 6px', borderRadius: 99, fontSize: 10,
          background: st.n > 0 ? C.accentSoft : 'transparent', color: C.text
        }
      }, st.n)]))),
      subtab === 'controls' && h(SubtabControls, { warnings }),
      subtab === 'verify'   && h(SubtabVerify,   { rows: all.filter(r =>
        ['S','E'].includes(r.Qualità_Dato || r.qualita_dato)) }),
      subtab === 'yoy'      && h(SubtabYoY,      { rows: yoyAnomalies, threshold: ANOMALY_THRESHOLD }),
      subtab === 'fe'       && h(SubtabFE,       { rows: oldFE, year }),
      subtab === 'notes'    && h(SubtabNotes,    { rows: notes })
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
  function FEExplorer ({ data }) {
    const [fam, setFam] = useState('');
    const [q, setQ] = useState('');
    const fams = Array.from(new Set((data.fe || []).map(f => f.Famiglia || f.famiglia))).filter(Boolean);
    const filtered = (data.fe || []).filter(f => {
      const F = f.Famiglia || f.famiglia;
      const D = String(f.Descrizione || f.descrizione || '').toLowerCase();
      const I = String(f.FE_ID || f.fe_id || '').toLowerCase();
      if (fam && F !== fam) return false;
      if (q && !D.includes(q.toLowerCase()) && !I.includes(q.toLowerCase())) return false;
      return true;
    });
    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } }, 'FE Explorer'),
      h('div', {
        style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }
      }, [
        h(G.ui.Pill, { color: !fam ? C.brand : C.textMid, key: '_all',
          children: h('button', {
            onClick: () => setFam(''),
            style: { background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }
          }, 'Tutte') }),
        ...fams.map(f => h(G.ui.Pill, {
          key: f, color: G.FAMIGLIE_FE[f] || C.brand,
          children: h('button', {
            onClick: () => setFam(f),
            style: { background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }
          }, f)
        })),
        h(G.ui.Input, {
          key: 'q', placeholder: 'Cerca…',
          value: q, onChange: e => setQ(e.target.value),
          style: { marginLeft: 'auto', width: 240 }
        })
      ]),
      h(G.ui.DataTable, {
        rows: filtered,
        columns: [
          { key: 'FE_ID', label: 'FE ID', mono: true },
          { key: 'Famiglia' },
          { key: 'Descrizione' },
          { key: 'Anno_Validità', label: 'Anno', align: 'right' },
          { key: 'Valore', align: 'right',
            render: v => v == null ? '—' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: 6, useGrouping: 'always' }) },
          { key: 'Unità' },
          { key: 'Fonte' }
        ]
      })
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Scenarios
  // ────────────────────────────────────────────────────────────────────
  function Scenarios ({ data, year }) {
    const [gas, setGas]   = useState(0);
    const [go, setGo]     = useState(0);
    const [mat, setMat]   = useState(0);
    const [trans, setTrans] = useState(0);
    const [ks, setKs]     = useState(0);

    const tot = G.calc.totals(year, data.s1, data.s2, data.s3);
    const newS1 = tot.s1 * (1 - gas / 100);
    const newS2 = tot.s2lb * (1 - go / 100);
    const newS3 = tot.s3 * (1 - (mat * 0.6 + trans * 0.25 + ks * 0.15) / 100);
    const baseline = tot.em_total_tco2e;
    const scenario = newS1 + newS2 + newS3;
    const saving   = baseline - scenario;
    const savingPct = baseline > 0 ? saving / baseline * 100 : 0;

    const prod = (data.produzione || []).filter(p => +(p.Anno || p.anno) === +year);
    const totProd = prod.reduce((a,p) => ({
      kg: a.kg + G.calc.num(p.Produzione_kg || p.produzione_kg),
      m2: a.m2 + G.calc.num(p.Produzione_m2 || p.produzione_m2)
    }), { kg: 0, m2: 0 });
    const intBase = G.calc.intensity({ em_total_tco2e: baseline }, totProd);
    const intScn  = G.calc.intensity({ em_total_tco2e: scenario }, totProd);

    // Risparmio per leva (per ranking)
    const leverImpacts = [
      { name: 'Riduzione gas naturale', val: gas, saved: tot.s1 * gas / 100, color: C.s1 },
      { name: 'Acquisto Garanzie di Origine', val: go, saved: tot.s2lb * go / 100, color: C.s2loc },
      { name: 'Materiali low-carbon (cat. 1)', val: mat, saved: tot.s3 * 0.6 * mat / 100, color: C.s3 },
      { name: 'Trasporti efficienti (cat. 4/9)', val: trans, saved: tot.s3 * 0.25 * trans / 100, color: C.accentLight },
      { name: 'Beni strumentali (cat. 2)', val: ks, saved: tot.s3 * 0.15 * ks / 100, color: C.accent }
    ].sort((a, b) => b.saved - a.saved);

    // Scope breakdown post-scenario
    const scopeRows = [
      { label: 'Scope 1', base: tot.s1, after: newS1, color: C.s1 },
      { label: 'Scope 2 LB', base: tot.s2lb, after: newS2, color: C.s2loc },
      { label: 'Scope 3', base: tot.s3, after: newS3, color: C.s3 }
    ];
    const maxBase = Math.max(...scopeRows.map(r => r.base), 1);

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Scenario Tool · ${year}`),
      h('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }
      }, [
        h(G.ui.Card, { key: 'sl' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 16 } },
            'Leve di riduzione'),
          ...[
            ['Riduzione gas naturale', gas, setGas, C.s1],
            ['Acquisto GO',            go,  setGo, C.s2loc],
            ['Materiali low-carbon',   mat, setMat, C.s3],
            ['Trasporti efficienti',   trans, setTrans, C.accentLight],
            ['Beni strumentali',       ks,  setKs, C.accent]
          ].map(([label, val, setVal, col]) => h('div', {
            key: label, style: { marginBottom: 14 }
          }, [
            h('div', {
              style: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 }
            }, [
              h('label', {
                style: { fontSize: 13, color: C.text, fontWeight: 500 }
              }, label),
              h('span', {
                style: { fontSize: 13, fontWeight: 700, color: col }
              }, `${val}%`)
            ]),
            h('input', {
              type: 'range', min: 0, max: 100, value: val,
              onChange: e => setVal(+e.target.value),
              style: { width: '100%', accentColor: col }
            })
          ]))
        ]),
        h('div', { key: 'rs', style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
          h(G.ui.Card, {
            key: 'lb',
            style: { borderLeft: `4px solid ${savingPct > 0 ? C.success : C.brand}` }
          }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 8 } },
              'Risultato LB'),
            h('div', { style: { fontSize: 32, fontWeight: 700 } },
              `${fmt(scenario, 0)} tCO₂e`),
            h('div', { style: { fontSize: 13, color: C.textMid, marginTop: 4 } },
              `Baseline ${year}: ${fmt(baseline, 0)} tCO₂e`),
            h('div', { style: {
              fontSize: 14,
              color: savingPct > 0 ? C.success : C.textMid,
              marginTop: 4, fontWeight: 600
            }},
              `${savingPct > 0 ? 'Risparmio' : 'Variazione'}: ${fmt(saving, 0)} tCO₂e ` +
              `(${savingPct.toFixed(1)}%)`)
          ]),
          // Scope breakdown a barre
          h(G.ui.Card, { key: 'sb' }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
              'Scope breakdown'),
            ...scopeRows.map(r => h('div', {
              key: r.label, style: { marginBottom: 10 }
            }, [
              h('div', {
                style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }
              }, [
                h('span', { style: { fontWeight: 600 } }, r.label),
                h('span', { style: { color: C.textMid } },
                  `${fmt(r.base, 0)} → ${fmt(r.after, 0)} tCO₂e`)
              ]),
              h('div', {
                style: { position: 'relative', height: 10, background: C.borderSoft, borderRadius: 5 }
              }, [
                h('div', { key: 'b', style: {
                  position: 'absolute', inset: '0 0 0 0',
                  width: `${r.base / maxBase * 100}%`,
                  background: r.color, opacity: .3, borderRadius: 5
                }}),
                h('div', { key: 'a', style: {
                  position: 'absolute', inset: '0 0 0 0',
                  width: `${r.after / maxBase * 100}%`,
                  background: r.color, borderRadius: 5,
                  transition: 'width .15s'
                }})
              ])
            ]))
          ]),
          // Ranking leve per impatto
          h(G.ui.Card, { key: 'rk' }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
              'Ranking leve per impatto'),
            ...leverImpacts.map((l, i) => h('div', {
              key: i,
              style: {
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '6px 0', borderBottom: i < 4 ? `1px solid ${C.borderSoft}` : 'none'
              }
            }, [
              h('span', {
                style: {
                  fontSize: 11, fontWeight: 700, color: C.textLow,
                  width: 22, textAlign: 'center'
                }
              }, `#${i + 1}`),
              h('span', {
                style: {
                  width: 8, height: 24, background: l.color, borderRadius: 2
                }
              }),
              h('div', { style: { flex: 1, fontSize: 13 } }, l.name),
              h('span', {
                style: {
                  fontSize: 13, fontWeight: 700,
                  color: l.saved > 0 ? C.success : C.textLow
                }
              }, `${fmt(l.saved, 0)} tCO₂e`)
            ]))
          ]),
          h(G.ui.Card, { key: 'in' }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 8 } },
              'Impatto su intensità'),
            h('div', { style: { fontSize: 13, color: C.textMid, lineHeight: 1.8 } }, [
              `m²: ${intBase.perM2 != null ? intBase.perM2.toFixed(2) : 'n.d.'}`,
              ' → ',
              h('strong', { key: 'm2' }, intScn.perM2 != null ? intScn.perM2.toFixed(2) : 'n.d.'),
              ' kgCO₂e/m²',
              h('br', { key: 'b' }),
              `kg: ${intBase.perKg != null ? intBase.perKg.toFixed(2) : 'n.d.'}`,
              ' → ',
              h('strong', { key: 'kg' }, intScn.perKg != null ? intScn.perKg.toFixed(2) : 'n.d.'),
              ' kgCO₂e/kg'
            ])
          ])
        ])
      ])
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Output — KPI strip + 5 insight automatici + ESG block + Snapshot
  // ────────────────────────────────────────────────────────────────────
  function Output ({ data, year }) {
    const role = root.__GHG_ROLE || 'viewer';
    const tot = G.calc.totals(year, data.s1, data.s2, data.s3);
    const prev = G.calc.totals(year - 1, data.s1, data.s2, data.s3);

    // Calcoli supporto per gli insight
    const prod = (data.produzione || []).filter(p => +(p.Anno || p.anno) === +year);
    const totProd = prod.reduce((a, p) => ({
      kg: a.kg + G.calc.num(p.Produzione_kg || p.produzione_kg),
      m2: a.m2 + G.calc.num(p.Produzione_m2 || p.produzione_m2)
    }), { kg: 0, m2: 0 });
    const intCur = G.calc.intensity(tot, totProd);

    const yearDelta = prev.em_total_tco2e > 0
      ? ((tot.em_total_tco2e - prev.em_total_tco2e) / prev.em_total_tco2e * 100) : null;
    const s2GoCovEE = (data.s2 || [])
      .filter(r => +(r.Anno || r.anno) === +year && (r.Unità || r.unita) === 'kWh');
    const totEE = s2GoCovEE.reduce((a,r) => a + G.calc.num(r.Quantità || r.quantita), 0);
    const goEE  = s2GoCovEE.filter(r => (r.Voce_S2 || r.voce_s2) === 'EE_Acquistata_GO')
      .reduce((a,r) => a + G.calc.num(r.Quantità || r.quantita), 0);
    const goPct = totEE > 0 ? goEE / totEE * 100 : 0;

    // Top sito per emissioni (S1+S2_LB)
    const sitesAgg = {};
    (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = r.Codice_Sito || r.codice_sito;
      sitesAgg[k] = (sitesAgg[k] || 0) + G.calc.num(r.Em_tCO2e || r.em_tco2e);
    });
    (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = r.Codice_Sito || r.codice_sito;
      sitesAgg[k] = (sitesAgg[k] || 0) + G.calc.num(r.Em_Loc_tCO2e || r.em_loc_tco2e);
    });
    const topSite = Object.entries(sitesAgg).sort((a,b) => b[1]-a[1])[0] || ['—', 0];
    const topPct = (topSite[1] / (tot.s1 + tot.s2lb)) * 100 || 0;

    // S3 top categoria
    const s3Agg = {};
    (data.s3 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = +(r.Categoria_S3 || r.categoria_s3);
      s3Agg[k] = (s3Agg[k] || 0) + G.calc.num(r.Em_tCO2e || r.em_tco2e);
    });
    const topS3 = Object.entries(s3Agg).sort((a,b) => b[1]-a[1])[0] || ['—', 0];

    // 5 insight auto-generati
    const insights = [];
    insights.push({
      icon: '📊', title: 'Variazione anno su anno',
      text: yearDelta == null
        ? `${year} è il primo anno disponibile, non confrontabile.`
        : `Le emissioni totali sono ${yearDelta >= 0 ? 'aumentate' : 'diminuite'} del ` +
          `${Math.abs(yearDelta).toFixed(1)}% rispetto al ${year - 1} ` +
          `(${fmt(prev.em_total_tco2e, 0)} → ${fmt(tot.em_total_tco2e, 0)} tCO₂e).`
    });
    insights.push({
      icon: '🏭', title: 'Sito principale',
      text: `${topSite[0]} contribuisce per il ${topPct.toFixed(1)}% delle emissioni di Scope 1+2 ` +
        `(${fmt(topSite[1], 0)} tCO₂e). Concentrare leve di riduzione su questo sito ` +
        `può avere il massimo impatto.`
    });
    insights.push({
      icon: '⚡', title: 'Energia rinnovabile',
      text: goPct >= 80
        ? `Eccellente: il ${goPct.toFixed(0)}% dell'energia elettrica acquistata è coperto ` +
          `da Garanzie di Origine.`
        : goPct >= 50
          ? `Buono: il ${goPct.toFixed(0)}% di EE è coperto da GO. C'è margine per arrivare al 100%.`
          : `Critico: solo il ${goPct.toFixed(0)}% di EE è coperto da GO. Aumentare la quota può ` +
            `ridurre significativamente lo Scope 2 Market-Based.`
    });
    insights.push({
      icon: '🔄', title: 'Categoria Scope 3 dominante',
      text: tot.s3 === 0
        ? `Nessuna emissione Scope 3 censita per l'anno ${year}.`
        : `La categoria S3 #${topS3[0]} (${G.CAT_NAMES?.[topS3[0]] || 'n.d.'}) pesa per ` +
          `${fmt(topS3[1], 0)} tCO₂e (${(topS3[1] / tot.s3 * 100).toFixed(1)}% dello S3).`
    });
    insights.push({
      icon: '📐', title: 'Intensità di prodotto',
      text: intCur.perM2 == null
        ? `Intensità non calcolabile: dati di produzione mancanti per il ${year}.`
        : `Intensità: ${intCur.perM2.toFixed(2)} kgCO₂e/m²` +
          (intCur.perKg != null ? ` · ${intCur.perKg.toFixed(2)} kgCO₂e/kg.` : '.') +
          ` Questi rapporti sono i KPI ESG più utilizzati nel reporting di settore.`
    });

    async function downloadSnapshot () {
      try {
        const payload = {
          year, generated_at: new Date().toISOString(),
          schema_version: '1', anagrafiche: data.anagrafiche, produzione: data.produzione,
          fe: data.fe, s1: data.s1, s2: data.s2, s3: data.s3,
          s3_materiality: data.s3_materiality
        };
        const sb = G.db.getClient();
        const { data: signed, error } = await sb.functions.invoke('sign_snapshot', { body: payload });
        if (error) throw error;
        const file = { ...payload, _signature: signed };
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = root.document.createElement('a');
        a.href = url;
        a.download = `snapshot_${year}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        G.ui.pushToast('Snapshot firmato scaricato', 'success');
      } catch (e) {
        G.ui.pushToast('Snapshot fallito: ' + (e.message || 'errore Edge Function'), 'error');
      }
    }

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Output / Report · ${year}`),
      // KPI strip
      h('div', {
        style: {
          display: 'grid', gap: 12, marginBottom: 24,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))'
        }
      }, [
        h(G.ui.KPICard, { key: 't', title: 'Totale LB', value: fmt(tot.em_total_tco2e, 0), unit: 'tCO₂e', color: C.brand }),
        h(G.ui.KPICard, { key: 's1', title: 'Scope 1', value: fmt(tot.s1, 0), unit: 'tCO₂e', color: C.s1 }),
        h(G.ui.KPICard, { key: 's2', title: 'Scope 2 LB', value: fmt(tot.s2lb, 0), unit: 'tCO₂e', color: C.s2loc }),
        h(G.ui.KPICard, { key: 's3', title: 'Scope 3', value: fmt(tot.s3, 0), unit: 'tCO₂e', color: C.s3 }),
        h(G.ui.KPICard, { key: 'ik', title: 'Intensità m²',
          value: intCur.perM2 != null ? intCur.perM2.toFixed(2) : 'n.d.',
          unit: 'kgCO₂e/m²', color: C.accentLight }),
        h(G.ui.KPICard, { key: 'ikg', title: 'Intensità kg',
          value: intCur.perKg != null ? intCur.perKg.toFixed(2) : 'n.d.',
          unit: 'kgCO₂e/kg', color: C.accentLight })
      ]),
      // Insight automatici
      h(G.ui.Card, { style: { marginBottom: 16 } }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } }, 'Insight automatici'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          insights.map((ins, i) => h('div', {
            key: i,
            style: {
              display: 'flex', gap: 12, padding: 12,
              background: i % 2 ? '#fff' : C.bg, borderRadius: 8
            }
          }, [
            h('div', { style: { fontSize: 22 } }, ins.icon),
            h('div', { style: { flex: 1 } }, [
              h('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, ins.title),
              h('div', { style: { fontSize: 13, color: C.textMid, lineHeight: 1.6 } }, ins.text)
            ])
          ]))
        )
      ]),
      // ESG text block
      h(G.ui.Card, { style: { marginBottom: 16 } }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
          'Riepilogo ESG (testo pronto da copiare)'),
        h('pre', {
          style: {
            background: C.brand, color: C.cream, padding: 24, borderRadius: 8,
            fontFamily: 'Sora, sans-serif', fontSize: 13, lineHeight: 1.7,
            whiteSpace: 'pre-wrap', overflow: 'auto'
          }
        },
`Inventario ${year} · GHG Protocol Corporate Standard

Scope 1:    ${fmt(tot.s1, 0)} tCO₂e
Scope 2 LB: ${fmt(tot.s2lb, 0)} tCO₂e
Scope 2 MB: ${fmt(tot.s2mb, 0)} tCO₂e
Scope 3:    ${fmt(tot.s3, 0)} tCO₂e
─────────────────────────
Totale LB:  ${fmt(tot.em_total_tco2e, 0)} tCO₂e

Intensità: ${intCur.perM2 != null ? intCur.perM2.toFixed(2) + ' kgCO₂e/m²' : 'n.d.'}` +
(intCur.perKg != null ? ` · ${intCur.perKg.toFixed(2)} kgCO₂e/kg` : '') + `

Boundary: controllo operativo, 7 siti del gruppo
Fattori emissivi: ISPRA, AIB, DEFRA, ecoinvent
Categorie S3 incluse: vedere sezione Materialità S3`)
      ]),
      // Export PPTX
      h(G.ui.Card, { style: { marginBottom: 16 } }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 8 } },
          'Export presentazione'),
        h('p', { style: { fontSize: 13, color: C.textMid, marginBottom: 12 } },
          'Genera un file PowerPoint (6 slide: cover, KPI, scope breakdown, ' +
          'trend, S3 per categoria, note metodologiche).'),
        h(G.ui.Button, {
          kind: 'primary',
          onClick: async () => {
            try {
              G.ui.pushToast('Generazione PPTX in corso…', 'info');
              await G.io.exportPPTX(data, year);
              G.ui.pushToast('Presentazione scaricata', 'success');
            } catch (e) { G.ui.pushToast(e.message || 'Export PPTX fallito', 'error'); }
          }
        }, '⤓ Scarica PPTX (6 slide)')
      ]),
      // Snapshot button (admin)
      G.can.delete(role) && h(G.ui.Card, null, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 8 } },
          'Snapshot inventario firmato'),
        h('p', { style: { fontSize: 13, color: C.textMid, marginBottom: 12 } },
          'Genera un file JSON di tutti i dati con firma HMAC-SHA256 ' +
          '(via Edge Function sign_snapshot). Utile per audit di terzi e ' +
          'recovery a freddo.'),
        h(G.ui.Button, {
          kind: 'primary', onClick: downloadSnapshot
        }, '⤓ Scarica snapshot firmato')
      ])
    ]);
  }

  G.sections = G.sections || {};
  Object.assign(G.sections, {
    SiteAnalysis, ScopeAnalysis, DataQuality, FEExplorer, Scenarios, Output
  });
})(typeof window !== 'undefined' ? window : globalThis);
