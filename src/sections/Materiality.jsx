/* GHG Tool — Materiality.jsx (sezione top-level, console interna)
 *
 * 15 card categoria, 4 stati (Inclusa / Esclusa / N.A. / Da valutare).
 * Visibile a tutti i ruoli interni; editabile da admin/editor.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;

  const STATES = ['Inclusa','Esclusa','N.A.','Da valutare'];
  const STATE_COLOR = {
    'Inclusa':     C.success,
    'Esclusa':     C.textMid,
    'N.A.':        C.textLow,
    'Da valutare': C.warning
  };

  function Materiality ({ data, role, reload }) {
    const canEdit = G.can.edit(role);
    const rows = data.s3_materiality || [];
    const byCat = Object.fromEntries(rows.map(r => [r.cat_id, r]));

    return h('div', null, [
      h('h1', {
        key: 'h',
        style: { fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 8 }
      }, 'Materialità Scope 3 — 15 categorie'),
      h('p', {
        key: 's',
        style: { fontSize: 14, color: C.textMid, marginBottom: 24 }
      }, 'Stato di inclusione, giustificazione metodologica e anno di revisione per ciascuna delle 15 categorie GHG Protocol.'),
      h('div', {
        key: 'g',
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16
        }
      }, Array.from({ length: 15 }, (_, i) => i + 1).map(catId => {
        const row = byCat[catId] || { cat_id: catId, status: 'Da valutare' };
        return h(MaterialityCard, {
          key: catId,
          row, canEdit,
          onSave: async (payload) => {
            try {
              await G.db.saveMateriality([payload]);
              G.ui.pushToast('Categoria aggiornata', 'success');
              reload && reload();
            } catch (e) {
              G.ui.pushToast(e.message || 'Errore di salvataggio', 'error');
            }
          }
        });
      }))
    ]);
  }

  function MaterialityCard ({ row, canEdit, onSave }) {
    const [editing, setEditing]   = useState(false);
    const [status, setStatus]     = useState(row.status || 'Da valutare');
    const [just, setJust]         = useState(row.justification || '');
    const [methRef, setMethRef]   = useState(row.methodological_ref || '');
    const [revYear, setRevYear]   = useState(row.review_year || new Date().getFullYear());

    return h(G.ui.Card, {
      borderLeft: STATE_COLOR[status],
      style: { padding: 16 }
    }, [
      h('div', {
        key: 'h',
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }
      }, [
        h('div', { key: 'l' }, [
          h('div', { style: { fontSize: 11, color: C.textLow, fontWeight: 600 } },
            `Categoria ${row.cat_id}`),
          h('div', { style: { fontSize: 14, fontWeight: 600, color: C.text, marginTop: 2 } },
            G.CAT_NAMES[row.cat_id] || `Cat ${row.cat_id}`)
        ]),
        h(G.ui.Pill, {
          key: 'p',
          color: STATE_COLOR[status],
          children: status
        })
      ]),
      editing ? h('div', { key: 'e', style: { marginTop: 12 } }, [
        h('label', { key: 'l1', style: lbl }, 'Stato'),
        h(G.ui.Select, {
          key: 's',
          value: status, onChange: e => setStatus(e.target.value),
          options: STATES,
          style: { width: '100%', marginTop: 4 }
        }),
        (status === 'Inclusa' || status === 'Esclusa') && h('div', { key: 'j' }, [
          h('label', { style: lbl }, 'Giustificazione'),
          h('textarea', {
            value: just, onChange: e => setJust(e.target.value),
            rows: 3,
            style: textareaStyle
          })
        ]),
        h('label', { key: 'l2', style: lbl }, 'Riferimento metodologico'),
        h(G.ui.Input, {
          value: methRef, onChange: e => setMethRef(e.target.value),
          style: { width: '100%' }
        }),
        h('label', { key: 'l3', style: lbl }, 'Anno revisione'),
        h(G.ui.Input, {
          type: 'number', value: revYear,
          onChange: e => setRevYear(+e.target.value),
          style: { width: 120 }
        }),
        h('div', {
          key: 'a',
          style: { display: 'flex', gap: 8, marginTop: 12 }
        }, [
          h(G.ui.Button, {
            key: 's', kind: 'primary',
            onClick: () => {
              onSave({ cat_id: row.cat_id, status, justification: just, methodological_ref: methRef, review_year: revYear });
              setEditing(false);
            }
          }, 'Salva'),
          h(G.ui.Button, {
            key: 'c', kind: 'ghost',
            onClick: () => setEditing(false)
          }, 'Annulla')
        ])
      ]) : h('div', { key: 'r', style: { marginTop: 12 } }, [
        row.justification && h('p', {
          key: 'j', style: { fontSize: 12, color: C.textMid, lineHeight: 1.5 }
        }, row.justification),
        row.methodological_ref && h('div', {
          key: 'm',
          style: { fontSize: 11, color: C.textLow, marginTop: 8 }
        }, `Rif. metodologico: ${row.methodological_ref}`),
        row.review_year && h('div', {
          key: 'y',
          style: { fontSize: 11, color: C.textLow, marginTop: 4 }
        }, `Anno revisione: ${row.review_year}`),
        canEdit && h('button', {
          key: 'e', onClick: () => setEditing(true),
          style: {
            marginTop: 12, padding: '4px 10px',
            background: 'transparent', color: C.brand,
            border: `1px solid ${C.border}`, borderRadius: 8,
            fontSize: 12, cursor: 'pointer'
          }
        }, '✎ Modifica')
      ])
    ]);
  }

  const lbl = {
    fontSize: 11, color: C.textMid, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: .5,
    display: 'block', marginTop: 12, marginBottom: 4
  };
  const textareaStyle = {
    width: '100%', padding: 8, border: `1px solid ${C.border}`,
    borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical'
  };

  G.sections = G.sections || {};
  G.sections.Materiality = Materiality;
})(typeof window !== 'undefined' ? window : globalThis);
