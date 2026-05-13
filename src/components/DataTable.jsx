/* GHG Tool — DataTable.jsx
 *
 * Tabella generica con sort, filter, paginazione, edit/delete inline.
 * Le colonne edit/delete sono mostrate solo se l'utente ne ha i permessi.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useMemo, useEffect, useRef } = root.React;
  const C = G.COLORS;

  function DataTable ({
    columns = [], rows = [],
    pageSize = 15, sortable = true, filterable = true,
    onRowClick, onEdit, onDelete,
    canEdit = false, canDelete = false,
    // Multi-select: se true mostra checkbox in colonna iniziale + header.
    // bulkActions: array di { label, kind?, danger?, onClick(selectedRows) }.
    // Quando ci sono selezioni e bulkActions è non vuoto, appare un
    // banner sopra la tabella con i bottoni delle azioni di massa.
    selectable = false, bulkActions = null,
    emptyText = 'Nessuna riga corrisponde ai filtri.'
  }) {
    const [page, setPage] = useState(0);
    const [sort, setSort] = useState({ key: null, asc: true });
    const [q, setQ]       = useState('');
    // Set di id selezionati (richiede che row.id sia definito; se mancano
    // id le checkbox restano disabilitate). Reset quando cambia il set
    // di righe sottostante (es. dopo delete + reload).
    const [selected, setSelected] = useState(() => new Set());
    // Reset selezione quando l'identità della collezione `rows` cambia,
    // così dopo un delete bulk + reload non restiamo con id stale.
    const lastRowsRef = useRef(rows);
    useEffect(() => {
      if (lastRowsRef.current !== rows) {
        lastRowsRef.current = rows;
        setSelected(prev => prev.size > 0 ? new Set() : prev);
      }
    }, [rows]);

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

    // Stato selezione calcolato solo sulla collezione `filtered` (non
    // su `rows`), così la checkbox header riflette "tutto ciò che vedi
    // ora con il filtro attivo". Più utile della select-all globale.
    const filteredIds = filtered.map(r => r.id).filter(id => id != null);
    const allFilteredSelected = filteredIds.length > 0
      && filteredIds.every(id => selected.has(id));
    const someFilteredSelected = filteredIds.some(id => selected.has(id));

    function toggleAllFiltered () {
      const next = new Set(selected);
      if (allFilteredSelected) {
        filteredIds.forEach(id => next.delete(id));
      } else {
        filteredIds.forEach(id => next.add(id));
      }
      setSelected(next);
    }
    function toggleOne (id) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelected(next);
    }
    async function runBulkAction (action) {
      const selectedRows = rows.filter(r => selected.has(r.id));
      if (selectedRows.length === 0) return;
      try {
        await action.onClick(selectedRows);
        setSelected(new Set());  // reset post-azione
      } catch (_) { /* l'azione gestisce i suoi errori (toast) */ }
    }

    const showSelection = selectable;
    const showBulkBanner = showSelection && selected.size > 0
      && Array.isArray(bulkActions) && bulkActions.length > 0;

    return h('div', null, [
      // Bulk actions banner (solo se ci sono selezioni)
      showBulkBanner && h('div', {
        key: 'bb',
        style: {
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 12,
          background: C.accentSoft || '#EEF1F3',
          border: `1px solid ${C.accent || '#A6B5BE'}`,
          borderRadius: 8, fontSize: 13, color: C.text
        }
      }, [
        h('span', { key: 't', style: { fontWeight: 600 } },
          `${selected.size} ${selected.size === 1 ? 'riga selezionata' : 'righe selezionate'}`),
        h('span', { key: 'sp', style: { flex: 1 } }),
        ...bulkActions.map((action, i) => h('button', {
          key: i, type: 'button',
          onClick: () => runBulkAction(action),
          style: {
            padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: 'pointer',
            background: action.danger ? C.critical : '#fff',
            color: action.danger ? '#fff' : C.text,
            border: `1px solid ${action.danger ? C.critical : C.border}`
          }
        }, action.label)),
        h('button', {
          key: 'cl', type: 'button',
          onClick: () => setSelected(new Set()),
          style: {
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.textMid, fontSize: 12, padding: '4px 8px'
          }
        }, 'Deseleziona tutto')
      ]),
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
            // Colonna checkbox header (tri-state: vuoto / pieno / parziale)
            showSelection && h('th', {
              key: '_sel',
              scope: 'col',
              style: {
                width: 36, padding: '10px 8px',
                borderBottom: `1px solid ${C.border}`,
                textAlign: 'center'
              }
            }, h('input', {
              type: 'checkbox',
              checked: allFilteredSelected,
              ref: el => {
                // Tri-state: 'indeterminate' è un property DOM (non attributo).
                if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
              },
              disabled: filteredIds.length === 0,
              onChange: toggleAllFiltered,
              'aria-label': allFilteredSelected
                ? 'Deseleziona tutte le righe filtrate'
                : 'Seleziona tutte le righe filtrate',
              style: { cursor: filteredIds.length === 0 ? 'not-allowed' : 'pointer' }
            })),
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
                // Sort via tastiera: Enter/Spazio (th non è focusable di
                // default → tabIndex 0 quando sortable)
                onKeyDown: isSortable ? (ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onActivate();
                  }
                } : undefined,
                tabIndex: isSortable ? 0 : undefined,
                // <th> ha già role="columnheader" implicito; non combiniamo
                // con "button" (ARIA non supporta ruoli multipli con spazio).
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
                colSpan: columns.length
                  + (canEdit || canDelete ? 1 : 0)
                  + (showSelection ? 1 : 0),
                style: { padding: 32, textAlign: 'center', color: C.textLow }
              }, emptyText))]
            : cur.map((row, i) => h('tr', {
                key: row.id || i,
                onClick: () => onRowClick && onRowClick(row),
                style: {
                  cursor: onRowClick ? 'pointer' : 'default',
                  borderBottom: `1px solid ${C.borderSoft}`,
                  background: showSelection && selected.has(row.id) ? (C.accentSoft || '#F4F6F7') : 'transparent'
                }
              }, [
                showSelection && h('td', {
                  key: '_sel',
                  style: { padding: '8px', textAlign: 'center' },
                  // Stop click propagation: cliccare la checkbox non
                  // deve triggerare onRowClick / onEdit della riga.
                  onClick: e => e.stopPropagation()
                }, h('input', {
                  type: 'checkbox',
                  checked: row.id != null && selected.has(row.id),
                  disabled: row.id == null,
                  onChange: () => row.id != null && toggleOne(row.id),
                  'aria-label': `Seleziona riga ${i + 1}`,
                  style: { cursor: row.id == null ? 'not-allowed' : 'pointer' }
                })),
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
