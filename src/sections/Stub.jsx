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

  // fmt è centralizzato in G.fmt (constants.js)
  const fmt = G.fmt;

  // ── helper: loading state coerente per sezioni vuote ────────────
  function isLoading (data) {
    return !data || (
      (data.s1 || []).length === 0 &&
      (data.s2 || []).length === 0 &&
      (data.s3 || []).length === 0 &&
      (data.produzione || []).length === 0 &&
      (data.anagrafiche || []).length === 0
    );
  }
  function loadingSkeleton (title) {
    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } }, title),
      h('div', {
        style: { display: 'grid', gap: 12, marginBottom: 20,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }
      }, [1,2,3,4].map(i => h(G.ui.Skeleton, { key: i, height: 110, radius: 12 }))),
      h(G.ui.Skeleton, { height: 280, radius: 12 })
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  SiteAnalysis
  // ────────────────────────────────────────────────────────────────────
  function SiteAnalysis ({ data, year }) {
    const num = G.calc.num;
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
      const it = G.calc.intensityPerSite(s1, s2, prod);
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
    const cur  = useMemo(() => aggregateBySite(year),     [data, year]);
    const prev = useMemo(() => aggregateBySite(year - 1), [data, year]);

    // isLoading guard DOPO i hooks per non violare rule-of-hooks
    if (isLoading(data)) return loadingSkeleton(`Analisi per Sede · ${year || ''}`);

    // Tabella: aggiungo s1+s2 LB totale + delta YoY su quel totale
    const rows = cur.map(c => {
      const p = prev.find(x => x.code === c.code);
      const totLB     = c.s1 + c.s2lb;
      const totLBPrev = p ? p.s1 + p.s2lb : 0;
      const yoyPct = totLBPrev > 0 ? (totLB - totLBPrev) / totLBPrev * 100 : null;
      return {
        Codice_Sito: c.code, Nome: c.name, Tipologia: c.type,
        S1: c.s1, S2_LB: c.s2lb, S2_MB: c.s2mb,
        Tot_LB: totLB, YoY: yoyPct,
        Prod_kg: c.prodKg, Prod_m2: c.prodM2,
        Int_m2: c.intM2, Int_kg: c.intKg
      };
    });

    // KPI summary
    const totalLBAll  = cur.reduce((a, c) => a + c.s1 + c.s2lb, 0);
    const sitesWithInt  = cur.filter(c => c.intM2 != null);
    const topEmitter = cur.slice().sort((a,b) => (b.s1+b.s2lb) - (a.s1+a.s2lb))[0];
    const bestInt = sitesWithInt.slice().sort((a,b) => a.intM2 - b.intM2)[0];
    const worstInt = sitesWithInt.slice().sort((a,b) => b.intM2 - a.intM2)[0];

    // Bar chart: emissioni per sito (S1+S2 LB stacked)
    const sortedByEm = cur.slice().sort((a,b) => (b.s1+b.s2lb) - (a.s1+a.s2lb));
    const emBarData = {
      labels: sortedByEm.map(c => c.code),
      datasets: [
        { label: 'Scope 1', data: sortedByEm.map(c => c.s1),
          backgroundColor: C.s1 },
        { label: 'Scope 2 LB', data: sortedByEm.map(c => c.s2lb),
          backgroundColor: C.s2loc }
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
        style: { fontSize: 13, color: C.textMid, marginBottom: 16,
                 maxWidth: 760, lineHeight: 1.55 }
      }, 'Confronto tra i siti del Gruppo per emissioni Scope 1+2, intensità per m² e variazione vs anno precedente. Lo Scope 3 è organizzativo e non viene distribuito per sito.'),
      // KPI strip riassunto
      h('div', {
        style: { display: 'grid', gap: 12, marginBottom: 20,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }
      }, [
        h(G.ui.KPICard, { key: 'top',
          title: 'Sito con più emissioni',
          value: topEmitter ? topEmitter.code : '—',
          sub: topEmitter
            ? emWithPct(topEmitter.s1 + topEmitter.s2lb, totalLBAll, 'Gruppo')
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
            'Emissioni per sito · S1 + S2 LB'),
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
            }, '(S1 + S2 LB) ÷ m²')
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
            { key: 'Tot_LB', label: 'Tot LB tCO₂e', align: 'right',
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

  // ────────────────────────────────────────────────────────────────────
  //  ScopeAnalysis
  // ────────────────────────────────────────────────────────────────────
  function ScopeAnalysis ({ data, year }) {
    const [scope, setScope] = useState('s1');
    if (isLoading(data)) return loadingSkeleton(`Analisi per Scope · ${year || ''}`);
    const num = G.calc.num;
    const tot     = G.calc.totals(year, data.s1, data.s2, data.s3);
    const totPrev = G.calc.totals(year - 1, data.s1, data.s2, data.s3);

    const tabBtn = (s, label) => h('button', {
      key: s, onClick: () => setScope(s),
      style: G.ui.btnStyle({ kind: scope === s ? 'primary' : 'ghost' })
    }, label);

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        `Analisi per Scope · ${year}`),
      h('div', {
        style: { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }
      }, [
        tabBtn('s1', 'Scope 1'),
        tabBtn('s2', 'Scope 2'),
        tabBtn('s3', 'Scope 3')
      ]),
      scope === 's1' ? renderScope1(data, year, num, tot, totPrev)
        : scope === 's2' ? renderScope2(data, year, num, tot, totPrev)
        :                  renderScope3(data, year, num, tot, totPrev)
    ]);
  }

  // ── helper: percentuale safe (evita NaN su tot=0)
  function pctOf (part, total) {
    if (!total || total === 0) return null;
    return part / total * 100;
  }

  // ── helper: format "{em} tCO₂e · {pct}% di {scope}", null-safe
  function emWithPct (em, total, scopeLabel) {
    const p = pctOf(em, total);
    return `${fmt(em, 0)} tCO₂e${p != null ? ' · ' + p.toFixed(0) + '% di ' + scopeLabel : ''}`;
  }

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
  //  Scenarios — strumento what-if con leve allineate al Piano di
  //  Decarbonizzazione 2024 di Gresmalt. Calcola scenario vs baseline
  //  e vs target ufficiali (S1+S2 MB).
  // ────────────────────────────────────────────────────────────────────
  function Scenarios ({ data, year }) {
    const T = G.TARGETS;
    const num = G.calc.num;

    // Stato leve
    const [eff, setEff]         = useState(0);   // efficienza energetica %
    const [pvMw, setPvMw]       = useState(4);   // capacità PV proprietaria MWp (4 attuali)
    const [go, setGo]           = useState(0);   // % GO sul residuo
    const [electr, setElectr]   = useState(0);   // % elettrificazione gas naturale
    const [biofuel, setBiofuel] = useState(0);   // % biofuel sostitutivo CH4
    const [thinness, setThin]   = useState(0);   // % riduzione spessore prodotto
    const [eFleet, setEFleet]   = useState(0);   // % flotta aziendale elettrica
    const [prodVar, setProdVar] = useState(0);   // var. produzione %
    const [mat, setMat]         = useState(0);   // S3 cat. 1
    const [trans, setTrans]     = useState(0);   // S3 cat. 4+9
    const [ks, setKs]           = useState(0);   // S3 cat. 2

    function applyPreset (name) {
      if (name === 'reset') {
        setEff(0); setPvMw(4); setGo(0); setElectr(0); setBiofuel(0);
        setThin(0); setEFleet(0); setProdVar(0); setMat(0); setTrans(0); setKs(0);
      } else if (name === '2034') {
        // Piano 2034: PV 4 MWp, GO residuo 100%, efficienza ~15%,
        // riduzione spessori ~10%, prima elettrificazione flotta ~25%
        setEff(15); setPvMw(4); setGo(100); setElectr(0); setBiofuel(0);
        setThin(10); setEFleet(25); setProdVar(0);
        setMat(15); setTrans(15); setKs(10);
      } else if (name === '2050') {
        // Vision 2050: efficienza ~25%, PV ~15 MWp, elettrificazione 50%,
        // biofuel 30%, spessori 20%, flotta 100% elettrica
        setEff(25); setPvMw(15); setGo(100); setElectr(50); setBiofuel(30);
        setThin(20); setEFleet(100); setProdVar(0);
        setMat(40); setTrans(50); setKs(30);
      }
    }

    const tot = G.calc.totals(year, data.s1, data.s2, data.s3);

    // ─── Modello scenario ──────────────────────────────────────
    const prodFactor = 1 + prodVar / 100;

    // 1 MWp PV nel Centro-Nord Italia ≈ 1300 MWh/anno (stima settoriale).
    const pvMwhYear = pvMw * 1300;
    const s2Year = (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year);
    const s2kwh = s2Year
      .filter(r => (r.Unità || r.unita) === 'kWh')
      .reduce((a, r) => a + num(r.Quantità), 0);
    const feLocAvg = s2kwh > 0
      ? s2Year.reduce((a, r) => a + num(r.Em_Loc_tCO2e), 0) / s2kwh * 1000
      : 0.288; // fallback ISPRA 2024 kgCO₂e/kWh

    // PV proprietario sostituisce mix di rete (FE Location); cap a S2 totale
    const pvSavingTons = Math.min(pvMwhYear * 1000, s2kwh) * feLocAvg / 1000;

    // S2: PV proprietario riduce sia LB che MB di pari quantità
    let newS2lb = Math.max(0, tot.s2lb - pvSavingTons);
    let newS2mb = Math.max(0, tot.s2mb - pvSavingTons);
    // Efficienza: riduce ulteriormente
    newS2lb *= (1 - eff / 100);
    newS2mb *= (1 - eff / 100);
    // GO addizionale sul S2 MB residuo
    newS2mb *= (1 - go / 100);

    // S1: efficienza + biofuel + elettrificazione (sposta a S2)
    let newS1 = tot.s1 * (1 - eff / 100);
    const electrAmount = newS1 * electr / 100;
    newS1 -= electrAmount;
    newS1 *= (1 - biofuel / 100);
    // Spessore prodotti: ~70% del beneficio in S1 (cottura)
    newS1 *= (1 - thinness * 0.70 / 100);
    // Flotta elettrica: assumiamo combustione mobile = ~15% di S1
    newS1 *= (1 - eFleet * 0.15 / 100);

    // L'elettricità da elettrificazione carica S2 LB; con GO 100% MB resta basso
    newS2lb += electrAmount;
    // newS2mb non cambia se utente ha attivato GO 100% sul residuo

    // Variazione produzione: scala tutto
    newS1   *= prodFactor;
    newS2lb *= prodFactor;
    newS2mb *= prodFactor;

    // S3: spessore (~30% beneficio) + le 3 leve dirette
    let newS3 = tot.s3
      * (1 - thinness * 0.30 / 100)
      * (1 - (mat * 0.6 + trans * 0.25 + ks * 0.15) / 100)
      * prodFactor;

    // ─── Aggregati ─────────────────────────────────────────────
    const baselineLB = tot.em_total_tco2e;
    const scenarioLB = newS1 + newS2lb + newS3;
    const scenarioS12mb = newS1 + newS2mb;     // perimetro target
    const savingLB    = baselineLB - scenarioLB;
    const savingPctLB = baselineLB > 0 ? savingLB / baselineLB * 100 : 0;

    // Confronto con target ufficiali (perimetro S1+S2 MB)
    const vsTarget2034 = scenarioS12mb - T.shortTerm_tco2e;
    const vsTarget2050 = scenarioS12mb - T.longTerm_tco2e;

    // Intensità — tiene conto della variazione di produzione
    const prod = (data.produzione || []).filter(p => +(p.Anno || p.anno) === +year);
    const baseProdKg = prod.reduce((a,p) => a + num(p.Produzione_kg), 0);
    const baseProdM2 = prod.reduce((a,p) => a + num(p.Produzione_m2), 0);
    const intBase = G.calc.intensity({ em_total_tco2e: baselineLB },
      { kg: baseProdKg, m2: baseProdM2 });
    const intScn  = G.calc.intensity({ em_total_tco2e: scenarioLB },
      { kg: baseProdKg * prodFactor, m2: baseProdM2 * prodFactor });

    // Ranking leve per impatto assoluto
    const leverImpacts = [
      { name: 'Efficienza energetica',                color: C.s1,
        saved: (tot.s1 + tot.s2lb) * eff / 100 },
      { name: `Capacità PV proprietaria (${pvMw} MWp)`, color: C.success,
        saved: pvSavingTons },
      { name: 'GO sul S2 residuo',                    color: C.s2loc,
        saved: tot.s2mb * go / 100 },
      { name: 'Elettrificazione gas',                 color: C.s2mkt,
        saved: tot.s1 * electr / 100 },
      { name: 'Biofuel sostitutivo metano',           color: C.brand,
        saved: tot.s1 * biofuel / 100 },
      { name: 'Riduzione spessore prodotti',          color: C.accentLight,
        saved: tot.s1 * thinness * 0.7/100 + tot.s3 * thinness * 0.3/100 },
      { name: 'Flotta aziendale elettrica',           color: C.s3,
        saved: tot.s1 * eFleet * 0.15/100 },
      { name: 'Materiali low-carbon (S3 cat. 1)',     color: C.s3,
        saved: tot.s3 * 0.6 * mat / 100 },
      { name: 'Trasporti efficienti (S3 cat. 4+9)',   color: C.accentLight,
        saved: tot.s3 * 0.25 * trans / 100 },
      { name: 'Beni strumentali (S3 cat. 2)',         color: C.accent,
        saved: tot.s3 * 0.15 * ks / 100 }
    ].filter(l => l.saved > 0).sort((a, b) => b.saved - a.saved);

    // Scope breakdown
    const scopeRows = [
      { label: 'Scope 1',    base: tot.s1,   after: newS1,   color: C.s1 },
      { label: 'Scope 2 LB', base: tot.s2lb, after: newS2lb, color: C.s2loc },
      { label: 'Scope 2 MB', base: tot.s2mb, after: newS2mb, color: C.s2mkt },
      { label: 'Scope 3',    base: tot.s3,   after: newS3,   color: C.s3 }
    ];
    const maxBase = Math.max(...scopeRows.map(r => Math.max(r.base, r.after)), 1);

    // Helper UI
    function slider (label, val, setVal, max, color, suffix, step, hint) {
      return h('div', { key: label, style: { marginBottom: 14 } }, [
        h('div', {
          style: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 }
        }, [
          h('label', {
            style: { fontSize: 13, color: C.text, fontWeight: 500 }
          }, label),
          h('span', {
            style: { fontSize: 13, fontWeight: 700, color,
                     fontVariantNumeric: 'tabular-nums' }
          }, `${val}${suffix || '%'}`)
        ]),
        h('input', {
          type: 'range', min: 0, max, step: step || 1, value: val,
          onChange: e => setVal(+e.target.value),
          style: { width: '100%', accentColor: color }
        }),
        hint && h('div', {
          style: { fontSize: 11, color: C.textLow, marginTop: 2 }
        }, hint)
      ]);
    }

    function group (title, sliders) {
      return h('div', {
        key: title,
        style: { marginBottom: 18, paddingBottom: 8,
                 borderBottom: `1px solid ${C.borderSoft}` }
      }, [
        h('div', { key: 'h',
          style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                   textTransform: 'uppercase', letterSpacing: .5,
                   marginBottom: 12 }
        }, title),
        ...sliders
      ]);
    }

    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 8 } },
        `Scenari di decarbonizzazione · baseline ${year}`),
      h('p', {
        style: { fontSize: 13, color: C.textMid, marginBottom: 16,
                 maxWidth: 760, lineHeight: 1.55 }
      }, 'Simula l\'effetto delle leve del Piano di Decarbonizzazione 2024 di Gresmalt sull\'inventario corrente. Le formule sono semplificate ma allineate ai coefficienti settoriali. Usa i preset per caricare scenari di riferimento.'),
      // Preset buttons
      h('div', {
        style: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }
      }, [
        h(G.ui.Button, { kind: 'ghost', onClick: () => applyPreset('reset') }, '↻ Reset'),
        h(G.ui.Button, { kind: 'ghost', onClick: () => applyPreset('2034') }, 'Piano 2034'),
        h(G.ui.Button, { kind: 'ghost', onClick: () => applyPreset('2050') }, 'Vision 2050')
      ]),
      h('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }
      }, [
        // Colonna sinistra: leve
        h(G.ui.Card, { key: 'sl' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 16 } },
            'Leve di riduzione'),
          group('Energia & emissioni dirette', [
            slider('Efficienza energetica', eff, setEff, 50, C.s1, '%', 1,
              'Motori IE4, pompe calore, recupero calore, LED'),
            slider('Capacità PV proprietaria', pvMw, setPvMw, 30, C.success, ' MWp', 1,
              'Attuali: 4 MWp · 1 MWp ≈ 1.300 MWh/anno'),
            slider('GO sul S2 residuo', go, setGo, 100, C.s2loc, '%', 5,
              'Garanzie di Origine sull\'elettricità non da PV proprietario'),
            slider('Elettrificazione gas → elettricità', electr, setElectr, 80, C.s2mkt, '%', 5,
              'Bruciatori elettrici, atomizzatori (sposta carico da S1 a S2)'),
            slider('Biofuel sostitutivo metano', biofuel, setBiofuel, 50, C.brand, '%', 5,
              'Biogas/biometano in miscela su gas naturale')
          ]),
          group('Processo & logistica', [
            slider('Riduzione spessore prodotti', thinness, setThin, 30, C.accentLight, '%', 1,
              'Meno materie prime, energia di cottura e trasporti per m²'),
            slider('Flotta aziendale elettrica', eFleet, setEFleet, 100, C.s3, '%', 5,
              'Mezzi, carrelli elevatori, trattori interni')
          ]),
          group('Scope 3 — value chain', [
            slider('Materiali low-carbon (cat. 1)', mat, setMat, 50, C.s3, '%', 5),
            slider('Trasporti efficienti (cat. 4 + 9)', trans, setTrans, 50, C.accentLight, '%', 5),
            slider('Beni strumentali (cat. 2)', ks, setKs, 50, C.accent, '%', 5)
          ]),
          group('Volume di produzione', [
            slider('Variazione vs anno corrente', prodVar, setProdVar, 30, C.textMid, '%', 1,
              'Disaccoppia riduzione fisica da fluttuazioni industriali')
          ])
        ]),

        // Colonna destra: risultati
        h('div', { key: 'rs', style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
          // Risultato sintetico
          h(G.ui.Card, {
            key: 'lb',
            style: { borderLeft: `4px solid ${savingPctLB > 0 ? C.success : C.brand}` }
          }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 8 } },
              'Risultato scenario · S1 + S2 LB + S3'),
            h('div', { style: { fontSize: 32, fontWeight: 700,
                                fontVariantNumeric: 'tabular-nums' } },
              `${fmt(scenarioLB, 0)} tCO₂e`),
            h('div', { style: { fontSize: 13, color: C.textMid, marginTop: 4 } },
              `Baseline ${year}: ${fmt(baselineLB, 0)} tCO₂e`),
            h('div', { style: {
              fontSize: 14, color: savingPctLB > 0 ? C.success : C.textMid,
              marginTop: 4, fontWeight: 600
            }},
              `${savingPctLB > 0 ? 'Risparmio' : 'Variazione'}: ${fmt(savingLB, 0)} tCO₂e ` +
              `(${savingPctLB.toFixed(1)}%)`)
          ]),

          // Confronto con target Piano (S1+S2 MB)
          h(G.ui.Card, { key: 'tg' }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
              'Confronto col Piano · Scope 1 + 2 MB'),
            h('div', {
              style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }
            }, [
              h('div', { key: 'sc' }, [
                h('div', { style: { fontSize: 11, color: C.textMid, fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: .5 } }, 'Scenario'),
                h('div', { style: { fontSize: 18, fontWeight: 700, marginTop: 4,
                                    fontVariantNumeric: 'tabular-nums' } },
                  fmt(scenarioS12mb, 0)),
                h('div', { style: { fontSize: 11, color: C.textLow } }, 'tCO₂e')
              ]),
              h('div', { key: 't34' }, [
                h('div', { style: { fontSize: 11, color: C.textMid, fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: .5 } },
                  `Target ${T.shortTermYear}`),
                h('div', { style: { fontSize: 18, fontWeight: 700, marginTop: 4,
                                    fontVariantNumeric: 'tabular-nums' } },
                  fmt(T.shortTerm_tco2e, 0)),
                h('div', { style: {
                  fontSize: 11, fontWeight: 700,
                  color: vsTarget2034 <= 0 ? C.success : C.critical
                }}, vsTarget2034 <= 0 ? '✓ sotto target' : `+${fmt(vsTarget2034, 0)} tCO₂e`)
              ]),
              h('div', { key: 't50' }, [
                h('div', { style: { fontSize: 11, color: C.textMid, fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: .5 } },
                  `Vision ${T.longTermYear}`),
                h('div', { style: { fontSize: 18, fontWeight: 700, marginTop: 4,
                                    fontVariantNumeric: 'tabular-nums' } },
                  fmt(T.longTerm_tco2e, 0)),
                h('div', { style: {
                  fontSize: 11, fontWeight: 700,
                  color: vsTarget2050 <= 0 ? C.success : C.critical
                }}, vsTarget2050 <= 0 ? '✓ sotto target' : `+${fmt(vsTarget2050, 0)} tCO₂e`)
              ])
            ])
          ]),

          // Scope breakdown a barre
          h(G.ui.Card, { key: 'sb' }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
              'Scope breakdown'),
            ...scopeRows.map(r => h('div', {
              key: r.label, style: { marginBottom: 10 }
            }, [
              h('div', {
                style: { display: 'flex', justifyContent: 'space-between',
                         fontSize: 12, marginBottom: 4 }
              }, [
                h('span', { style: { fontWeight: 600 } }, r.label),
                h('span', { style: { color: C.textMid, fontVariantNumeric: 'tabular-nums' } },
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
            leverImpacts.length === 0
              ? h('p', { style: { color: C.textLow, fontStyle: 'italic',
                                  padding: '8px 0', fontSize: 13 } },
                  'Nessuna leva attiva. Sposta gli slider o seleziona un preset.')
              : leverImpacts.slice(0, 8).map((l, i) => h('div', {
                  key: i,
                  style: {
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '6px 0',
                    borderBottom: i < Math.min(leverImpacts.length, 8) - 1 ? `1px solid ${C.borderSoft}` : 'none'
                  }
                }, [
                  h('span', {
                    style: {
                      fontSize: 11, fontWeight: 700, color: C.textLow,
                      width: 22, textAlign: 'center'
                    }
                  }, `#${i + 1}`),
                  h('span', {
                    style: { width: 8, height: 24, background: l.color, borderRadius: 2 }
                  }),
                  h('div', { style: { flex: 1, fontSize: 13 } }, l.name),
                  h('span', {
                    style: {
                      fontSize: 13, fontWeight: 700, color: C.success,
                      fontVariantNumeric: 'tabular-nums'
                    }
                  }, `−${fmt(l.saved, 0)} tCO₂e`)
                ]))
          ]),

          // Intensità
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
            ]),
            h('p', {
              style: { fontSize: 11, color: C.textLow, fontStyle: 'italic',
                       marginTop: 8, lineHeight: 1.5 }
            }, 'L\'intensità riflette anche la variazione di volume produttivo: scenari a parità di emissioni assolute con +volume danno comunque intensità migliore.')
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
