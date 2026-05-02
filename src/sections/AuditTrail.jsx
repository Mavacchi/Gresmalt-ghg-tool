/* GHG Tool — AuditTrail.jsx (admin/auditor)
 *
 * Tabella audit_log con filtri tabella/utente/range, badge operazione,
 * diff sintetico e modal JSON old/new. Indicatore catena hash.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useEffect, useMemo } = root.React;
  const C = G.COLORS;

  const OP_COLOR = { INSERT: C.success, UPDATE: C.info, DELETE: C.critical };

  function AuditTrail () {
    const [rows, setRows]   = useState([]);
    const [loading, setLoading] = useState(true);
    const [filt, setFilt]   = useState({ table: '', user: '', range: 'all' });
    const [open, setOpen]   = useState(null);
    const [chainOk, setChainOk] = useState(null);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          const sb = G.db.getClient();
          const { data, error } = await sb.from('audit_log')
            .select('*').order('id', { ascending: false }).limit(2000);
          if (error) throw error;
          if (!cancelled) setRows(data || []);
        } catch (e) {
          G.ui.pushToast(e.message || 'Errore audit', 'error');
        } finally {
          if (!cancelled) setLoading(false);
        }
        try {
          const broken = await G.db.verifyAuditChain();
          if (!cancelled) setChainOk(!Array.isArray(broken) || broken.length === 0);
        } catch (_) {
          if (!cancelled) setChainOk(null);
        }
      })();
      return () => { cancelled = true; };
    }, []);

    const filtered = useMemo(() => {
      let r = rows;
      if (filt.table) r = r.filter(x => x.table_name === filt.table);
      if (filt.user)  r = r.filter(x => (x.user_email || '').includes(filt.user));
      if (filt.range !== 'all') {
        const ms = filt.range === '24h' ? 86400000 : 7*86400000;
        r = r.filter(x => new Date(x.ts).getTime() > Date.now() - ms);
      }
      return r;
    }, [rows, filt]);

    return h('div', null, [
      h('div', {
        key: 'h',
        style: { display: 'flex', justifyContent: 'space-between', marginBottom: 16 }
      }, [
        h('h1', { style: { fontSize: 22, fontWeight: 700 } }, 'Audit Trail'),
        h('div', {
          style: {
            fontSize: 12, color: chainOk ? C.success : chainOk === false ? C.critical : C.textMid,
            fontWeight: 600
          }
        }, chainOk == null ? '— catena hash non verificata —'
          : chainOk ? '✓ catena hash integra' : '✗ catena hash rotta')
      ]),
      h('div', {
        key: 'f',
        style: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }
      }, [
        h(G.ui.Select, {
          key: 't', value: filt.table,
          onChange: e => setFilt({ ...filt, table: e.target.value }),
          options: [
            { value: '', label: 'Tutte le tabelle' },
            ...['anagrafiche','produzione','fe','s1','s2','s3','s3_materiality','app_meta']
              .map(t => ({ value: t, label: t }))
          ]
        }),
        h(G.ui.Input, {
          key: 'u', placeholder: 'Filtra utente…', value: filt.user,
          onChange: e => setFilt({ ...filt, user: e.target.value })
        }),
        ...['24h','week','all'].map(r => h('button', {
          key: r, onClick: () => setFilt({ ...filt, range: r }),
          style: {
            ...G.ui.btnStyle({ kind: filt.range === r ? 'primary' : 'ghost' }),
            padding: '4px 12px'
          }
        }, r === '24h' ? 'Ultime 24h' : r === 'week' ? 'Settimana' : 'Tutto')),
        h('span', {
          key: 'c',
          style: { marginLeft: 'auto', fontSize: 12, color: C.textMid }
        }, `${filtered.length} eventi`)
      ]),
      loading
        ? h(G.ui.Skeleton, { height: 240 })
        : h(G.ui.DataTable, {
            columns: [
              { key: 'ts', label: 'Timestamp', render: v =>
                v ? new Date(v).toLocaleString('it-IT') : '—', nowrap: true },
              { key: 'user_email', label: 'Utente', nowrap: true },
              { key: 'table_name', label: 'Tabella', nowrap: true },
              { key: 'operation', label: 'Op', render: v =>
                h(G.ui.Pill, { color: OP_COLOR[v] || C.textMid }, v) },
              { key: 'row_id', label: 'Row', mono: true, nowrap: true }
            ],
            rows: filtered,
            onRowClick: r => setOpen(r)
          }),
      open && h(DiffModal, { row: open, onClose: () => setOpen(null) })
    ]);
  }

  function DiffModal ({ row, onClose }) {
    return h('div', {
      role: 'dialog', 'aria-modal': true,
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'grid', placeItems: 'center', zIndex: 9000
      }
    }, h(G.ui.Card, {
      style: {
        maxWidth: 720, width: '90%', maxHeight: '80vh', overflow: 'auto'
      }
    }, [
      h('div', {
        key: 'h',
        style: { display: 'flex', justifyContent: 'space-between', marginBottom: 12 }
      }, [
        h('h2', { style: { fontSize: 18, fontWeight: 700 } },
          `${row.operation} · ${row.table_name}`),
        h('button', {
          onClick: onClose,
          style: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 20 }
        }, '×')
      ]),
      h('div', {
        key: 'g',
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }
      }, [
        h('div', { key: 'o' }, [
          h('h3', { style: { fontSize: 12, fontWeight: 600, color: C.textMid, marginBottom: 4 } }, 'Old'),
          h('pre', {
            style: {
              background: '#f6f6f6', padding: 12, borderRadius: 8,
              fontSize: 11, fontFamily: 'ui-monospace,monospace', overflow: 'auto'
            }
          }, JSON.stringify(row.old_data, null, 2) || 'null')
        ]),
        h('div', { key: 'n' }, [
          h('h3', { style: { fontSize: 12, fontWeight: 600, color: C.textMid, marginBottom: 4 } }, 'New'),
          h('pre', {
            style: {
              background: '#f6f6f6', padding: 12, borderRadius: 8,
              fontSize: 11, fontFamily: 'ui-monospace,monospace', overflow: 'auto'
            }
          }, JSON.stringify(row.new_data, null, 2) || 'null')
        ])
      ])
    ]));
  }

  G.sections = G.sections || {};
  G.sections.AuditTrail = AuditTrail;
})(typeof window !== 'undefined' ? window : globalThis);
