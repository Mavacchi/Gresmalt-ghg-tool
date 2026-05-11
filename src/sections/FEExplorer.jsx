/* GHG Tool — FEExplorer.jsx
 *
 * Esplora i fattori di emissione presenti nel database e, per
 * admin/editor, propone una "Ricerca FE online" che usa l'Edge
 * Function search_fe (Gemini 2.5 Flash + Google Search Grounding)
 * per recuperare candidati FE da fonti istituzionali (ISPRA,
 * DEFRA, EPA, AIB, IPCC, GHG Protocol, ecc.).
 *
 * Flusso ricerca FE online:
 *   1. Utente inserisce query naturale (es. "FE trasporto furgone
 *      diesel 7 t, 2025")
 *   2. Edge Function ritorna fino a 5 candidati con valore, unità,
 *      anno, fonte URL, citazione testuale, confidence
 *   3. Utente seleziona un candidato → form pre-compilato
 *   4. Salva → INSERT in public.fe (con audit trail in audit_log
 *      via trigger esistente) + mark_fe_search_selected per legare
 *      il log al record
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;

  function FEExplorer ({ data, role, reload }) {
    const canEdit = G.can.edit(role || 'viewer');

    // Filtri tabella esistente
    const [fam, setFam] = useState('');
    const [q, setQ] = useState('');

    // Stato ricerca online
    const [searchOpen, setSearchOpen]       = useState(false);
    const [searchQuery, setSearchQuery]     = useState('');
    const [searchYear, setSearchYear]       = useState(new Date().getFullYear());
    const [searching, setSearching]         = useState(false);
    const [searchResult, setSearchResult]   = useState(null); // { candidates, sources_used, notice, log_id }
    const [selectedIdx, setSelectedIdx]     = useState(null);
    const [editedRow, setEditedRow]         = useState(null);
    const [saving, setSaving]               = useState(false);

    const fams = Array.from(new Set((data.fe || []).map(f => f.Famiglia || f.famiglia))).filter(Boolean);
    const filtered = (data.fe || []).filter(f => {
      const F = f.Famiglia || f.famiglia;
      const D = String(f.Descrizione || f.descrizione || '').toLowerCase();
      const I = String(f.FE_ID || f.fe_id || '').toLowerCase();
      if (fam && F !== fam) return false;
      if (q && !D.includes(q.toLowerCase()) && !I.includes(q.toLowerCase())) return false;
      return true;
    });

    async function runSearch () {
      const query = searchQuery.trim();
      if (query.length < 5) {
        G.ui.pushToast('La query deve essere di almeno 5 caratteri', 'warning');
        return;
      }
      setSearching(true);
      setSearchResult(null);
      setSelectedIdx(null);
      setEditedRow(null);
      try {
        const r = await G.db.searchFE(query, +searchYear);
        setSearchResult(r);
        if (r.notice) G.ui.pushToast(r.notice, 'info');
      } catch (e) {
        G.ui.pushToast(e.message || 'Ricerca FE fallita', 'error');
      } finally {
        setSearching(false);
      }
    }

    function selectCandidate (idx) {
      const c = searchResult && searchResult.candidates[idx];
      if (!c) return;
      setSelectedIdx(idx);
      // Pre-compila il form con i campi App-named (vedi typedef FE
      // in SupabaseDB.jsx). La nota include URL fonte + citazione
      // per traceability CSRD.
      setEditedRow({
        FE_ID:           c.fe_id_suggested || '',
        Famiglia:        c.famiglia || '',
        Codice_Voce:     c.codice_voce || '',
        Descrizione:     c.descrizione || '',
        Anno_Validità:   c.anno_validita || +searchYear,
        Valore:          c.valore,
        Unità:           c.unita || '',
        Gas:             c.gas || 'CO2e',
        Fonte:           c.fonte || '',
        Nota:            `${c.source_url}\n«${c.source_quote}»\n` +
                         `Confidence LLM: ${c.confidence || 'n.d.'}`
      });
    }

    async function saveSelected () {
      if (!editedRow) return;
      // Validazione minima
      if (!editedRow.FE_ID && !editedRow.Codice_Voce) {
        G.ui.pushToast('FE_ID o Codice_Voce richiesto', 'error');
        return;
      }
      if (!editedRow.Valore || +editedRow.Valore < 0) {
        G.ui.pushToast('Valore deve essere ≥ 0', 'error');
        return;
      }
      setSaving(true);
      try {
        const saved = await G.db.upsert('fe', editedRow);
        // Lega il log a questo record fe (audit trail CSRD)
        if (searchResult && searchResult.log_id && saved && saved.id) {
          try {
            await G.db.markFESearchSelected(
              searchResult.log_id, selectedIdx, saved.id);
          } catch (_) { /* log non critico */ }
        }
        G.ui.pushToast('FE salvato. Aggiornamento elenco…', 'success');
        // Reset UI ricerca
        setSearchResult(null);
        setSelectedIdx(null);
        setEditedRow(null);
        setSearchQuery('');
        if (typeof reload === 'function') await reload();
      } catch (e) {
        G.ui.pushToast(e.message || 'Salvataggio FE fallito', 'error');
      } finally {
        setSaving(false);
      }
    }

    return h('div', null, [
      h('h1', { key: 'h', style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } }, 'FE Explorer'),

      // ─── Card "Cerca FE online" (admin/editor only) ─────────
      canEdit && h(G.ui.Card, {
        key: 'search', style: { marginBottom: 16 }
      }, [
        h('div', {
          key: 'hd',
          style: { display: 'flex', justifyContent: 'space-between',
                   alignItems: 'center', cursor: 'pointer' },
          onClick: () => setSearchOpen(!searchOpen)
        }, [
          h('div', { key: 't' }, [
            h('h2', {
              style: { fontSize: 16, fontWeight: 700, display: 'inline' }
            }, '🤖 Cerca FE online (IA)'),
            h('p', {
              style: { fontSize: 12, color: C.textMid, marginTop: 4 }
            }, 'Cerca fattori di emissione da fonti istituzionali (ISPRA, DEFRA, EPA, AIB, IPCC). Tutti i candidati vanno rivisti e confermati prima del salvataggio.')
          ]),
          h('button', {
            key: 'b',
            'aria-label': searchOpen ? 'Chiudi' : 'Apri',
            style: { background: 'transparent', border: 'none',
                     fontSize: 18, cursor: 'pointer', color: C.textMid }
          }, searchOpen ? '▲' : '▼')
        ]),

        // Form di ricerca
        searchOpen && h('div', {
          key: 'frm',
          style: { marginTop: 16, padding: 16, background: C.bg,
                   borderRadius: 8, display: 'flex', gap: 8, flexWrap: 'wrap',
                   alignItems: 'end' }
        }, [
          h('div', { key: 'q', style: { flex: '1 1 320px', minWidth: 220 } }, [
            h('label', {
              style: { display: 'block', fontSize: 11, fontWeight: 700,
                       color: C.textMid, marginBottom: 4,
                       textTransform: 'uppercase', letterSpacing: .5 }
            }, 'Descrizione del FE da cercare'),
            h(G.ui.Input, {
              placeholder: 'es. FE trasporto camion HGV diesel 16-32 t, distance-based',
              value: searchQuery,
              onChange: e => setSearchQuery(e.target.value),
              onKeyDown: e => { if (e.key === 'Enter' && !searching) runSearch(); }
            })
          ]),
          h('div', { key: 'y', style: { width: 120 } }, [
            h('label', {
              style: { display: 'block', fontSize: 11, fontWeight: 700,
                       color: C.textMid, marginBottom: 4,
                       textTransform: 'uppercase', letterSpacing: .5 }
            }, 'Anno validità'),
            h(G.ui.Input, {
              type: 'number', min: 2000, max: 2100,
              value: searchYear,
              onChange: e => setSearchYear(e.target.value)
            })
          ]),
          h(G.ui.Button, {
            key: 'go', kind: 'primary',
            disabled: searching || searchQuery.trim().length < 5,
            onClick: runSearch
          }, searching ? 'Ricerca…' : 'Cerca')
        ]),

        // Risultati
        searchOpen && searchResult && h('div', {
          key: 'rs', style: { marginTop: 16 }
        }, [
          // Header con info sources
          searchResult.sources_used && searchResult.sources_used.length > 0 && h('div', {
            key: 'src',
            style: { fontSize: 11, color: C.textLow, marginBottom: 12 }
          }, `Fonti consultate: ${searchResult.sources_used.join(' · ')} · ${searchResult.duration_ms} ms`),

          searchResult.candidates.length === 0 && h('div', {
            key: 'empty',
            style: { padding: 24, background: C.bg, borderRadius: 8,
                     textAlign: 'center', color: C.textMid, fontSize: 13 }
          }, 'Nessun FE affidabile trovato. Prova a riformulare la query oppure inserisci manualmente.'),

          // Lista candidati come card cliccabili
          h('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            searchResult.candidates.map((c, i) => h('div', {
              key: i,
              onClick: () => selectCandidate(i),
              style: {
                padding: 14,
                background: selectedIdx === i ? C.accentSoft : '#fff',
                border: `1px solid ${selectedIdx === i ? C.accent : C.border}`,
                borderRadius: 8, cursor: 'pointer',
                transition: 'all .15s ease'
              }
            }, [
              h('div', {
                key: 'r1',
                style: { display: 'flex', justifyContent: 'space-between',
                         alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }
              }, [
                h('div', { key: 'v', style: { fontSize: 18, fontWeight: 700, color: C.text } }, [
                  c.valore,
                  h('span', { key: 'u', style: { fontSize: 13, fontWeight: 500,
                                                   color: C.textMid, marginLeft: 6 } }, c.unita)
                ]),
                h('div', { key: 'f', style: { fontSize: 11, color: C.textMid } }, [
                  c.fonte,
                  h('span', { key: 'y', style: { marginLeft: 8 } }, `· ${c.anno_validita}`),
                  h('span', {
                    key: 'cf',
                    style: {
                      marginLeft: 8, padding: '2px 8px', borderRadius: 99,
                      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                      background: c.confidence === 'high' ? C.successPale
                                : c.confidence === 'medium' ? C.warningPale
                                : C.criticalPale,
                      color:      c.confidence === 'high' ? C.success
                                : c.confidence === 'medium' ? C.warning
                                : C.critical
                    }
                  }, c.confidence || 'low')
                ])
              ]),
              c.descrizione && h('div', {
                key: 'd', style: { fontSize: 13, color: C.text, marginTop: 6 }
              }, c.descrizione),
              c.source_quote && h('div', {
                key: 'sq',
                style: {
                  fontSize: 12, color: C.textMid, marginTop: 8,
                  fontStyle: 'italic', borderLeft: `2px solid ${C.border}`,
                  paddingLeft: 8
                }
              }, '«' + c.source_quote + '»'),
              h('a', {
                key: 'sl', href: c.source_url, target: '_blank', rel: 'noopener noreferrer',
                onClick: e => e.stopPropagation(),
                style: { fontSize: 11, color: C.accent, marginTop: 6,
                         display: 'inline-block', wordBreak: 'break-all' }
              }, '→ ' + c.source_url)
            ]))
          ),

          // Form review del candidato selezionato
          editedRow && h('div', {
            key: 'edit', style: {
              marginTop: 16, padding: 16, background: '#fff',
              border: `1px solid ${C.accent}`, borderRadius: 8
            }
          }, [
            h('div', {
              key: 'th',
              style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                       textTransform: 'uppercase', letterSpacing: .5, marginBottom: 12 }
            }, 'Verifica e salva — i campi sono modificabili'),
            h('div', {
              key: 'gr',
              style: {
                display: 'grid', gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))'
              }
            }, [
              ['FE_ID', 'FE_ID *'], ['Famiglia', 'Famiglia'],
              ['Codice_Voce', 'Codice voce'], ['Descrizione', 'Descrizione'],
              ['Anno_Validità', 'Anno validità'], ['Valore', 'Valore *'],
              ['Unità', 'Unità'], ['Gas', 'Gas'],
              ['Fonte', 'Fonte']
            ].map(([k, label]) => h('div', { key: k }, [
              h('label', {
                style: { display: 'block', fontSize: 10, fontWeight: 700,
                         color: C.textMid, marginBottom: 3 }
              }, label),
              h(G.ui.Input, {
                value: editedRow[k] == null ? '' : editedRow[k],
                onChange: e => setEditedRow(Object.assign({},
                  editedRow, { [k]: e.target.value }))
              })
            ]))),
            h('div', { key: 'nt', style: { marginTop: 10 } }, [
              h('label', {
                style: { display: 'block', fontSize: 10, fontWeight: 700,
                         color: C.textMid, marginBottom: 3 }
              }, 'Nota (audit trail · contiene URL fonte)'),
              h('textarea', {
                value: editedRow.Nota || '',
                onChange: e => setEditedRow(Object.assign({},
                  editedRow, { Nota: e.target.value })),
                style: {
                  width: '100%', minHeight: 70, padding: 10,
                  border: `1px solid ${C.border}`, borderRadius: 8,
                  fontFamily: 'inherit', fontSize: 12, resize: 'vertical'
                }
              })
            ]),
            h('div', { key: 'btn', style: { marginTop: 12, display: 'flex', gap: 8 } }, [
              h(G.ui.Button, {
                key: 's', kind: 'primary', disabled: saving,
                onClick: saveSelected
              }, saving ? 'Salvataggio…' : '⤓ Salva nel database'),
              h(G.ui.Button, {
                key: 'c', kind: 'ghost',
                onClick: () => { setSelectedIdx(null); setEditedRow(null); }
              }, 'Annulla')
            ])
          ])
        ]),

        searchOpen && h('p', {
          key: 'note',
          style: { fontSize: 10, color: C.textLow, marginTop: 16,
                   fontStyle: 'italic' }
        }, 'L\'IA recupera valori da fonti pubbliche citando l\'URL. Ogni risultato deve essere verificato dall\'operatore prima del salvataggio. La query, le fonti consultate e il candidato selezionato sono registrati nel log per audit CSRD.')
      ]),

      // ─── Browse FE esistenti (invariato) ────────────────────
      h('div', {
        key: 'flt',
        style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }
      }, [
        h(G.ui.Pill, { color: !fam ? C.brand : C.textMid, key: '_all',
          children: h('button', {
            onClick: () => setFam(''),
            style: { background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }
          }, 'Tutte') }),
        ...fams.map(f => h(G.ui.Pill, {
          key: f, color: G.FAMIGLIE_FE[f] || C.brand,
          children: h('button', {
            onClick: () => setFam(f),
            style: { background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }
          }, f)
        })),
        h(G.ui.Input, {
          key: 'q', placeholder: 'Cerca…',
          value: q, onChange: e => setQ(e.target.value),
          style: { marginLeft: 'auto', width: 240 }
        })
      ]),
      h(G.ui.DataTable, {
        key: 'tbl',
        rows: filtered,
        columns: [
          { key: 'FE_ID', label: 'FE ID', mono: true },
          { key: 'Famiglia' },
          { key: 'Descrizione' },
          { key: 'Anno_Validità', label: 'Anno', align: 'right' },
          { key: 'Valore', align: 'right',
            render: v => v == null ? '—' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: 6, useGrouping: 'always' }) },
          { key: 'Unità' },
          { key: 'Fonte' }
        ]
      })
    ]);
  }

  G.sections = G.sections || {};
  Object.assign(G.sections, { FEExplorer });
})(typeof window !== 'undefined' ? window : globalThis);
