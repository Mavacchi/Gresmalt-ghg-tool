/* GHG Tool — Output.jsx
 *
 * Output section della console interna.
 * Estratta dal vecchio Stub.jsx in PR di splitting.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;
  const fmt = G.fmt;

  function Output ({ data, year }) {
    // Lingua per il PPT export. Default dal localStorage 'ghg_lang'
    // (impostato dal selettore Public Dashboard); fallback IT.
    const [pptLang, setPptLang] = useState(() => {
      try {
        const v = root.localStorage.getItem('ghg_lang');
        return (v === 'en') ? 'en' : 'it';
      } catch (_) { return 'it'; }
    });
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
    const _denomS12 = tot.s1 + tot.s2lb;
    const topPct = _denomS12 > 0 ? topSite[1] / _denomS12 * 100 : 0;

    // S3 top categoria
    const s3Agg = {};
    (data.s3 || []).filter(r => +(r.Anno || r.anno) === +year).forEach(r => {
      const k = +(r.Categoria_S3 || r.categoria_s3);
      s3Agg[k] = (s3Agg[k] || 0) + G.calc.num(r.Em_tCO2e || r.em_tco2e);
    });
    const topS3 = Object.entries(s3Agg).sort((a,b) => b[1]-a[1])[0] || ['—', 0];

    // ─── Calcoli aggiuntivi per Riepilogo ESG arricchito ──────
    // Top 3 categorie Scope 3 con nome + tCO₂e + %
    const top3S3 = Object.entries(s3Agg)
      .map(([k, v]) => ({ cat: +k, em: v }))
      .sort((a, b) => b.em - a.em)
      .slice(0, 3);

    // Conteggio categorie Scope 3 incluse
    const s3IncCount = (data.s3_materiality || [])
      .filter(m => m.status === 'Inclusa').length;

    // Scope 1+2 MB (perimetro target Gresmalt) e variazione vs baseline 2021
    const T = G.TARGETS;
    const s12mb     = tot.s1 + tot.s2mb;
    const vsBasePct = T && T.baseline_tco2e > 0
      ? (s12mb / T.baseline_tco2e - 1) * 100
      : null;

    // Numero siti con dati nell'anno
    const sitesWithData = new Set();
    (data.s1 || []).filter(r => +(r.Anno || r.anno) === +year)
      .forEach(r => sitesWithData.add(r.Codice_Sito || r.codice_sito));
    (data.s2 || []).filter(r => +(r.Anno || r.anno) === +year)
      .forEach(r => sitesWithData.add(r.Codice_Sito || r.codice_sito));
    const sitesCount = sitesWithData.size;
    const sitesTotal = (data.anagrafiche || []).length;

    // Generation timestamp
    const generatedAt = new Date().toLocaleString('it-IT');

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
      const payload = {
        year, generated_at: new Date().toISOString(),
        schema_version: '1', anagrafiche: data.anagrafiche, produzione: data.produzione,
        fe: data.fe, s1: data.s1, s2: data.s2, s3: data.s3,
        s3_materiality: data.s3_materiality
      };
      // Tenta firma HMAC via Edge Function. Se fallisce (function non
      // deployata, CORS, network), fallback a snapshot NON firmato così
      // l'utente ha comunque un backup utilizzabile, con annotazione
      // esplicita dell'errore nel campo _signature_error.
      let signed = null, sigErr = null;
      try {
        const sb = G.db.getClient();
        const r = await sb.functions.invoke('sign_snapshot', { body: payload });
        if (r.error) throw r.error;
        signed = r.data;
      } catch (e) {
        sigErr = e && e.message ? e.message : String(e);
      }

      try {
        const file = signed
          ? Object.assign({}, payload, { _signature: signed })
          : Object.assign({}, payload, {
              _signature: null,
              _signature_error: sigErr || 'Edge Function non disponibile',
              _note: 'Snapshot NON firmato — verificare deploy della function sign_snapshot e secret SNAPSHOT_HMAC_KEY (vedi docs/RUNBOOK.md).'
            });
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = root.document.createElement('a');
        a.href = url;
        a.download = `snapshot${signed ? '' : '_unsigned'}_${year}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (signed) {
          G.ui.pushToast('Snapshot firmato scaricato', 'success');
        } else {
          G.ui.pushToast(`Snapshot scaricato senza firma · ${sigErr || 'Edge Function non disponibile'}`, 'warning');
        }
      } catch (e) {
        G.ui.pushToast('Snapshot fallito: ' + (e.message || 'errore'), 'error');
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
      // ─── Riepilogo ESG arricchito (testo pronto da copiare) ──
      (function () {
        const esgText = buildESGSummary({
          year, tot, prev, intCur,
          yearDelta, goPct, totEE,
          topSite, topPct, top3S3,
          s3IncCount, s12mb, vsBasePct,
          sitesCount, sitesTotal,
          T, generatedAt
        });
        return h(G.ui.Card, { style: { marginBottom: 16 } }, [
          h('div', {
            key: 'h',
            style: { display: 'flex', justifyContent: 'space-between',
                     alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }
          }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700 } },
              'Riepilogo ESG (testo pronto da copiare)'),
            h(G.ui.Button, {
              kind: 'ghost',
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(esgText);
                  G.ui.pushToast('Riepilogo copiato negli appunti', 'success');
                } catch (e) {
                  G.ui.pushToast('Copia non riuscita: ' + e.message, 'error');
                }
              },
              style: { fontSize: 12, padding: '4px 12px' }
            }, '⎘ Copia')
          ]),
          h('pre', {
            style: {
              background: C.brand, color: C.cream, padding: 24, borderRadius: 8,
              fontFamily: 'Sora, sans-serif', fontSize: 13, lineHeight: 1.7,
              whiteSpace: 'pre-wrap', overflow: 'auto'
            }
          }, esgText)
        ]);
      })(),
      // Export PPTX
      h(G.ui.Card, { style: { marginBottom: 16 } }, [
        h('h2', { style: { fontSize: 16, fontWeight: 700, marginBottom: 8 } },
          'Sustainability Report PPTX'),
        h('p', { style: { fontSize: 13, color: C.textMid, marginBottom: 12, lineHeight: 1.55 } },
          'Genera un report completo in PowerPoint: cover, indice, executive summary, KPI, composizione e trend con traiettoria target, performance vs target, deep dive Scope 1/2/3 con hot spot e metodologie, confronto siti LB/MB, dettaglio per stabilimento, intensità carbon multi-anno, qualità del dato (P/S/E e stato), metodologia, perimetro, riferimenti FE, audit & governance, disclaimer e contatti. Bilingue IT/EN selezionabile qui sotto.'),
        // Selettore lingua report
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '10px 14px', marginBottom: 12,
            background: C.borderSoft || '#F0F0F0', borderRadius: 8
          }
        }, [
          h('span', {
            key: 'l',
            style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                     textTransform: 'uppercase', letterSpacing: .5 }
          }, 'Lingua report:'),
          h('div', {
            key: 'g', role: 'group', 'aria-label': 'Lingua del report PPT',
            style: { display: 'inline-flex', gap: 4,
                     padding: 3, background: '#E5E5E5', borderRadius: 8 }
          }, ['it', 'en'].map(L => h('button', {
            key: L, type: 'button',
            'aria-pressed': pptLang === L,
            onClick: () => setPptLang(L),
            style: {
              padding: '5px 16px', borderRadius: 6, border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: pptLang === L ? '#fff' : 'transparent',
              color:      pptLang === L ? C.text : C.textMid,
              boxShadow:  pptLang === L ? '0 1px 2px rgba(0,0,0,.08)' : 'none'
            }
          }, L === 'it' ? 'Italiano' : 'English')))
        ]),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(G.ui.Button, {
            key: 'pp', kind: 'primary',
            onClick: async () => {
              try {
                G.ui.pushToast('Generazione PPTX in corso…', 'info');
                await G.io.exportPPTX(data, year, { lang: pptLang });
                G.ui.pushToast('Presentazione scaricata', 'success');
              } catch (e) { G.ui.pushToast(e.message || 'Export PPTX fallito', 'error'); }
            }
          }, '⤓ Scarica PPTX'),
          h(G.ui.Button, {
            key: 'pdf', kind: 'ghost',
            // Apre il dialogo di stampa del browser (Cmd/Ctrl+P);
            // l'utente può scegliere "Salva come PDF". Stile dedicato
            // via @media print nel build.mjs (header semplificato,
            // pagine A4 portrait, niente bottoni di navigazione).
            onClick: () => {
              try {
                root.document.body.classList.add('ghg-print-mode');
                root.print();
              } finally {
                setTimeout(() => root.document.body.classList.remove('ghg-print-mode'), 200);
              }
            }
          }, '⎙ Stampa / Salva PDF')
        ])
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

  // ────────────────────────────────────────────────────────────────────
  //  Riepilogo ESG — testo arricchito pronto per copy-paste in
  //  bilancio, comunicazione interna, mail, PowerPoint.
  //  Layout strutturato per leggibilità + tutti i dati materiali per
  //  un'analisi indipendente.
  // ────────────────────────────────────────────────────────────────────
  function buildESGSummary (ctx) {
    const { year, tot, prev, intCur, yearDelta, goPct, totEE,
            topSite, topPct, top3S3, s3IncCount, s12mb, vsBasePct,
            sitesCount, sitesTotal, T, generatedAt } = ctx;

    const totLB = tot.em_total_tco2e;
    const intM2 = intCur.perM2 != null ? intCur.perM2.toFixed(2) + ' kgCO₂e/m²' : 'n.d.';
    const intKg = intCur.perKg != null ? intCur.perKg.toFixed(2) + ' kgCO₂e/kg' : 'n.d.';
    const yoyStr = yearDelta == null ? 'n.d. (primo anno)'
      : `${yearDelta >= 0 ? '+' : ''}${yearDelta.toFixed(1)}% vs ${year - 1} ` +
        `(${fmt(prev.em_total_tco2e, 0)} → ${fmt(totLB, 0)} tCO₂e)`;
    const baselineStr = vsBasePct == null
      ? 'n.d.'
      : `${vsBasePct >= 0 ? '+' : ''}${vsBasePct.toFixed(1)}% ` +
        `(${fmt(s12mb, 0)} vs ${fmt(T.baseline_tco2e, 0)} baseline ${T.baselineYear})`;

    const top3Str = top3S3.length === 0
      ? '  Nessuna categoria Scope 3 censita per quest\'anno'
      : top3S3.map((c, i) => {
          const pct = tot.s3 > 0 ? (c.em / tot.s3 * 100).toFixed(0) : '0';
          const name = (G.CAT_NAMES && G.CAT_NAMES[c.cat]) || `Categoria ${c.cat}`;
          return `  #${i + 1}  Cat. ${c.cat} · ${name}\n` +
                 `       ${fmt(c.em, 0)} tCO₂e (${pct}% di Scope 3)`;
        }).join('\n');

    return [
      `═════════════════════════════════════════════════════════`,
      `INVENTARIO EMISSIONI GHG · ${year}`,
      `Gruppo Ceramiche Gresmalt`,
      `═════════════════════════════════════════════════════════`,
      ``,
      `STANDARD                GHG Protocol Corporate Standard`,
      `Periodo rendicontazione 1 gennaio – 31 dicembre ${year}`,
      `Approccio consolidamento Controllo operativo`,
      `Perimetro              ${sitesCount}/${sitesTotal} siti con dati nell'anno`,
      `Allineamento           ${T && T.alignment ? T.alignment : 'n.d.'}`,
      ``,
      `─── EMISSIONI ASSOLUTE ────────────────────────────────`,
      `Scope 1                ${fmt(tot.s1, 0).padStart(10)} tCO₂e`,
      `Scope 2 Location-based ${fmt(tot.s2lb, 0).padStart(10)} tCO₂e`,
      `Scope 2 Market-based   ${fmt(tot.s2mb, 0).padStart(10)} tCO₂e`,
      `Scope 3                ${fmt(tot.s3, 0).padStart(10)} tCO₂e`,
      `─────────────────────────`,
      `Totale Scope 1+2 LB+3  ${fmt(totLB, 0).padStart(10)} tCO₂e`,
      `Totale Scope 1+2 MB    ${fmt(s12mb, 0).padStart(10)} tCO₂e   ← perimetro target Piano`,
      ``,
      `─── INTENSITÀ DI PRODOTTO ─────────────────────────────`,
      `Per m²                 ${intM2}`,
      `Per kg                 ${intKg}`,
      ``,
      `─── VARIAZIONI ────────────────────────────────────────`,
      `Anno su anno (totale)  ${yoyStr}`,
      `Vs baseline 2021 (S1+S2 MB)`,
      `                       ${baselineStr}`,
      ``,
      `─── ENERGIA ───────────────────────────────────────────`,
      `Elettricità acquistata ${fmt(totEE, 0)} kWh`,
      `Copertura GO           ${goPct.toFixed(0)}% (Garanzie di Origine)`,
      ``,
      `─── HOTSPOT ───────────────────────────────────────────`,
      `Sito con più emissioni ${topSite[0]}`,
      `                       ${fmt(topSite[1], 0)} tCO₂e (${topPct.toFixed(0)}% di S1+S2 LB del Gruppo)`,
      ``,
      `Top 3 categorie Scope 3:`,
      top3Str,
      ``,
      `Materialità Scope 3    ${s3IncCount}/15 categorie incluse`,
      ``,
      `─── METODOLOGIA ───────────────────────────────────────`,
      `Fattori emissivi       NIR, Min. Ambiente, ETS, ISPRA (combustibili)`,
      `                       AIB, Terna (elettricità)`,
      `Soglia ricalcolo       5% delle emissioni totali`,
      `Validazione            Dati validati internamente prima della pubblicazione`,
      `Emissioni biogeniche   Tracciate separatamente, escluse dal totale Scope 1`,
      `                       (GHG Protocol Corporate Standard)`,
      ``,
      `─── RIFERIMENTO TARGET ────────────────────────────────`,
      `Anno base              ${T.baselineYear} · ${fmt(T.baseline_tco2e, 0)} tCO₂e (S1+S2 MB)`,
      `Target ${T.shortTermYear}            ${fmt(T.shortTerm_tco2e, 0)} tCO₂e ` +
        `(${((T.shortTerm_tco2e/T.baseline_tco2e - 1)*100).toFixed(0)}%)`,
      `Vision ${T.longTermYear}            ${fmt(T.longTerm_tco2e, 0)} tCO₂e ` +
        `(${((T.longTerm_tco2e/T.baseline_tco2e - 1)*100).toFixed(0)}%)`,
      ``,
      `═════════════════════════════════════════════════════════`,
      `Generato il ${generatedAt}`,
      `Per dettaglio metodologico completo:`,
      `Bilancio di Sostenibilità 2024 — Gresmalt`,
      `Piano di Decarbonizzazione 2024 — Gresmalt`,
      `═════════════════════════════════════════════════════════`
    ].join('\n');
  }


  G.sections = G.sections || {};
  Object.assign(G.sections, { Output });
})(typeof window !== 'undefined' ? window : globalThis);
