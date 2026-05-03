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

    const total      = data && data.em_tco2e_total;
    const totalPrev  = prevData && prevData.em_tco2e_total;
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
          style: { flex: 1, fontSize: 14, color: C.text, fontWeight: 600 }
        }, t.title),
        h('label', {
          key: 'yl',
          style: { fontSize: 12, color: C.textMid }
        }, t.yearLabel + ': '),
        h('select', {
          key: 'ys',
          value: year || '', onChange: e => setYear(+e.target.value),
          style: selectStyle
        }, (years || []).map(y =>
          h('option', { key: y, value: y }, y))),
        h('div', {
          key: 'ln',
          style: { display: 'flex', gap: 4, marginLeft: 8 }
        }, ['it','en'].map(l => h('button', {
          key: l, onClick: () => setLangPersist(l),
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
        style: {
          maxWidth: 1200, margin: '0 auto', padding: '64px 32px',
          color: '#fff'
        }
      }, [
        h('h1', {
          key: 'h1',
          style: { fontSize: 40, fontWeight: 700, lineHeight: 1.1, marginBottom: 12 }
        }, t.heroTitle),
        h('p', {
          key: 's',
          style: { fontSize: 18, color: '#cfd5da', marginBottom: 6 }
        }, t.subtitle.replace('{year}', year || '—')),
        h('p', {
          key: 'r',
          style: { fontSize: 13, color: '#A6A6A6' }
        }, t.lastUpdate.replace('{date}', fmtDate(refreshTs)))
      ])),

      // ─── KPI STRIP ───────────────────────────────────────────
      h('section', { key: 'kpis' }, h('div', { style: containerStyle }, [
        h('div', {
          key: 'g',
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16, padding: '40px 0'
          }
        }, loading ? [h(G.ui.Skeleton, { key: 's', height: 110 })]
          : [
            h(G.ui.KPICard, {
              key: 'k1',
              title: t.kpiTotal,
              value: total != null ? fmt(total) : '—',
              unit: 'tCO₂e',
              sub: t.kpiTotalSub,
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
      }, [
        h(G.ui.Card, {
          key: 'cd',
          style: { padding: 24 }
        }, [
          h('h2', {
            key: 't',
            style: { fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 16 }
          }, t.donut),
          h(G.charts.ChartDonut, {
            key: 'd',
            ariaLabel: `${t.donut}: S1 ${fmt(perScope.s1)}, S2 LB ${fmt(perScope.s2_lb)}, S3 ${fmt(perScope.s3)} tCO₂e`,
            unit: 'tCO₂e',
            data: {
              labels: ['Scope 1', 'Scope 2 LB', 'Scope 3'],
              datasets: [{
                data: [perScope.s1 || 0, perScope.s2_lb || 0, perScope.s3 || 0],
                backgroundColor: [C.s1, C.s2loc, C.s3],
                borderWidth: 0
              }]
            },
            height: 280
          })
        ]),
        h(G.ui.Card, {
          key: 'cl',
          style: { padding: 24 }
        }, [
          h('h2', {
            key: 't',
            style: { fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 16 }
          }, t.trend),
          h(G.charts.ChartLine, {
            key: 'l',
            ariaLabel: t.trend,
            unit: 'tCO₂e',
            data: {
              labels: trend.map(d => d.anno),
              datasets: [{
                label: 'tCO₂e',
                data: trend.map(d => d.em_tco2e_total),
                borderColor: C.brand, backgroundColor: 'rgba(43,42,45,.08)',
                fill: true
              }]
            },
            height: 280
          })
        ])
      ]))),

      // ─── METODOLOGIA ─────────────────────────────────────────
      h('section', { key: 'me' }, h('div', { style: containerStyle }, h(G.ui.Card, {
        style: { background: C.cream, padding: 32, marginBottom: 32 }
      }, [
        h('h2', {
          key: 't',
          style: { fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 12 }
        }, t.methodTitle),
        h('ul', {
          key: 'l',
          style: { fontSize: 14, color: C.textMid, lineHeight: 1.8, paddingLeft: 20 }
        }, [
          h('li', { key: 'a' }, t.methodStandard),
          h('li', { key: 'b' }, t.methodBoundary),
          h('li', { key: 'c' }, t.methodFE),
          h('li', { key: 'd' }, t.methodIntensity)
        ])
      ]))),

      // ─── MATERIALITÀ S3 ─────────────────────────────────────
      h('section', { key: 'ma' }, h('div', { style: containerStyle }, h(G.ui.Card, {
        style: { padding: 32, marginBottom: 32 }
      }, [
        h('h2', {
          key: 't',
          style: { fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 16 }
        }, t.materialityTitle),
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

      // ─── FOOTER ─────────────────────────────────────────────
      h('footer', { key: 'f', style: footerStyle }, h('div', {
        style: { ...containerStyle, padding: '32px 24px' }
      }, [
        h('div', {
          key: 't',
          style: { display: 'flex', justifyContent: 'space-between',
                   alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }
        }, [
          h('div', { key: 'l' }, [
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
          ]),
          h('button', {
            key: 'p',
            onClick: () => root.print(),
            style: {
              padding: '10px 20px', background: '#fff', color: C.brand,
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: 'pointer'
            }
          }, t.downloadPDF)
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
