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
      minimumFractionDigits: dec, maximumFractionDigits: dec,
      useGrouping: 'always'
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
          value: goPct ? `${fmt(goPct, 0)}%` : 'n.d.',
          color: '#5C7A6B', sub: 'Garanzie di Origine'
        }),
        h(G.ui.KPICard, {
          key: 'i1', title: 'Intensità m²',
          value: intens.perM2 != null ? fmt(intens.perM2, 2) : 'n.d.',
          unit: intens.perM2 != null ? 'kgCO₂e/m²' : '',
          sub: intens.perM2 == null ? 'Manca dato Produzione_m2' : null,
          color: C.s3,
          onClick: () => intens.perM2 == null ? navigate && navigate('data', 'produzione') : null
        }),
        h(G.ui.KPICard, {
          key: 'i2', title: 'Intensità kg',
          // calc.intensity restituisce perKg in g/kg (× 1e6 da tCO₂e):
          // /1000 per kgCO₂e/kg, coerente con la PublicDashboard.
          value: intens.perKg != null ? fmt(intens.perKg / 1000, 2) : 'n.d.',
          unit: intens.perKg != null ? 'kgCO₂e/kg' : '',
          sub: intens.perKg == null ? 'Manca dato Produzione_kg' : null,
          color: C.accent,
          onClick: () => intens.perKg == null ? navigate && navigate('data', 'produzione') : null
        })
      ]),
      h('div', {
        key: 'ch',
        style: {
          display: 'grid', gap: 16, marginBottom: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))'
        }
      }, [
        h(G.ui.Card, { key: 'c1' }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 12 } },
            'Composizione per scope'),
          h(G.charts.ChartDonut, {
            unit: 'tCO₂e',
            data: {
              labels: ['Scope 1','Scope 2 LB','Scope 3'],
              datasets: [{
                data: [tot.s1, tot.s2lb, tot.s3],
                backgroundColor: [C.s1, C.s2loc, C.s3], borderWidth: 0
              }]
            }
          })
        ])
      ]),
      // ─── CONFRONTO SITI ─────────────────────────────────
      renderSiteComparison(data, year),
      // ─── TREND STORICO + PROIEZIONE 2034/2050 ───────────
      renderTrendForecast(data)
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Trend storico + proiezione lineare al 2034 / 2050
  //  Perimetro: Scope 1 + Scope 2 Market-based (= perimetro target).
  // ────────────────────────────────────────────────────────────────────
  function renderTrendForecast (data) {
    const years = G.calc.availableYears(data.s1, data.s2, data.s3, data.produzione);
    if (!years || years.length < 1) return null;
    const actualYears = years.slice().sort((a, b) => a - b);
    const actuals = actualYears.map(y => {
      const t = G.calc.totals(y, data.s1, data.s2, data.s3);
      return { y, em: t.s1 + t.s2mb }; // S1 + S2 MB
    });

    const T = G.TARGETS;
    const lastActual = actuals[actuals.length - 1];
    const yearsForReg = actuals.slice(-5);   // ultimi ≤ 5 anni
    const reg = linReg(
      yearsForReg.map(p => p.y),
      yearsForReg.map(p => p.em)
    );

    // X-axis: dal primo anno di dati al 2050 (orizzonte vision)
    const startYear = Math.min(actualYears[0], T.baselineYear);
    const endYear   = T.longTermYear;
    const labels = [];
    for (let y = startYear; y <= endYear; y++) labels.push(y);

    // Storico: valori per anni reali, null altrove
    const histMap = new Map(actuals.map(a => [a.y, a.em]));
    const dHist = labels.map(y => histMap.has(y) ? histMap.get(y) : null);

    // Proiezione: dall'anno successivo all'ultimo storico fino al 2050
    let dForecast = labels.map(() => null);
    let projAt2034 = null;
    if (reg && lastActual) {
      // Aggancio: includiamo l'ultimo punto storico per continuità visiva
      dForecast = labels.map(y => {
        if (y === lastActual.y) return lastActual.em;
        if (y > lastActual.y)   return Math.max(0, reg.a + reg.b * y);
        return null;
      });
      projAt2034 = Math.max(0, reg.a + reg.b * T.shortTermYear);
    }

    // Linea target: punti baseline → 2034 → 2050 (interpolazione lineare
    // tra i 3 milestone ufficiali)
    const dTarget = labels.map(y => {
      if (y === T.baselineYear) return T.baseline_tco2e;
      if (y === T.shortTermYear) return T.shortTerm_tco2e;
      if (y === T.longTermYear) return T.longTerm_tco2e;
      // interp lineare tra i tre punti
      if (y > T.baselineYear && y < T.shortTermYear) {
        const f = (y - T.baselineYear) / (T.shortTermYear - T.baselineYear);
        return T.baseline_tco2e + f * (T.shortTerm_tco2e - T.baseline_tco2e);
      }
      if (y > T.shortTermYear && y < T.longTermYear) {
        const f = (y - T.shortTermYear) / (T.longTermYear - T.shortTermYear);
        return T.shortTerm_tco2e + f * (T.longTerm_tco2e - T.shortTerm_tco2e);
      }
      return null;
    });

    const onTrack = projAt2034 != null
      ? projAt2034 <= T.shortTerm_tco2e
      : null;
    const onTrackLabel = onTrack == null ? '—'
      : onTrack ? 'On-track' : 'Off-track';
    const onTrackColor = onTrack == null ? C.textLow
      : onTrack ? C.success : C.critical;

    const chartData = {
      labels,
      datasets: [
        {
          label: 'Storico (S1 + S2 MB)',
          data: dHist,
          borderColor: C.brand,
          backgroundColor: 'rgba(43,42,45,.08)',
          fill: true,
          spanGaps: false
        },
        {
          label: 'Proiezione lineare',
          data: dForecast,
          borderColor: C.s1,
          borderDash: [6, 6],
          backgroundColor: 'transparent',
          fill: false,
          pointRadius: 0,
          spanGaps: false
        },
        {
          label: 'Traiettoria target',
          data: dTarget,
          borderColor: C.success,
          borderDash: [2, 4],
          backgroundColor: 'transparent',
          fill: false,
          pointRadius: 3,
          spanGaps: true
        }
      ]
    };

    return h(G.ui.Card, {
      style: { marginTop: 16 }
    }, [
      h('div', {
        key: 'h',
        style: {
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap', gap: 8
        }
      }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700 } },
          'Trend storico e proiezione · S1 + S2 MB'),
        h('span', {
          style: {
            fontSize: 12, fontWeight: 700, color: onTrackColor,
            background: onTrack == null ? 'transparent'
                       : onTrack ? C.successPale : C.criticalPale,
            padding: '2px 10px', borderRadius: 99
          }
        }, projAt2034 != null
          ? `${onTrackLabel} · proiezione 2034: ${fmt(projAt2034)} tCO₂e (target ${fmt(T.shortTerm_tco2e)})`
          : 'Servono ≥ 2 anni per la proiezione')
      ]),
      h('p', {
        key: 'i',
        style: { fontSize: 11, color: C.textLow, fontStyle: 'italic',
                 marginBottom: 12 }
      }, 'Regressione lineare sugli ultimi 5 anni — è uno "scenario inerziale" (la velocità del trend recente proiettata in avanti). Le riduzioni 2021-2024 includono il salto da Garanzie di Origine e i primi PV: la proiezione può quindi essere ottimistica. Linea tratteggiata verde: traiettoria interpolata tra baseline 2021 e i target ufficiali 2034 / 2050 del Piano.'),
      h(G.charts.ChartLine, {
        unit: 'tCO₂e',
        data: chartData,
        height: 320
      })
    ]);
  }

  // y = a + b*x — minimi quadrati
  function linReg (xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += xs[i]; sumY += ys[i];
      sumXY += xs[i] * ys[i];
      sumX2 += xs[i] * xs[i];
    }
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    const b = (n * sumXY - sumX * sumY) / denom;
    const a = (sumY - b * sumX) / n;
    return { a, b };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Confronto siti — stacked S1+S2LB+S3 + intensità per sito.
  //  Aggregazione per sito sull'anno selezionato.
  // ────────────────────────────────────────────────────────────────────
  function renderSiteComparison (data, year) {
    const num = G.calc.num;
    const sites = (data.anagrafiche || [])
      .map(a => a.Codice_Sito || a.codice_sito)
      .filter(Boolean);
    if (!sites.length) return null;

    // Per-sito: S1, S2 LB, S2 MB, S3, prod_kg, prod_m2
    const bySite = {};
    sites.forEach(s => { bySite[s] = { s1: 0, s2lb: 0, s2mb: 0, s3: 0, kg: 0, m2: 0 }; });

    (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = r.Codice_Sito || r.codice_sito;
      if (bySite[k]) bySite[k].s1 += num(r.Em_tCO2e);
    });
    (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = r.Codice_Sito || r.codice_sito;
      if (bySite[k]) {
        bySite[k].s2lb += num(r.Em_Loc_tCO2e);
        bySite[k].s2mb += num(r.Em_Mkt_tCO2e);
      }
    });
    // Scope 3 non è per-sito (è organizzativo); non lo distribuiamo per sito.
    (data.produzione || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = r.Codice_Sito || r.codice_sito;
      if (bySite[k]) {
        bySite[k].kg += num(r.Produzione_kg);
        bySite[k].m2 += num(r.Produzione_m2);
      }
    });

    // Ordina siti per (S1+S2LB) desc — il sito più impattante in cima
    const ordered = sites.slice().sort((a, b) =>
      (bySite[b].s1 + bySite[b].s2lb) - (bySite[a].s1 + bySite[a].s2lb)
    );
    const hasAny = ordered.some(s => bySite[s].s1 + bySite[s].s2lb > 0);
    if (!hasAny) {
      return h(G.ui.Card, {
        style: { marginBottom: 16 }
      }, h('p', {
        style: { color: C.textLow, textAlign: 'center', padding: 24 }
      }, `Nessun dato S1/S2 per l'anno ${year}.`));
    }

    // Stacked S1 + S2 LB per sito (Scope 3 escluso: non per-sito)
    const stackedData = {
      labels: ordered,
      datasets: [
        { label: 'Scope 1',    data: ordered.map(s => bySite[s].s1),   backgroundColor: C.s1    },
        { label: 'Scope 2 LB', data: ordered.map(s => bySite[s].s2lb), backgroundColor: C.s2loc },
        { label: 'Scope 2 MB', data: ordered.map(s => bySite[s].s2mb), backgroundColor: C.s2mkt,
          // MB e LB sono alternative: rendiamo MB hidden di default per non
          // confondere lo stack. L'operatore lo abilita dalla legenda.
          hidden: true }
      ]
    };

    // Intensità per sito: (S1 + S2 LB) × 1000 / m²  → kgCO₂e/m²
    const intensityData = {
      labels: ordered,
      datasets: [{
        label: 'Intensità',
        data: ordered.map(s => bySite[s].m2 > 0
          ? (bySite[s].s1 + bySite[s].s2lb) * 1000 / bySite[s].m2
          : 0),
        backgroundColor: ordered.map(s => G.SITE_COLORS[s] || C.brand)
      }]
    };

    return h('div', {
      style: {
        display: 'grid', gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))'
      }
    }, [
      h(G.ui.Card, { key: 'st' }, [
        h('div', {
          key: 'h',
          style: { display: 'flex', justifyContent: 'space-between',
                   alignItems: 'baseline', marginBottom: 12 }
        }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700 } },
            'Confronto siti · S1 + S2'),
          h('span', {
            style: { fontSize: 11, color: C.textLow, fontStyle: 'italic' }
          }, 'ordinati per LB')
        ]),
        h(G.charts.ChartBar, {
          unit: 'tCO₂e',
          stacked: true,
          ariaLabel: 'Emissioni Scope 1 + 2 per sito',
          data: stackedData,
          height: 280
        })
      ]),
      h(G.ui.Card, { key: 'in' }, [
        h('div', {
          key: 'h',
          style: { display: 'flex', justifyContent: 'space-between',
                   alignItems: 'baseline', marginBottom: 12 }
        }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700 } },
            'Intensità per sito'),
          h('span', {
            style: { fontSize: 11, color: C.textLow, fontStyle: 'italic' }
          }, '(S1+S2 LB) ÷ m²')
        ]),
        h(G.charts.ChartBar, {
          unit: 'kgCO₂e/m²',
          ariaLabel: 'Intensità per sito',
          data: intensityData,
          height: 280
        })
      ])
    ]);
  }

  G.sections = G.sections || {};
  G.sections.Dashboard = Dashboard;
})(typeof window !== 'undefined' ? window : globalThis);
