/* GHG Tool — Scenarios.jsx
 *
 * Scenarios section della console interna.
 * Estratta dal vecchio Stub.jsx in PR di splitting.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;
  const fmt = G.fmt;

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
        // "Gresmalt scenario 2034" — fedele riproduzione del Piano di
        // Decarbonizzazione (Rev. 1 del 18/11/2024, Tabella 18-19).
        // Baseline simulazione: il tool parte dal valore S1+S2 MB
        // calcolato sui dati reali 2024 in DB (nel nostro inventario:
        // ≈72.043 tCO₂e MB, includendo Processo_Decarb). Più preciso
        // dei valori riportati nel Piano (67.799 senza decarb / 74.914
        // come proiezione teorica) — vedi note metodologiche.
        // Interventi esplicitamente quantificati come completati entro 2034:
        //   · Efficienza energetica 2025-2030 (motori IE4, recupero
        //     calore forni, relamping LED, perdite aria, …): cumulativo
        //     ~1.500 tCO₂e ≈ 2-3% riduzione su S1.
        //   · PV: 4 MWp baseline + 1,6 MWp Viano Gargola (2032-2035)
        //     → ~6 MWp totali al 2034 (delta = 2 MWp di nuova autoprod.).
        //   · GO + PPA progressivo → S2 MB resta ≈ 0 (già nel baseline 2024).
        // Riduzione spessori, elettrificazione, biofuel: NON ancora
        // operativi al 2034 (Piano li colloca 2035-2050).
        // S3 fuori scope dei target Piano → leve S3 a 0.
        // ATTESO: il Piano stesso ammette (Cap 7 + Tab 22) che con questi
        // interventi il target SBTi 2034 NON viene raggiunto (off-track
        // di +78% vs target 41.124 tCO₂e MB).
        setEff(3); setPvMw(6); setGo(100); setElectr(0); setBiofuel(0);
        setThin(0); setEFleet(0); setProdVar(0);
        setMat(0); setTrans(0); setKs(0);
      } else if (name === '2050') {
        // "Gresmalt scenario 2050" — fedele riproduzione del Piano
        // Vision al 2050 (Rev. 1 del 18/11/2024, Tabella 18-20).
        // Interventi quantificati cumulativi al 2050:
        //   · Efficienza energetica matura (continuo 2025-2050): ~10%.
        //   · Elettrificazione 2030-2040 (carrelli, flotta, bruciatori
        //     elettrici cottura, ATM): ~5-10% gas elettrificato.
        //   · Sostituzione CH4 con green fuel (bruciatori blend 50%,
        //     turbina blend, essiccatoi ZERO FUEL, transizione GREEN
        //     FUEL totale 2045-2050): cumulativo ~31M smc su 44M smc
        //     baseline = ~70-90% di sostituzione CH4 al 2050.
        //   · Flotta aziendale 100% elettrica entro 2030-2035.
        //   · Riduzione spessori (Piano: 2046, "non ancora quantificata
        //     in dettaglio"): ipotesi 10%.
        //   · PV ~10-12 MWp (FER vision, non quantificata in dettaglio).
        // Strumenti finanziari (PPA, CCUS, compensazioni): coprono
        // la quota residua, non modellati nei slider fisici.
        // ATTESO: scenario Gresmalt al 2050 ≈ 5.000 tCO₂e (Tabella 22)
        // → on-track vs target SBTi 9.981 tCO₂e MB con margine ~50%.
        setEff(10); setPvMw(10); setGo(100); setElectr(10); setBiofuel(90);
        setThin(10); setEFleet(100); setProdVar(0);
        setMat(0); setTrans(0); setKs(0);
      }
    }

    const tot = G.calc.totals(year, data.s1, data.s2, data.s3);

    // ─── Modello scenario ──────────────────────────────────────
    const prodFactor = 1 + prodVar / 100;

    // 1 MWp PV nel Centro-Nord Italia ≈ 1300 MWh/anno (stima settoriale).
    // Solo la quota DELTA rispetto al PV già installato (4 MWp) genera
    // riduzione addizionale: i 4 MWp attuali sono già scontati nel
    // baseline (em S2 di tot.s2lb / tot.s2mb).
    const PV_BASELINE_MW = 4;
    const pvDeltaMw = Math.max(0, pvMw - PV_BASELINE_MW);
    const pvMwhYear = pvDeltaMw * 1300;
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
      { name: pvDeltaMw > 0
          ? `PV addizionale (+${pvDeltaMw} MWp vs ${PV_BASELINE_MW} attuali)`
          : `Capacità PV proprietaria (${pvMw} MWp)`,
        color: C.success,
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
              'Attuali: 4 MWp (già nel baseline). Solo la quota oltre i 4 MWp riduce: 1 MWp ≈ 1.300 MWh/anno.'),
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

  G.sections = G.sections || {};
  Object.assign(G.sections, { Scenarios });
})(typeof window !== 'undefined' ? window : globalThis);
