/* GHG Tool — Dashboard.jsx (interna)
 *
 * Mostra i 9 KPI di gruppo + grafici scope + intensità per anno.
 * Le 2 card di intensità mostrano "n.d." se la produzione manca per
 * quell'anno e propongono il drill-down a Gestione Dati / Produzione.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useMemo } = root.React;
  const C = G.COLORS;

  function fmt (n, dec = 0) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('it-IT', {
      minimumFractionDigits: dec, maximumFractionDigits: dec
    });
  }

  function Dashboard ({ data, year, navigate }) {
    const tot = useMemo(() => G.calc.totals(year, data.s1, data.s2, data.s3), [data, year]);
    const prod = (data.produzione || [])
      .filter(p => +(p.Anno || p.anno) === +year);
    const totProd = prod.reduce((acc, p) => ({
      kg: acc.kg + (G.calc.num(p.Produzione_kg || p.produzione_kg)),
      m2: acc.m2 + (G.calc.num(p.Produzione_m2 || p.produzione_m2))
    }), { kg: 0, m2: 0 });

    const intens = G.calc.intensity({ em_total_tco2e: tot.em_total_tco2e }, totProd);
    const goPct = (() => {
      const s2y = (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year && (r.Unità || r.unita) === 'kWh');
      const tot = s2y.reduce((a,r) => a + G.calc.num(r.Quantità || r.quantita), 0);
      const go  = s2y.filter(r => (r.Voce_S2 || r.voce_s2) === 'EE_Acquistata_GO')
                     .reduce((a,r) => a + G.calc.num(r.Quantità || r.quantita), 0);
      return tot > 0 ? 100 * go / tot : 0;
    })();

    return h('div', null, [
      h('h1', {
        key: 'h',
        style: { fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 16 }
      }, `Dashboard interna · Anno ${year}`),
      h('div', {
        key: 'g',
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12, marginBottom: 24
        }
      }, [
        h(G.ui.KPICard, {
          key: 'k1', title: 'Totale GHG LB', value: fmt(tot.em_total_tco2e),
          unit: 'tCO₂e', sub: 'S1+S2 LB+S3', color: C.s1,
          onClick: () => navigate && navigate('scope')
        }),
        h(G.ui.KPICard, {
          key: 'k2', title: 'Totale GHG MB',
          value: fmt(tot.s1 + tot.s2mb + tot.s3),
          unit: 'tCO₂e', sub: 'S1+S2 MB+S3', color: C.s2mkt
        }),
        h(G.ui.KPICard, { key: 's1', title: 'Scope 1', value: fmt(tot.s1), unit: 'tCO₂e', color: C.s1 }),
        h(G.ui.KPICard, { key: 's2l', title: 'Scope 2 LB', value: fmt(tot.s2lb), unit: 'tCO₂e', color: C.s2loc }),
        h(G.ui.KPICard, { key: 's2m', title: 'Scope 2 MB', value: fmt(tot.s2mb), unit: 'tCO₂e', color: C.s2mkt }),
        h(G.ui.KPICard, { key: 's3',  title: 'Scope 3',    value: fmt(tot.s3),  unit: 'tCO₂e', color: C.s3 }),
        h(G.ui.KPICard, {
          key: 'go', title: 'Copertura GO',
          value: goPct ? `${goPct.toFixed(0)}%` : 'n.d.',
          color: '#5C7A6B', sub: 'Garanzie di Origine'
        }),
        h(G.ui.KPICard, {
          key: 'i1', title: 'Intensità m²',
          value: intens.perM2 != null ? intens.perM2.toFixed(2) : 'n.d.',
          unit: intens.perM2 != null ? 'kgCO₂e/m²' : '',
          sub: intens.perM2 == null ? 'Manca dato Produzione_m2' : null,
          color: C.s3,
          onClick: () => intens.perM2 == null ? navigate && navigate('data', 'produzione') : null
        }),
        h(G.ui.KPICard, {
          key: 'i2', title: 'Intensità kg',
          value: intens.perKg != null ? intens.perKg.toFixed(0) : 'n.d.',
          unit: intens.perKg != null ? 'g CO₂e/kg' : '',
          sub: intens.perKg == null ? 'Manca dato Produzione_kg' : null,
          color: C.accent,
          onClick: () => intens.perKg == null ? navigate && navigate('data', 'produzione') : null
        })
      ]),
      h('div', {
        key: 'ch',
        style: {
          display: 'grid', gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))'
        }
      }, [
        h(G.ui.Card, { key: 'c1' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
            'Composizione per scope'),
          h(G.charts.ChartDonut, {
            data: {
              labels: ['Scope 1','Scope 2 LB','Scope 3'],
              datasets: [{
                data: [tot.s1, tot.s2lb, tot.s3],
                backgroundColor: [C.s1, C.s2loc, C.s3], borderWidth: 0
              }]
            }
          })
        ]),
        h(G.ui.Card, { key: 'c2' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
            'S1 per sito'),
          h(G.charts.ChartBar, {
            data: (() => {
              const grp = {};
              (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year)
                .forEach(r => {
                  const k = r.Codice_Sito || r.codice_sito;
                  grp[k] = (grp[k] || 0) + G.calc.num(r.Em_tCO2e || r.em_tco2e);
                });
              const labels = Object.keys(grp);
              return {
                labels,
                datasets: [{
                  label: 'tCO₂e',
                  data: labels.map(k => grp[k]),
                  backgroundColor: labels.map(k => G.SITE_COLORS[k] || C.brand)
                }]
              };
            })()
          })
        ])
      ])
    ]);
  }

  G.sections = G.sections || {};
  G.sections.Dashboard = Dashboard;
})(typeof window !== 'undefined' ? window : globalThis);
