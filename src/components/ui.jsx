/* GHG Tool — UI primitives.
 *
 * Card, KPICard, EmissionBadge, Toast, Skeleton, ConfirmDialog, ErrorBoundary,
 * Button, Select, Input, Pill.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useEffect, useRef, useCallback, Component } = root.React;
  const C = G.COLORS;

  // ────────────────────────────────────────────────────────────────────
  //  Card
  // ────────────────────────────────────────────────────────────────────
  // React.memo wrapper applicato sotto: rende Card e KPICard memoizzati
  // sulla shallow-equality dei props. Riduce re-render quando il parent
  // si re-renderizza ma i props della card non sono cambiati.
  function Card ({ children, padding = 24, borderLeft, style, ...rest }) {
    return h('div', {
      style: {
        background: C.card, border: `1px solid ${C.border}`,
        borderLeft: borderLeft ? `4px solid ${borderLeft}` : `1px solid ${C.border}`,
        borderRadius: 12, padding,
        boxShadow: '0 1px 3px rgba(0,0,0,.07)',
        ...style
      },
      ...rest
    }, children);
  }

  // ────────────────────────────────────────────────────────────────────
  //  KPICard
  // ────────────────────────────────────────────────────────────────────
  function KPICard ({
    title, value, unit, sub, color = C.brand, delta, deltaRef, secondary,
    drilldown, onClick, source
  }) {
    const interactive = !!(onClick || drilldown);
    return h('div', {
      role: interactive ? 'button' : null,
      tabIndex: interactive ? 0 : null,
      title: source || null,
      onClick: () => onClick && onClick(),
      onKeyDown: (e) => interactive && e.key === 'Enter' && onClick && onClick(),
      style: {
        background: C.card, border: `1px solid ${C.border}`,
        borderTop: `3px solid ${color}`,
        borderRadius: 12, padding: 20, position: 'relative',
        cursor: interactive ? 'pointer' : 'default',
        transition: 'transform .15s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,.07)'
      }
    }, [
      h('div', {
        key: 't',
        style: {
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: .5, color: C.textMid, marginBottom: 8
        }
      }, title),
      h('div', { key: 'v', style: { display: 'flex', alignItems: 'baseline', gap: 6 } }, [
        h('span', {
          key: 'val',
          style: { fontSize: 28, fontWeight: 700, color: C.text, lineHeight: 1 }
        }, value == null ? 'n.d.' : value),
        unit && h('span', {
          key: 'u',
          style: { fontSize: 13, color: C.textMid, fontWeight: 500 }
        }, unit)
      ]),
      secondary && h('div', {
        key: 'sec',
        style: { fontSize: 14, color: C.textMid, marginTop: 4, fontWeight: 500 }
      }, secondary),
      delta != null && h('div', {
        key: 'd',
        style: {
          marginTop: 6, fontSize: 13, fontWeight: 600,
          color: delta < 0 ? C.success : delta > 0 ? C.critical : C.textMid
        }
      }, [
        h('span', { key: 'p' },
          (delta > 0 ? '↑ ' : delta < 0 ? '↓ ' : '')
          + Math.abs(delta).toLocaleString('it-IT',
              { maximumFractionDigits: 1, useGrouping: 'always' })
          + '%'),
        // Riferimento opzionale ("vs 2023", "vs baseline 2021"…)
        deltaRef && h('span', {
          key: 'r',
          style: { color: C.textMid, fontWeight: 500, marginLeft: 6 }
        }, deltaRef)
      ]),
      sub && h('div', {
        key: 's',
        style: { fontSize: 12, color: C.textLow, marginTop: 6 }
      }, sub)
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  EmissionBadge
  // ────────────────────────────────────────────────────────────────────
  function EmissionBadge ({ scope = 's1', value, unit = 'tCO₂e', size = 12 }) {
    const colorMap = { s1: C.s1, s2lb: C.s2loc, s2mb: C.s2mkt, s3: C.s3 };
    const labels   = { s1: 'S1', s2lb: 'S2 LB', s2mb: 'S2 MB', s3: 'S3' };
    return h('span', {
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '2px 8px', borderRadius: 99, fontSize: size,
        background: colorMap[scope] + '22', color: colorMap[scope],
        fontWeight: 600
      }
    }, [
      h('span', { key: 'l' }, labels[scope] || scope),
      value != null && h('span', { key: 'v' },
        Number(value).toLocaleString('it-IT',
          { maximumFractionDigits: 2, useGrouping: 'always' }) + ' ' + unit)
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Skeleton
  // ────────────────────────────────────────────────────────────────────
  function Skeleton ({ width = '100%', height = 16, radius = 6 }) {
    return h('div', {
      style: {
        width, height, borderRadius: radius,
        background: 'linear-gradient(90deg,#eee 25%,#f5f5f5 37%,#eee 63%)',
        backgroundSize: '400% 100%',
        animation: 'ghg-skel 1.4s ease infinite'
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  //  Toast
  // ────────────────────────────────────────────────────────────────────
  let _toastSet = null;
  function ToastHost () {
    const [toasts, setToasts] = useState([]);
    useEffect(() => {
      _toastSet = setToasts;
      return () => { _toastSet = null; };
    }, []);
    return h('div', {
      role: 'region',
      'aria-label': 'Notifiche',
      'aria-live': 'polite',  // screen reader annuncia i nuovi toast
      'aria-atomic': 'false', // legge solo il toast aggiunto, non tutto
      style: {
        position: 'fixed', top: 16, right: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8
      }
    }, toasts.map(t => h('div', {
      key: t.id,
      role: t.kind === 'error' ? 'alert' : 'status',
      style: {
        background: C.card, border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${t.color}`,
        padding: '10px 16px', borderRadius: 8, fontSize: 13, color: C.text,
        boxShadow: '0 2px 8px rgba(0,0,0,.12)', minWidth: 240
      }
    }, t.text)));
  }
  function pushToast (text, kind = 'info') {
    if (!_toastSet) return;
    const id = Math.random().toString(36).slice(2);
    const color = kind === 'success' ? C.success
                : kind === 'error'   ? C.critical
                : kind === 'warning' ? C.warning : C.info;
    _toastSet(t => [...t, { id, text, color, kind }]);
    setTimeout(() => {
      if (_toastSet) _toastSet(t => t.filter(x => x.id !== id));
    }, 3000);
  }

  // ────────────────────────────────────────────────────────────────────
  //  ConfirmDialog
  // ────────────────────────────────────────────────────────────────────
  let _confirmFn = null;
  function ConfirmHost () {
    const [state, setState] = useState(null);
    useEffect(() => {
      _confirmFn = (opts) => new Promise(resolve => {
        setState({ ...opts, resolve });
      });
      return () => { _confirmFn = null; };
    }, []);
    // Esc chiude il modal (default = cancel)
    useEffect(() => {
      if (!state) return;
      function onKey (e) {
        if (e.key === 'Escape') {
          state.resolve(false);
          setState(null);
        }
      }
      root.addEventListener('keydown', onKey);
      return () => root.removeEventListener('keydown', onKey);
    }, [state]);
    if (!state) return null;
    return h('div', {
      role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'cf-title', 'aria-describedby': 'cf-desc',
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'grid', placeItems: 'center', zIndex: 9000
      }
    }, h(Card, {
      style: { maxWidth: 440, width: '90%', boxShadow: '0 24px 70px rgba(0,0,0,.45)' }
    }, [
      h('h2', {
        key: 'h', id: 'cf-title',
        style: { fontSize: 18, fontWeight: 700, color: C.text, margin: 0, marginBottom: 8 }
      }, state.title || 'Conferma'),
      h('div', {
        key: 'b', id: 'cf-desc',
        style: { fontSize: 14, color: C.textMid, marginBottom: 16 }
      }, state.message || ''),
      h('div', {
        key: 'a', style: { display: 'flex', justifyContent: 'flex-end', gap: 8 }
      }, [
        h('button', {
          key: 'c',
          onClick: () => { state.resolve(false); setState(null); },
          style: btnStyle({ kind: 'ghost' })
        }, state.cancelLabel || 'Annulla'),
        h('button', {
          key: 'k',
          onClick: () => { state.resolve(true); setState(null); },
          style: btnStyle({ kind: state.danger ? 'danger' : 'primary' })
        }, state.confirmLabel || 'Conferma')
      ])
    ]));
  }
  async function confirm (opts) {
    if (!_confirmFn) return root.confirm(opts && opts.message || 'Confermare?');
    return _confirmFn(opts || {});
  }

  function btnStyle ({ kind = 'primary' } = {}) {
    const base = {
      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
      cursor: 'pointer', border: '1px solid transparent', fontFamily: 'inherit'
    };
    if (kind === 'primary') return { ...base, background: C.brand, color: '#fff' };
    if (kind === 'danger')  return { ...base, background: C.critical, color: '#fff' };
    return { ...base, background: 'transparent', borderColor: C.border, color: C.text };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Button
  // ────────────────────────────────────────────────────────────────────
  function Button ({ kind = 'primary', children, ...rest }) {
    return h('button', { ...rest, style: { ...btnStyle({ kind }), ...(rest.style || {}) } }, children);
  }

  function Input (props) {
    // No outline: 'none' — il global *:focus-visible deve poter
    // mostrare il ring di focus per gli utenti da tastiera.
    return h('input', {
      ...props,
      style: {
        padding: '8px 12px', border: `1px solid ${C.border}`,
        borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
        ...(props.style || {})
      }
    });
  }

  function Select ({ options = [], ...rest }) {
    return h('select', {
      ...rest,
      style: {
        padding: '8px 12px', border: `1px solid ${C.border}`,
        borderRadius: 8, fontSize: 13, background: '#fff',
        ...(rest.style || {})
      }
    }, options.map(o => h('option', {
      key: typeof o === 'object' ? o.value : o,
      value: typeof o === 'object' ? o.value : o
    }, typeof o === 'object' ? o.label : o)));
  }

  function Pill ({ color = C.brand, bg, children }) {
    return h('span', {
      style: {
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
        background: bg || color + '22', color
      }
    }, children);
  }

  // ────────────────────────────────────────────────────────────────────
  //  S2MethodToggle — pulsante LB/MB per perimetro Scope 2
  //  Usato in PublicDashboard, Dashboard interna, SiteAnalysis.
  //  Persiste in localStorage 'ghg_s2method' (condiviso fra tutte
  //  le viste così la scelta utente è coerente su sessione).
  // ────────────────────────────────────────────────────────────────────
  function useS2Method () {
    const [m, setM] = root.React.useState(() => {
      try {
        const v = root.localStorage && root.localStorage.getItem('ghg_s2method');
        return (v === 'lb' || v === 'mb') ? v : 'mb';
      } catch (_) { return 'mb'; }
    });
    function set (next) {
      setM(next);
      try { root.localStorage.setItem('ghg_s2method', next); } catch (_) {}
    }
    return [m, set];
  }

  function S2MethodToggle ({
    value, onChange,
    label = 'Metodo Scope 2',
    hint = 'LB = Location-based (mix di rete). MB = Market-based (riflette gli acquisti GO).',
    style
  }) {
    return h('div', {
      style: Object.assign({
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: '#fff', border: `1px solid ${C.border}`,
        borderRadius: 10
      }, style || {})
    }, [
      h('span', {
        key: 'l',
        style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                 textTransform: 'uppercase', letterSpacing: .5 }
      }, label + ':'),
      h('div', {
        key: 'g',
        role: 'group', 'aria-label': label,
        style: {
          display: 'inline-flex', gap: 4,
          padding: 3, background: C.borderSoft || '#F0F0F0', borderRadius: 8
        }
      }, ['lb', 'mb'].map(m => h('button', {
        key: m,
        type: 'button',
        'aria-pressed': value === m,
        'aria-label': m === 'lb' ? 'Location-based' : 'Market-based',
        onClick: () => onChange(m),
        style: {
          padding: '5px 14px', borderRadius: 6, border: 'none',
          cursor: 'pointer', fontSize: 13, fontWeight: 600,
          background: value === m ? '#fff' : 'transparent',
          color:      value === m ? C.text : C.textMid,
          boxShadow:  value === m ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
          transition: 'all .15s ease'
        }
      }, m.toUpperCase()))),
      hint && h('span', {
        key: 'h',
        style: { fontSize: 12, color: C.textMid, lineHeight: 1.5,
                 flex: '1 1 240px', minWidth: 200 }
      }, hint)
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  ErrorBoundary
  // ────────────────────────────────────────────────────────────────────
  class ErrorBoundary extends Component {
    constructor (props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError (error) { return { error }; }
    componentDidCatch (error, info) {
      try {
        const route = root.location.hash || '/';
        if (G.db && G.db.logClientError) {
          G.db.logClientError(route, error.message, error.stack);
        }
      } catch (_) {}
    }
    render () {
      if (!this.state.error) return this.props.children;
      const isAdmin = root.__GHG_ROLE === 'admin';
      return h('div', {
        style: {
          minHeight: '100vh', display: 'grid', placeItems: 'center',
          background: C.bg, padding: 32
        }
      }, h(Card, {
        style: { maxWidth: 560 }
      }, [
        h('h1', { key: 't', style: { fontSize: 18, color: C.critical, marginBottom: 8 } },
          'Si è verificato un errore'),
        h('p', { key: 'm', style: { fontSize: 14, color: C.textMid, marginBottom: 16 } },
          'Riprova; se il problema persiste, contatta l\'amministratore.'),
        isAdmin && h('pre', {
          key: 's',
          style: {
            fontSize: 11, background: '#f6f6f6', padding: 12, borderRadius: 8,
            overflow: 'auto', maxHeight: 240, fontFamily: 'ui-monospace,monospace'
          }
        }, String(this.state.error && (this.state.error.stack || this.state.error.message))),
        h('button', {
          key: 'r',
          onClick: () => this.setState({ error: null }),
          style: btnStyle({ kind: 'primary' })
        }, 'Riprova')
      ]));
    }
  }

  // memo wrap: KPICard è la card più ridisegnata (4-9 per pagina),
  // memoizzarla risparmia paint significativo. Card è più variabile
  // (children spesso array nuovo) → memoizzare ha meno effetto, salto.
  // Skeleton/Pill puramente visuali, scope minimale → no memo.
  const memoKPICard = root.React.memo
    ? root.React.memo(KPICard)
    : KPICard;

  G.ui = {
    Card, KPICard: memoKPICard, EmissionBadge, Skeleton,
    ToastHost, pushToast, ConfirmHost, confirm,
    Button, Input, Select, Pill, ErrorBoundary, btnStyle,
    S2MethodToggle, useS2Method
  };
})(typeof window !== 'undefined' ? window : globalThis);
