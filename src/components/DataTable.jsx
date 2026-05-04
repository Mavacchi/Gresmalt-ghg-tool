/* GHG Tool — DataTable.jsx
 *
 * Tabella generica con sort, filter, paginazione, edit/delete inline.
 * Le colonne edit/delete sono mostrate solo se l'utente ne ha i permessi.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useMemo } = root.React;
  const C = G.COLORS;

  function DataTable ({
    columns = [], rows = [],
    pageSize = 15, sortable = true, filterable = true,
    onRowClick, onEdit, onDelete,
    canEdit = false, canDelete = false,
    emptyText = 'Nessuna riga corrisponde ai filtri.'
  }) {
    const [page, setPage] = useState(0);
    const [sort, setSort] = useState({ key: null, asc: true });
    const [q, setQ]       = useState('');

    const filtered = useMemo(() => {
      let r = rows;
      if (q) {
        const Q = q.toLowerCase();
        r = r.filter(row => columns.some(c => {
          const v = c.key ? row[c.key] : null;
          return v != null && String(v).toLowerCase().includes(Q);
        }));
      }
      if (sort.key) {
        r = [...r].sort((a, b) => {
          const va = a[sort.key], vb = b[sort.key];
          if (typeof va === 'number' && typeof vb === 'number')
            return sort.asc ? va - vb : vb - va;
          return sort.asc
            ? String(va || '').localeCompare(String(vb || ''))
            : String(vb || '').localeCompare(String(va || ''));
        });
      }
      return r;
    }, [rows, q, sort, columns]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const cur = filtered.slice(page * pageSize, (page + 1) * pageSize);

    return h('div', null, [
      filterable && h('div', {
        key: 'flt',
        style: { display: 'flex', justifyContent: 'space-between', marginBottom: 12 }
      }, [
        h('input', {
          key: 'q', type: 'search',
          placeholder: 'Cerca…',
          'aria-label': 'Filtra righe della tabella',
          value: q, onChange: e => { setQ(e.target.value); setPage(0); },
          style: {
            padding: '8px 12px', border: `1px solid ${C.border}`,
            borderRadius: 8, fontSize: 13, width: 240
          }
        }),
        h('div', {
          key: 'cnt',
          'aria-live': 'polite', 'aria-atomic': 'true',
          style: { fontSize: 12, color: C.textMid, alignSelf: 'center' }
        }, `${filtered.length} righe`)
      ]),
      h('div', {
        key: 'tw',
        style: { overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }
      }, h('table', {
        style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
      }, [
        h('thead', { key: 'h', style: { background: C.bg } },
          h('tr', null, [
            ...columns.map(c => {
              const isSortable = sortable && c.key;
              const ariaSort = sort.key === c.key
                ? (sort.asc ? 'ascending' : 'descending')
                : (isSortable ? 'none' : undefined);
              const onActivate = () => isSortable && setSort(s =>
                ({ key: c.key, asc: s.key === c.key ? !s.asc : true }));
              return h('th', {
                key: c.key,
                scope: 'col',
                'aria-sort': ariaSort,
                onClick: onActivate,
                // Sort via tastiera: Enter/Spazio
                onKeyDown: isSortable ? (ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onActivate();
                  }
                } : undefined,
                tabIndex: isSortable ? 0 : undefined,
                role: isSortable ? 'columnheader button' : 'columnheader',
                'aria-label': isSortable
                  ? `${c.label || c.key} — ordina${ariaSort === 'ascending' ? ' (ascendente)' : ariaSort === 'descending' ? ' (discendente)' : ''}`
                  : undefined,
                style: {
                  padding: '10px 12px', textAlign: c.align || 'left',
                  fontSize: 11, fontWeight: 600, color: C.textMid,
                  textTransform: 'uppercase', letterSpacing: .5,
                  cursor: isSortable ? 'pointer' : 'default',
                  borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap', userSelect: 'none'
                }
              }, [
                c.label || c.key,
                sort.key === c.key && h('span', { key: 'a', 'aria-hidden': 'true', style: { marginLeft: 4 } },
                  sort.asc ? '▲' : '▼')
              ]);
            }),
            (canEdit || canDelete) && h('th', {
              key: '_a',
              style: { width: 80, padding: 8, borderBottom: `1px solid ${C.border}` }
            }, '')
          ])),
        h('tbody', { key: 'b' },
          cur.length === 0
            ? [h('tr', { key: 'e' }, h('td', {
                colSpan: columns.length + (canEdit || canDelete ? 1 : 0),
                style: { padding: 32, textAlign: 'center', color: C.textLow }
              }, emptyText))]
            : cur.map((row, i) => h('tr', {
                key: row.id || i,
                onClick: () => onRowClick && onRowClick(row),
                style: {
                  cursor: onRowClick ? 'pointer' : 'default',
                  borderBottom: `1px solid ${C.borderSoft}`
                }
              }, [
                ...columns.map(c => h('td', {
                  key: c.key,
                  style: {
                    padding: '10px 12px', textAlign: c.align || 'left',
                    color: C.text, whiteSpace: c.nowrap ? 'nowrap' : 'normal',
                    fontFamily: c.mono ? 'ui-monospace,monospace' : 'inherit'
                  }
                }, c.render ? c.render(row[c.key], row) : row[c.key] != null ? String(row[c.key]) : '—')),
                (canEdit || canDelete) && h('td', {
                  key: '_a',
                  style: { padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }
                }, [
                  canEdit && h('button', {
                    key: 'e', type: 'button',
                    'aria-label': 'Modifica riga',
                    title: 'Modifica',
                    onClick: (ev) => { ev.stopPropagation(); onEdit && onEdit(row); },
                    style: btn(C.brand)
                  }, h('span', { 'aria-hidden': 'true' }, '✎')),
                  canDelete && h('button', {
                    key: 'd', type: 'button',
                    'aria-label': 'Elimina riga',
                    title: 'Elimina',
                    onClick: (ev) => { ev.stopPropagation(); onDelete && onDelete(row); },
                    style: btn(C.critical)
                  }, h('span', { 'aria-hidden': 'true' }, '🗑'))
                ])
              ])))
      ])),
      totalPages > 1 && h('nav', {
        key: 'pg',
        'aria-label': 'Paginazione tabella',
        style: { display: 'flex', gap: 8, justifyContent: 'center',
                 marginTop: 12, fontSize: 13 }
      }, [
        h('button', {
          key: 'p', type: 'button', disabled: page === 0,
          'aria-label': 'Pagina precedente',
          onClick: () => setPage(p => Math.max(0, p - 1)),
          style: pgBtn(page === 0)
        }, h('span', { 'aria-hidden': 'true' }, '←')),
        h('span', {
          key: 'i',
          'aria-current': 'page', 'aria-live': 'polite',
          style: { padding: '6px 12px', color: C.textMid }
        }, `${page + 1} / ${totalPages}`),
        h('button', {
          key: 'n', type: 'button', disabled: page >= totalPages - 1,
          'aria-label': 'Pagina successiva',
          onClick: () => setPage(p => Math.min(totalPages - 1, p + 1)),
          style: pgBtn(page >= totalPages - 1)
        }, h('span', { 'aria-hidden': 'true' }, '→'))
      ])
    ]);
  }

  function btn (color) {
    return {
      background: 'transparent', border: 'none', cursor: 'pointer',
      color, fontSize: 16, padding: '4px 6px', marginLeft: 4
    };
  }
  function pgBtn (disabled) {
    return {
      padding: '6px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
      background: '#fff', cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1
    };
  }

  G.ui.DataTable = DataTable;
})(typeof window !== 'undefined' ? window : globalThis);
