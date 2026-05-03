/* GHG Tool — PublicDashboard.jsx (Faccia A)
 *
 * Pagina pubblica per i clienti del gruppo. Niente sidebar, niente login.
 * Mostra solo aggregati e intensità. Switch lingua IT/EN. window.print()
 * per il PDF.
 *
 * Sicurezza: usa SOLO la RPC public.get_public_dashboard(year) e la
 * vista s3_materiality_public. Non legge mai s1/s2/s3/produzione/fe
 * dal client (le policy RLS nemmeno permetterebbero di vederli).
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useEffect, useMemo } = root.React;
  const C = G.COLORS;

  function fmt (n, dec = 0) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('it-IT', {
      minimumFractionDigits: dec, maximumFractionDigits: dec,
      useGrouping: 'always'
    });
  }

  function detectLang () {
    try {
      const stored = root.localStorage && root.localStorage.getItem('ghg_lang');
      if (stored === 'it' || stored === 'en') return stored;
      const nav = (root.navigator && root.navigator.language) || 'it';
      return nav.toLowerCase().startsWith('en') ? 'en' : 'it';
    } catch (_) { return 'it'; }
  }

  // ────────────────────────────────────────────────────────────────────
  //  Spacing tokens — uniformi tra le sezioni della pagina
  // ────────────────────────────────────────────────────────────────────
  const SECTION_GAP   = 32;   // marginBottom standard per ogni Card
  const SECTION_PAD   = 32;   // padding standard delle Card sezioni
  const SECTION_PAD_S = 24;   // padding ridotto per sezioni compatte
  const sectionCard   = { padding: SECTION_PAD, marginBottom: SECTION_GAP };

  function PublicDashboard () {
    const [lang, setLang] = useState(detectLang());
    const [years, setYears] = useState([]);
    const [year, setYear] = useState(null);
    const [data, setData] = useState(null);
    const [prevData, setPrevData] = useState(null);
    const [trend, setTrend] = useState([]);
    const [materiality, setMateriality] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // Metodo di calcolo Scope 2 — 'mb' (default) o 'lb'.
    // Persiste in localStorage come ghg_s2method.
    const [s2Method, setS2Method] = useState(() => {
      try {
        const v = root.localStorage && root.localStorage.getItem('ghg_s2method');
        return (v === 'lb' || v === 'mb') ? v : 'mb';
      } catch (_) { return 'mb'; }
    });
    function setS2MethodPersist (m) {
      setS2Method(m);
      try { root.localStorage.setItem('ghg_s2method', m); } catch (_) {}
    }

    const t = G.I18N[lang] || G.I18N.it;

    if (!G.db.isConfigured()) {
      return h('div', { style: rootStyle }, h('div', {
        style: {
          maxWidth: 720, margin: '64px auto', padding: 32,
          background: '#fff', borderRadius: 12,
          border: `1px solid ${C.border}`,
          boxShadow: '0 1px 3px rgba(0,0,0,.07)'
        }
      }, [
        h('h1', { key: 't', style: {
          fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 12
        } }, 'Configurazione richiesta'),
        h('p', { key: 'p', style: {
          fontSize: 14, color: C.textMid, lineHeight: 1.7
        } }, 'Il sito è stato pubblicato senza le credenziali Supabase. Eseguire il build con le variabili SUPABASE_URL e SUPABASE_ANON_KEY impostate.'),
        h('pre', { key: 'c', style: {
          fontSize: 12, background: '#F6F6F6', padding: 12,
          borderRadius: 8, marginTop: 16, fontFamily: 'ui-monospace,monospace',
          whiteSpace: 'pre-wrap'
        } }, 'SUPABASE_URL=https://xxx.supabase.co \\\nSUPABASE_ANON_KEY=eyJ... \\\nnode build.mjs')
      ]));
    }

    // Carica anni disponibili + materialità (una sola volta)
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const [yr, mat] = await Promise.all([
            G.db.listPublicYears().catch(() => []),
            G.db.getMaterialityPublic().catch(() => [])
          ]);
          if (cancelled) return;
          const ys = Array.isArray(yr) ? yr : [];
          setYears(ys);
          setYear(ys[0] || null);
          setMateriality(mat || []);
        } catch (e) {
          if (!cancelled) setError(e.message || String(e));
        }
      })();
      return () => { cancelled = true; };
    }, []);

    // Carica dati anno corrente + anno precedente + trend 5 anni
    useEffect(() => {
      if (!year) return;
      let cancelled = false;
      setLoading(true);
      (async () => {
        try {
          const cur = await G.db.getPublicDashboard(year);
          if (cancelled) return;
          setData(cur || null);
          // Anno precedente
          const prevY = years.find(y => y < year);
          if (prevY) {
            const prev = await G.db.getPublicDashboard(prevY);
            if (!cancelled) setPrevData(prev || null);
          } else {
            setPrevData(null);
          }
          // Trend 5 anni: prendiamo gli ultimi 5 in ordine cronologico
          const last5 = years.slice(0, 5).slice().sort((a,b) => a - b);
          const series = await Promise.all(
            last5.map(y => G.db.getPublicDashboard(y).catch(() => null))
          );
          if (!cancelled) setTrend(series.filter(Boolean));
        } catch (e) {
          if (!cancelled) setError(e.message || String(e));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [year, years]);

    function setLangPersist (lng) {
      setLang(lng);
      try { root.localStorage.setItem('ghg_lang', lng); } catch (_) {}
    }

    // Totale aggregato dipendente dal metodo Scope 2 selezionato.
    // LB: S1 + S2_LB + S3 (default GHG Protocol storico).
    // MB: S1 + S2_MB + S3 (perimetro del Piano di Decarbonizzazione).
    function totalFor (d) {
      if (!d || !d.em_per_scope) return null;
      const ps = d.em_per_scope;
      const s2 = s2Method === 'mb' ? (ps.s2_mb || 0) : (ps.s2_lb || 0);
      return (ps.s1 || 0) + s2 + (ps.s3 || 0);
    }
    const total      = totalFor(data);
    const totalPrev  = totalFor(prevData);
    const delta      = total != null && totalPrev != null && totalPrev > 0
      ? (total - totalPrev) / totalPrev * 100 : null;
    const goPct      = data && data.go_coverage_pct;
    // La RPC restituisce intensity_per_m2 già in kgCO₂e/m² (× 1e3 da
    // tCO₂e) e intensity_per_kg in gCO₂e/kg (× 1e6). Per le intensità
    // teniamo kgCO₂e (più leggibile alla scala industriale ceramica:
    // m²≈10–30, kg≈0.1–0.5; in tCO₂e diventerebbero 0.0XXX e 0.0000XX).
    const intM2      = data && data.intensity_per_m2 != null
      ? data.intensity_per_m2 : null;             // kgCO₂e / m²
    const intKg      = data && data.intensity_per_kg != null
      ? data.intensity_per_kg / 1000 : null;      // kgCO₂e / kg (da g/kg)
    const perScope   = (data && data.em_per_scope) || {};
    const refreshTs  = data && data.refresh_ts ? new Date(data.refresh_ts) : null;

    // Conteggio Scope 3 incluse vs totale 15 — sticker pubblico per
    // dichiarare a colpo d'occhio quante categorie sono nell'inventario.
    const s3Inclusi = (materiality || []).filter(m => m.status === 'Inclusa').length;
    const s3TotCat  = 15;

    // Hero stat — riduzione % dell'ultimo anno disponibile vs baseline
    // 2021 (stesso perimetro dei target = Scope 1 + 2 MB).
    const T = G.TARGETS;
    const _latestForHero = (trend && trend.length > 0) ? trend[trend.length - 1] : null;
    const _latestS12MB = _latestForHero && _latestForHero.em_per_scope
      ? ((_latestForHero.em_per_scope.s1 || 0) + (_latestForHero.em_per_scope.s2_mb || 0))
      : null;
    const heroLatestYr = _latestForHero ? _latestForHero.anno : null;
    const heroDeltaPct = (_latestS12MB != null && heroLatestYr !== T.baselineYear)
      ? (_latestS12MB / T.baseline_tco2e - 1) * 100
      : null;
    const heroTarget2034Pct = (T.shortTerm_tco2e / T.baseline_tco2e - 1) * 100;

    const fmtDate = (d) => {
      if (!d) return '—';
      const months = lang === 'en'
        ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        : ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
      return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    };

    return h('div', { style: rootStyle }, [
      // ─── HEADER ──────────────────────────────────────────────
      h('header', { key: 'h', style: headerStyle, role: 'banner' }, h('div', {
        className: 'ghg-header-bar',
        style: {
          maxWidth: 1200, margin: '0 auto',
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '14px 24px'
        }
      }, [
        h('img', {
          key: 'lg',
          src: G.LOGO_DATA_URI || '',
          alt: 'Gresmalt Group',
          style: { height: 36, width: 'auto' }
        }),
        h('div', {
          key: 'tt',
          className: 'ghg-header-title',
          style: { flex: 1, fontSize: 14, color: C.text, fontWeight: 600 }
        }, t.title),
        h('label', {
          key: 'yl',
          htmlFor: 'ghg-year-select',
          style: { fontSize: 12, color: C.textMid }
        }, t.yearLabel + ': '),
        h('select', {
          key: 'ys',
          id: 'ghg-year-select',
          'aria-label': t.yearLabel,
          value: year || '', onChange: e => setYear(+e.target.value),
          style: selectStyle
        }, (years || []).map(y =>
          h('option', { key: y, value: y }, y))),
        h('div', {
          key: 'ln',
          role: 'group',
          'aria-label': lang === 'it' ? 'Lingua' : 'Language',
          style: { display: 'flex', gap: 4, marginLeft: 8 }
        }, ['it','en'].map(l => h('button', {
          key: l,
          onClick: () => setLangPersist(l),
          'aria-pressed': lang === l,
          'aria-label': l === 'it' ? 'Italiano' : 'English',
          style: {
            padding: '4px 10px', borderRadius: 99, fontSize: 11,
            fontWeight: 600, border: `1px solid ${C.border}`,
            background: lang === l ? C.brand : 'transparent',
            color: lang === l ? '#fff' : C.textMid,
            cursor: 'pointer'
          }
        }, l.toUpperCase()))),
        h('a', {
          key: 'op',
          href: '#app',
          onClick: () => { root.location.hash = '#app'; },
          style: {
            marginLeft: 8, fontSize: 13, color: C.textMid,
            textDecoration: 'none', fontWeight: 600
          }
        }, t.operatorAccess)
      ])),

      // ─── HERO ────────────────────────────────────────────────
      h('section', { key: 'hero', style: heroStyle }, h('div', {
        className: 'ghg-hero-pad',
        style: {
          maxWidth: 1200, margin: '0 auto', padding: '64px 32px',
          color: '#fff'
        }
      }, heroDeltaPct != null ? [
        // Piramide a 3 righe: big stat → label → target.
        // h1 doppione rimosso (titolo è già nell'header sticky).
        h('div', {
          key: 'n',
          className: 'ghg-hero-stat',
          style: {
            fontSize: 96, fontWeight: 800, lineHeight: 1,
            letterSpacing: '-0.02em',
            color: heroDeltaPct < 0 ? '#9FE5B5' : '#F5C28E',
            fontVariantNumeric: 'tabular-nums'
          }
        }, `${heroDeltaPct > 0 ? '+' : ''}${fmt(heroDeltaPct, 1)}%`),
        h('div', {
          key: 'l',
          style: {
            fontSize: 18, fontWeight: 500, color: '#F4F6F8',
            marginTop: 12, maxWidth: 720
          }
        }, t.heroStatLabel
            .replace('{y}', T.baselineYear)
            .replace('{cy}', heroLatestYr || '—')),
        h('div', {
          key: 'tg',
          style: {
            fontSize: 14, color: '#cfd5da', marginTop: 16,
            paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.20)',
            maxWidth: 720
          }
        }, t.heroStatTarget
            .replace('{pct}', `${fmt(heroTarget2034Pct, 0)}%`)
            .replace('{y}', T.shortTermYear)),
        // Caveat onesto: il salto include un cambio metodologico
        // (acquisto GO sul 100% dell'elettricità → S2 MB ≈ 0) oltre
        // alla riduzione fisica. Critico per evitare greenwashing.
        h('p', {
          key: 'cv',
          style: {
            fontSize: 12, color: '#A6ADB3', marginTop: 12,
            lineHeight: 1.5, maxWidth: 720, fontStyle: 'italic'
          }
        }, t.heroStatCaveat),
        h('p', {
          key: 'r',
          style: { fontSize: 12, color: '#8d959c', marginTop: 20 }
        }, t.lastUpdate.replace('{date}', fmtDate(refreshTs)))
      ] : [
        // Fallback senza dati / solo baseline year disponibile
        h('h1', {
          key: 'h1',
          style: { fontSize: 40, fontWeight: 700, lineHeight: 1.2,
                   marginBottom: 12, color: '#fff' }
        }, t.heroTitle),
        h('p', {
          key: 's',
          style: { fontSize: 16, color: '#cfd5da', marginBottom: 6 }
        }, t.subtitle.replace('{year}', year || '—')),
        h('p', {
          key: 'r',
          style: { fontSize: 12, color: '#8d959c' }
        }, t.lastUpdate.replace('{date}', fmtDate(refreshTs)))
      ])),

      // ─── COSA RENDICONTIAMO (educational) ────────────────────
      h('section', { key: 'sc' }, h('div', { style: containerStyle }, h('div', {
        style: { padding: '40px 0' }
      }, [
        h('h2', {
          key: 'st',
          style: { fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 8 }
        }, t.scopesTitle),
        h('p', {
          key: 'si',
          style: {
            fontSize: 14, color: C.textMid, lineHeight: 1.6,
            maxWidth: 760, marginBottom: 24
          }
        }, t.scopesIntro),
        h('div', {
          key: 'sg',
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16
          }
        }, [
          { color: C.s1,    title: t.scope1Title, q: t.scope1Q, body: t.scope1Body, key: 's1' },
          { color: C.s2loc, title: t.scope2Title, q: t.scope2Q, body: t.scope2Body, key: 's2' },
          { color: C.s3,    title: t.scope3Title, q: t.scope3Q, body: t.scope3Body, key: 's3' }
        ].map(s => h('div', {
          key: s.key,
          style: {
            background: '#fff',
            border: `1px solid ${C.border}`,
            borderTop: `3px solid ${s.color}`,
            borderRadius: 12, padding: '20px 22px',
            display: 'flex', flexDirection: 'column', gap: 10
          }
        }, [
          h('h3', {
            key: 't',
            style: { fontSize: 15, fontWeight: 700, color: C.text }
          }, s.title),
          h('div', {
            key: 'q',
            style: { fontSize: 12, fontWeight: 600, color: s.color,
                     textTransform: 'uppercase', letterSpacing: .5 }
          }, s.q),
          h('p', {
            key: 'b',
            style: { fontSize: 13, lineHeight: 1.6, color: C.textMid }
          }, s.body)
        ])))
      ]))),

      // ─── GLOSSARIO (educativo, prima del dato) ───────────────
      h('section', { key: 'gl' }, h('div', { style: containerStyle },
        renderGlossary(t)
      )),

      // ─── TOGGLE Scope 2 (LB / MB) ────────────────────────────
      h('section', { key: 'mt' }, h('div', { style: containerStyle }, h('div', {
        style: {
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          background: '#fff', border: `1px solid ${C.border}`,
          borderRadius: 10, marginBottom: 24
        }
      }, [
        h('span', {
          key: 'l',
          style: { fontSize: 12, fontWeight: 700, color: C.textMid,
                   textTransform: 'uppercase', letterSpacing: .5 }
        }, t.methodLabel + ':'),
        h('div', {
          key: 'btn',
          role: 'group', 'aria-label': t.methodLabel,
          style: {
            display: 'inline-flex', gap: 4,
            padding: 3, background: C.borderSoft, borderRadius: 8
          }
        }, ['lb', 'mb'].map(m => h('button', {
          key: m,
          'aria-pressed': s2Method === m,
          'aria-label': m === 'lb' ? t.methodLB : t.methodMB,
          onClick: () => setS2MethodPersist(m),
          style: {
            padding: '6px 14px', borderRadius: 6, border: 'none',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: s2Method === m ? '#fff' : 'transparent',
            color:      s2Method === m ? C.text : C.textMid,
            boxShadow:  s2Method === m ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
            transition: 'all .15s ease'
          }
        }, m === 'lb' ? t.methodLB : t.methodMB))),
        h('span', {
          key: 'h',
          style: { fontSize: 12, color: C.textMid, lineHeight: 1.5,
                   flex: '1 1 280px', minWidth: 280 }
        }, t.methodHint)
      ]))),

      // ─── KPI STRIP ───────────────────────────────────────────
      h('section', { key: 'kpis' }, h('div', { style: containerStyle }, [
        h('div', {
          key: 'g',
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16, padding: '40px 0'
          }
        }, loading
          ? [1,2,3,4].map(i => h(G.ui.Skeleton, { key: 'sk' + i, height: 130, radius: 12 }))
          : [
            h(G.ui.KPICard, {
              key: 'k1',
              title: t.kpiTotal,
              value: total != null ? fmt(total) : '—',
              // Unit + sticker MB/LB inline così il metodo è visibile a
              // colpo d'occhio anche se l'utente non legge il subtitle.
              unit: `tCO₂e · ${s2Method.toUpperCase()}`,
              sub: t.kpiTotalSub.replace('{m}', s2Method.toUpperCase()),
              color: C.s1
            }),
            h(G.ui.KPICard, {
              key: 'k2',
              title: t.kpiDelta,
              value: delta != null ? `${delta > 0 ? '+' : ''}${fmt(delta, 1)}%` : 'n.d.',
              sub: prevData ? t.kpiDeltaSub.replace('{year}', years.find(y => y < year)) : '',
              color: delta == null ? C.textLow : (delta < 0 ? C.success : C.critical)
            }),
            h(G.ui.KPICard, {
              key: 'k3',
              title: t.kpiGO,
              value: goPct != null ? `${fmt(goPct, 0)}%` : 'n.d.',
              sub: t.kpiGOSub,
              color: '#5C7A6B'
            }),
            h(G.ui.KPICard, {
              key: 'k4',
              title: t.kpiIntensity,
              value: intM2 != null ? fmt(intM2, 2) : 'n.d.',
              unit: intM2 != null ? 'kgCO₂e/m²' : '',
              secondary: intKg != null ? `${fmt(intKg, 2)} kgCO₂e/kg` : null,
              sub: t.kpiIntensitySub,
              color: C.s3
            })
          ])
      ])),

      // ─── GRAFICI ─────────────────────────────────────────────
      h('section', { key: 'ch' }, h('div', { style: containerStyle }, h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 20, paddingBottom: 40
        }
      }, loading ? [
        h(G.ui.Skeleton, { key: 'sk1', height: 320, radius: 12 }),
        h(G.ui.Skeleton, { key: 'sk2', height: 320, radius: 12 })
      ] : [
        h(G.ui.Card, {
          key: 'cd',
          style: { padding: 24 }
        }, [
          h('div', {
            key: 't',
            style: { display: 'flex', alignItems: 'center', gap: 8,
                     marginBottom: 16, flexWrap: 'wrap' }
          }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, color: C.text } },
              t.donut),
            h('span', {
              style: {
                fontSize: 11, fontWeight: 700, padding: '2px 8px',
                background: C.borderSoft, borderRadius: 99, color: C.textMid
              }
            }, s2Method.toUpperCase()),
            // Sticker Scope 3 incluse — dichiarazione di trasparenza
            // visibile vicino al donut (non solo nella materialità in fondo).
            s3Inclusi > 0 && h('span', {
              title: t.scope3IncCntFull,
              style: {
                fontSize: 11, fontWeight: 700, padding: '2px 8px',
                background: C.s3 + '22', borderRadius: 99, color: C.s3
              }
            }, t.scope3IncCnt
                .replace('{n}', s3Inclusi)
                .replace('{tot}', s3TotCat))
          ]),
          h(G.charts.ChartDonut, (function () {
            const lbl = s2Method === 'mb' ? 'Scope 2 MB' : 'Scope 2 LB';
            const s2v = s2Method === 'mb' ? (perScope.s2_mb || 0) : (perScope.s2_lb || 0);
            const s2c = s2Method === 'mb' ? C.s2mkt : C.s2loc;
            return {
              key: 'd',
              ariaLabel: `${t.donut}: S1 ${fmt(perScope.s1)}, ${lbl} ${fmt(s2v)}, S3 ${fmt(perScope.s3)} tCO₂e`,
              unit: 'tCO₂e',
              data: {
                labels: ['Scope 1', lbl, 'Scope 3'],
                datasets: [{
                  data: [perScope.s1 || 0, s2v, perScope.s3 || 0],
                  backgroundColor: [C.s1, s2c, C.s3],
                  borderWidth: 0
                }]
              },
              height: 280
            };
          })())
        ]),
        h(G.ui.Card, {
          key: 'cl',
          style: { padding: 24 }
        }, [
          h('div', {
            key: 't',
            style: { display: 'flex', alignItems: 'center', gap: 8,
                     marginBottom: 16, flexWrap: 'wrap' }
          }, [
            h('h2', { style: { fontSize: 16, fontWeight: 700, color: C.text } },
              t.trend),
            h('span', {
              style: {
                fontSize: 11, fontWeight: 700, padding: '2px 8px',
                background: C.borderSoft, borderRadius: 99, color: C.textMid
              }
            }, s2Method.toUpperCase())
          ]),
          h(G.charts.ChartLine, {
            key: 'l',
            ariaLabel: t.trend,
            unit: 'tCO₂e',
            data: {
              labels: trend.map(d => d.anno),
              datasets: [{
                // Trend coerente col metodo Scope 2 selezionato.
                label: 'tCO₂e · ' + s2Method.toUpperCase(),
                data: trend.map(d => {
                  const ps = d.em_per_scope || {};
                  const s2 = s2Method === 'mb' ? (ps.s2_mb || 0) : (ps.s2_lb || 0);
                  return (ps.s1 || 0) + s2 + (ps.s3 || 0);
                }),
                borderColor: C.brand, backgroundColor: 'rgba(43,42,45,.08)',
                fill: true
              }]
            },
            height: 280
          })
        ])
      ]))),

      // ─── TOP 3 HOTSPOT SCOPE 3 ───────────────────────────────
      h('section', { key: 'hp' }, h('div', { style: containerStyle },
        renderScope3Hotspots(t, fmt, data)
      )),

      // ─── TARGETS · Piano di decarbonizzazione ────────────────
      // Usa SEMPRE l'anno più recente disponibile (non quello del
      // selettore in alto), perché la trajectory ha senso solo come
      // "dove SIAMO ora vs dove vogliamo andare". `trend` è già
      // ordinato per anno crescente, quindi l'ultimo elemento è il
      // più recente. Fallback al data dell'anno selezionato se trend
      // non è ancora popolato.
      h('section', { key: 'tg' }, h('div', { style: containerStyle },
        renderTargets(
          t, fmt,
          (trend && trend.length > 0) ? trend[trend.length - 1] : data
        )
      )),

      // ─── INIZIATIVE / leve ──────────────────────────────────
      h('section', { key: 'iv' }, h('div', { style: containerStyle },
        renderInitiatives(t)
      )),

      // ─── BASELINE & ricalcoli ────────────────────────────────
      h('section', { key: 'bl' }, h('div', { style: containerStyle },
        renderBaseline(t)
      )),


      // ─── MATERIALITÀ S3 ─────────────────────────────────────
      h('section', { key: 'ma' }, h('div', { style: containerStyle }, h(G.ui.Card, {
        style: { padding: 32, marginBottom: 32 }
      }, [
        h('h2', {
          key: 't',
          style: { fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 8 }
        }, t.materialityTitle),
        h('p', {
          key: 'i',
          style: {
            fontSize: 14, color: C.textMid, lineHeight: 1.6,
            maxWidth: 760, marginBottom: 16
          }
        }, t.materialityIntro),
        // Legenda statuti — stessi stili dei badge nelle card
        h('div', {
          key: 'lg',
          style: { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }
        }, [
          { st: 'Inclusa',     hint: t.matLegInclusa },
          { st: 'Esclusa',     hint: t.matLegEsclusa },
          { st: 'N.A.',        hint: t.matLegNA },
          { st: 'Da valutare', hint: t.matLegDaValutare }
        ].map(({ st, hint }) => {
          const s = matStyle(st);
          return h('div', {
            key: st,
            style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.textMid }
          }, [
            h('span', {
              key: 'b',
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 99,
                fontSize: 12, fontWeight: 600,
                background: s.bg, color: s.fg,
                border: `1px solid ${s.border}`
              }
            }, [
              h('span', {
                key: 'd',
                style: { width: 8, height: 8, borderRadius: 99,
                         background: s.fg, flexShrink: 0 }
              }),
              h('span', { key: 'l' }, t.mat[st] || st)
            ]),
            h('span', { key: 'h' }, hint)
          ]);
        })),
        h('div', {
          key: 'g',
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12
          }
        }, materiality.map(m => {
          const st = matStyle(m.status);
          const name = (t.catNames && t.catNames[m.cat_id])
                    || G.CAT_NAMES[m.cat_id]
                    || `Categoria ${m.cat_id}`;
          return h('div', {
            key: m.cat_id,
            style: {
              padding: '14px 16px', borderRadius: 10,
              border: `1px solid ${C.border}`, background: '#fff',
              display: 'flex', flexDirection: 'column', gap: 10,
              minHeight: 96
            }
          }, [
            h('div', {
              key: 'top',
              style: { display: 'flex', alignItems: 'flex-start', gap: 10 }
            }, [
              h('span', {
                key: 'n',
                style: {
                  flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 28, height: 28, padding: '0 8px',
                  borderRadius: 6, background: C.brand,
                  fontSize: 13, fontWeight: 700, color: '#fff',
                  fontVariantNumeric: 'tabular-nums'
                }
              }, String(m.cat_id)),
              h('div', {
                key: 't',
                style: {
                  fontSize: 14, fontWeight: 600, color: C.text,
                  lineHeight: 1.35, flex: 1, minWidth: 0,
                  wordBreak: 'break-word'
                }
              }, name)
            ]),
            // Status badge: contrasto alto, niente Pill semitrasparente.
            h('div', {
              key: 'bot',
              style: { marginTop: 'auto' }
            }, h('span', {
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 99,
                fontSize: 12, fontWeight: 600,
                background: st.bg, color: st.fg,
                border: `1px solid ${st.border}`
              }
            }, [
              h('span', {
                key: 'd',
                style: {
                  width: 8, height: 8, borderRadius: 99,
                  background: st.fg, flexShrink: 0
                }
              }),
              h('span', { key: 'l' }, t.mat[m.status] || m.status)
            ]))
          ]);
        }))
      ]))),

      // ─── CTA FINALI · per saperne di più ─────────────────────
      h('section', { key: 'cta' }, h('div', { style: containerStyle },
        renderCTA(t)
      )),

      // ─── TRUST SIGNALS · standard di riferimento ─────────────
      h('section', { key: 'tr' }, h('div', { style: containerStyle },
        renderTrust(t)
      )),

      // ─── DISCLAIMER · perimetro/limitazioni ──────────────────
      h('section', { key: 'dc' }, h('div', { style: containerStyle },
        renderDisclaimer(t)
      )),

      // ─── FOOTER ─────────────────────────────────────────────
      h('footer', { key: 'f', style: footerStyle }, h('div', {
        style: { ...containerStyle, padding: '32px 24px' }
      }, [
        h('div', {
          key: 'l',
          style: { display: 'flex', justifyContent: 'space-between',
                   alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }
        }, [
          h('div', { key: 'i' }, [
            h('div', {
              style: { fontSize: 14, fontWeight: 600, marginBottom: 4 }
            }, '__COMPANY_LEGAL_NAME__'),
            h('div', {
              style: { fontSize: 12, color: '#A6A6A6' }
            }, ['P.IVA __COMPANY_VAT__ · ', h('a', {
              key: 'm',
              href: 'mailto:__SUSTAINABILITY_EMAIL__',
              style: { color: '#cfd5da', textDecoration: 'none' }
            }, '__SUSTAINABILITY_EMAIL__')])
          ])
        ]),
        h('div', {
          key: 'd',
          style: {
            fontSize: 11, color: '#7c8389', marginTop: 16, lineHeight: 1.5
          }
        }, t.footerDisclaimer)
      ])),

      error && h('div', {
        key: 'er',
        role: 'alert',
        style: {
          position: 'fixed', bottom: 16, left: 16, padding: '8px 12px',
          background: C.criticalPale, color: C.critical, borderRadius: 8, fontSize: 12
        }
      }, error)
    ]);
  }

  // Restituisce {bg, fg, border} per il badge di stato.
  // Tutti gli accoppiamenti soddisfano contrasto AA (≥4.5:1) sul testo
  // e ≥3:1 sul bordo. Niente più semi-trasparenze (color + '22') che
  // creavano grigi su grigi illeggibili per Esclusa/N.A.
  function matStyle (status) {
    if (status === 'Inclusa') {
      return { bg: C.successPale, fg: C.success, border: C.success + '55' };
    }
    if (status === 'Esclusa') {
      return { bg: '#F2F2F2',     fg: '#444',      border: '#D9D9D9' };
    }
    if (status === 'N.A.') {
      return { bg: '#FAFAFA',     fg: C.textMid,   border: C.border };
    }
    // 'Da valutare' o fallback
    return   { bg: C.warningPale, fg: C.warning,   border: C.warning + '55' };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Top 3 Scope 3 hotspots — usa s3_breakdown già esposto dalla MV
  // ────────────────────────────────────────────────────────────────────
  function renderScope3Hotspots (t, fmt, data) {
    const ps = (data && data.em_per_scope) || {};
    const s3Total = +ps.s3 || 0;
    const breakdown = (data && data.s3_breakdown) || {};
    const items = Object.entries(breakdown)
      .map(([cat, em]) => ({ cat: +cat, em: +em || 0 }))
      .filter(x => x.em > 0)
      .sort((a, b) => b.em - a.em)
      .slice(0, 3);

    return h(G.ui.Card, {
      style: { padding: 32, marginBottom: 32 }
    }, [
      h('h2', {
        key: 'h',
        style: { fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 8 }
      }, t.hotspotsTitle),
      h('p', {
        key: 'i',
        style: {
          fontSize: 14, color: C.textMid, lineHeight: 1.6,
          maxWidth: 760, marginBottom: 20
        }
      }, t.hotspotsIntro),
      items.length === 0
        ? h('p', {
            style: { fontSize: 13, color: C.textLow, fontStyle: 'italic' }
          }, t.hotspotsEmpty)
        : h('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 16
            }
          }, items.map((it, idx) => {
            const pct = s3Total > 0 ? it.em / s3Total * 100 : null;
            const name = (t.catNames && t.catNames[it.cat])
                      || (G.CAT_NAMES && G.CAT_NAMES[it.cat])
                      || `Categoria ${it.cat}`;
            return h('div', {
              key: it.cat,
              style: {
                position: 'relative',
                background: '#fff',
                border: `1px solid ${C.border}`,
                borderTop: `3px solid ${C.s3}`,
                borderRadius: 10,
                padding: '18px 20px'
              }
            }, [
              // Posizione (#1, #2, #3) in alto a destra
              h('span', {
                key: 'r',
                style: {
                  position: 'absolute', top: 12, right: 14,
                  fontSize: 11, fontWeight: 700, color: C.textLow,
                  letterSpacing: .5
                }
              }, `#${idx + 1}`),
              // Badge categoria + nome
              h('div', {
                key: 'b',
                style: { display: 'flex', alignItems: 'flex-start', gap: 10,
                         marginBottom: 12 }
              }, [
                h('span', {
                  key: 'n',
                  style: {
                    flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 28, height: 28, padding: '0 8px',
                    borderRadius: 6, background: C.brand,
                    fontSize: 13, fontWeight: 700, color: '#fff',
                    fontVariantNumeric: 'tabular-nums'
                  }
                }, String(it.cat)),
                h('div', {
                  style: { fontSize: 14, fontWeight: 600, color: C.text,
                           lineHeight: 1.35, flex: 1, minWidth: 0,
                           wordBreak: 'break-word' }
                }, name)
              ]),
              // Numero + unità
              h('div', {
                key: 'em',
                style: {
                  fontSize: 22, fontWeight: 700, color: C.text,
                  fontVariantNumeric: 'tabular-nums'
                }
              }, fmt(it.em, 0)),
              h('div', {
                key: 'u',
                style: { fontSize: 12, color: C.textMid, marginBottom: 8 }
              }, 'tCO₂e'),
              // Barra % + label
              pct != null && h('div', {
                key: 'bar',
                style: {
                  height: 6, background: C.borderSoft,
                  borderRadius: 3, overflow: 'hidden', marginTop: 4
                }
              }, h('div', {
                style: {
                  height: '100%',
                  width: `${Math.max(2, Math.min(100, pct))}%`,
                  background: C.s3, transition: 'width .2s'
                }
              })),
              pct != null && h('div', {
                key: 'pl',
                style: { fontSize: 11, color: C.textMid, marginTop: 4 }
              }, `${fmt(pct, 1)}% ${t.hotspotsOf}`)
            ]);
          }))
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  TARGETS — 4 colonne (baseline, anno corrente, target 2034, vision 2050)
  // ────────────────────────────────────────────────────────────────────
  function renderTargets (t, fmt, latestData) {
    const T = G.TARGETS;
    // Perimetro dei target Gresmalt: Scope 1 + Scope 2 Market-based.
    // NON include Scope 3 — né nelle emissioni assolute, né
    // nell'intensità.
    const ps        = (latestData && latestData.em_per_scope) || {};
    const latestYr  = latestData && latestData.anno;
    const curS1     = ps.s1    || 0;
    const curS2mb   = ps.s2_mb || 0;
    const curS2lb   = ps.s2_lb || 0;
    const curS3     = ps.s3    || 0;
    const curEm     = curS1 + curS2mb;                 // assoluto S1+S2 MB
    const totalLB   = curS1 + curS2lb + curS3;         // denominatore MV intensity
    const hasCur    = latestData && curEm > 0;
    // L'intensità della MV (intensity_per_m2) è (S1+S2_LB+S3) × 1000 / m².
    // I target Gresmalt sono su S1+S2 MB / m². Ricalcoliamo:
    //   intensity_S1+S2_MB = (s1+s2_mb) / (s1+s2_lb+s3) × intensity_total
    // (formula esatta perché total_m² = (s1+s2_lb+s3)×1000 / intensity_total).
    const totalIntensity = latestData && latestData.intensity_per_m2;
    const curIntensity   = (hasCur && totalIntensity != null && totalLB > 0)
      ? (curEm / totalLB) * totalIntensity
      : null;

    function pct (val, base) {
      if (val == null || !base) return null;
      return (val / base - 1) * 100;
    }
    const sub = (s, y) => s.replace('{y}', y);
    const introStr = t.targetsIntro.replace('{scope}', T.scope);

    function pillVsBase (delta, year) {
      if (delta == null) return null;
      const pos = delta < 0;
      return h('span', {
        style: {
          display: 'inline-block', marginTop: 6,
          padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
          background: pos ? C.successPale : C.criticalPale,
          color:      pos ? C.success     : C.critical
        }
      }, `${delta > 0 ? '+' : ''}${fmt(delta, 1)}%  ${sub(t.targetsVsBase, year)}`);
    }

    const cols = [
      {
        k: 'b',
        label: sub(t.targetsBaseline, T.baselineYear),
        em: T.baseline_tco2e,
        intens: T.baseline_intensity,
        delta: 0,
        accent: C.textMid
      },
      {
        k: 'c',
        label: sub(t.targetsCurrent, latestYr || '—'),
        em: hasCur ? curEm : null,
        intens: hasCur ? curIntensity : null,
        delta: hasCur ? pct(curEm, T.baseline_tco2e) : null,
        accent: C.s1,
        note: hasCur ? null : t.targetsNoData
      },
      {
        k: 's',
        label: sub(t.targetsShortTerm, T.shortTermYear),
        em: T.shortTerm_tco2e,
        intens: T.shortTerm_intensity,
        delta: pct(T.shortTerm_tco2e, T.baseline_tco2e),
        accent: C.s3
      },
      {
        k: 'l',
        label: sub(t.targetsLongTerm, T.longTermYear),
        em: T.longTerm_tco2e,
        intens: T.longTerm_intensity,
        delta: pct(T.longTerm_tco2e, T.baseline_tco2e),
        accent: C.brand
      }
    ];

    return h(G.ui.Card, {
      style: { padding: 32, marginBottom: 32 }
    }, [
      h('h2', { key: 'h',
        style: { fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 8 }
      }, t.targetsTitle),
      h('p', { key: 'i',
        style: {
          fontSize: 14, color: C.textMid, lineHeight: 1.6,
          maxWidth: 760, marginBottom: 20
        }
      }, introStr),
      h('div', { key: 'g',
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16, marginBottom: 12
        }
      }, cols.map(c => h('div', {
        key: c.k,
        style: {
          background: '#fff', border: `1px solid ${C.border}`,
          borderTop: `3px solid ${c.accent}`,
          borderRadius: 10, padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 4
        }
      }, [
        h('div', { key: 'l',
          style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                   textTransform: 'uppercase', letterSpacing: .5 }
        }, c.label),
        h('div', { key: 'e',
          style: { fontSize: 22, fontWeight: 700, color: C.text,
                   marginTop: 4, fontVariantNumeric: 'tabular-nums' }
        }, c.em != null ? `${fmt(c.em, 0)}` : '—'),
        h('div', { key: 'u',
          style: { fontSize: 11, color: C.textMid }
        }, t.targetsAbsolute + ' · tCO₂e'),
        c.intens != null && h('div', { key: 'i',
          style: { fontSize: 13, color: C.text, marginTop: 8,
                   fontVariantNumeric: 'tabular-nums' }
        }, `${fmt(c.intens, 2)} kgCO₂e/m²`),
        c.intens != null && h('div', { key: 'iu',
          style: { fontSize: 11, color: C.textMid }
        }, t.targetsIntensity),
        c.delta != null && c.delta !== 0 && pillVsBase(c.delta, T.baselineYear),
        c.note && h('div', { key: 'n',
          style: { fontSize: 12, color: C.textLow, fontStyle: 'italic',
                   marginTop: 8 }
        }, c.note)
      ]))),
      h('div', { key: 'al',
        style: {
          fontSize: 12, color: C.textMid, marginTop: 8,
          paddingTop: 12, borderTop: `1px dashed ${C.border}`
        }
      }, [
        h('strong', { key: 's' }, t.targetsAlign + ': '),
        T.alignment
      ])
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  INIZIATIVE — 6 leve organizzate in "Piano 2034" / "Vision 2050"
  // ────────────────────────────────────────────────────────────────────
  function renderInitiatives (t) {
    const groups = [
      {
        gKey: '34', heading: t.init2034, accent: C.s1,
        items: [
          { k: '1', title: t.init1Title, body: t.init1Body },
          { k: '2', title: t.init2Title, body: t.init2Body },
          { k: '3', title: t.init3Title, body: t.init3Body }
        ]
      },
      {
        gKey: '50', heading: t.init2050, accent: C.s3,
        items: [
          { k: '4', title: t.init4Title, body: t.init4Body },
          { k: '5', title: t.init5Title, body: t.init5Body },
          { k: '6', title: t.init6Title, body: t.init6Body }
        ]
      }
    ];
    return h(G.ui.Card, {
      style: { padding: 32, marginBottom: 32 }
    }, [
      h('h2', { key: 'h',
        style: { fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 8 }
      }, t.initiativesTitle),
      h('p', { key: 'i',
        style: {
          fontSize: 14, color: C.textMid, lineHeight: 1.6,
          maxWidth: 760, marginBottom: 20
        }
      }, t.initiativesIntro),
      h('div', { key: 'g',
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 24
        }
      }, groups.map(g => h('div', { key: g.gKey }, [
        h('div', { key: 'h',
          style: {
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12
          }
        }, [
          h('span', { key: 'p',
            style: { width: 8, height: 8, borderRadius: 99, background: g.accent }
          }),
          h('h3', { key: 't',
            style: { fontSize: 14, fontWeight: 700, color: C.text,
                     textTransform: 'uppercase', letterSpacing: .5 }
          }, g.heading)
        ]),
        h('div', { key: 'l',
          style: { display: 'flex', flexDirection: 'column', gap: 12 }
        }, g.items.map(it => h('div', {
          key: it.k,
          style: {
            padding: '14px 16px', borderRadius: 8,
            background: C.bg, border: `1px solid ${C.borderSoft}`,
            borderLeft: `3px solid ${g.accent}`
          }
        }, [
          h('div', { key: 't',
            style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }
          }, it.title),
          h('div', { key: 'b',
            style: { fontSize: 13, color: C.textMid, lineHeight: 1.55 }
          }, it.body)
        ])))
      ])))
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  BASELINE & ricalcoli — 3 box compatti
  // ────────────────────────────────────────────────────────────────────
  function renderBaseline (t) {
    const items = [
      { k: 'y', label: t.baselineYearLab,    body: t.baselineYearBody   },
      { k: 'c', label: t.baselineConsLab,    body: t.baselineConsBody   },
      { k: 'r', label: t.baselineRecalcLab,  body: t.baselineRecalcBody },
      { k: 'f', label: t.baselineFELab,      body: t.baselineFEBody     },
      { k: 'b', label: t.baselineBioLab,     body: t.baselineBioBody    }
    ];
    return h(G.ui.Card, {
      style: { padding: 32, marginBottom: 32 }
    }, [
      h('h2', { key: 'h',
        style: { fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 8 }
      }, t.baselineTitle),
      h('p', { key: 'i',
        style: { fontSize: 14, color: C.textMid, lineHeight: 1.6,
                 maxWidth: 760, marginBottom: 20 }
      }, t.baselineIntro),
      h('div', { key: 'g',
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16
        }
      }, items.map(it => h('div', {
        key: it.k,
        style: {
          padding: '14px 16px', borderRadius: 8,
          background: C.bg, border: `1px solid ${C.borderSoft}`
        }
      }, [
        h('div', { key: 'l',
          style: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }
        }, it.label),
        h('p', { key: 'b',
          style: { fontSize: 13, color: C.textMid, lineHeight: 1.55, margin: 0 }
        }, it.body)
      ])))
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  GLOSSARIO · termini chiave (posizione: subito dopo "Cosa
  //  rendicontiamo" così l'utente non-esperto trova le definizioni
  //  prima di vedere i numeri).
  // ────────────────────────────────────────────────────────────────────
  function renderGlossary (t) {
    const items = [
      { k: 'tCO2e',     term: t.glossaryTermTCO2e,     body: t.glossaryBodyTCO2e },
      { k: 'GO',        term: t.glossaryTermGO,        body: t.glossaryBodyGO },
      { k: 'intensity', term: t.glossaryTermIntensity, body: t.glossaryBodyIntensity },
      { k: 'locmb',     term: t.glossaryTermLocMb,     body: t.glossaryBodyLocMb }
    ];
    return h(G.ui.Card, {
      style: sectionCard
    }, [
      h('h2', {
        key: 't',
        style: { fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 16 }
      }, t.glossaryTitle),
      h('div', {
        key: 'g',
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16
        }
      }, items.map(it => h('div', {
        key: it.k,
        style: {
          padding: '14px 16px', borderRadius: 8,
          background: C.bg, border: `1px solid ${C.borderSoft}`
        }
      }, [
        h('div', { key: 'k',
          style: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }
        }, it.term),
        h('p', { key: 'b',
          style: { fontSize: 13, lineHeight: 1.6, color: C.textMid, margin: 0 }
        }, it.body)
      ])))
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  CTA finali — link al Piano, sito, email sostenibilità, print fallback
  // ────────────────────────────────────────────────────────────────────
  function renderCTA (t) {
    const PLAN_URL = 'https://www.gresmalt.it/wp-content/uploads/2025/09/GRESMALT_PIANO_DI_DECARBONIZZAZIONE_2025_IT.pdf';
    const EPD_URL  = 'https://www.gresmalt.it/download/';
    const SITE_URL = 'https://www.gresmalt.it/';
    // Email sostituita a build-time da __SUSTAINABILITY_EMAIL__
    const MAIL = '__SUSTAINABILITY_EMAIL__';

    const linkStyle = (primary) => ({
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '10px 18px', borderRadius: 8,
      fontSize: 14, fontWeight: 600, textDecoration: 'none',
      cursor: 'pointer', border: 'none',
      background: primary ? C.brand : '#fff',
      color:      primary ? '#fff' : C.brand,
      borderWidth: 1, borderStyle: 'solid',
      borderColor: primary ? C.brand : C.border,
      transition: 'transform .1s ease'
    });

    return h(G.ui.Card, {
      style: { padding: 32, marginBottom: 32, background: C.cream }
    }, [
      h('h2', {
        key: 'h',
        style: { fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 8 }
      }, t.ctaTitle),
      h('p', {
        key: 'i',
        style: { fontSize: 14, color: C.textMid, lineHeight: 1.6,
                 maxWidth: 720, marginBottom: 20 }
      }, t.ctaIntro),
      h('div', {
        key: 'b',
        style: {
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center'
        }
      }, [
        h('a', {
          key: 'p',
          href: PLAN_URL, target: '_blank', rel: 'noopener noreferrer',
          className: 'ghg-cta', style: linkStyle(true)
        }, [
          h('span', { key: 'i', style: { fontSize: 16 } }, '⤓'),
          t.ctaPlanLab
        ]),
        h('a', {
          key: 'm',
          href: `mailto:${MAIL}?subject=${encodeURIComponent('ghg tool')}`,
          className: 'ghg-cta', style: linkStyle(false)
        }, [
          h('span', { key: 'i', style: { fontSize: 16 } }, '✉'),
          t.ctaMailLab
        ]),
        h('a', {
          key: 'e',
          href: EPD_URL, target: '_blank', rel: 'noopener noreferrer',
          className: 'ghg-cta', style: linkStyle(false)
        }, [
          h('span', { key: 'i', style: { fontSize: 16 } }, '↗'),
          t.ctaEpdLab
        ]),
        h('a', {
          key: 's',
          href: SITE_URL, target: '_blank', rel: 'noopener noreferrer',
          className: 'ghg-cta', style: linkStyle(false)
        }, [
          h('span', { key: 'i', style: { fontSize: 16 } }, '↗'),
          t.ctaSiteLab
        ]),
        h('button', {
          key: 'pr',
          onClick: () => root.print(),
          className: 'ghg-cta', style: { ...linkStyle(false), opacity: .7 }
        }, [
          h('span', { key: 'i', style: { fontSize: 16 } }, '🖶'),
          t.ctaPrintLab
        ])
      ])
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  TRUST SIGNALS · riga di standard di riferimento.
  //  Niente immagini esterne (CSP-safe + sotto controllo). Ogni chip
  //  è cliccabile e porta alla home dello standard, con tooltip esteso.
  // ────────────────────────────────────────────────────────────────────
  function renderTrust (t) {
    const items = [
      { lab: 'GHG Protocol',    full: 'GHG Protocol Corporate Standard',
        url: 'https://ghgprotocol.org/' },
      { lab: 'GRI',             full: 'GRI Sustainability Reporting Standards',
        url: 'https://www.globalreporting.org/' },
      { lab: 'ESRS',            full: 'European Sustainability Reporting Standards (CSRD) — primo report in preparazione',
        url: 'https://www.efrag.org/en/sustainability-reporting/esrs-workstreams' },
      { lab: 'SBTi',            full: 'Science Based Targets initiative (1,5 °C — auto-allineato)',
        url: 'https://sciencebasedtargets.org/' },
      { lab: 'EU ETS',          full: 'European Union Emissions Trading System',
        url: 'https://climate.ec.europa.eu/eu-action/eu-emissions-trading-system-eu-ets_en' },
      { lab: 'ISO 9001',        full: 'Sistema di Gestione per la Qualità',
        url: 'https://www.iso.org/iso-9001-quality-management.html' },
      { lab: 'ISO 14001',       full: 'Sistema di Gestione Ambientale',
        url: 'https://www.iso.org/iso-14001-environmental-management.html' },
      { lab: 'AIB',             full: 'Association of Issuing Bodies (Garanzie di Origine)',
        url: 'https://www.aib-net.org/' }
    ];

    return h('div', {
      style: {
        padding: '24px 0', borderTop: `1px solid ${C.borderSoft}`,
        borderBottom: `1px solid ${C.borderSoft}`, marginBottom: 24
      }
    }, [
      h('div', {
        key: 'h',
        style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                 textTransform: 'uppercase', letterSpacing: .5,
                 marginBottom: 6 }
      }, t.trustTitle),
      h('p', {
        key: 'i',
        style: { fontSize: 12, color: C.textMid, lineHeight: 1.5,
                 maxWidth: 680, marginBottom: 14 }
      }, t.trustIntro),
      h('div', {
        key: 'r',
        style: {
          display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center'
        }
      }, items.map(it => h('a', {
        key: it.lab,
        href: it.url, target: '_blank', rel: 'noopener noreferrer',
        title: it.full,
        className: 'ghg-trust ghg-trust-chip',
        style: {
          display: 'inline-flex', alignItems: 'center',
          padding: '6px 12px', borderRadius: 6,
          fontSize: 12, fontWeight: 600, color: C.text,
          background: '#fff', border: `1px solid ${C.border}`,
          textDecoration: 'none', fontFamily: 'ui-sans-serif, system-ui',
          letterSpacing: 0,
          transition: 'background .15s ease, border-color .15s ease'
        }
      }, it.lab)))
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  DISCLAIMER · perimetro / limitazioni
  // ────────────────────────────────────────────────────────────────────
  function renderDisclaimer (t) {
    return h('div', {
      style: {
        padding: '20px 0 32px', borderTop: `1px solid ${C.border}`
      }
    }, [
      h('div', { key: 'l',
        style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                 textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }
      }, t.disclaimerTitle),
      h('p', { key: 'b',
        style: { fontSize: 12, color: C.textMid, lineHeight: 1.6,
                 margin: 0, fontStyle: 'italic' }
      }, t.disclaimerBody)
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  const rootStyle = {
    minHeight: '100vh', background: C.bg,
    fontFamily: 'Sora, sans-serif', color: C.text
  };
  const headerStyle = {
    background: '#fff', borderBottom: `1px solid ${C.border}`,
    position: 'sticky', top: 0, zIndex: 50
  };
  const heroStyle = {
    background: C.brand
  };
  const containerStyle = {
    maxWidth: 1200, margin: '0 auto', padding: '0 24px'
  };
  const footerStyle = {
    background: C.brand, color: '#fff'
  };
  const selectStyle = {
    padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 8,
    fontSize: 13, background: '#fff'
  };

  G.PublicDashboard = PublicDashboard;
})(typeof window !== 'undefined' ? window : globalThis);
