/* GHG Tool — Dashboard.jsx (interna)
 *
 * Mostra i 9 KPI di gruppo + grafici scope + intensità per anno.
 * Le 2 card di intensità mostrano "n.d." se la produzione manca per
 * quell'anno e propongono il drill-down a Gestione Dati / Produzione.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useMemo, useState } = root.React;
  const C = G.COLORS;

  // fmt è centralizzato in G.fmt (constants.js)
  const fmt = G.fmt;

  function Dashboard ({ data, year, navigate, role }) {
    const [s2Method, setS2Method] = G.ui.useS2Method();
    const canExplain = G.can ? G.can.edit(role || 'viewer') : false;
    // Stato della chat AI sul bilancio (ai_assist · task explain_balance + chat_balance).
    // - messages: lista turn della conversazione [{role:'user'|'assistant', text}].
    //   Primo turn è sempre l'output di explain_balance (assistant).
    // - balanceContext: snapshot dei dati passati al primo turn — lo
    //   riutilizziamo identico nei follow-up via chat_balance così le
    //   risposte sono sempre coerenti col contesto su cui è stato fatto
    //   il riassunto, anche se l'utente nel frattempo cambia anno/LB-MB.
    // - chatInput: testo dell'input di follow-up corrente.
    // - chatting: chiamata in volo (esplicitamente per turno follow-up).
    // - explaining: chiamata in volo per il riassunto iniziale.
    // - errore: ultimo errore (è uguale per init e follow-up; un singolo
    //   campo è sufficiente perché chiudi il box AI per ricominciare).
    const [explaining, setExplaining]         = useState(false);
    const [messages, setMessages]             = useState(null);
    const [balanceContext, setBalanceContext] = useState(null);
    const [chatInput, setChatInput]           = useState('');
    const [chatting, setChatting]             = useState(false);
    const [aiErr, setAiErr]                   = useState(null);
    const isMB = s2Method === 'mb';
    const tot = useMemo(() => G.calc.totals(year, data.s1, data.s2, data.s3), [data, year]);
    const prod = (data.produzione || [])
      .filter(p => +(p.Anno || p.anno) === +year);
    const totProd = prod.reduce((acc, p) => ({
      kg: acc.kg + (G.calc.num(p.Produzione_kg || p.produzione_kg)),
      m2: acc.m2 + (G.calc.num(p.Produzione_m2 || p.produzione_m2))
    }), { kg: 0, m2: 0 });

    // Intensità segue il metodo scelto: usa S1 + S2(LB|MB) + S3 al numeratore.
    const emForIntensity = tot.s1 + (isMB ? tot.s2mb : tot.s2lb) + tot.s3;
    const intens = G.calc.intensity({ em_total_tco2e: emForIntensity }, totProd);
    const goPct = (() => {
      const s2y = (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year && (r.Unità || r.unita) === 'kWh');
      const tot = s2y.reduce((a,r) => a + G.calc.num(r.Quantità || r.quantita), 0);
      const go  = s2y.filter(r => (r.Voce_S2 || r.voce_s2) === 'EE_Acquistata_GO')
                     .reduce((a,r) => a + G.calc.num(r.Quantità || r.quantita), 0);
      return tot > 0 ? 100 * go / tot : 0;
    })();

    // Totale "principale" segue il metodo scelto; l'altra variante
    // resta visibile come confronto in una card dedicata.
    const totMain    = isMB ? (tot.s1 + tot.s2mb + tot.s3) : tot.em_total_tco2e;
    const totOther   = isMB ? tot.em_total_tco2e : (tot.s1 + tot.s2mb + tot.s3);
    const mainLabel  = isMB ? 'Totale GHG MB' : 'Totale GHG LB';
    const mainSub    = isMB ? 'S1+S2 MB+S3'   : 'S1+S2 LB+S3';
    const otherLabel = isMB ? 'Confronto LB'  : 'Confronto MB';
    const otherSub   = isMB ? 'S1+S2 LB+S3'   : 'S1+S2 MB+S3';

    // Costruisce il payload "balance_context" che descrive il bilancio
    // corrente. Aggrega per sito (S1, S2 LB/MB) — stessa logica usata
    // sotto per la card Confronto siti. Identico tra explain_balance
    // e chat_balance, così le risposte AI sono coerenti.
    function buildBalanceContext () {
      const num = G.calc.num;
      const sitesAgg = {};
      (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
        const k = r.Codice_Sito || r.codice_sito;
        if (!k) return;
        sitesAgg[k] = sitesAgg[k] || { codice_sito: k, s1: 0, s2lb: 0, s2mb: 0 };
        sitesAgg[k].s1 += num(r.Em_tCO2e);
      });
      (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
        const k = r.Codice_Sito || r.codice_sito;
        if (!k) return;
        sitesAgg[k] = sitesAgg[k] || { codice_sito: k, s1: 0, s2lb: 0, s2mb: 0 };
        sitesAgg[k].s2lb += num(r.Em_Loc_tCO2e);
        sitesAgg[k].s2mb += num(r.Em_Mkt_tCO2e);
      });
      const sites = Object.values(sitesAgg)
        .sort((a, b) => (b.s1 + b.s2lb) - (a.s1 + a.s2lb));
      return {
        year: +year,
        s2_method: s2Method,
        totals: { s1: tot.s1, s2lb: tot.s2lb, s2mb: tot.s2mb, s3: tot.s3 },
        intensity: { perM2: intens.perM2, perKg: intens.perKg },
        go_coverage_pct: goPct,
        sites
      };
    }

    async function runExplain () {
      setExplaining(true);
      setMessages(null);
      setBalanceContext(null);
      setAiErr(null);
      try {
        const ctx = buildBalanceContext();
        const r = await G.db.aiAssist('explain_balance', ctx);
        const text = (r && r.output && r.output.text) || '';
        if (!text) throw new Error('AI ha risposto senza testo');
        setBalanceContext(ctx);
        setMessages([{ role: 'assistant', text }]);
      } catch (e) {
        setAiErr(e && e.message ? e.message : 'Spiegazione AI fallita');
      } finally {
        setExplaining(false);
      }
    }

    async function sendQuestion () {
      const q = (chatInput || '').trim();
      if (!q || chatting || !messages || !balanceContext) return;
      const next = messages.concat([{ role: 'user', text: q }]);
      setMessages(next);
      setChatInput('');
      setChatting(true);
      setAiErr(null);
      try {
        const r = await G.db.aiAssist('chat_balance', {
          balance_context: balanceContext,
          messages: next
        });
        const text = (r && r.output && r.output.text) || '';
        if (!text) throw new Error('AI ha risposto senza testo');
        setMessages(next.concat([{ role: 'assistant', text }]));
      } catch (e) {
        setAiErr(e && e.message ? e.message : 'Risposta AI fallita');
        // Lascia la domanda utente in storia (next) anche se la risposta
        // è fallita: così l'utente può ritentare senza riscriverla.
      } finally {
        setChatting(false);
      }
    }

    function resetChat () {
      setMessages(null);
      setBalanceContext(null);
      setChatInput('');
      setAiErr(null);
    }

    return h('div', null, [
      h('div', {
        key: 'h',
        style: { display: 'flex', alignItems: 'center',
                 justifyContent: 'space-between', marginBottom: 12,
                 gap: 8, flexWrap: 'wrap' }
      }, [
        h('h1', {
          key: 't',
          style: { fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }
        }, `Dashboard interna · Anno ${year}`),
        canExplain && h(G.ui.Button, {
          key: 'ex',
          kind: 'ghost',
          disabled: explaining,
          onClick: runExplain,
          'aria-label': 'Genera spiegazione AI del bilancio'
        }, explaining ? 'Elaborazione…' : '✨ Spiega bilancio')
      ]),
      // Card chat AI sul bilancio (visibile dopo "Spiega bilancio" o se
      // c'è un errore). Layout lineare: turn con label Tu/AI, input di
      // follow-up sotto. Reset col tasto "Nuova conversazione".
      (messages || aiErr) && h(G.ui.Card, {
        key: 'ai',
        style: {
          marginBottom: 16,
          borderLeft: '3px solid ' + (aiErr && !messages ? C.critical : C.accent)
        }
      }, [
        h('div', {
          key: 'hd',
          style: { display: 'flex', justifyContent: 'space-between',
                   alignItems: 'baseline', marginBottom: 8, gap: 8 }
        }, [
          h('div', {
            key: 't',
            style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                     textTransform: 'uppercase', letterSpacing: .5 }
          }, messages
              ? 'Analista AI · solo come supporto, verifica i numeri'
              : 'Errore AI'),
          h('button', {
            key: 'c',
            onClick: resetChat,
            'aria-label': 'Chiudi conversazione',
            style: { background: 'transparent', border: 'none',
                     fontSize: 14, cursor: 'pointer', color: C.textMid }
          }, '✕')
        ]),

        // Lista turn della conversazione (se ne abbiamo).
        messages && h('div', {
          key: 'turns',
          style: { display: 'flex', flexDirection: 'column', gap: 12 }
        }, messages.map((m, i) => h('div', {
          key: i,
          style: {
            paddingTop: i > 0 ? 12 : 0,
            borderTop: i > 0 ? `1px solid ${C.border}` : 'none'
          }
        }, [
          h('div', {
            key: 'lbl',
            style: { fontSize: 10, fontWeight: 700, color: C.textMid,
                     textTransform: 'uppercase', letterSpacing: .5,
                     marginBottom: 4 }
          }, m.role === 'user' ? 'Tu' : 'AI'),
          h('div', {
            key: 'txt',
            style: { fontSize: 13, color: C.text, whiteSpace: 'pre-wrap',
                     lineHeight: 1.5 }
          }, m.text)
        ]))),

        // Errore: se c'è un messaggio di errore (init o follow-up).
        aiErr && h('div', {
          key: 'err',
          style: { fontSize: 13, color: C.critical, whiteSpace: 'pre-wrap',
                   marginTop: messages ? 12 : 0,
                   paddingTop: messages ? 12 : 0,
                   borderTop: messages ? `1px solid ${C.border}` : 'none' }
        }, aiErr),

        // Input di follow-up (solo se la conversazione è iniziata).
        messages && h('div', {
          key: 'input',
          style: { marginTop: 12, paddingTop: 12,
                   borderTop: `1px solid ${C.border}`,
                   display: 'flex', gap: 8, alignItems: 'stretch',
                   flexWrap: 'wrap' }
        }, [
          h('textarea', {
            key: 'i',
            value: chatInput,
            placeholder: 'Fai una domanda di approfondimento (es. "perché IANO ha intensità più alta?")',
            disabled: chatting,
            onChange: e => setChatInput(e.target.value),
            onKeyDown: e => {
              // Enter invia; Shift+Enter va a capo.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendQuestion();
              }
            },
            style: {
              flex: '1 1 280px', minHeight: 44, maxHeight: 120,
              padding: 10, border: `1px solid ${C.border}`,
              borderRadius: 8, fontFamily: 'inherit', fontSize: 13,
              resize: 'vertical', background: chatting ? C.bg : '#fff',
              color: C.text
            }
          }),
          h('div', {
            key: 'btns',
            style: { display: 'flex', flexDirection: 'column', gap: 6 }
          }, [
            h(G.ui.Button, {
              key: 's', kind: 'primary',
              disabled: chatting || !chatInput.trim(),
              onClick: sendQuestion
            }, chatting ? 'AI…' : 'Invia'),
            h(G.ui.Button, {
              key: 'r', kind: 'ghost',
              disabled: chatting,
              onClick: resetChat,
              title: 'Chiudi e ricomincia da capo'
            }, 'Reset')
          ])
        ])
      ]),
      // Toggle LB/MB (perimetro Scope 2) — persiste in localStorage
      h('div', { key: 'tg', style: { marginBottom: 16 } },
        h(G.ui.S2MethodToggle, {
          value: s2Method,
          onChange: setS2Method,
          hint: 'LB = mix di rete (intensità storica). MB = riflette gli acquisti GO. Influenza KPI totale, intensità m²/kg, donut composizione e confronto siti.'
        })),
      h('div', {
        key: 'g',
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12, marginBottom: 24
        }
      }, [
        h(G.ui.KPICard, {
          key: 'k1', title: mainLabel, value: fmt(totMain),
          unit: 'tCO₂e', sub: mainSub, color: isMB ? C.s2mkt : C.s1,
          onClick: () => navigate && navigate('scope')
        }),
        h(G.ui.KPICard, {
          key: 'k2', title: otherLabel,
          value: fmt(totOther),
          unit: 'tCO₂e', sub: otherSub, color: isMB ? C.s1 : C.s2mkt
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
          key: 'i1', title: `Intensità m² · ${isMB ? 'MB' : 'LB'}`,
          value: intens.perM2 != null ? fmt(intens.perM2, 2) : 'n.d.',
          unit: intens.perM2 != null ? 'kgCO₂e/m²' : '',
          sub: intens.perM2 == null ? 'Manca dato Produzione_m2'
                                    : `S1+S2 ${isMB ? 'MB' : 'LB'}+S3`,
          color: C.s3,
          onClick: () => intens.perM2 == null ? navigate && navigate('data', 'produzione') : null
        }),
        h(G.ui.KPICard, {
          key: 'i2', title: `Intensità kg · ${isMB ? 'MB' : 'LB'}`,
          // calc.intensity ritorna perKg in kgCO₂e/kg direttamente.
          value: intens.perKg != null ? fmt(intens.perKg, 2) : 'n.d.',
          unit: intens.perKg != null ? 'kgCO₂e/kg' : '',
          sub: intens.perKg == null ? 'Manca dato Produzione_kg'
                                    : `S1+S2 ${isMB ? 'MB' : 'LB'}+S3`,
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
            `Composizione per scope · ${isMB ? 'MB' : 'LB'}`),
          h(G.charts.ChartDonut, {
            unit: 'tCO₂e',
            data: {
              labels: ['Scope 1', isMB ? 'Scope 2 MB' : 'Scope 2 LB','Scope 3'],
              datasets: [{
                data: [tot.s1, isMB ? tot.s2mb : tot.s2lb, tot.s3],
                backgroundColor: [C.s1, isMB ? C.s2mkt : C.s2loc, C.s3], borderWidth: 0
              }]
            }
          })
        ])
      ]),
      // ─── CONFRONTO SITI ─────────────────────────────────
      renderSiteComparison(data, year, s2Method),
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
  function renderSiteComparison (data, year, s2Method) {
    const num = G.calc.num;
    const isMB = s2Method === 'mb';
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

    // Ordina siti per (S1+S2 perimetro scelto) desc — il sito più impattante in cima
    const s2Of = (b) => isMB ? b.s2mb : b.s2lb;
    const ordered = sites.slice().sort((a, b) =>
      (bySite[b].s1 + s2Of(bySite[b])) - (bySite[a].s1 + s2Of(bySite[a]))
    );
    const hasAny = ordered.some(s => bySite[s].s1 + s2Of(bySite[s]) > 0);
    if (!hasAny) {
      return h(G.ui.Card, {
        style: { marginBottom: 16 }
      }, h('p', {
        style: { color: C.textLow, textAlign: 'center', padding: 24 }
      }, `Nessun dato S1/S2 per l'anno ${year}.`));
    }

    // Stacked S1 + S2 (perimetro scelto) per sito. L'altra variante è
    // disponibile come dataset hidden, attivabile da legenda chart.js.
    const s2ActiveLabel = isMB ? 'Scope 2 MB' : 'Scope 2 LB';
    const s2ActiveColor = isMB ? C.s2mkt    : C.s2loc;
    const s2OtherLabel  = isMB ? 'Scope 2 LB' : 'Scope 2 MB';
    const s2OtherColor  = isMB ? C.s2loc    : C.s2mkt;
    const s2OtherData   = ordered.map(s => isMB ? bySite[s].s2lb : bySite[s].s2mb);
    const stackedData = {
      labels: ordered,
      datasets: [
        { label: 'Scope 1', data: ordered.map(s => bySite[s].s1),
          backgroundColor: C.s1 },
        { label: s2ActiveLabel,
          data: ordered.map(s => s2Of(bySite[s])),
          backgroundColor: s2ActiveColor },
        { label: s2OtherLabel, data: s2OtherData,
          backgroundColor: s2OtherColor, hidden: true }
      ]
    };

    // Intensità per sito: (S1 + S2 perimetro scelto) × 1000 / m²  → kgCO₂e/m²
    const intensityData = {
      labels: ordered,
      datasets: [{
        label: 'Intensità',
        data: ordered.map(s => bySite[s].m2 > 0
          ? (bySite[s].s1 + s2Of(bySite[s])) * 1000 / bySite[s].m2
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
            `Confronto siti · S1 + S2 ${isMB ? 'MB' : 'LB'}`),
          h('span', {
            style: { fontSize: 11, color: C.textLow, fontStyle: 'italic' }
          }, `ordinati per ${isMB ? 'MB' : 'LB'}`)
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
          }, `(S1+S2 ${isMB ? 'MB' : 'LB'}) ÷ m²`)
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
