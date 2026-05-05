/* GHG Tool — FEExplorer.jsx
 *
 * FEExplorer section della console interna.
 * Estratta dal vecchio Stub.jsx in PR di splitting.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;

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
  //  Scenarios — strumento what-if con leve allineate al Piano di
  //  Decarbonizzazione 2024 di Gresmalt. Calcola scenario vs baseline
  //  e vs target ufficiali (S1+S2 MB).
  // ────────────────────────────────────────────────────────────────────

  G.sections = G.sections || {};
  Object.assign(G.sections, { FEExplorer });
})(typeof window !== 'undefined' ? window : globalThis);
