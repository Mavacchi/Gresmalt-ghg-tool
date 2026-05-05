/* GHG Tool — ScopeAnalysis.jsx
 *
 * ScopeAnalysis section della console interna.
 * Estratta dal vecchio Stub.jsx in PR di splitting.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;
  const fmt = G.fmt;
  // Helper condivisi estratti in src/sections/_shared.jsx
  const { isLoading, loadingSkeleton, pctOf, emWithPct } = G.sectionsHelpers;

  function ScopeAnalysis ({ data, year }) {
    const [scope, setScope] = useState('s1');
    if (isLoading(data)) return loadingSkeleton(`Analisi per Scope · ${year || ''}`);
    const num = G.calc.num;
    const tot     = G.calc.totals(year, data.s1, data.s2, data.s3);
    const totPrev = G.calc.totals(year - 1, data.s1, data.s2, data.s3);

    const tabBtn = (s, label) => h('button', {
      key: s, type: 'button',
      role: 'tab',
      'aria-selected': scope === s,
      'aria-controls': `sa-panel-${s}`,
      id: `sa-tab-${s}`,
      onClick: () => setScope(s),
      style: G.ui.btnStyle({ kind: scope === s ? 'primary' : 'ghost' })
    }, label);

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Analisi per Scope · ${year}`),
      h('div', {
        role: 'tablist', 'aria-label': 'Selettore Scope',
        style: { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }
      }, [
        tabBtn('s1', 'Scope 1'),
        tabBtn('s2', 'Scope 2'),
        tabBtn('s3', 'Scope 3')
      ]),
      h('div', {
        role: 'tabpanel',
        id: `sa-panel-${scope}`,
        'aria-labelledby': `sa-tab-${scope}`
      },
      scope === 's1' ? renderScope1(data, year, num, tot, totPrev)
        : scope === 's2' ? renderScope2(data, year, num, tot, totPrev)
        :                  renderScope3(data, year, num, tot, totPrev)
      )
    ]);
  }

  // pctOf + emWithPct centralizzati in src/sections/_shared.jsx
  // (estratti per essere riusati anche da SiteAnalysis senza duplicazione).

  // ── helper: bar chart "ranking" da object {key: val}
  function barRanking (obj, color, height = 240, unit = 'tCO₂e') {
    const entries = Object.entries(obj)
      .map(([k, v]) => ({ k, v: +v || 0 }))
      .filter(x => x.v > 0)
      .sort((a, b) => b.v - a.v);
    if (!entries.length) {
      return h('p', {
        style: { color: C.textLow, fontStyle: 'italic', padding: 16 }
      }, 'Nessun dato disponibile.');
    }
    return h(G.charts.ChartBar, {
      unit, height, horizontal: true,
      data: {
        labels: entries.map(e => e.k),
        datasets: [{
          label: unit,
          data:  entries.map(e => e.v),
          backgroundColor: entries.map(() => color),
          borderRadius: 4
        }]
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  //  ScopeAnalysis — Scope 1
  // ────────────────────────────────────────────────────────────────────
  function renderScope1 (data, year, num, tot, totPrev) {
    const rows = (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year);

    // Aggregati: per categoria, per combustibile, per sito
    const byCat = {}, byFuel = {}, bySite = {};
    rows.forEach(r => {
      const cat = r.Categoria_S1 || 'Altro';
      const fuel = r.Combustibile || 'Altro';
      const site = r.Codice_Sito || '—';
      const em = num(r.Em_tCO2e);
      byCat[cat]   = (byCat[cat]  || 0) + em;
      byFuel[fuel] = (byFuel[fuel]|| 0) + em;
      bySite[site] = (bySite[site]|| 0) + em;
    });
    const topFuel = Object.entries(byFuel).sort((a,b) => b[1]-a[1])[0];
    const topSite = Object.entries(bySite).sort((a,b) => b[1]-a[1])[0];

    // Stacked bar: sito × categoria
    const sites = Object.keys(bySite);
    const cats  = Object.keys(byCat);
    const catMatrix = {};
    cats.forEach(c => { catMatrix[c] = sites.map(() => 0); });
    rows.forEach(r => {
      const cat  = r.Categoria_S1 || 'Altro';
      const site = r.Codice_Sito || '—';
      const idx  = sites.indexOf(site);
      if (idx >= 0) catMatrix[cat][idx] += num(r.Em_tCO2e);
    });
    const catColors = [C.s1, C.brand, C.accent, C.s3];
    const stacked = {
      labels: sites,
      datasets: cats.map((c, i) => ({
        label: c, data: catMatrix[c],
        backgroundColor: catColors[i % catColors.length]
      }))
    };

    return [
      h('div', {
        key: 'kpi',
        style: { display: 'grid', gap: 12, marginBottom: 20,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }
      }, [
        h(G.ui.KPICard, { key: 't',
          title: 'Totale Scope 1',
          value: fmt(tot.s1, 0), unit: 'tCO₂e', color: C.s1,
          delta:    totPrev.s1 > 0 ? (tot.s1 - totPrev.s1) / totPrev.s1 * 100 : null,
          deltaRef: totPrev.s1 > 0 ? `vs ${year - 1}` : null
        }),
        h(G.ui.KPICard, { key: 'tf',
          title: 'Combustibile principale',
          value: topFuel ? topFuel[0] : '—',
          sub: topFuel ? emWithPct(topFuel[1], tot.s1, 'S1') : '',
          color: C.brand
        }),
        h(G.ui.KPICard, { key: 'ts',
          title: 'Sito principale',
          value: topSite ? topSite[0] : '—',
          sub: topSite ? emWithPct(topSite[1], tot.s1, 'S1') : '',
          color: C.accent
        })
      ]),
      h('div', { key: 'g',
        style: { display: 'grid', gap: 16,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', marginBottom: 16 }
      }, [
        h(G.ui.Card, { key: 'cat' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
            'Composizione per categoria'),
          h(G.charts.ChartDonut, {
            unit: 'tCO₂e',
            data: {
              labels: Object.keys(byCat),
              datasets: [{
                data: Object.values(byCat),
                backgroundColor: catColors.slice(0, Object.keys(byCat).length),
                borderWidth: 0
              }]
            }
          })
        ]),
        h(G.ui.Card, { key: 'st' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
            'Per sito × categoria'),
          h(G.charts.ChartBar, {
            unit: 'tCO₂e', stacked: true, data: stacked, height: 280
          })
        ])
      ]),
      h(G.ui.Card, { key: 'fr' }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
          'Ranking combustibili per emissioni'),
        barRanking(byFuel, C.s1, 240)
      ])
    ];
  }

  // ────────────────────────────────────────────────────────────────────
  //  ScopeAnalysis — Scope 2
  // ────────────────────────────────────────────────────────────────────
  function renderScope2 (data, year, num, tot, totPrev) {
    const rows = (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year);

    // Per sito: kWh, em LB, em MB
    const bySite = {};
    let totKwh = 0, totGoKwh = 0;
    rows.forEach(r => {
      const site = r.Codice_Sito || '—';
      const isKwh = (r.Unità || r.unita) === 'kWh';
      const qty   = num(r.Quantità);
      const isGo  = (r.Voce_S2 || r.voce_s2) === 'EE_Acquistata_GO';
      if (isKwh) {
        totKwh   += qty;
        if (isGo) totGoKwh += qty;
      }
      if (!bySite[site]) bySite[site] = { kwh: 0, kwhGO: 0, lb: 0, mb: 0 };
      if (isKwh) {
        bySite[site].kwh += qty;
        if (isGo) bySite[site].kwhGO += qty;
      }
      bySite[site].lb += num(r.Em_Loc_tCO2e);
      bySite[site].mb += num(r.Em_Mkt_tCO2e);
    });
    const goPct = totKwh > 0 ? totGoKwh / totKwh * 100 : 0;

    // Tabella per sito
    const tableRows = Object.entries(bySite).map(([site, v]) => ({
      Sito: site,
      kWh: v.kwh,
      kWh_GO: v.kwhGO,
      GO_pct: v.kwh > 0 ? v.kwhGO / v.kwh * 100 : 0,
      LB: v.lb,
      MB: v.mb
    })).sort((a, b) => b.LB - a.LB);

    // Stacked bar GO vs no-GO per sito
    const sitesArr = tableRows.map(r => r.Sito);
    const stackedGo = {
      labels: sitesArr,
      datasets: [
        { label: 'EE con GO', data: tableRows.map(r => r.kWh_GO),
          backgroundColor: C.success },
        { label: 'EE senza GO', data: tableRows.map(r => r.kWh - r.kWh_GO),
          backgroundColor: C.s2loc }
      ]
    };

    return [
      h('div', { key: 'kpi',
        style: { display: 'grid', gap: 12, marginBottom: 20,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }
      }, [
        h(G.ui.KPICard, { key: 'l',
          title: 'Scope 2 Location-based', value: fmt(tot.s2lb, 0),
          unit: 'tCO₂e', color: C.s2loc,
          delta:    totPrev.s2lb > 0 ? (tot.s2lb - totPrev.s2lb) / totPrev.s2lb * 100 : null,
          deltaRef: totPrev.s2lb > 0 ? `vs ${year - 1}` : null
        }),
        h(G.ui.KPICard, { key: 'm',
          title: 'Scope 2 Market-based', value: fmt(tot.s2mb, 0),
          unit: 'tCO₂e', color: C.s2mkt,
          delta:    totPrev.s2mb > 0 ? (tot.s2mb - totPrev.s2mb) / totPrev.s2mb * 100 : null,
          deltaRef: totPrev.s2mb > 0 ? `vs ${year - 1}` : null,
          sub: `Risparmio MB vs LB: ${fmt(tot.s2lb - tot.s2mb, 0)} tCO₂e`
        }),
        h(G.ui.KPICard, { key: 'go',
          title: 'Copertura GO',
          value: `${goPct.toFixed(0)}%`,
          sub: `${fmt(totGoKwh, 0)} / ${fmt(totKwh, 0)} kWh acquistati`,
          color: C.success
        }),
        h(G.ui.KPICard, { key: 'kw',
          title: 'Elettricità totale',
          value: fmt(totKwh, 0), unit: 'kWh',
          color: C.textMid
        })
      ]),
      h(G.ui.Card, { key: 'go-bar', style: { marginBottom: 16 } }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
          'Copertura GO per sito'),
        h('p', {
          style: { fontSize: 12, color: C.textMid, marginBottom: 12 }
        }, 'Quote di EE acquistata con e senza Garanzie di Origine. Più verde = meglio.'),
        h(G.charts.ChartBar, {
          unit: 'kWh', stacked: true, data: stackedGo, height: 240
        })
      ]),
      h(G.ui.Card, { key: 'tbl' }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
          'Dettaglio per sito'),
        h(G.ui.DataTable, {
          rows: tableRows,
          columns: [
            { key: 'Sito' },
            { key: 'kWh', label: 'kWh totali', align: 'right',
              render: v => fmt(v, 0) },
            { key: 'kWh_GO', label: 'di cui GO', align: 'right',
              render: v => fmt(v, 0) },
            { key: 'GO_pct', label: 'GO %', align: 'right',
              render: v => `${v.toFixed(0)}%` },
            { key: 'LB', label: 'tCO₂e LB', align: 'right',
              render: v => fmt(v, 1) },
            { key: 'MB', label: 'tCO₂e MB', align: 'right',
              render: v => fmt(v, 1) }
          ]
        })
      ])
    ];
  }

  // ────────────────────────────────────────────────────────────────────
  //  ScopeAnalysis — Scope 3
  // ────────────────────────────────────────────────────────────────────
  function renderScope3 (data, year, num, tot, totPrev) {
    const rows = (data.s3 || []).filter(r => +(r.Anno || r.anno) === +year);
    const mat  = data.s3_materiality || [];
    const inclSet = new Set(mat.filter(m => m.status === 'Inclusa').map(m => +m.cat_id));

    // Per categoria
    const byCat = {};
    rows.forEach(r => {
      const c = +(r.Categoria_S3 || 0);
      byCat[c] = (byCat[c] || 0) + num(r.Em_tCO2e);
    });
    const catSorted = Object.entries(byCat)
      .map(([c, em]) => ({ cat: +c, em }))
      .sort((a,b) => b.em - a.em);
    const top = catSorted[0];

    // Sottocategoria — per top 3 cat
    const top3Cats = catSorted.slice(0, 3).map(c => c.cat);
    const subRows = rows
      .filter(r => top3Cats.includes(+(r.Categoria_S3 || 0)))
      .map(r => ({
        Cat: +(r.Categoria_S3 || 0),
        Sottocat: r.Sottocategoria || '—',
        Metodo: r.Metodo || '—',
        Quantita: num(r.Quantità),
        Unita: r.Unità || '',
        Em: num(r.Em_tCO2e)
      })).sort((a, b) => b.Em - a.Em);

    return [
      h('div', { key: 'kpi',
        style: { display: 'grid', gap: 12, marginBottom: 20,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }
      }, [
        h(G.ui.KPICard, { key: 't',
          title: 'Totale Scope 3', value: fmt(tot.s3, 0), unit: 'tCO₂e',
          color: C.s3,
          delta:    totPrev.s3 > 0 ? (tot.s3 - totPrev.s3) / totPrev.s3 * 100 : null,
          deltaRef: totPrev.s3 > 0 ? `vs ${year - 1}` : null
        }),
        h(G.ui.KPICard, { key: 'inc',
          title: 'Categorie incluse', value: `${inclSet.size}/15`,
          sub: 'da Materialità Scope 3', color: C.s3
        }),
        h(G.ui.KPICard, { key: 'top',
          title: 'Categoria dominante',
          value: top ? `Cat. ${top.cat}` : '—',
          sub: top ? emWithPct(top.em, tot.s3, 'S3') : '',
          color: C.brand
        })
      ]),
      h('div', { key: 'g',
        style: { display: 'grid', gap: 16,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', marginBottom: 16 }
      }, [
        h(G.ui.Card, { key: 'rk' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
            'Ranking categorie Scope 3'),
          catSorted.length === 0
            ? h('p', { style: { color: C.textLow, fontStyle: 'italic', padding: 16 } },
                'Nessuna emissione Scope 3 per questo anno.')
            : h(G.charts.ChartBar, {
                unit: 'tCO₂e', horizontal: true, height: 280,
                data: {
                  labels: catSorted.map(c => `${c.cat} · ${(G.CAT_NAMES?.[c.cat] || '').slice(0, 28)}`),
                  datasets: [{
                    label: 'tCO₂e',
                    data: catSorted.map(c => c.em),
                    backgroundColor: catSorted.map(() => C.s3),
                    borderRadius: 4
                  }]
                }
              })
        ]),
        h(G.ui.Card, { key: 'do' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
            'Composizione (donut)'),
          catSorted.length === 0
            ? h('p', { style: { color: C.textLow, fontStyle: 'italic', padding: 16 } },
                'Nessun dato.')
            : h(G.charts.ChartDonut, {
                unit: 'tCO₂e',
                data: {
                  labels: catSorted.map(c => `Cat. ${c.cat}`),
                  datasets: [{
                    data: catSorted.map(c => c.em),
                    backgroundColor: G.CATEGORICAL || [C.s3, C.s1, C.brand, C.accent],
                    borderWidth: 0
                  }]
                }
              })
        ])
      ]),
      h(G.ui.Card, { key: 'sub' }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
          'Top sottocategorie (categorie dominanti)'),
        subRows.length === 0
          ? h('p', { style: { color: C.textLow, fontStyle: 'italic', padding: 16 } },
              'Nessuna sottocategoria registrata.')
          : h(G.ui.DataTable, {
              rows: subRows.slice(0, 20),
              columns: [
                { key: 'Cat', label: 'Cat.', align: 'right' },
                { key: 'Sottocat', label: 'Sottocategoria' },
                { key: 'Metodo' },
                { key: 'Quantita', label: 'Quantità', align: 'right',
                  render: v => fmt(v, 0) },
                { key: 'Unita', label: 'Unità' },
                { key: 'Em', label: 'tCO₂e', align: 'right',
                  render: v => fmt(v, 1) }
              ]
            })
      ])
    ];
  }

  // ────────────────────────────────────────────────────────────────────
  //  DataQuality — 4 sotto-tab come da spec
  //   1. Controlli consigliati
  //   2. Dati da verificare
  //   3. FE da aggiornare
  //   4. Note metodologiche
  // ────────────────────────────────────────────────────────────────────

  G.sections = G.sections || {};
  Object.assign(G.sections, { ScopeAnalysis });
})(typeof window !== 'undefined' ? window : globalThis);
