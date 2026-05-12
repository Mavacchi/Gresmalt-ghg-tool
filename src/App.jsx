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
    { key: 'output',      icon: '↗', label: 'Download',           visible: r => r !== 'guest' },
    { key: 'data',        icon: '✎', label: 'Gestione Dati',     visible: r => G.can.viewMgmt(r) },
    { key: 'audit',       icon: '⊛', label: 'Audit Trail',       visible: r => G.can.viewAudit(r) },
    { key: 'diag',        icon: '⊕', label: 'Diagnostica',       visible: r => G.can.viewDiag(r) },
    { key: 'account',     icon: '◉', label: 'Account',            visible: r => r !== 'guest' }
  ];

  function App () {
    const [data, setData] = useState({
      anagrafiche: [], produzione: [], fe: [], s1: [], s2: [], s3: [],
      s3_materiality: [], app_meta: {}
    });
    const [loading, setLoading] = useState(true);
    // Persistenza ultimo anno selezionato in localStorage —
    // resta nel contesto dell'utente attraverso reload
    const [year, _setYear] = useState(() => {
      try {
        const stored = root.localStorage.getItem('ghg_year');
        const n = +stored;
        return n && isFinite(n) ? n : null;
      } catch (_) { return null; }
    });
    function setYear (y) {
      _setYear(y);
      try {
        if (y) root.localStorage.setItem('ghg_year', String(y));
      } catch (_) {}
    }
    const [route, setRoute] = useState({ section: 'dashboard', tab: null });
    // Sidebar aperta:
    //   - desktop (>= 768px): true di default (espansa a 230px)
    //   - mobile  (<  768px): false di default (drawer chiuso, si apre via ☰)
    const [isMobile, setIsMobile] = useState(() => {
      try { return root.matchMedia('(max-width: 768px)').matches; }
      catch (_) { return false; }
    });
    const [sidebarOpen, setSidebarOpen] = useState(() => {
      try { return !root.matchMedia('(max-width: 768px)').matches; }
      catch (_) { return true; }
    });
    // Listener resize per swap layout desktop ↔ mobile in tempo reale
    useEffect(() => {
      let mq;
      try { mq = root.matchMedia('(max-width: 768px)'); } catch (_) { return; }
      const handler = (e) => {
        setIsMobile(e.matches);
        // Su transizione → mobile: chiudi drawer per default
        // Su transizione → desktop: apri sidebar
        setSidebarOpen(!e.matches);
      };
      // Compatibilità: addEventListener su MQList è più moderno;
      // fallback a addListener (deprecato ma supportato da Safari < 14).
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
      return () => {
        if (mq.removeEventListener) mq.removeEventListener('change', handler);
        else if (mq.removeListener) mq.removeListener(handler);
      };
    }, []);
    const [error, setError] = useState(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [pingState, setPingState] = useState({ ok: null, ts: null });

    const role = root.__GHG_ROLE || 'viewer';

    // Keyboard shortcuts globali
    useEffect(() => {
      function onKey (e) {
        // Cmd+K / Ctrl+K → search
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          setSearchOpen(true);
          return;
        }
        // Cmd+S / Ctrl+S → trigger Salva nel modal aperto (se c'è).
        // Se un modal è aperto, comunque preventDefault per evitare
        // il save-page del browser che confonderebbe l'utente.
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          const dialog = root.document.querySelector(
            '[role="dialog"][aria-modal="true"]');
          if (!dialog) return;
          e.preventDefault();
          const buttons = Array.from(dialog.querySelectorAll('button'));
          const saveBtn = buttons.find(b =>
            /^(salva|save)$/i.test((b.textContent || '').trim()) && !b.disabled);
          if (saveBtn) saveBtn.click();
          return;
        }
        // ? (Shift+/) → help shortcuts
        // Skippa se l'utente sta scrivendo in un input (evita conflitto)
        const tag = (e.target && e.target.tagName) || '';
        if (e.key === '?' && !['INPUT','TEXTAREA','SELECT'].includes(tag)) {
          e.preventDefault();
          setHelpOpen(o => !o);
        }
      }
      root.addEventListener('keydown', onKey);
      return () => root.removeEventListener('keydown', onKey);
    }, []);

    // DB ping ogni 30s, aggiorna indicatore
    useEffect(() => {
      let cancelled = false;
      async function tick () {
        try {
          const sb = G.db.getClient();
          const { error } = await sb.from('app_meta').select('key').limit(1);
          if (!cancelled) setPingState({ ok: !error, ts: Date.now() });
        } catch (_) {
          if (!cancelled) setPingState({ ok: false, ts: Date.now() });
        }
      }
      tick();
      const id = setInterval(tick, 30000);
      return () => { cancelled = true; clearInterval(id); };
    }, []);

    const load = async () => {
      setLoading(true);
      try {
        const d = await G.db.loadAll();
        setData(d);
        // Override G.TARGETS da app_meta.targets se presente (admin
        // può aggiornarli via SQL senza redeploy del bundle).
        if (d.app_meta && d.app_meta.targets && typeof d.app_meta.targets === 'object') {
          Object.assign(G.TARGETS, d.app_meta.targets);
        }
        const ys = G.calc.availableYears(d.s1, d.s2, d.s3, d.produzione);
        // Auto-select latest se nessun anno scelto, oppure se l'anno
        // persistito non è più disponibile (dataset cambiato).
        if (ys.length > 0 && (!year || !ys.includes(year))) {
          setYear(ys[0]);
        }
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

    // Su mobile, navigare a una sezione chiude il drawer (UX standard)
    const navigate = (section, tab) => {
      setRoute({ section, tab });
      if (isMobile) setSidebarOpen(false);
    };
    const visibleNav = NAV.filter(n => n.visible(role));
    const cur = NAV.find(n => n.key === route.section) || NAV[0];

    return h('div', {
      style: {
        display: 'flex', minHeight: '100vh', background: C.bg,
        fontFamily: 'Sora, sans-serif'
      }
    }, [
      // Backdrop overlay (solo mobile + drawer aperto): click chiude il drawer
      isMobile && sidebarOpen && h('div', {
        key: 'bd',
        onClick: () => setSidebarOpen(false),
        'aria-hidden': true,
        style: {
          position: 'fixed', inset: 0, zIndex: 998,
          background: 'rgba(0,0,0,0.45)', cursor: 'pointer'
        }
      }),
      // Sidebar
      h('aside', {
        key: 'sb',
        style: isMobile
          ? {
              // Mobile: drawer overlay scorrevole da sinistra
              position: 'fixed', top: 0, left: 0, bottom: 0,
              width: 260, zIndex: 999,
              background: C.brand, color: '#fff',
              transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform .25s ease', overflowY: 'auto',
              display: 'flex', flexDirection: 'column',
              boxShadow: sidebarOpen ? '2px 0 16px rgba(0,0,0,.25)' : 'none'
            }
          : {
              // Desktop: sidebar inline collassabile
              width: sidebarOpen ? 230 : 64,
              background: C.brand, color: '#fff',
              transition: 'width .2s ease', overflow: 'hidden',
              display: 'flex', flexDirection: 'column'
            }
      }, [
        h('div', {
          key: 'l',
          // Padding ridotto quando collassata per centrare il brand mark.
          // alignItems 'flex-start' quando aperta evita che il flex layout
          // stiri l'<img> a tutta larghezza (default 'stretch' su column).
          style: {
            padding: sidebarOpen ? 16 : '14px 8px',
            borderBottom: '1px solid #ffffff20',
            display: 'flex',
            flexDirection: 'column',
            alignItems: sidebarOpen ? 'flex-start' : 'center'
          }
        }, [
          // Sidebar espansa (e mobile): wordmark "gresmalt GROUP" intero.
          // Sidebar collassata (desktop only): brand mark compatto "G"
          // quadrato bianco (pattern VS Code, Notion, Slack).
          sidebarOpen
            ? h('img', {
                key: 'g',
                src: G.LOGO_DATA_URI || '',
                alt: 'Gresmalt',
                // width:auto preserva aspect ratio (height fissa 28px).
                // maxWidth previene overflow se il logo fosse molto largo.
                style: {
                  height: 28, width: 'auto', maxWidth: '100%',
                  filter: 'invert(1) brightness(2)'
                }
              })
            // Sidebar collassata: brand mark compatto.
            // Se in build c'è assets/Logo-ridotto.* viene esposto come
            // G.LOGO_MARK_DATA_URI (vedi build.mjs). Altrimenti fallback
            // box bianco con "G" inline.
            : G.LOGO_MARK_DATA_URI
              ? h('img', {
                  key: 'g',
                  src: G.LOGO_MARK_DATA_URI,
                  alt: 'Gresmalt',
                  title: 'Gresmalt',
                  style: {
                    height: 36, width: 'auto', maxWidth: 48
                  }
                })
              : h('div', {
                  key: 'g',
                  'aria-label': 'Gresmalt',
                  title: 'Gresmalt',
                  style: {
                    width: 36, height: 36, borderRadius: 8,
                    background: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, fontWeight: 800, color: C.brand,
                    fontFamily: '"Sora", sans-serif',
                    letterSpacing: -0.5
                  }
                }, 'G'),
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
      h('div', { key: 'm', style: {
        flex: 1, display: 'flex', flexDirection: 'column',
        // minWidth: 0 evita che i contenuti larghi (tabelle, chart)
        // facciano crescere la colonna oltre il container flex,
        // rompendo il responsive su schermi stretti
        minWidth: 0
      } }, [
        h('header', {
          key: 'tb',
          style: {
            background: '#fff', borderBottom: `1px solid ${C.border}`,
            padding: '0 24px', height: 56, display: 'flex',
            alignItems: 'center', gap: 16
          }
        }, [
          h('button', {
            key: 'tg',  // mancava → React mischiava reconciliation keyed/positional
            onClick: () => setSidebarOpen(!sidebarOpen),
            'aria-expanded': sidebarOpen,
            'aria-label': isMobile ? 'Apri menu' : 'Toggle sidebar',
            // Touch-friendly su mobile: 44×44px (Apple HIG min target)
            style: {
              background: 'transparent', border: 'none',
              fontSize: 22, cursor: 'pointer', color: C.text,
              padding: 0, width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 6,
              flexShrink: 0
            }
          }, '☰'),
          h('span', {
            key: 'lb',
            style: { fontSize: 13, color: C.textMid }
          }, `Console / ${cur.label}`),
          // Search globale (Cmd+K)
          h('button', {
            key: 'sr',
            onClick: () => setSearchOpen(true),
            title: 'Cerca (Cmd+K)',
            style: {
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
              background: '#F6F6F6', border: `1px solid ${C.border}`,
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
              fontSize: 12, color: C.textMid, minWidth: 200
            }
          }, [
            h('span', { key: 'i' }, '⌕'),
            h('span', { key: 't', style: { flex: 1, textAlign: 'left' } }, 'Cerca…'),
            h('kbd', {
              key: 'k',
              style: {
                background: '#fff', padding: '2px 6px', borderRadius: 4,
                fontSize: 10, color: C.textLow, border: `1px solid ${C.border}`
              }
            }, '⌘K')
          ]),
          // Anno corrente
          h('span', {
            key: 'yr',
            style: { fontSize: 12, color: C.textMid, fontWeight: 600 }
          }, `Anno ${year || '—'}`),
          // DB ping indicator
          h('div', {
            key: 'pg',
            title: pingState.ts
              ? `${pingState.ok ? 'Connesso' : 'Disconnesso'} · ${new Date(pingState.ts).toLocaleTimeString('it-IT')}`
              : 'Non ancora pingato',
            style: {
              width: 8, height: 8, borderRadius: '50%',
              background: pingState.ok === null ? C.textLow
                       : pingState.ok ? C.success : C.critical,
              boxShadow: pingState.ok === true ? `0 0 4px ${C.success}` : 'none'
            }
          })
        ]),
        h('main', {
          key: 'c',
          style: { padding: 24, flex: 1, overflow: 'auto' }
        }, error ? h(G.ui.Card, {
          style: { borderLeft: `4px solid ${C.critical}`, marginBottom: 16 }
        }, [
          h('h2', { style: { fontSize: 16, fontWeight: 700, color: C.critical, marginBottom: 8 } },
            'Errore caricamento dati'),
          h('p', { style: { fontSize: 13, color: C.textMid, lineHeight: 1.5 } }, error),
          h(G.ui.Button, {
            kind: 'ghost',
            onClick: () => load(),
            style: { marginTop: 12 }
          }, 'Riprova')
        ]) : !year ? h(G.ui.Card, null, [
          h('h2', { style: { fontSize: 18, fontWeight: 700 } },
            'Nessun anno disponibile'),
          h('p', { style: { fontSize: 13, color: C.textMid, marginTop: 8 } },
            'Per iniziare, crea righe in S1, S2, S3 o Produzione dalla Gestione Dati.')
        ]) : route.section === 'dashboard'  ? h(G.sections.Dashboard,   { data, year, navigate, role })
            : route.section === 'site'      ? h(G.sections.SiteAnalysis,{ data, year })
            : route.section === 'scope'     ? h(G.sections.ScopeAnalysis,{ data, year })
            : route.section === 'materiality'? h(G.sections.Materiality,{ data, role, reload: load })
            : route.section === 'quality'   ? h(G.sections.DataQuality, { data, year })
            : route.section === 'fe'        ? h(G.sections.FEExplorer,  { data, role, reload: load })
            : route.section === 'scenarios' ? h(G.sections.Scenarios,   { data, year })
            : route.section === 'output'    ? h(G.sections.Output,      { data, year })
            : route.section === 'data'      ? h(G.sections.DataManager, { data, role, reload: load, focusTab: route.tab, navigate })
            : route.section === 'audit'     ? h(G.sections.AuditTrail, null)
            : route.section === 'diag'      ? h(G.sections.Diagnostics, { data })
            : route.section === 'account'   ? h(G.sections.Account,    { role })
            : null),
        // Search globale modal
        searchOpen && h(SearchModal, {
          key: 'srm', data,
          onClose: () => setSearchOpen(false),
          onPick: (section, tab) => { setSearchOpen(false); navigate(section, tab); }
        }),
        // Keyboard shortcuts overlay
        helpOpen && h(HelpModal, {
          key: 'hlp',
          onClose: () => setHelpOpen(false)
        })
      ])
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  SearchModal — Cmd+K, max 20 risultati, raggruppati per tabella
  // ────────────────────────────────────────────────────────────────────
  function SearchModal ({ data, onClose, onPick }) {
    const [q, setQ] = useState('');
    useEffect(() => {
      const onKey = e => { if (e.key === 'Escape') onClose(); };
      root.addEventListener('keydown', onKey);
      return () => root.removeEventListener('keydown', onKey);
    }, []);
    const results = useMemo(() => {
      if (!q || q.length < 2) return [];
      const Q = q.toLowerCase();
      function search (table, key, displayKey, sec, tab) {
        const rows = data[table] || [];
        return rows.filter(r => {
          const v = String(r[key] || r[key.toLowerCase()] || '').toLowerCase();
          const note = String(r.Note || r.note || '').toLowerCase();
          const fe = String(r.FE_ID || r.fe_id || r.Codice_FE || r.codice_fe || '').toLowerCase();
          const cat = String(r.Combustibile || r.combustibile || '').toLowerCase();
          return v.includes(Q) || note.includes(Q) || fe.includes(Q) || cat.includes(Q);
        }).slice(0, 5).map(r => ({
          table, sec, tab,
          label: r[displayKey] || r[displayKey.toLowerCase()] || '—',
          sub:   `${r.Codice_Sito || r.codice_sito || ''} · ${r.Anno || r.anno || ''}`,
          row: r
        }));
      }
      const all = [
        ...search('s1', 'Codice_Sito', 'Combustibile', 'data', 's1'),
        ...search('s2', 'Codice_Sito', 'Voce_S2', 'data', 's2'),
        ...search('s3', 'Categoria_S3', 'Sottocategoria', 'data', 's3'),
        ...search('fe', 'FE_ID', 'Descrizione', 'fe', null),
        ...search('produzione', 'Codice_Sito', 'Codice_Sito', 'data', 'produzione')
      ].slice(0, 20);
      return all;
    }, [q, data]);
    return h('div', {
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'grid', placeItems: 'flex-start', zIndex: 999, paddingTop: 80
      },
      onClick: e => { if (e.target === e.currentTarget) onClose(); }
    }, h('div', {
      style: {
        background: '#fff', width: 'min(640px, 90vw)', maxHeight: '70vh',
        borderRadius: 12, boxShadow: '0 24px 70px rgba(0,0,0,.45)',
        margin: '0 auto', overflow: 'hidden', display: 'flex',
        flexDirection: 'column'
      }
    }, [
      h('input', {
        autoFocus: true, value: q, onChange: e => setQ(e.target.value),
        placeholder: 'Cerca codice sito, combustibile, FE_ID, note…',
        style: {
          padding: 16, fontSize: 16, border: 'none', outline: 'none',
          borderBottom: `1px solid ${C.border}`
        }
      }),
      h('div', { style: { overflow: 'auto', flex: 1 } },
        results.length === 0
          ? h('div', { style: { padding: 24, color: C.textLow, textAlign: 'center', fontSize: 13 } },
              q.length < 2 ? 'Digita almeno 2 caratteri…' : 'Nessun risultato')
          : results.map((r, i) => h('div', {
              key: i,
              onClick: () => onPick(r.sec, r.tab),
              style: {
                padding: '10px 16px', borderBottom: `1px solid ${C.borderSoft}`,
                cursor: 'pointer', display: 'flex', justifyContent: 'space-between'
              }
            }, [
              h('div', { key: 'l' }, [
                h('div', { style: { fontWeight: 600, fontSize: 13 } }, r.label),
                h('div', { style: { fontSize: 11, color: C.textLow } }, r.sub)
              ]),
              h('span', {
                key: 't',
                style: {
                  fontSize: 10, fontWeight: 700, padding: '2px 6px',
                  borderRadius: 4, background: C.accentSoft, color: C.text,
                  textTransform: 'uppercase'
                }
              }, r.table)
            ]))
      ),
      h('div', {
        style: {
          padding: '8px 16px', fontSize: 11, color: C.textLow,
          borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between'
        }
      }, [
        h('span', null, `${results.length} risultati`),
        h('span', null, 'Esc per chiudere')
      ])
    ]));
  }

  // ────────────────────────────────────────────────────────────────────
  //  HelpModal — keyboard shortcut overlay (toggle con `?`)
  // ────────────────────────────────────────────────────────────────────
  function HelpModal ({ onClose }) {
    useEffect(() => {
      const onKey = e => { if (e.key === 'Escape') onClose(); };
      root.addEventListener('keydown', onKey);
      return () => root.removeEventListener('keydown', onKey);
    }, []);
    const isMac = typeof navigator !== 'undefined'
      && /Mac|iPhone|iPad/.test(navigator.userAgent);
    const cmd = isMac ? '⌘' : 'Ctrl';
    const items = [
      { keys: [cmd, 'K'],   desc: 'Apri ricerca globale' },
      { keys: [cmd, 'S'],   desc: 'Salva nel modal aperto' },
      { keys: ['?'],         desc: 'Mostra/nascondi questo overlay' },
      { keys: ['Esc'],       desc: 'Chiudi modal o overlay' },
      { keys: ['Tab'],       desc: 'Naviga campi del form' },
      { keys: ['Enter'],     desc: 'Conferma azione (su button focused)' }
    ];
    function Kbd ({ children }) {
      return h('kbd', {
        style: {
          padding: '2px 8px', minWidth: 28, textAlign: 'center',
          background: '#fff', border: `1px solid ${C.border}`,
          borderRadius: 6, fontSize: 12, fontWeight: 700, color: C.text,
          fontFamily: 'ui-monospace, monospace',
          boxShadow: '0 1px 0 rgba(0,0,0,.06)'
        }
      }, children);
    }
    return h('div', {
      role: 'dialog', 'aria-modal': true, 'aria-label': 'Scorciatoie da tastiera',
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'grid', placeItems: 'center', zIndex: 9999, padding: 16
      },
      onClick: e => { if (e.target === e.currentTarget) onClose(); }
    }, h(G.ui.Card, {
      style: { maxWidth: 480, width: '100%', padding: 24 }
    }, [
      h('div', {
        key: 'h',
        style: { display: 'flex', justifyContent: 'space-between',
                 alignItems: 'baseline', marginBottom: 16 }
      }, [
        h('h2', { style: { fontSize: 18, fontWeight: 700 } },
          'Scorciatoie da tastiera'),
        h('button', {
          onClick: onClose,
          'aria-label': 'Chiudi',
          style: { background: 'transparent', border: 'none',
                   fontSize: 22, cursor: 'pointer', color: C.textMid }
        }, '×')
      ]),
      h('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        items.map((it, i) => h('div', {
          key: i,
          style: { display: 'flex', alignItems: 'center', gap: 12 }
        }, [
          h('div', {
            key: 'k', style: { display: 'flex', gap: 4, minWidth: 100 }
          }, it.keys.map((k, j) => h(Kbd, { key: j }, k))),
          h('div', {
            key: 'd',
            style: { fontSize: 13, color: C.textMid, flex: 1 }
          }, it.desc)
        ]))),
      h('p', {
        key: 'f',
        style: { fontSize: 11, color: C.textLow, marginTop: 16, fontStyle: 'italic' }
      }, 'Premi ? in qualsiasi momento per riaprire questo overlay.')
    ]));
  }

  G.App = App;
})(typeof window !== 'undefined' ? window : globalThis);
