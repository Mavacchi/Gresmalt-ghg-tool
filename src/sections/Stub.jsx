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
      { minimumFractionDigits: dec, maximumFractionDigits: dec });
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
          { key: 'Int_m2', label: 'Int. m²', align: 'right',
            render: v => v == null ? 'n.d.' : v.toFixed(2) },
          { key: 'Int_kg', label: 'Int. kg', align: 'right',
            render: v => v == null ? 'n.d.' : v.toFixed(0) }
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
  //  DataQuality
  // ────────────────────────────────────────────────────────────────────
  function DataQuality ({ data, year }) {
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

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Data Quality · ${year}`),
      h('div', {
        style: {
          display: 'grid', gap: 12, marginBottom: 24,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))'
        }
      }, [
        h(G.ui.KPICard, { key: 'tot', title: 'Righe', value: all.length, color: C.brand }),
        h(G.ui.KPICard, { key: 'p',   title: 'Primari (P)', value: p, color: C.success }),
        h(G.ui.KPICard, { key: 's',   title: 'Secondari (S)', value: s, color: C.warning }),
        h(G.ui.KPICard, { key: 'e',   title: 'Stimati (E)', value: e, color: C.critical }),
        h(G.ui.KPICard, { key: 'sc',  title: 'Punteggio', value: `${score.toFixed(0)}/100`,
          color: score >= 80 ? C.success : score >= 50 ? C.warning : C.critical })
      ]),
      missingProd.length > 0 && h(G.ui.Card, {
        style: { borderLeft: `4px solid ${C.warning}`, marginBottom: 16 }
      }, [
        h('h3', { style: { fontSize: 14, fontWeight: 700, color: C.warning } },
          'Produzione mancante'),
        h('p', { style: { fontSize: 13, color: C.textMid, marginTop: 8 } },
          `Per l'anno ${year} mancano i dati di produzione per: ${missingProd.join(', ')}. ` +
          'L\'intensità non è calcolabile per questi siti.')
      ])
    ]);
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
            render: v => v == null ? '—' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: 6 }) },
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

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Scenario Tool · ${year}`),
      h('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }
      }, [
        h(G.ui.Card, { key: 'sl' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 16 } },
            'Leve'),
          ...[
            ['Riduzione gas', gas, setGas],
            ['+ GO',         go,  setGo],
            ['Materiali low-C', mat, setMat],
            ['Trasporti efficienti', trans, setTrans],
            ['Beni strumentali', ks, setKs]
          ].map(([label, val, setVal]) => h('div', {
            key: label, style: { marginBottom: 12 }
          }, [
            h('label', {
              style: { fontSize: 13, color: C.text, fontWeight: 500 }
            }, `${label}: ${val}%`),
            h('input', {
              type: 'range', min: 0, max: 100, value: val,
              onChange: e => setVal(+e.target.value),
              style: { width: '100%' }
            })
          ]))
        ]),
        h('div', { key: 'rs', style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
          h(G.ui.Card, {
            key: 'lb', borderLeft: C.success
          }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 8 } },
              'Risultato LB'),
            h('div', { style: { fontSize: 32, fontWeight: 700 } },
              `${fmt(scenario, 0)} tCO₂e`),
            h('div', { style: { fontSize: 13, color: C.textMid, marginTop: 4 } },
              `Baseline: ${fmt(baseline, 0)} tCO₂e`),
            h('div', { style: { fontSize: 14, color: C.success, marginTop: 4, fontWeight: 600 } },
              `Risparmio: ${fmt(saving, 0)} tCO₂e (${savingPct.toFixed(1)}%)`)
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
              `kg: ${intBase.perKg != null ? intBase.perKg.toFixed(0) : 'n.d.'}`,
              ' → ',
              h('strong', { key: 'kg' }, intScn.perKg != null ? intScn.perKg.toFixed(0) : 'n.d.'),
              ' g CO₂e/kg'
            ])
          ])
        ])
      ])
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Output
  // ────────────────────────────────────────────────────────────────────
  function Output ({ data, year }) {
    const tot = G.calc.totals(year, data.s1, data.s2, data.s3);
    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Output / Report · ${year}`),
      h(G.ui.Card, null, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 16 } },
          'Riepilogo ESG'),
        h('pre', {
          style: {
            background: C.brand, color: '#fff', padding: 24, borderRadius: 8,
            fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7,
            whiteSpace: 'pre-wrap'
          }
        },
`Inventario ${year} · GHG Protocol Corporate Standard

Scope 1:    ${fmt(tot.s1, 0)} tCO₂e
Scope 2 LB: ${fmt(tot.s2lb, 0)} tCO₂e
Scope 2 MB: ${fmt(tot.s2mb, 0)} tCO₂e
Scope 3:    ${fmt(tot.s3, 0)} tCO₂e
─────────────────────
Totale LB: ${fmt(tot.em_total_tco2e, 0)} tCO₂e

Boundary: controllo operativo, 7 siti del gruppo
Fattori emissivi: ISPRA, AIB, DEFRA, ecoinvent
Categorie S3 incluse: 1, 2, 3, 4, 5, 6, 7, 9, 12`)
      ])
    ]);
  }

  G.sections = G.sections || {};
  Object.assign(G.sections, {
    SiteAnalysis, ScopeAnalysis, DataQuality, FEExplorer, Scenarios, Output
  });
})(typeof window !== 'undefined' ? window : globalThis);
