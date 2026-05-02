/* GHG Tool — App.jsx
 *
 * Shell della console interna (faccia B): sidebar + topbar + main.
 * Voci di nav filtrate per ruolo (matrice in constants.can).
 * Selettore anno globale popolato da unique(s1∪s2∪s3∪produzione).
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useEffect, useMemo } = root.React;
  const C = G.COLORS;

  const NAV = [
    { key: 'dashboard',   icon: '◈', label: 'Dashboard',         visible: r => r !== 'guest' },
    { key: 'site',        icon: '⊞', label: 'Analisi per Sede',  visible: r => r !== 'guest' },
    { key: 'scope',       icon: '⊕', label: 'Analisi per Scope', visible: r => r !== 'guest' },
    { key: 'materiality', icon: '⌥', label: 'Materialità S3',    visible: r => r !== 'guest' },
    { key: 'quality',     icon: '⚠', label: 'Data Quality',      visible: r => G.can.viewQuality(r) },
    { key: 'fe',          icon: '⊡', label: 'FE Explorer',       visible: r => G.can.viewFE(r) },
    { key: 'scenarios',   icon: '◎', label: 'Scenario Tool',     visible: r => r !== 'guest' },
    { key: 'output',      icon: '↗', label: 'Output / Report',   visible: r => r !== 'guest' },
    { key: 'data',        icon: '✎', label: 'Gestione Dati',     visible: r => G.can.viewMgmt(r) },
    { key: 'audit',       icon: '⊛', label: 'Audit Trail',       visible: r => G.can.viewAudit(r) },
    { key: 'diag',        icon: '⊕', label: 'Diagnostica',       visible: r => G.can.viewDiag(r) }
  ];

  function App () {
    const [data, setData] = useState({
      anagrafiche: [], produzione: [], fe: [], s1: [], s2: [], s3: [],
      s3_materiality: [], app_meta: {}
    });
    const [loading, setLoading] = useState(true);
    const [year, setYear] = useState(null);
    const [route, setRoute] = useState({ section: 'dashboard', tab: null });
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [error, setError] = useState(null);

    const role = root.__GHG_ROLE || 'viewer';

    const load = async () => {
      setLoading(true);
      try {
        const d = await G.db.loadAll();
        setData(d);
        const ys = G.calc.availableYears(d.s1, d.s2, d.s3, d.produzione);
        if (ys.length > 0 && !year) setYear(ys[0]);
        setError(null);
      } catch (e) {
        setError(e.message || 'Errore caricamento dati');
      } finally {
        setLoading(false);
      }
    };
    useEffect(() => { load(); }, []);

    const years = useMemo(() => G.calc.availableYears(
      data.s1, data.s2, data.s3, data.produzione
    ), [data]);

    if (loading && !data.s1.length) {
      return h('div', {
        style: { minHeight: '100vh', display: 'grid', placeItems: 'center',
                 background: C.bg, fontFamily: 'Sora, sans-serif' }
      }, h(G.ui.Skeleton, { width: 320, height: 80 }));
    }

    const navigate = (section, tab) => setRoute({ section, tab });
    const visibleNav = NAV.filter(n => n.visible(role));
    const cur = NAV.find(n => n.key === route.section) || NAV[0];

    return h('div', {
      style: {
        display: 'flex', minHeight: '100vh', background: C.bg,
        fontFamily: 'Sora, sans-serif'
      }
    }, [
      // Sidebar
      h('aside', {
        key: 'sb',
        style: {
          width: sidebarOpen ? 230 : 64, background: C.brand, color: '#fff',
          transition: 'width .2s ease', overflow: 'hidden',
          display: 'flex', flexDirection: 'column'
        }
      }, [
        h('div', {
          key: 'l',
          style: { padding: 16, borderBottom: `1px solid #ffffff20` }
        }, [
          h('img', {
            key: 'g',
            src: G.LOGO_DATA_URI || '',
            alt: 'Gresmalt',
            style: { height: 28, filter: 'invert(1) brightness(2)' }
          }),
          sidebarOpen && h('div', {
            key: 't',
            style: { fontSize: 11, color: '#cfd5da', marginTop: 4 }
          }, 'GHG Tool · Console operatori')
        ]),
        sidebarOpen && h('div', { key: 'y', style: { padding: 16 } }, [
          h('div', {
            style: { fontSize: 10, fontWeight: 600, color: '#cfd5da',
                     textTransform: 'uppercase', letterSpacing: .5,
                     marginBottom: 6 }
          }, 'Anno'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
            years.map(y => h('button', {
              key: y, onClick: () => setYear(y),
              style: {
                padding: '4px 10px', borderRadius: 99, fontSize: 11,
                fontWeight: 600, border: 'none', cursor: 'pointer',
                background: y === year ? '#fff' : 'transparent',
                color: y === year ? C.brand : '#fff'
              }
            }, y)))
        ]),
        h('nav', {
          key: 'n',
          style: { flex: 1, paddingTop: 8 }
        }, visibleNav.map(n => h('button', {
          key: n.key,
          onClick: () => navigate(n.key),
          style: {
            display: 'flex', alignItems: 'center', gap: 12,
            width: '100%', padding: '10px 16px', border: 'none',
            background: route.section === n.key ? '#ffffff10' : 'transparent',
            color: '#fff', fontSize: 13, cursor: 'pointer',
            textAlign: 'left',
            borderLeft: route.section === n.key
              ? `3px solid ${C.accent}` : '3px solid transparent'
          }
        }, [
          h('span', { key: 'i', style: { fontSize: 16 } }, n.icon),
          sidebarOpen && h('span', { key: 'l' }, n.label)
        ]))),
        sidebarOpen && h('div', {
          key: 'pl',
          style: { padding: '8px 16px', borderTop: `1px solid #ffffff20` }
        }, h('a', {
          href: '#',
          onClick: (e) => { e.preventDefault(); root.location.hash = ''; },
          style: { fontSize: 12, color: '#cfd5da', textDecoration: 'none' }
        }, '⤴ Vai al Public Dashboard')),
        h('div', {
          key: 'f',
          style: { padding: 16, borderTop: `1px solid #ffffff20`, fontSize: 11 }
        }, [
          h('div', {
            key: 'r',
            style: {
              display: 'inline-block', padding: '2px 8px', borderRadius: 99,
              background: G.ROLE_LABELS[role] ? G.ROLE_LABELS[role].color : '#666',
              color: '#fff', fontSize: 10, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: .5,
              marginBottom: 6
            }
          }, G.ROLE_LABELS[role] ? G.ROLE_LABELS[role].name : role),
          sidebarOpen && h('button', {
            key: 'lo',
            onClick: () => root.__GHG_LOGOUT && root.__GHG_LOGOUT(),
            style: {
              background: 'transparent', color: '#fff', border: '1px solid #ffffff40',
              padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              marginTop: 4
            }
          }, 'Logout')
        ])
      ]),
      // Main column
      h('div', { key: 'm', style: { flex: 1, display: 'flex', flexDirection: 'column' } }, [
        h('header', {
          key: 'tb',
          style: {
            background: '#fff', borderBottom: `1px solid ${C.border}`,
            padding: '0 24px', height: 56, display: 'flex',
            alignItems: 'center', gap: 16
          }
        }, [
          h('button', {
            onClick: () => setSidebarOpen(!sidebarOpen),
            'aria-expanded': sidebarOpen, 'aria-label': 'Toggle sidebar',
            style: { background: 'transparent', border: 'none',
                     fontSize: 18, cursor: 'pointer', color: C.textMid }
          }, '☰'),
          h('span', {
            style: { fontSize: 13, color: C.textMid }
          }, `Console / ${cur.label}`),
          h('span', {
            style: { marginLeft: 'auto', fontSize: 12, color: C.textMid, fontWeight: 600 }
          }, `Anno ${year || '—'}`)
        ]),
        h('main', {
          key: 'c',
          style: { padding: 24, flex: 1, overflow: 'auto' }
        }, !year ? h(G.ui.Card, null, [
          h('h2', { style: { fontSize: 18, fontWeight: 700 } },
            'Nessun anno disponibile'),
          h('p', { style: { fontSize: 13, color: C.textMid, marginTop: 8 } },
            'Per iniziare, crea righe in S1, S2, S3 o Produzione dalla Gestione Dati.')
        ]) : route.section === 'dashboard'  ? h(G.sections.Dashboard,   { data, year, navigate })
            : route.section === 'site'      ? h(G.sections.SiteAnalysis,{ data, year })
            : route.section === 'scope'     ? h(G.sections.ScopeAnalysis,{ data, year })
            : route.section === 'materiality'? h(G.sections.Materiality,{ data, role, reload: load })
            : route.section === 'quality'   ? h(G.sections.DataQuality, { data, year })
            : route.section === 'fe'        ? h(G.sections.FEExplorer,  { data })
            : route.section === 'scenarios' ? h(G.sections.Scenarios,   { data, year })
            : route.section === 'output'    ? h(G.sections.Output,      { data, year })
            : route.section === 'data'      ? h(G.sections.DataManager, { data, role, reload: load, focusTab: route.tab })
            : route.section === 'audit'     ? h(G.sections.AuditTrail, null)
            : route.section === 'diag'      ? h(G.sections.Diagnostics, { data })
            : null)
      ])
    ]);
  }

  G.App = App;
})(typeof window !== 'undefined' ? window : globalThis);
