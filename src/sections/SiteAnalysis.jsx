/* GHG Tool — SiteAnalysis.jsx
 *
 * SiteAnalysis section della console interna.
 * Estratta dal vecchio Stub.jsx in PR di splitting.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useMemo } = root.React;
  const C = G.COLORS;
  const fmt = G.fmt;
  // Helper condivisi estratti in src/sections/_shared.jsx
  const { isLoading, loadingSkeleton, emWithPct } = G.sectionsHelpers;

  function SiteAnalysis ({ data, year }) {
    const num = G.calc.num;
    const [s2Method, setS2Method] = G.ui.useS2Method();
    const isMB = s2Method === 'mb';
    const sites = (data.anagrafiche || []).map(a => ({
      code: a.Codice_Sito, name: a.Nome_Sito, type: a.Tipologia
    }));

    // Aggrega anno corrente + anno precedente in un solo pass.
    const aggregateBySite = (yr) => sites.map(s => {
      const s1 = (data.s1 || []).filter(r =>
        +(r.Anno || r.anno) === +yr && (r.Codice_Sito || r.codice_sito) === s.code);
      const s2 = (data.s2 || []).filter(r =>
        +(r.Anno || r.anno) === +yr && (r.Codice_Sito || r.codice_sito) === s.code);
      const prod = (data.produzione || []).find(p =>
        +(p.Anno || p.anno) === +yr && (p.Codice_Sito || p.codice_sito) === s.code);
      const it = G.calc.intensityPerSite(s1, s2, prod, { s2Method });
      return {
        code: s.code, name: s.name, type: s.type,
        s1:    s1.reduce((a, r) => a + num(r.Em_tCO2e),     0),
        s2lb:  s2.reduce((a, r) => a + num(r.Em_Loc_tCO2e), 0),
        s2mb:  s2.reduce((a, r) => a + num(r.Em_Mkt_tCO2e), 0),
        prodKg: prod ? num(prod.Produzione_kg) : null,
        prodM2: prod ? num(prod.Produzione_m2) : null,
        intM2: it.perM2,
        intKg: it.perKg
      };
    });
    const cur  = useMemo(() => aggregateBySite(year),     [data, year, s2Method]);
    const prev = useMemo(() => aggregateBySite(year - 1), [data, year, s2Method]);

    // isLoading guard DOPO i hooks per non violare rule-of-hooks
    if (isLoading(data)) return loadingSkeleton(`Analisi per Sede · ${year || ''}`);

    // Helpers che rispettano il perimetro scelto
    const s2Of = (c) => isMB ? c.s2mb : c.s2lb;
    const totOf = (c) => c.s1 + s2Of(c);

    // Tabella: aggiungo s1+s2 (perimetro scelto) totale + delta YoY su quello
    const rows = cur.map(c => {
      const p = prev.find(x => x.code === c.code);
      const totCur  = totOf(c);
      const totPrev = p ? totOf(p) : 0;
      const yoyPct = totPrev > 0 ? (totCur - totPrev) / totPrev * 100 : null;
      return {
        Codice_Sito: c.code, Nome: c.name, Tipologia: c.type,
        S1: c.s1, S2_LB: c.s2lb, S2_MB: c.s2mb,
        Tot: totCur, YoY: yoyPct,
        Prod_kg: c.prodKg, Prod_m2: c.prodM2,
        Int_m2: c.intM2, Int_kg: c.intKg
      };
    });

    // KPI summary
    const totalAll  = cur.reduce((a, c) => a + totOf(c), 0);
    const sitesWithInt  = cur.filter(c => c.intM2 != null);
    const topEmitter = cur.slice().sort((a,b) => totOf(b) - totOf(a))[0];
    const bestInt = sitesWithInt.slice().sort((a,b) => a.intM2 - b.intM2)[0];
    const worstInt = sitesWithInt.slice().sort((a,b) => b.intM2 - a.intM2)[0];

    // Bar chart: emissioni per sito (S1 + S2 perimetro scelto, stacked)
    const sortedByEm = cur.slice().sort((a,b) => totOf(b) - totOf(a));
    const s2ActiveLabel = isMB ? 'Scope 2 MB' : 'Scope 2 LB';
    const s2ActiveColor = isMB ? C.s2mkt    : C.s2loc;
    const emBarData = {
      labels: sortedByEm.map(c => c.code),
      datasets: [
        { label: 'Scope 1', data: sortedByEm.map(c => c.s1),
          backgroundColor: C.s1 },
        { label: s2ActiveLabel, data: sortedByEm.map(c => s2Of(c)),
          backgroundColor: s2ActiveColor }
      ]
    };

    // Bar chart: intensità per sito
    const sortedByInt = sitesWithInt.slice().sort((a,b) => b.intM2 - a.intM2);
    const intBarData = {
      labels: sortedByInt.map(c => c.code),
      datasets: [{
        label: 'kgCO₂e/m²',
        data: sortedByInt.map(c => c.intM2),
        backgroundColor: sortedByInt.map(c =>
          (G.SITE_COLORS && G.SITE_COLORS[c.code]) || C.brand)
      }]
    };

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 8 } },
        `Analisi per Sede · ${year}`),
      h('p', {
        style: { fontSize: 13, color: C.textMid, marginBottom: 12,
                 maxWidth: 760, lineHeight: 1.55 }
      }, 'Confronto tra i siti del Gruppo per emissioni Scope 1+2, intensità per m² e variazione vs anno precedente. Lo Scope 3 è organizzativo e non viene distribuito per sito.'),
      // Toggle LB/MB (perimetro Scope 2) — persiste in localStorage
      h('div', { style: { marginBottom: 16 } },
        h(G.ui.S2MethodToggle, {
          value: s2Method,
          onChange: setS2Method,
          hint: 'Influenza intensità, totali per sito, ranking top emitter, delta YoY e bar chart emissioni.'
        })),
      // KPI strip riassunto
      h('div', {
        style: { display: 'grid', gap: 12, marginBottom: 20,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }
      }, [
        h(G.ui.KPICard, { key: 'top',
          title: `Sito con più emissioni (${isMB ? 'MB' : 'LB'})`,
          value: topEmitter ? topEmitter.code : '—',
          sub: topEmitter
            ? emWithPct(totOf(topEmitter), totalAll, 'Gruppo')
            : '',
          color: C.s1
        }),
        h(G.ui.KPICard, { key: 'best',
          title: 'Migliore intensità m²',
          value: bestInt ? bestInt.code : '—',
          sub: bestInt ? `${bestInt.intM2.toFixed(2)} kgCO₂e/m²` : 'no production',
          color: C.success
        }),
        h(G.ui.KPICard, { key: 'worst',
          title: 'Peggiore intensità m²',
          value: worstInt && worstInt.code !== (bestInt && bestInt.code)
            ? worstInt.code : '—',
          sub: worstInt && worstInt.code !== (bestInt && bestInt.code)
            ? `${worstInt.intM2.toFixed(2)} kgCO₂e/m²` : '',
          color: C.warning
        }),
        h(G.ui.KPICard, { key: 'cov',
          title: 'Copertura intensità',
          value: `${sitesWithInt.length}/${sites.length}`,
          sub: 'siti con dato produzione',
          color: C.textMid
        })
      ]),
      // 2 bar chart
      h('div', {
        style: { display: 'grid', gap: 16,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                 marginBottom: 20 }
      }, [
        h(G.ui.Card, { key: 'em' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
            `Emissioni per sito · S1 + S2 ${isMB ? 'MB' : 'LB'}`),
          h(G.charts.ChartBar, {
            unit: 'tCO₂e', stacked: true, data: emBarData, height: 280
          })
        ]),
        h(G.ui.Card, { key: 'in' }, [
          h('div', {
            style: { display: 'flex', justifyContent: 'space-between',
                     alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }
          }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700 } },
              'Intensità per sito'),
            h('span', {
              style: { fontSize: 11, color: C.textLow, fontStyle: 'italic' }
            }, `(S1 + S2 ${isMB ? 'MB' : 'LB'}) ÷ m²`)
          ]),
          sitesWithInt.length === 0
            ? h('p', {
                style: { color: C.textLow, fontStyle: 'italic', padding: 16, fontSize: 13 }
              }, 'Nessun sito con dato produzione disponibile per quest\'anno.')
            : h(G.charts.ChartBar, {
                unit: 'kgCO₂e/m²', data: intBarData, height: 280
              })
        ])
      ]),
      // Tabella dettaglio
      h(G.ui.Card, { style: { marginBottom: 16 } }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
          'Dettaglio per sito'),
        h(G.ui.DataTable, {
          rows,
          columns: [
            { key: 'Codice_Sito', label: 'Sito',
              render: (v, r) => h('div', null, [
                h('div', { style: { fontWeight: 600 } }, v),
                h('div', { style: { fontSize: 11, color: C.textLow } }, r.Nome)
              ]) },
            { key: 'Tipologia' },
            { key: 'S1',    label: 'S1 tCO₂e',    align: 'right',
              render: v => fmt(v, 1) },
            { key: 'S2_LB', label: 'S2 LB tCO₂e', align: 'right',
              render: v => fmt(v, 1) },
            { key: 'S2_MB', label: 'S2 MB tCO₂e', align: 'right',
              render: v => fmt(v, 1) },
            { key: 'Tot', label: `Tot ${isMB ? 'MB' : 'LB'} tCO₂e`, align: 'right',
              render: v => h('strong', null, fmt(v, 1)) },
            { key: 'YoY', label: `YoY vs ${year - 1}`, align: 'right',
              render: v => v == null
                ? h('span', { style: { color: C.textLow } }, '—')
                : h('span', {
                    style: {
                      color: v < 0 ? C.success : v > 0 ? C.critical : C.textMid,
                      fontWeight: 600
                    }
                  }, `${v > 0 ? '↑ +' : v < 0 ? '↓ ' : ''}${Math.abs(v).toFixed(1)}%`)
            },
            { key: 'Prod_m2', label: 'Prod m²', align: 'right',
              render: v => v == null ? '—' : fmt(v) },
            { key: 'Int_m2', label: 'kgCO₂e/m²', align: 'right',
              render: v => v == null ? 'n.d.' : v.toFixed(2) },
            { key: 'Int_kg', label: 'kgCO₂e/kg', align: 'right',
              render: v => v == null ? 'n.d.' : v.toFixed(2) }
          ]
        })
      ])
    ]);
  }

  G.sections = G.sections || {};
  Object.assign(G.sections, { SiteAnalysis });
})(typeof window !== 'undefined' ? window : globalThis);
