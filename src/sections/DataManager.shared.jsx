/* GHG Tool — DataManager.shared.jsx
 *
 * Helper interni e componenti riusabili da DataManager.
 * Estratti da DataManager.jsx in PR di splitting.
 *
 * Espone su window.GHG.DM = {
 *   getLockedYears, isYearLocked, makeConfirmedClose, LockBanner,
 *   OnboardingCard, ImportPreviewModal, Field, GenericTab,
 *   feFillBtnStyle, fmtNum, exportCSV, csvCell
 * }
 *
 * NOTA: caricato PRIMA di DataManager.tabs.jsx, DataManager.scopeModals.jsx
 * e DataManager.jsx nell'ordine SRC_FILES di build.mjs (vedi build.mjs).
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;

  function OnboardingCard ({ steps, stepsDone, onPickImport, onGoMateriality }) {
    const items = [
      {
        k: 'sites', n: 1,
        title: 'Carica le anagrafiche dei siti',
        body:  'I 7 stabilimenti del Gruppo. Esegui il seed sql/02_data_seed.sql in Supabase, oppure prepara un Excel con il foglio "anagrafiche" (colonne: Codice_Sito, Nome_Sito, Tipologia, …) e importalo dal pulsante qui sotto.',
        action: { lab: '⤴ Importa Excel (anagrafiche)', cb: onPickImport }
      },
      {
        k: 'data', n: 2,
        title: 'Importa lo storico (S1, S2, S3, Produzione, FE)',
        body:  'Importa un file Excel con i fogli s1, s2, s3, produzione, fe. La validazione mostrerà errori per riga prima del commit. In alternativa puoi inserire le righe manualmente dai tab qui sotto.',
        action: { lab: '⤴ Importa Excel (dati)', cb: onPickImport }
      },
      {
        k: 'mat', n: 3,
        title: 'Conferma la materialità Scope 3',
        body:  'Per ciascuna delle 15 categorie indica se è Inclusa nell\'inventario, Esclusa, N.A. o Da valutare, con la giustificazione metodologica. Si esegue una volta e si rivede annualmente.',
        action: onGoMateriality
          ? { lab: 'Vai a Materialità →', cb: onGoMateriality }
          : null
      }
    ];

    return h(G.ui.Card, {
      style: {
        padding: 24, marginBottom: 20,
        background: '#FFF7E6', borderColor: '#F0C97A',
        borderLeft: '#C7891F'
      }
    }, [
      h('div', {
        key: 'h',
        style: { display: 'flex', alignItems: 'baseline',
                 justifyContent: 'space-between', marginBottom: 12, gap: 12 }
      }, [
        h('h2', {
          style: { fontSize: 18, fontWeight: 700, color: '#7A5510' }
        }, '🚀 Setup iniziale dell\'inventario'),
        h('span', {
          style: {
            fontSize: 12, fontWeight: 700, color: '#7A5510',
            background: '#FFEEC7', padding: '4px 10px', borderRadius: 99
          }
        }, `${stepsDone} / 3 completati`)
      ]),
      h('p', {
        key: 'p',
        style: { fontSize: 13, color: '#7A5510', marginBottom: 16, lineHeight: 1.5 }
      }, 'Per cominciare a usare lo strumento servono 3 step. Si possono completare in ordine o saltare se sai cosa stai facendo.'),
      h('div', {
        key: 'g',
        style: { display: 'flex', flexDirection: 'column', gap: 10 }
      }, items.map(it => {
        const done = !!steps[it.k];
        return h('div', {
          key: it.k,
          style: {
            display: 'flex', gap: 14, padding: 14,
            background: done ? 'rgba(45,122,79,.08)' : '#fff',
            border: `1px solid ${done ? '#A8D5BA' : '#F0C97A'}`,
            borderRadius: 8, alignItems: 'flex-start'
          }
        }, [
          h('div', {
            key: 'n',
            style: {
              flexShrink: 0, width: 32, height: 32, borderRadius: 99,
              background: done ? C.success : '#F0C97A',
              color: '#fff', fontWeight: 700, fontSize: 14,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
            }
          }, done ? '✓' : it.n),
          h('div', { key: 'b', style: { flex: 1, minWidth: 0 } }, [
            h('div', {
              style: {
                fontSize: 14, fontWeight: 700,
                color: done ? C.textMid : C.text,
                textDecoration: done ? 'line-through' : 'none',
                marginBottom: 4
              }
            }, it.title),
            h('div', {
              style: { fontSize: 12, color: C.textMid, lineHeight: 1.5,
                       marginBottom: it.action && !done ? 8 : 0 }
            }, it.body),
            !done && it.action && h(G.ui.Button, {
              kind: 'ghost',
              onClick: it.action.cb,
              style: { fontSize: 12, padding: '6px 12px' }
            }, it.action.lab)
          ])
        ]);
      }))
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Lock helpers — modal pre-check
  //  Editor non può scrivere su anni bloccati (lo blocca anche RLS lato
  //  DB, ma è meglio pre-empt: messaggio chiaro + Save disabilitato).
  //  Admin bypassa sempre.
  // ────────────────────────────────────────────────────────────────────
  function getLockedYears (data) {
    const v = data && data.app_meta && data.app_meta.locked_years;
    return Array.isArray(v) ? v.map(Number).filter(n => isFinite(n)) : [];
  }
  function isYearLocked (year, lockedYears, role) {
    if (role === 'admin') return false;
    return lockedYears.includes(+year);
  }
  // Confirm-on-close helper: ritorna una funzione che chiude SOLO se
  // i dati nel modal coincidono con la row iniziale (non sporca).
  // Altrimenti chiede conferma. Usata da S1/S2/S3/Produzione modals.
  function makeConfirmedClose (initialRow, currentVal, onClose) {
    return async () => {
      const dirty = JSON.stringify(initialRow) !== JSON.stringify(currentVal);
      if (!dirty) { onClose(); return; }
      const ok = await G.ui.confirm({
        title: 'Modifiche non salvate',
        message: 'Stai per chiudere il form con modifiche non salvate. Procedere?',
        danger: true
      });
      if (ok) onClose();
    };
  }

  function LockBanner ({ year }) {
    return h('div', {
      role: 'alert',
      style: {
        background: '#FFF7E6', color: '#7A5510',
        border: '1px solid #F0C97A',
        padding: '10px 14px', borderRadius: 8, fontSize: 13,
        marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10
      }
    }, [
      h('span', { key: 'i', style: { fontSize: 16 } }, '🔒'),
      h('span', { key: 't' },
        `L'anno ${year} è approvato e bloccato. Solo un admin può modificare le righe di questo anno.`)
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  ANAGRAFICHE TAB — gestione siti del Gruppo
  //  Codice_Sito è PK e referenziato in s1/s2/produzione (FK on
  //  delete restrict): la cancellazione fallisce se il sito ha dati
  //  associati. UPDATE del codice_sito invece è bloccato dall'UI
  //  quando esistono righe collegate.
  // ────────────────────────────────────────────────────────────────────
  function ImportPreviewModal ({ preview, onClose, onCommit }) {
    const [expanded, setExpanded] = useState({});
    const [skipInvalid, setSkipInvalid] = useState(false);

    const tables = Object.entries(preview.perTable);
    const totalRows   = tables.reduce((a, [, p]) => a + (p.summary ? p.summary.total : 0), 0);
    const totalErrors = tables.reduce((a, [, p]) => a + (p.summary ? p.summary.withErrors : 0), 0);
    const totalWarn   = tables.reduce((a, [, p]) => a + (p.summary ? p.summary.withWarnings : 0), 0);
    const validRows   = totalRows - totalErrors;

    const canCommit  = totalErrors === 0 || skipInvalid;
    const commitLabel = totalErrors === 0
      ? `Importa ${validRows} righe`
      : `Importa ${validRows} righe valide (salta ${totalErrors})`;

    function toggle (t) { setExpanded(p => ({ ...p, [t]: !p[t] })); }

    return h('div', {
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'grid', placeItems: 'center', zIndex: 999
      },
      onClick: e => { if (e.target === e.currentTarget) onClose(); }
    }, h('div', {
      style: {
        background: '#fff', padding: 24, borderRadius: 12,
        width: 'min(720px, 92vw)', maxHeight: '85vh', overflow: 'auto',
        boxShadow: '0 24px 70px rgba(0,0,0,.45)'
      }
    }, [
      h('h2', { key: 'h', style: { fontSize: 18, fontWeight: 700, marginBottom: 4 } },
        'Anteprima import'),
      h('p', { key: 'fp', style: { fontSize: 12, color: C.textLow, marginBottom: 16 } },
        `File: ${preview.fileName}`),
      // Riepilogo header
      h('div', {
        key: 'sm',
        style: {
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12, marginBottom: 16
        }
      }, [
        { lab: 'Totali', n: totalRows, color: C.text, bg: C.borderSoft },
        { lab: 'Errori', n: totalErrors, color: C.critical, bg: C.criticalPale },
        { lab: 'Warning', n: totalWarn, color: C.warning, bg: C.warningPale }
      ].map(s => h('div', {
        key: s.lab,
        style: {
          padding: '10px 14px', borderRadius: 8, background: s.bg
        }
      }, [
        h('div', { style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                            textTransform: 'uppercase', letterSpacing: .5 } }, s.lab),
        h('div', { style: { fontSize: 22, fontWeight: 700, color: s.color,
                            fontVariantNumeric: 'tabular-nums' } }, String(s.n))
      ]))),

      // Lista per tabella
      h('div', { key: 'ts', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        tables.map(([t, p]) => {
          const sum = p.summary || { total: 0, ok: 0, withErrors: 0, withWarnings: 0 };
          const issues = (p.validations || [])
            .filter(v => v.errors.length || v.warnings.length);
          const exp = !!expanded[t];
          return h('div', {
            key: t,
            style: {
              border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden'
            }
          }, [
            h('button', {
              key: 'h',
              onClick: () => issues.length && toggle(t),
              style: {
                width: '100%', padding: '10px 14px', textAlign: 'left',
                background: '#fff', border: 'none',
                cursor: issues.length ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', gap: 12
              }
            }, [
              h('span', { key: 'n', style: { fontWeight: 700, minWidth: 70 } },
                t.toUpperCase()),
              h('span', { key: 's', style: { fontSize: 12, color: C.textMid, flex: 1 } },
                p.note),
              sum.withErrors > 0 && h('span', {
                key: 'e',
                style: {
                  fontSize: 11, fontWeight: 700, color: C.critical,
                  background: C.criticalPale, padding: '2px 8px', borderRadius: 99
                }
              }, `${sum.withErrors} errori`),
              sum.withWarnings > 0 && h('span', {
                key: 'w',
                style: {
                  fontSize: 11, fontWeight: 700, color: C.warning,
                  background: C.warningPale, padding: '2px 8px', borderRadius: 99
                }
              }, `${sum.withWarnings} warning`),
              issues.length > 0 && h('span', {
                key: 'x', style: { fontSize: 12, color: C.textLow }
              }, exp ? '▾' : '▸')
            ]),
            exp && issues.length > 0 && h('div', {
              key: 'b',
              style: { borderTop: `1px solid ${C.borderSoft}`, background: C.bg }
            }, issues.slice(0, 50).map(v => h('div', {
              key: v.idx,
              style: {
                padding: '8px 14px', fontSize: 12,
                borderBottom: `1px solid ${C.borderSoft}`,
                color: v.errors.length ? C.critical : C.warning
              }
            }, [
              h('span', { key: 'l', style: { fontWeight: 700, marginRight: 8 } },
                `Riga ${v.idx}`),
              h('span', { key: 'm' },
                [...v.errors, ...v.warnings].join(' · '))
            ])).concat(issues.length > 50
              ? [h('div', {
                  key: 'mo',
                  style: { padding: '8px 14px', fontSize: 11,
                           color: C.textLow, fontStyle: 'italic' }
                }, `… e altre ${issues.length - 50} righe (mostriamo le prime 50)`)]
              : []
            ))
          ]);
        })
      ),

      totalErrors > 0 && h('label', {
        key: 'sk',
        style: {
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: C.text, marginTop: 16,
          cursor: 'pointer'
        }
      }, [
        h('input', {
          key: 'cb', type: 'checkbox',
          checked: skipInvalid,
          onChange: e => setSkipInvalid(e.target.checked)
        }),
        h('span', { key: 'l' },
          `Importa solo le ${validRows} righe valide e salta le ${totalErrors} con errori`)
      ]),

      h('div', {
        key: 'btn',
        style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }
      }, [
        h(G.ui.Button, { key: 'c', kind: 'ghost', onClick: onClose }, 'Annulla'),
        h(G.ui.Button, {
          key: 's', kind: 'primary',
          disabled: !canCommit || validRows === 0,
          onClick: onCommit
        }, commitLabel)
      ])
    ]));
  }

  function Field ({ label, children }) {
    // Wrap input dentro <label> per associazione implicita (a11y):
    // così screen reader annuncia il label leggendo l'input, anche
    // senza htmlFor/id espliciti.
    return h('label', { style: { display: 'block', marginBottom: 12 } }, [
      h('span', {
        key: 'l',
        style: {
          display: 'block', fontSize: 11, fontWeight: 600,
          color: C.textMid, textTransform: 'uppercase', letterSpacing: .5,
          marginBottom: 4
        }
      }, label),
      children
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  GENERIC TAB (S1/S2/S3) — read + insert/edit/delete + CSV export
  //  Per S1/S3 il fattore emissivo è risolto per lookup su tabella FE;
  //  per S2 è inserito manualmente (location + market).
  //  FE TAB (sotto) — read + edit/insert + cascade ricalcolo S1/S3 + nuova versione
  // ────────────────────────────────────────────────────────────────────
  function GenericTab ({ table, data, canEdit, canDelete, reload, role }) {
    const [editing, setEditing] = useState(null);
    const rows = data[table] || [];
    const cols = COLUMNS[table] || [];

    // NB: FETab + S1/S2/S3EditModal sono definiti rispettivamente in
    // DataManager.tabs.jsx e DataManager.scopeModals.jsx, caricati DOPO
    // shared.jsx in build.mjs:SRC_FILES. Quindi a parse-time queste
    // identifier non sono in scope. Le risolviamo a runtime via G.DM:
    // quando questa function body viene eseguita (al render di GenericTab),
    // tutti i moduli sono già stati valutati e G.DM è completo.
    if (table === 'fe') return h(G.DM.FETab, { data, canEdit, canDelete, reload });

    const sites = (data.anagrafiche || []).map(a => a.Codice_Sito || a.codice_sito);
    const fe = data.fe || [];
    const lockedYears = getLockedYears(data);
    const Modal = table === 's1' ? G.DM.S1EditModal
                : table === 's2' ? G.DM.S2EditModal
                :                  G.DM.S3EditModal;

    function blankRow () {
      const yr = new Date().getFullYear();
      const site = sites[0] || '';
      if (table === 's1') return {
        // Categoria_S1 viene auto-popolata dal Combustibile nel modal
        // (è di fatto un alias). Niente default qui.
        Anno: yr, Codice_Sito: site,
        Categoria_S1: '', Combustibile: '',
        Quantità: '', Unità: '',
        Qualità_Dato: 'P', Stato_Dato: 'Definitivo',
        Fonte_Dato: '', Note: ''
      };
      if (table === 's2') return {
        Anno: yr, Codice_Sito: site,
        Voce_S2: 'EE_Acquistata',
        Quantità: '', Unità: 'kWh', Strumento_MB: '',
        FE_Location: '', FE_Market: '',
        Qualità_Dato: 'P', Stato_Dato: 'Definitivo',
        Fonte_Dato: '', Note: ''
      };
      return {
        Anno: yr, Categoria_S3: 1, Sottocategoria: '', Metodo: 'Activity-based',
        Codice_FE: '', Quantità: '', Unità: '',
        Qualità_Dato: 'S', Stato_Dato: 'Provvisorio',
        Fonte_Dato: '', Note: ''
      };
    }

    async function save (payload) {
      try {
        await G.db.upsert(table, payload);
        G.ui.pushToast('Riga salvata', 'success');
        setEditing(null);
        reload && reload();
      } catch (e) { G.ui.pushToast(e.message || 'Errore', 'error'); }
    }

    return h('div', null, [
      canEdit && h('div', {
        key: 'tb', style: { display: 'flex', gap: 8, marginBottom: 16 }
      }, [
        h(G.ui.Button, {
          key: 'a', kind: 'primary',
          onClick: () => setEditing(blankRow())
        }, '+ Aggiungi'),
        h(G.ui.Button, {
          key: 'csv', kind: 'ghost',
          onClick: () => exportCSV(table, rows)
        }, 'Esporta CSV')
      ]),
      h(G.ui.DataTable, {
        columns: cols, rows,
        canEdit, canDelete,
        onEdit:   r => setEditing({ ...r }),
        onDelete: async r => {
          if (!await G.ui.confirm({
            title: 'Eliminare questa riga?', danger: true,
            message: 'Operazione irreversibile (verrà loggata in audit_log).'
          })) return;
          try {
            await G.db.del(table, r.id);
            G.ui.pushToast('Riga eliminata', 'success');
            reload && reload();
          } catch (e) { G.ui.pushToast(e.message, 'error'); }
        },
        // Bulk-delete (admin/editor con permessi delete). Una sola query
        // con .in('id', ids) — chunked a 200 lato G.db.batchDelete.
        // L'audit_log resta popolato dai trigger per-riga lato DB.
        selectable: canDelete,
        bulkActions: canDelete ? [{
          label: 'Elimina selezionate',
          danger: true,
          onClick: async (selectedRows) => {
            const n = selectedRows.length;
            if (!await G.ui.confirm({
              title: `Eliminare ${n} righe?`,
              danger: true,
              message: `Stai per eliminare ${n} righe da ${table.toUpperCase()}. ` +
                       `Operazione irreversibile (verrà loggata in audit_log per ognuna).`
            })) return;
            try {
              const ids = selectedRows.map(r => r.id).filter(Boolean);
              await G.db.batchDelete(table, ids);
              G.ui.pushToast(`${ids.length} righe eliminate`, 'success');
              reload && reload();
            } catch (e) { G.ui.pushToast(e.message || 'Eliminazione fallita', 'error'); }
          }
        }] : null
      }),
      editing && h(Modal, {
        row: editing, sites, fe, lockedYears, role,
        onClose: () => setEditing(null),
        onSave: save
      })
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Stili condivisi per i modali S1/S2/S3
  // ────────────────────────────────────────────────────────────────────
  const modalScrim = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
    display: 'grid', placeItems: 'center', zIndex: 999, padding: 16,
    overflow: 'auto'
  };
  const modalCard = (maxW = 640) => ({
    background: '#fff', padding: 24, borderRadius: 12,
    width: `min(${maxW}px, 92vw)`, maxHeight: '90vh', overflow: 'auto',
    boxShadow: '0 24px 70px rgba(0,0,0,.45)'
  });
  const modalGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
  const calcPanel = (ok) => ({
    marginTop: 12, padding: 12, borderRadius: 8,
    background: ok ? C.successPale : C.borderSoft,
    border: `1px solid ${ok ? C.success : C.border}`
  });
  const calcLabel = {
    fontSize: 11, fontWeight: 700, color: C.textMid,
    textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6
  };
  const calcRow = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    fontSize: 13, color: C.textMid, padding: '2px 0'
  };
  const calcResult = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    fontSize: 16, fontWeight: 700, color: C.text,
    marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${C.border}`
  };
  const errBox = {
    background: C.criticalPale, color: C.critical, padding: 8,
    borderRadius: 8, fontSize: 12, marginTop: 12
  };
  const warnBox = {
    background: C.warningPale, color: C.warning, padding: 8,
    borderRadius: 8, fontSize: 12, marginTop: 8
  };
  const btnRow = {
    display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16
  };
  const titleStyle = { fontSize: 18, fontWeight: 700, marginBottom: 16 };

  // Stile bottone "⤓ catalogo" usato in S1/S2/S3 modal accanto al campo
  // FE per popolare il valore dal catalogo FE caricato.
  function feFillBtnStyle (enabled) {
    return {
      padding: '0 10px', border: `1px solid ${C.border}`,
      borderRadius: 8, background: enabled ? '#fff' : C.bg,
      color: enabled ? C.brand : C.textLow,
      cursor: enabled ? 'pointer' : 'not-allowed',
      fontSize: 12, whiteSpace: 'nowrap'
    };
  }

  // fmtNum: variante "natural" che rimuove zeri finali (utile nei modal FE
  // dove un valore intero non vogliamo come '1.000,000'). G.fmt è invece
  // a precisione fissa per output tabellari.
  function fmtNum (n, dec = 3) {
    if (n == null || !isFinite(+n)) return '—';
    return Number(n).toLocaleString('it-IT', {
      minimumFractionDigits: 0,
      maximumFractionDigits: dec,
      useGrouping: 'always'
    });
  }

  // Opzioni standard riusate
  const QD_OPTS = [
    { value: '',  label: '—' },
    { value: 'P', label: 'P · Primario' },
    { value: 'S', label: 'S · Secondario' },
    { value: 'E', label: 'E · Stimato' }
  ];
  const SD_OPTS = [
    { value: '',            label: '—' },
    { value: 'Definitivo',  label: 'Definitivo' },
    { value: 'Provvisorio', label: 'Provvisorio' },
    { value: 'Stimato',     label: 'Stimato' }
  ];

  // ────────────────────────────────────────────────────────────────────
  //  S1 EDIT MODAL — calcolo live em = Q × FE(lookup) / 1000
  // ────────────────────────────────────────────────────────────────────
  function exportCSV (table, rows) {
    const sanitize = G.sanitize ? G.sanitize.sanitizeForSpreadsheet : (v => v);
    const cols = COLUMNS[table] || Object.keys(rows[0] || {}).map(k => ({ key: k }));
    const headers = cols.map(c => c.label || c.key);
    const lines = ['﻿' + headers.map(h => csvCell(h)).join(';')];
    rows.forEach(r => {
      const vals = cols.map(c => {
        const v = r[c.key];
        if (v == null) return '';
        if (typeof v === 'number') return String(v).replace('.', ',');
        return csvCell(sanitize(v));
      });
      lines.push(vals.join(';'));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = root.document.createElement('a');
    a.href = url;
    a.download = `ghg_${table}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    G.ui.pushToast(`Esportate ${rows.length} righe in CSV`, 'success');
  }
  function csvCell (v) {
    const s = String(v);
    if (/[;"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  const COLUMNS = {
    s1: [
      { key: 'Anno', label: 'Anno', align: 'right' },
      { key: 'Codice_Sito', label: 'Sito' },
      // Categoria_S1 omessa dalla tabella: nei dati reali era sempre
      // identica al Combustibile, rendendola una colonna ridondante.
      // A DB il campo resta ma è popolato automaticamente al save.
      { key: 'Combustibile', label: 'Combustibile' },
      { key: 'Quantità', label: 'Q', align: 'right',
        render: v => v == null ? '—' : Number(v).toLocaleString('it-IT', { useGrouping: 'always' }) },
      { key: 'Unità', label: 'Unità' },
      { key: 'Em_tCO2e', label: 'tCO₂e', align: 'right',
        render: v => v == null ? '—' : Number(v).toFixed(2) }
    ],
    s2: [
      { key: 'Anno', label: 'Anno', align: 'right' },
      { key: 'Codice_Sito', label: 'Sito' },
      { key: 'Voce_S2', label: 'Voce' },
      { key: 'Quantità', label: 'kWh', align: 'right',
        render: v => v == null ? '—' : Number(v).toLocaleString('it-IT', { useGrouping: 'always' }) },
      { key: 'Em_Loc_tCO2e', label: 'LB tCO₂e', align: 'right',
        render: v => v == null ? '—' : Number(v).toFixed(2) },
      { key: 'Em_Mkt_tCO2e', label: 'MB tCO₂e', align: 'right',
        render: v => v == null ? '—' : Number(v).toFixed(2) }
    ],
    s3: [
      { key: 'Anno', label: 'Anno', align: 'right' },
      { key: 'Categoria_S3', label: 'Cat', align: 'right' },
      { key: 'Sottocategoria', label: 'Voce' },
      { key: 'Quantità', label: 'Q', align: 'right',
        render: v => v == null ? '—' : Number(v).toLocaleString('it-IT', { useGrouping: 'always' }) },
      { key: 'Unità', label: 'Unità' },
      { key: 'Em_tCO2e', label: 'tCO₂e', align: 'right',
        render: v => v == null ? '—' : Number(v).toFixed(2) }
    ],
    fe: [
      { key: 'FE_ID', label: 'ID', mono: true },
      { key: 'Famiglia', label: 'Famiglia' },
      { key: 'Codice_Voce', label: 'Codice voce' },
      { key: 'Anno_Validità', label: 'Anno', align: 'right' },
      { key: 'Valore', label: 'Valore', align: 'right',
        render: v => v == null ? '—' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: 6, useGrouping: 'always' }) },
      { key: 'Unità', label: 'Unità' },
      { key: 'Fonte', label: 'Fonte' }
    ]
  };


  // ────────────────────────────────────────────────────────────────────
  //  CloneYearModal — Replica un anno (S1/S2/S3/Produzione) da
  //  sorgente a destinazione. Vedi G.db.cloneYear per la logica DB.
  //
  //  3 stati: 'form' (input src/dst) → 'loading' → 'done' (summary).
  //  In stato 'done' mostra inserted/skipped per tabella + Chiudi che
  //  chiude e ricarica il data.
  // ────────────────────────────────────────────────────────────────────
  function CloneYearModal ({ availableYears, defaultDst, lockedYears, onClose, onDone }) {
    const [step, setStep] = useState('form');
    const [src, setSrc]   = useState(
      Array.isArray(availableYears) && availableYears.length > 0
        ? Math.max.apply(null, availableYears) : '');
    const [dst, setDst]   = useState(defaultDst || '');
    const [error, setError]   = useState(null);
    const [result, setResult] = useState(null);

    const dstNum = +dst;
    const srcNum = +src;
    const validForm = !!srcNum && !!dstNum && srcNum !== dstNum
      && dstNum >= 2000 && dstNum <= 2100;
    // Se l'anno destinazione è bloccato (year_lock) non possiamo scriverci.
    const dstLocked = Array.isArray(lockedYears) && lockedYears.includes(dstNum);

    async function run () {
      setError(null);
      setStep('loading');
      try {
        const r = await G.db.cloneYear(srcNum, dstNum);
        setResult(r);
        setStep('done');
      } catch (e) {
        setError(e && e.message ? e.message : 'Errore durante la replica');
        setStep('form');
      }
    }

    function close () {
      // Se abbiamo creato righe, ricarica il data prima di chiudere
      if (step === 'done' && result && result.totalInserted > 0 && typeof onDone === 'function') {
        onDone();
      } else {
        onClose();
      }
    }

    return h('div', {
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'grid', placeItems: 'center', zIndex: 999
      },
      onClick: e => { if (e.target === e.currentTarget) close(); }
    }, h('div', {
      style: {
        background: '#fff', padding: 24, borderRadius: 12,
        width: 'min(560px, 92vw)', maxHeight: '85vh', overflow: 'auto',
        boxShadow: '0 24px 70px rgba(0,0,0,.45)'
      }
    }, [
      h('h2', { key: 'h', style: { fontSize: 18, fontWeight: 700, marginBottom: 4 } },
        'Replica anno'),
      h('p', {
        key: 'sub',
        style: { fontSize: 12, color: C.textMid, marginBottom: 16, lineHeight: 1.5 }
      }, 'Copia la struttura di S1, S2, S3 e Produzione da un anno sorgente a uno destinazione. ' +
         'Quantità copiate, FE/emissioni azzerati (vanno ri-applicati), stato impostato a "Provvisorio".'),

      // ─── STEP: form ───────────────────────────────────────
      step === 'form' && h('div', { key: 'frm' }, [
        h('div', {
          key: 'gr',
          style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }
        }, [
          h('label', { key: 'ls', style: { display: 'block' } }, [
            h('div', { style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                                marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 } },
              'Anno sorgente'),
            h('select', {
              value: src,
              onChange: e => setSrc(e.target.value),
              style: {
                width: '100%', padding: '8px 10px',
                border: `1px solid ${C.border}`, borderRadius: 8,
                fontFamily: 'inherit', fontSize: 13, background: '#fff'
              }
            }, [
              h('option', { key: '_', value: '' }, '— scegli —'),
              ...((availableYears || []).slice().sort((a,b) => b-a).map(y =>
                h('option', { key: y, value: y }, String(y))
              ))
            ])
          ]),
          h('label', { key: 'ld', style: { display: 'block' } }, [
            h('div', { style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                                marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 } },
              'Anno destinazione'),
            h('input', {
              type: 'number', min: 2000, max: 2100,
              value: dst,
              onChange: e => setDst(e.target.value),
              style: {
                width: '100%', padding: '8px 10px', boxSizing: 'border-box',
                border: `1px solid ${dstLocked ? C.critical : C.border}`,
                borderRadius: 8, fontFamily: 'inherit', fontSize: 13
              }
            })
          ])
        ]),

        dstLocked && h('div', {
          key: 'lk', style: errBox
        }, `L'anno ${dstNum} è bloccato (sign-off). Sblocca prima di replicare.`),

        // Avvisi UX
        h('ul', {
          key: 'note',
          style: { fontSize: 11, color: C.textLow, lineHeight: 1.6,
                   paddingLeft: 18, marginBottom: 16, marginTop: 0 }
        }, [
          h('li', { key: 'a' }, 'Le righe già presenti nell\'anno destinazione (per stesso sito + voce) NON vengono sovrascritte.'),
          h('li', { key: 'b' }, 'Anagrafiche, FE e Targets non sono toccati.'),
          h('li', { key: 'c' }, 'Operazione non transazionale: in caso di errore parziale, vedrai il summary di quanto inserito.')
        ]),

        error && h('div', { key: 'err', style: errBox }, error),

        h('div', { key: 'btn', style: btnRow }, [
          h(G.ui.Button, { key: 'c', kind: 'ghost', onClick: onClose }, 'Annulla'),
          h(G.ui.Button, {
            key: 'r', kind: 'primary',
            disabled: !validForm || dstLocked,
            onClick: run
          }, 'Replica')
        ])
      ]),

      // ─── STEP: loading ────────────────────────────────────
      step === 'loading' && h('div', {
        key: 'ld',
        style: { padding: '24px 0', textAlign: 'center', color: C.textMid, fontSize: 13 }
      }, `Replica in corso da anno ${srcNum} → ${dstNum}…`),

      // ─── STEP: done ───────────────────────────────────────
      step === 'done' && result && h('div', { key: 'dn' }, [
        h('div', {
          key: 'sm',
          style: {
            padding: 12, background: result.totalInserted > 0 ? C.successPale : C.borderSoft,
            borderRadius: 8, marginBottom: 12, fontSize: 13, color: C.text
          }
        }, [
          h('div', { style: { fontWeight: 700, marginBottom: 4 } },
            result.totalInserted > 0
              ? `Replicate ${result.totalInserted} righe in stato Provvisorio`
              : 'Nessuna riga replicata'),
          h('div', { style: { fontSize: 11, color: C.textMid } },
            result.totalSkipped > 0
              ? `${result.totalSkipped} righe saltate (già presenti in ${dstNum})`
              : 'Tutte le righe sorgente sono state replicate')
        ]),
        // Dettaglio per tabella
        h('table', {
          key: 'tbl',
          style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' }
        }, [
          h('thead', { key: 'th' }, h('tr', null, [
            h('th', { style: { textAlign: 'left',  padding: '6px 8px', borderBottom: `1px solid ${C.border}` } }, 'Tabella'),
            h('th', { style: { textAlign: 'right', padding: '6px 8px', borderBottom: `1px solid ${C.border}` } }, 'Sorgente'),
            h('th', { style: { textAlign: 'right', padding: '6px 8px', borderBottom: `1px solid ${C.border}` } }, 'Inserite'),
            h('th', { style: { textAlign: 'right', padding: '6px 8px', borderBottom: `1px solid ${C.border}` } }, 'Saltate')
          ])),
          h('tbody', { key: 'tb' }, Object.entries(result.perTable).map(([t, s]) =>
            h('tr', { key: t }, [
              h('td', { style: { padding: '6px 8px', textTransform: 'uppercase', fontWeight: 600 } }, t),
              h('td', { style: { padding: '6px 8px', textAlign: 'right', color: C.textMid } }, String(s.sourceRows)),
              h('td', { style: { padding: '6px 8px', textAlign: 'right', color: s.inserted > 0 ? C.success : C.textMid } }, String(s.inserted)),
              h('td', { style: { padding: '6px 8px', textAlign: 'right', color: s.skipped > 0 ? C.warning : C.textMid } }, String(s.skipped))
            ])
          ))
        ]),
        h('div', { key: 'btn', style: { ...btnRow, marginTop: 16 } }, [
          h(G.ui.Button, { key: 'k', kind: 'primary', onClick: close }, 'Chiudi')
        ])
      ])
    ]));
  }

  G.DM = G.DM || {};
  Object.assign(G.DM, {
    // Helper logici
    getLockedYears, isYearLocked, makeConfirmedClose,
    // Componenti UI
    LockBanner, OnboardingCard, ImportPreviewModal, CloneYearModal, Field, GenericTab,
    // Style helpers + costanti
    feFillBtnStyle, fmtNum,
    modalScrim, modalCard, titleStyle, modalGrid,
    calcPanel, calcLabel, calcRow,
    calcResult, errBox, warnBox, btnRow,
    QD_OPTS, SD_OPTS,
    // Schema columns mapping (usato da GenericTab + FETab)
    COLUMNS,
    // CSV
    exportCSV, csvCell
  });
})(typeof window !== 'undefined' ? window : globalThis);
