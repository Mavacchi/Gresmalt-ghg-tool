/* GHG Tool — DataManager.jsx (admin/editor)
 *
 * 5 tab: S1, S2, S3, FE, PRODUZIONE.
 * Tab Produzione: CRUD su (codice_sito, anno, kg, m², note) con
 * validazione di unicità e warning quando manca un'unità.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useMemo } = root.React;
  const C = G.COLORS;

  function DataManager ({ data, role, reload, focusTab, navigate }) {
    const [tab, setTab] = useState(focusTab || 's1');
    const [importPreview, setImportPreview] = useState(null);
    const canEdit   = G.can.edit(role);
    const canDelete = G.can.delete(role);
    const isAdmin   = role === 'admin';

    // ── Onboarding step status (admin only) ─────────────────────────
    // Mostriamo la card guida finché c'è almeno uno step incompleto.
    const stepsStatus = {
      sites: (data.anagrafiche || []).length > 0,
      data:  ((data.s1 || []).length + (data.s2 || []).length
              + (data.s3 || []).length + (data.produzione || []).length) > 0,
      mat:   (data.s3_materiality || []).some(m =>
        (m.status || m.Status || '') !== 'Da valutare')
    };
    const stepsDone = Object.values(stepsStatus).filter(Boolean).length;
    const showOnboarding = isAdmin && stepsDone < 3;

    async function exportExcel () {
      try {
        G.ui.pushToast('Generazione Excel in corso…', 'info');
        await G.io.exportExcel(data);
        G.ui.pushToast('Excel scaricato', 'success');
      } catch (e) { G.ui.pushToast(e.message || 'Export Excel fallito', 'error'); }
    }
    function pickImportFile () {
      const inp = root.document.createElement('input');
      inp.type = 'file';
      inp.accept = '.xlsx,.xls';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        try {
          G.ui.pushToast('Lettura del file…', 'info');
          // Passa il data corrente per cross-validazione (sito esiste,
          // FE esiste, anno bloccato).
          const preview = await G.io.importExcel(f, data);
          setImportPreview(preview);
        } catch (e) { G.ui.pushToast(e.message || 'Import fallito', 'error'); }
      };
      inp.click();
    }
    async function commitImport () {
      try {
        const s = await G.io.commitImport(importPreview);
        const parts = [`Importate ${s.inserted} righe`];
        if (s.skippedErrors) parts.push(`saltate ${s.skippedErrors} con errori`);
        if (s.dbErrors)      parts.push(`${s.dbErrors} errori DB`);
        const kind = s.dbErrors > 0 ? 'error'
                   : s.skippedErrors > 0 ? 'warning' : 'success';
        G.ui.pushToast(parts.join(' · '), kind);
        setImportPreview(null);
        reload && reload();
      } catch (e) { G.ui.pushToast(e.message || 'Commit fallito', 'error'); }
    }

    return h('div', null, [
      h('h1', { key: 'h', style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        'Gestione Dati'),
      showOnboarding && h(OnboardingCard, {
        key: 'ob',
        steps: stepsStatus,
        stepsDone,
        onPickImport: () => pickImportFile(),
        onGoMateriality: () => navigate && navigate('materiality')
      }),
      canEdit && h('div', {
        key: 'gtb', style: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }
      }, [
        h(G.ui.Button, { key: 'xl', kind: 'ghost', onClick: exportExcel },
          '⤓ Esporta Excel (6 fogli)'),
        h(G.ui.Button, {
          key: 'tp', kind: 'ghost',
          onClick: async () => {
            try {
              await G.io.exportTemplate();
              G.ui.pushToast('Template Excel scaricato', 'success');
            } catch (e) { G.ui.pushToast(e.message || 'Errore', 'error'); }
          }
        }, '⤓ Scarica template vuoto'),
        h(G.ui.Button, { key: 'im', kind: 'ghost', onClick: pickImportFile },
          '⤴ Importa Excel')
      ]),
      importPreview && h(ImportPreviewModal, {
        preview: importPreview,
        onClose: () => setImportPreview(null),
        onCommit: commitImport
      }),
      h('div', {
        key: 'tabs',
        style: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}` }
      }, ['s1','s2','s3','fe','produzione'].map(t => h('button', {
        key: t, onClick: () => setTab(t),
        style: {
          padding: '10px 16px', border: 'none', background: 'transparent',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
          color: tab === t ? C.text : C.textMid,
          borderBottom: `2px solid ${tab === t ? C.brand : 'transparent'}`,
          textTransform: 'uppercase', letterSpacing: .5
        }
      }, t === 'produzione' ? 'Produzione' : t.toUpperCase()))),
      tab === 'produzione'
        ? h(ProduzioneTab, { data, canEdit, canDelete, reload, role })
        : h(GenericTab, { table: tab, data, canEdit, canDelete, reload, role })
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Onboarding card per primo admin (DB nuovo / parzialmente vuoto)
  //  3 step: anagrafiche → dati storici → materialità Scope 3.
  //  Si auto-nasconde quando tutti gli step sono completi.
  // ────────────────────────────────────────────────────────────────────
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
  //  PRODUZIONE TAB
  // ────────────────────────────────────────────────────────────────────
  function ProduzioneTab ({ data, canEdit, canDelete, reload, role }) {
    const [editing, setEditing] = useState(null);
    const rows = data.produzione || [];
    const sites = (data.anagrafiche || []).map(a => a.Codice_Sito || a.codice_sito);
    const lockedYears = getLockedYears(data);

    const openNew = () => setEditing({
      Codice_Sito: sites[0] || '', Anno: new Date().getFullYear(),
      Produzione_kg: '', Produzione_m2: '', Note: ''
    });

    return h('div', null, [
      canEdit && h('div', {
        key: 'tb',
        style: { display: 'flex', gap: 8, marginBottom: 16 }
      }, [
        h(G.ui.Button, { key: 'a', kind: 'primary', onClick: openNew }, '+ Aggiungi')
      ]),
      h(G.ui.DataTable, {
        columns: [
          { key: 'Codice_Sito', label: 'Sito' },
          { key: 'Anno', label: 'Anno', align: 'right' },
          { key: 'Produzione_kg', label: 'Produzione kg', align: 'right',
            render: v => v == null ? '—' : Number(v).toLocaleString('it-IT', { useGrouping: 'always' }) },
          { key: 'Produzione_m2', label: 'Produzione m²', align: 'right',
            render: v => v == null ? '—' : Number(v).toLocaleString('it-IT', { useGrouping: 'always' }) },
          { key: 'Note', label: 'Note' }
        ],
        rows,
        canEdit, canDelete,
        onEdit:   r => setEditing({ ...r }),
        onDelete: async r => {
          if (!await G.ui.confirm({
            title: 'Eliminare questa riga di produzione?',
            message: `${r.Codice_Sito} · ${r.Anno}`,
            danger: true
          })) return;
          try {
            await G.db.delProduzione(r.Codice_Sito || r.codice_sito, r.Anno || r.anno);
            G.ui.pushToast('Riga eliminata', 'success');
            reload && reload();
          } catch (e) { G.ui.pushToast(e.message, 'error'); }
        }
      }),
      editing && h(EditModal, {
        row: editing, sites,
        existing: rows.filter(r => r !== editing),
        lockedYears, role,
        onClose: () => setEditing(null),
        onSave: async (payload) => {
          try {
            await G.db.upsert('produzione', payload);
            G.ui.pushToast('Produzione salvata', 'success');
            setEditing(null);
            reload && reload();
          } catch (e) { G.ui.pushToast(e.message || 'Errore', 'error'); }
        }
      })
    ]);
  }

  function EditModal ({ row, sites, existing, onClose, onSave, lockedYears = [], role }) {
    const [val, setVal] = useState(row);
    const locked = isYearLocked(val.Anno, lockedYears, role);
    const closeWithConfirm = makeConfirmedClose(row, val, onClose);
    const v = G.calc.validateRow('produzione', val);
    const dup = existing.some(r =>
      (r.Codice_Sito || r.codice_sito) === val.Codice_Sito
      && +(r.Anno || r.anno) === +val.Anno
      && (r.id || r.Codice_Sito) !== (row.id || row.Codice_Sito));
    const errors = [...v.errors, ...(dup ? [`Esiste già una riga per ${val.Codice_Sito} ${val.Anno}`] : [])];

    return h('div', {
      role: 'dialog', 'aria-modal': true,
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'grid', placeItems: 'center', zIndex: 9000
      }
    }, h(G.ui.Card, { style: { maxWidth: 520, width: '90%' } }, [
      h('h2', { key: 'h', style: { fontSize: 18, fontWeight: 700, marginBottom: 16 } },
        'Produzione'),
      locked && h(LockBanner, { key: 'lk', year: val.Anno }),
      h(Field, { key: 's', label: 'Sito',
        children: h(G.ui.Select, {
          value: val.Codice_Sito || '',
          onChange: e => setVal({ ...val, Codice_Sito: e.target.value }),
          options: [{ value: '', label: '—' }, ...sites.map(s => ({ value: s, label: s }))],
          style: { width: '100%' }
        })
      }),
      h(Field, { key: 'a', label: 'Anno',
        children: h(G.ui.Input, {
          type: 'number', value: val.Anno || '',
          onChange: e => setVal({ ...val, Anno: +e.target.value }),
          style: { width: 140 }
        })
      }),
      h(Field, { key: 'kg', label: 'Produzione kg',
        children: h(G.ui.Input, {
          type: 'number', step: 0.01, value: val.Produzione_kg || '',
          onChange: e => setVal({ ...val, Produzione_kg: e.target.value === '' ? null : +e.target.value }),
          style: { width: 200 }
        })
      }),
      h(Field, { key: 'm2', label: 'Produzione m²',
        children: h(G.ui.Input, {
          type: 'number', step: 0.01, value: val.Produzione_m2 || '',
          onChange: e => setVal({ ...val, Produzione_m2: e.target.value === '' ? null : +e.target.value }),
          style: { width: 200 }
        })
      }),
      h(Field, { key: 'n', label: 'Note',
        children: h('textarea', {
          rows: 2, value: val.Note || '',
          onChange: e => setVal({ ...val, Note: e.target.value }),
          style: {
            width: '100%', padding: 8, border: `1px solid ${C.border}`,
            borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical'
          }
        })
      }),
      errors.length > 0 && h('div', {
        key: 'e',
        style: {
          background: C.criticalPale, color: C.critical, padding: 8,
          borderRadius: 8, fontSize: 12, marginTop: 12
        }
      }, errors.join(' · ')),
      v.warnings.length > 0 && h('div', {
        key: 'w',
        style: {
          background: C.warningPale, color: C.warning, padding: 8,
          borderRadius: 8, fontSize: 12, marginTop: 8
        }
      }, v.warnings.join(' · ')),
      h('div', {
        key: 'a',
        style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }
      }, [
        h(G.ui.Button, { key: 'c', kind: 'ghost', onClick: closeWithConfirm }, 'Annulla'),
        h(G.ui.Button, {
          key: 's', kind: 'primary',
          disabled: errors.length > 0 || locked,
          onClick: () => {
            const payload = {
              Codice_Sito: val.Codice_Sito,
              Anno: +val.Anno,
              Produzione_kg: val.Produzione_kg || null,
              Produzione_m2: val.Produzione_m2 || null,
              Note: val.Note || null
            };
            onSave(payload);
          }
        }, 'Salva')
      ])
    ]));
  }

  // Modal anteprima import — mostra summary per tabella + errori per riga.
  // Commit blocca se ci sono errori (default), oppure procede con
  // skip-row se l'utente attiva "Importa solo righe valide".
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
    return h('div', { style: { marginBottom: 12 } }, [
      h('label', {
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

    if (table === 'fe') return h(FETab, { data, canEdit, canDelete, reload });

    const sites = (data.anagrafiche || []).map(a => a.Codice_Sito || a.codice_sito);
    const fe = data.fe || [];
    const lockedYears = getLockedYears(data);
    const Modal = table === 's1' ? S1EditModal
                : table === 's2' ? S2EditModal
                :                  S3EditModal;

    function blankRow () {
      const yr = new Date().getFullYear();
      const site = sites[0] || '';
      if (table === 's1') return {
        Anno: yr, Codice_Sito: site,
        Categoria_S1: 'Combustione_Stazionaria', Combustibile: '',
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
        }
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
  function S1EditModal ({ row, sites, fe, onClose, onSave, lockedYears = [], role }) {
    const [val, setVal] = useState(row);
    const update = (k, v) => setVal(p => ({ ...p, [k]: v }));
    const locked = isYearLocked(val.Anno, lockedYears, role);
    const closeWithConfirm = makeConfirmedClose(row, val, onClose);

    const lookup = G.calc.lookupFE('s1', val, fe);
    const feValore = lookup.fe ? +(lookup.fe.Valore || lookup.fe.valore || 0) : null;
    const feUnita  = lookup.fe ? (lookup.fe.Unità || lookup.fe.unita || '') : '';
    const feAnno   = lookup.fe ? +(lookup.fe.Anno_Validità || lookup.fe.anno_validita || 0) : null;
    const qty      = G.calc.num(val.Quantità);
    const em       = feValore != null && qty > 0 ? G.calc.emS1(qty, feValore) : null;

    const v = G.calc.validateRow('s1', val);
    const errors = [...v.errors];
    if (val.Combustibile && lookup.err) errors.push(lookup.err);
    const warnings = [...v.warnings];
    if (lookup.warn) warnings.push(lookup.warn);
    const expected = G.EXPECTED_UNIT_S1
      ? G.EXPECTED_UNIT_S1[val.Categoria_S1 + '_' + val.Combustibile]
      : null;
    if (val.Unità && expected && val.Unità !== expected) {
      warnings.push(`Unità "${val.Unità}" diversa dall'attesa "${expected}"`);
    }

    const combOpts = Array.from(new Set(
      (fe || [])
        .filter(f => (f.Famiglia || f.famiglia) === 'Combustibili')
        .map(f => f.Codice_Voce || f.codice_voce)
    )).filter(Boolean).sort();

    return h('div', {
      role: 'dialog', 'aria-modal': true, style: modalScrim,
      onClick: e => { if (e.target === e.currentTarget) closeWithConfirm(); }
    }, h('div', { style: modalCard(640) }, [
      h('h2', { key: 'h', style: titleStyle }, row.id ? 'Modifica S1' : 'Nuova riga S1'),
      locked && h(LockBanner, { key: 'lk', year: val.Anno }),
      h('div', { key: 'g', style: modalGrid }, [
        h(Field, { key: 'an', label: 'Anno' },
          h(G.ui.Input, { type: 'number', value: val.Anno || '',
            onChange: e => update('Anno', +e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'st', label: 'Sito' },
          h(G.ui.Select, { value: val.Codice_Sito || '',
            onChange: e => update('Codice_Sito', e.target.value),
            options: [{ value: '', label: '—' }, ...sites.map(s => ({ value: s, label: s }))],
            style: { width: '100%' } })),
        h(Field, { key: 'ca', label: 'Categoria' },
          h(G.ui.Select, { value: val.Categoria_S1 || '',
            onChange: e => update('Categoria_S1', e.target.value),
            options: [
              { value: 'Combustione_Stazionaria', label: 'Combustione stazionaria' },
              { value: 'Combustione_Mobile',      label: 'Combustione mobile' },
              { value: 'Fugitivi',                label: 'Fugitivi' }
            ],
            style: { width: '100%' } })),
        h(Field, { key: 'cb', label: 'Combustibile / Sostanza' },
          h(G.ui.Select, { value: val.Combustibile || '',
            onChange: e => {
              const cb = e.target.value;
              const next = { ...val, Combustibile: cb };
              if (!val.Unità) {
                const m = (fe || []).find(f =>
                  (f.Codice_Voce || f.codice_voce) === cb);
                if (m) next.Unità = m.Unità || m.unita || '';
              }
              setVal(next);
            },
            options: [{ value: '', label: '—' }, ...combOpts.map(s => ({ value: s, label: s }))],
            style: { width: '100%' } })),
        h(Field, { key: 'q', label: 'Quantità' },
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.Quantità == null ? '' : val.Quantità,
            onChange: e => update('Quantità', e.target.value === '' ? '' : +e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'u', label: 'Unità' },
          h(G.ui.Input, { value: val.Unità || '',
            onChange: e => update('Unità', e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'qd', label: 'Qualità dato' },
          h(G.ui.Select, { value: val.Qualità_Dato || '',
            onChange: e => update('Qualità_Dato', e.target.value),
            options: QD_OPTS, style: { width: '100%' } })),
        h(Field, { key: 'sd', label: 'Stato dato' },
          h(G.ui.Select, { value: val.Stato_Dato || '',
            onChange: e => update('Stato_Dato', e.target.value),
            options: SD_OPTS, style: { width: '100%' } }))
      ]),
      h(Field, { key: 'fd', label: 'Fonte dato' },
        h(G.ui.Input, { value: val.Fonte_Dato || '',
          onChange: e => update('Fonte_Dato', e.target.value),
          style: { width: '100%' } })),
      h(Field, { key: 'no', label: 'Note' },
        h('textarea', { rows: 2, value: val.Note || '',
          onChange: e => update('Note', e.target.value),
          style: {
            width: '100%', padding: 8, border: `1px solid ${C.border}`,
            borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical'
          } })),
      h('div', { key: 'cp', style: calcPanel(em != null) }, [
        h('div', { key: 'l', style: calcLabel }, 'Anteprima calcolo'),
        h('div', { key: 'fe', style: calcRow }, [
          h('span', null, 'Fattore emissivo' + (feAnno && feAnno !== +val.Anno ? ` (anno ${feAnno})` : '')),
          h('span', null, feValore != null
            ? `${fmtNum(feValore, 6)} ${feUnita}`
            : (val.Combustibile ? (lookup.err || 'non trovato') : '—'))
        ]),
        h('div', { key: 'q', style: calcRow }, [
          h('span', null, 'Quantità'),
          h('span', null, qty > 0 ? `${fmtNum(qty)} ${val.Unità || ''}` : '—')
        ]),
        h('div', { key: 'em', style: calcResult }, [
          h('span', null, 'Emissione = Q × FE ÷ 1000'),
          h('span', null, em != null ? `${fmtNum(em, 3)} tCO₂e` : '—')
        ])
      ]),
      errors.length > 0 && h('div', { key: 'e', style: errBox }, errors.join(' · ')),
      warnings.length > 0 && h('div', { key: 'w', style: warnBox }, warnings.join(' · ')),
      h('div', { key: 'b', style: btnRow }, [
        h(G.ui.Button, { key: 'c', kind: 'ghost', onClick: closeWithConfirm }, 'Annulla'),
        h(G.ui.Button, {
          key: 's', kind: 'primary',
          disabled: errors.length > 0 || em == null || locked,
          onClick: () => onSave({
            ...val,
            Anno: +val.Anno,
            Quantità: val.Quantità === '' || val.Quantità == null ? null : +val.Quantità,
            FE_Valore: feValore,
            Em_tCO2e:  em
          })
        }, 'Salva')
      ])
    ]));
  }

  // ────────────────────────────────────────────────────────────────────
  //  S2 EDIT MODAL — FE_Location e FE_Market inseriti a mano
  //  em_loc = Q × FE_Location / 1000 ; em_mkt = Q × FE_Market / 1000
  // ────────────────────────────────────────────────────────────────────
  function S2EditModal ({ row, sites, onClose, onSave, lockedYears = [], role }) {
    const [val, setVal] = useState(row);
    const update = (k, v) => setVal(p => ({ ...p, [k]: v }));
    const locked = isYearLocked(val.Anno, lockedYears, role);
    const closeWithConfirm = makeConfirmedClose(row, val, onClose);

    const qty   = G.calc.num(val.Quantità);
    const feLoc = G.calc.num(val.FE_Location);
    const feMkt = G.calc.num(val.FE_Market);
    const emLoc = qty > 0 && val.FE_Location !== '' && val.FE_Location != null
      ? G.calc.emS2Loc(qty, feLoc) : null;
    const emMkt = qty > 0 && val.FE_Market !== '' && val.FE_Market != null
      ? G.calc.emS2Mkt(qty, feMkt) : null;

    const v = G.calc.validateRow('s2', val);
    const errors = [...v.errors];
    const warnings = [...v.warnings];

    return h('div', {
      role: 'dialog', 'aria-modal': true, style: modalScrim,
      onClick: e => { if (e.target === e.currentTarget) closeWithConfirm(); }
    }, h('div', { style: modalCard(640) }, [
      h('h2', { key: 'h', style: titleStyle }, row.id ? 'Modifica S2' : 'Nuova riga S2'),
      locked && h(LockBanner, { key: 'lk', year: val.Anno }),
      h('div', { key: 'g', style: modalGrid }, [
        h(Field, { key: 'an', label: 'Anno' },
          h(G.ui.Input, { type: 'number', value: val.Anno || '',
            onChange: e => update('Anno', +e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'st', label: 'Sito' },
          h(G.ui.Select, { value: val.Codice_Sito || '',
            onChange: e => update('Codice_Sito', e.target.value),
            options: [{ value: '', label: '—' }, ...sites.map(s => ({ value: s, label: s }))],
            style: { width: '100%' } })),
        h(Field, { key: 'vo', label: 'Voce S2' },
          h(G.ui.Select, { value: val.Voce_S2 || '',
            onChange: e => update('Voce_S2', e.target.value),
            options: [
              { value: 'EE_Acquistata',    label: 'Energia elettrica acquistata' },
              { value: 'EE_Acquistata_GO', label: 'Energia elettrica con GO' },
              { value: 'Vapore_Acquistato',label: 'Vapore acquistato' },
              { value: 'Calore_Acquistato',label: 'Calore acquistato' },
              { value: 'Freddo_Acquistato',label: 'Freddo acquistato' }
            ],
            style: { width: '100%' } })),
        h(Field, { key: 'sm', label: 'Strumento MB (es. GO)' },
          h(G.ui.Input, { value: val.Strumento_MB || '',
            onChange: e => update('Strumento_MB', e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'q', label: 'Quantità (kWh)' },
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.Quantità == null ? '' : val.Quantità,
            onChange: e => update('Quantità', e.target.value === '' ? '' : +e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'u', label: 'Unità' },
          h(G.ui.Input, { value: val.Unità || 'kWh',
            onChange: e => update('Unità', e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'fl', label: 'FE Location (kgCO₂e/kWh)' },
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.FE_Location == null ? '' : val.FE_Location,
            onChange: e => update('FE_Location', e.target.value === '' ? '' : +e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'fm', label: 'FE Market (kgCO₂e/kWh)' },
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.FE_Market == null ? '' : val.FE_Market,
            onChange: e => update('FE_Market', e.target.value === '' ? '' : +e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'qd', label: 'Qualità dato' },
          h(G.ui.Select, { value: val.Qualità_Dato || '',
            onChange: e => update('Qualità_Dato', e.target.value),
            options: QD_OPTS, style: { width: '100%' } })),
        h(Field, { key: 'sd', label: 'Stato dato' },
          h(G.ui.Select, { value: val.Stato_Dato || '',
            onChange: e => update('Stato_Dato', e.target.value),
            options: SD_OPTS, style: { width: '100%' } }))
      ]),
      h(Field, { key: 'fd', label: 'Fonte dato' },
        h(G.ui.Input, { value: val.Fonte_Dato || '',
          onChange: e => update('Fonte_Dato', e.target.value),
          style: { width: '100%' } })),
      h(Field, { key: 'no', label: 'Note' },
        h('textarea', { rows: 2, value: val.Note || '',
          onChange: e => update('Note', e.target.value),
          style: {
            width: '100%', padding: 8, border: `1px solid ${C.border}`,
            borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical'
          } })),
      h('div', { key: 'cp', style: calcPanel(emLoc != null || emMkt != null) }, [
        h('div', { key: 'l', style: calcLabel }, 'Anteprima calcolo'),
        h('div', { key: 'q', style: calcRow }, [
          h('span', null, 'Quantità'),
          h('span', null, qty > 0 ? `${fmtNum(qty)} ${val.Unità || 'kWh'}` : '—')
        ]),
        h('div', { key: 'lb', style: calcResult }, [
          h('span', null, 'Em. Location-based'),
          h('span', null, emLoc != null ? `${fmtNum(emLoc, 3)} tCO₂e` : '—')
        ]),
        h('div', { key: 'mb', style: calcResult }, [
          h('span', null, 'Em. Market-based'),
          h('span', null, emMkt != null ? `${fmtNum(emMkt, 3)} tCO₂e` : '—')
        ])
      ]),
      errors.length > 0 && h('div', { key: 'e', style: errBox }, errors.join(' · ')),
      warnings.length > 0 && h('div', { key: 'w', style: warnBox }, warnings.join(' · ')),
      h('div', { key: 'b', style: btnRow }, [
        h(G.ui.Button, { key: 'c', kind: 'ghost', onClick: closeWithConfirm }, 'Annulla'),
        h(G.ui.Button, {
          key: 's', kind: 'primary',
          disabled: errors.length > 0 || (emLoc == null && emMkt == null) || locked,
          onClick: () => onSave({
            ...val,
            Anno: +val.Anno,
            Quantità: val.Quantità === '' || val.Quantità == null ? null : +val.Quantità,
            FE_Location: val.FE_Location === '' || val.FE_Location == null ? null : +val.FE_Location,
            FE_Market:   val.FE_Market   === '' || val.FE_Market   == null ? null : +val.FE_Market,
            Em_Loc_tCO2e: emLoc,
            Em_Mkt_tCO2e: emMkt
          })
        }, 'Salva')
      ])
    ]));
  }

  // ────────────────────────────────────────────────────────────────────
  //  S3 EDIT MODAL — calcolo live em = Q × FE(lookup per Codice_FE) / 1000
  // ────────────────────────────────────────────────────────────────────
  function S3EditModal ({ row, fe, onClose, onSave, lockedYears = [], role }) {
    const [val, setVal] = useState(row);
    const update = (k, v) => setVal(p => ({ ...p, [k]: v }));
    const locked = isYearLocked(val.Anno, lockedYears, role);
    const closeWithConfirm = makeConfirmedClose(row, val, onClose);

    const lookup = G.calc.lookupFE('s3', val, fe);
    const feValore = lookup.fe ? +(lookup.fe.Valore || lookup.fe.valore || 0) : null;
    const feUnita  = lookup.fe ? (lookup.fe.Unità || lookup.fe.unita || '') : '';
    const feAnno   = lookup.fe ? +(lookup.fe.Anno_Validità || lookup.fe.anno_validita || 0) : null;
    const qty      = G.calc.num(val.Quantità);
    const em       = feValore != null && qty > 0 ? G.calc.emS3(qty, feValore) : null;

    const v = G.calc.validateRow('s3', val);
    const errors = [...v.errors];
    if (val.Codice_FE && lookup.err) errors.push(lookup.err);
    const warnings = [...v.warnings];
    if (lookup.warn) warnings.push(lookup.warn);

    // Codici FE disponibili (FE_ID o Codice_Voce — entrambi accettati dal lookup)
    const feOpts = Array.from(new Set(
      (fe || []).flatMap(f => [
        f.FE_ID || f.fe_id,
        f.Codice_Voce || f.codice_voce
      ]).filter(Boolean)
    )).sort();

    const catLabel = (G.CAT_NAMES && G.CAT_NAMES[+val.Categoria_S3]) || '';

    return h('div', {
      role: 'dialog', 'aria-modal': true, style: modalScrim,
      onClick: e => { if (e.target === e.currentTarget) closeWithConfirm(); }
    }, h('div', { style: modalCard(640) }, [
      h('h2', { key: 'h', style: titleStyle }, row.id ? 'Modifica S3' : 'Nuova riga S3'),
      locked && h(LockBanner, { key: 'lk', year: val.Anno }),
      h('div', { key: 'g', style: modalGrid }, [
        h(Field, { key: 'an', label: 'Anno' },
          h(G.ui.Input, { type: 'number', value: val.Anno || '',
            onChange: e => update('Anno', +e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'cat', label: 'Categoria S3 (1–15)' },
          h(G.ui.Select, { value: val.Categoria_S3 || '',
            onChange: e => update('Categoria_S3', +e.target.value),
            options: Array.from({ length: 15 }, (_, i) => ({
              value: i + 1,
              label: `${i + 1} · ${(G.CAT_NAMES && G.CAT_NAMES[i + 1]) || ''}`
            })),
            style: { width: '100%' } })),
        h(Field, { key: 'sc', label: 'Sottocategoria' },
          h(G.ui.Input, { value: val.Sottocategoria || '',
            onChange: e => update('Sottocategoria', e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'me', label: 'Metodo' },
          h(G.ui.Select, { value: val.Metodo || '',
            onChange: e => update('Metodo', e.target.value),
            options: [
              { value: 'Activity-based', label: 'Activity-based' },
              { value: 'Spend-based',    label: 'Spend-based' },
              { value: 'Hybrid',         label: 'Hybrid' },
              { value: 'Distance-based', label: 'Distance-based' }
            ],
            style: { width: '100%' } })),
        h(Field, { key: 'cf', label: 'Codice FE' },
          h(G.ui.Select, { value: val.Codice_FE || '',
            onChange: e => {
              const cf = e.target.value;
              const next = { ...val, Codice_FE: cf };
              if (!val.Unità) {
                const m = (fe || []).find(f =>
                  (f.FE_ID || f.fe_id) === cf
                  || (f.Codice_Voce || f.codice_voce) === cf);
                if (m) next.Unità = m.Unità || m.unita || '';
              }
              setVal(next);
            },
            options: [{ value: '', label: '—' }, ...feOpts.map(s => ({ value: s, label: s }))],
            style: { width: '100%' } })),
        h(Field, { key: 'q', label: 'Quantità' },
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.Quantità == null ? '' : val.Quantità,
            onChange: e => update('Quantità', e.target.value === '' ? '' : +e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'u', label: 'Unità' },
          h(G.ui.Input, { value: val.Unità || '',
            onChange: e => update('Unità', e.target.value),
            style: { width: '100%' } })),
        h(Field, { key: 'qd', label: 'Qualità dato' },
          h(G.ui.Select, { value: val.Qualità_Dato || '',
            onChange: e => update('Qualità_Dato', e.target.value),
            options: QD_OPTS, style: { width: '100%' } })),
        h(Field, { key: 'sd', label: 'Stato dato' },
          h(G.ui.Select, { value: val.Stato_Dato || '',
            onChange: e => update('Stato_Dato', e.target.value),
            options: SD_OPTS, style: { width: '100%' } }))
      ]),
      h(Field, { key: 'fd', label: 'Fonte dato' },
        h(G.ui.Input, { value: val.Fonte_Dato || '',
          onChange: e => update('Fonte_Dato', e.target.value),
          style: { width: '100%' } })),
      h(Field, { key: 'no', label: 'Note' },
        h('textarea', { rows: 2, value: val.Note || '',
          onChange: e => update('Note', e.target.value),
          style: {
            width: '100%', padding: 8, border: `1px solid ${C.border}`,
            borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical'
          } })),
      h('div', { key: 'cp', style: calcPanel(em != null) }, [
        h('div', { key: 'l', style: calcLabel },
          'Anteprima calcolo' + (catLabel ? ` · cat. ${val.Categoria_S3} (${catLabel})` : '')),
        h('div', { key: 'fe', style: calcRow }, [
          h('span', null, 'Fattore emissivo' + (feAnno && feAnno !== +val.Anno ? ` (anno ${feAnno})` : '')),
          h('span', null, feValore != null
            ? `${fmtNum(feValore, 6)} ${feUnita}`
            : (val.Codice_FE ? (lookup.err || 'non trovato') : '—'))
        ]),
        h('div', { key: 'q', style: calcRow }, [
          h('span', null, 'Quantità'),
          h('span', null, qty > 0 ? `${fmtNum(qty)} ${val.Unità || ''}` : '—')
        ]),
        h('div', { key: 'em', style: calcResult }, [
          h('span', null, 'Emissione = Q × FE ÷ 1000'),
          h('span', null, em != null ? `${fmtNum(em, 3)} tCO₂e` : '—')
        ])
      ]),
      errors.length > 0 && h('div', { key: 'e', style: errBox }, errors.join(' · ')),
      warnings.length > 0 && h('div', { key: 'w', style: warnBox }, warnings.join(' · ')),
      h('div', { key: 'b', style: btnRow }, [
        h(G.ui.Button, { key: 'c', kind: 'ghost', onClick: closeWithConfirm }, 'Annulla'),
        h(G.ui.Button, {
          key: 's', kind: 'primary',
          disabled: errors.length > 0 || em == null || locked,
          onClick: () => onSave({
            ...val,
            Anno: +val.Anno,
            Categoria_S3: +val.Categoria_S3,
            Quantità: val.Quantità === '' || val.Quantità == null ? null : +val.Quantità,
            FE_Valore: feValore,
            Em_tCO2e:  em
          })
        }, 'Salva')
      ])
    ]));
  }

  // ────────────────────────────────────────────────────────────────────
  //  FE TAB con edit + cascade
  // ────────────────────────────────────────────────────────────────────
  function FETab ({ data, canEdit, canDelete, reload }) {
    const [editing, setEditing] = useState(null);
    const rows = data.fe || [];

    async function saveFE (payload) {
      try {
        const saved = await G.db.upsert('fe', payload);
        // Cascade: ricalcola S1/S3 dipendenti
        let cascadeMsg = '';
        try {
          const result = await G.db.cascadeFEUpdate(saved);
          if (result.s1 + result.s3 > 0) {
            cascadeMsg = ` · ricalcolate ${result.s1} righe S1 e ${result.s3} righe S3`;
          }
        } catch (e) {
          G.ui.pushToast('FE salvato ma cascade fallito: ' + e.message, 'warning');
        }
        G.ui.pushToast('FE salvato' + cascadeMsg, 'success');
        setEditing(null);
        reload && reload();
      } catch (e) { G.ui.pushToast(e.message || 'Errore', 'error'); }
    }

    async function cloneFE (row) {
      // "Nuova versione" — clona riga FE con anno+1
      const next = { ...row };
      delete next.id; delete next.created_at; delete next.updated_at;
      next.Anno_Validità = (+row.Anno_Validità || new Date().getFullYear()) + 1;
      setEditing(next);
    }

    return h('div', null, [
      canEdit && h('div', {
        key: 'tb', style: { display: 'flex', gap: 8, marginBottom: 16 }
      }, [
        h(G.ui.Button, {
          key: 'a', kind: 'primary',
          onClick: () => setEditing({
            FE_ID: '', Famiglia: '', Codice_Voce: '', Descrizione: '',
            Anno_Validità: new Date().getFullYear(),
            Valore: '', Unità: '', Gas: 'CO2e', Fonte: '', Nota: ''
          })
        }, '+ Aggiungi'),
        h(G.ui.Button, {
          key: 'csv', kind: 'ghost',
          onClick: () => exportCSV('fe', rows)
        }, 'Esporta CSV')
      ]),
      h(G.ui.DataTable, {
        columns: [...COLUMNS.fe, {
          key: '_clone', label: '', align: 'right',
          render: (_, r) => canEdit && h('button', {
            onClick: e => { e.stopPropagation(); cloneFE(r); },
            title: 'Crea nuova versione (anno + 1)',
            style: {
              border: `1px solid ${C.border}`, background: '#fff',
              padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
              fontSize: 11, color: C.textMid
            }
          }, '📋 Nuova versione')
        }],
        rows,
        canEdit, canDelete,
        onEdit:   r => setEditing({ ...r }),
        onDelete: async r => {
          if (!await G.ui.confirm({
            title: 'Eliminare questo FE?', danger: true,
            message: 'Le righe S1/S3 che lo usano dovranno essere ricalcolate manualmente.'
          })) return;
          try {
            await G.db.del('fe', r.id);
            G.ui.pushToast('FE eliminato', 'success');
            reload && reload();
          } catch (e) { G.ui.pushToast(e.message, 'error'); }
        }
      }),
      editing && h(FEEditModal, {
        row: editing,
        onClose: () => setEditing(null),
        onSave: saveFE
      })
    ]);
  }

  function FEEditModal ({ row, onClose, onSave }) {
    const [val, setVal] = useState(row);
    const update = (k, v) => setVal(p => ({ ...p, [k]: v }));
    const closeWithConfirm = makeConfirmedClose(row, val, onClose);
    return h('div', {
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'grid', placeItems: 'center', zIndex: 999
      },
      onClick: e => { if (e.target === e.currentTarget) closeWithConfirm(); }
    }, h('div', {
      style: {
        background: '#fff', padding: 24, borderRadius: 12,
        width: 'min(560px, 90vw)', boxShadow: '0 24px 70px rgba(0,0,0,.45)'
      }
    }, [
      h('h2', { key: 'h', style: { fontSize: 18, fontWeight: 700, marginBottom: 16 } },
        row.id ? 'Modifica FE' : 'Nuovo FE'),
      h('div', { key: 'g', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } }, [
        h(Field, { key: 'id', label: 'FE_ID' },
          h(G.ui.Input, { value: val.FE_ID || '', onChange: e => update('FE_ID', e.target.value) })),
        h(Field, { key: 'fa', label: 'Famiglia' },
          h(G.ui.Input, { value: val.Famiglia || '', onChange: e => update('Famiglia', e.target.value) })),
        h(Field, { key: 'cv', label: 'Codice Voce' },
          h(G.ui.Input, { value: val.Codice_Voce || '', onChange: e => update('Codice_Voce', e.target.value) })),
        h(Field, { key: 'an', label: 'Anno Validità' },
          h(G.ui.Input, { type: 'number', value: val.Anno_Validità || '', onChange: e => update('Anno_Validità', +e.target.value) })),
        h(Field, { key: 'va', label: 'Valore' },
          h(G.ui.Input, { type: 'number', step: 0.0001, value: val.Valore || '', onChange: e => update('Valore', +e.target.value) })),
        h(Field, { key: 'un', label: 'Unità' },
          h(G.ui.Input, { value: val.Unità || '', onChange: e => update('Unità', e.target.value) })),
        h(Field, { key: 'fo', label: 'Fonte' },
          h(G.ui.Input, { value: val.Fonte || '', onChange: e => update('Fonte', e.target.value) })),
        h(Field, { key: 'gs', label: 'Gas' },
          h(G.ui.Input, { value: val.Gas || '', onChange: e => update('Gas', e.target.value) }))
      ]),
      h(Field, { key: 'd', label: 'Descrizione' },
        h(G.ui.Input, { value: val.Descrizione || '', onChange: e => update('Descrizione', e.target.value) })),
      h('div', { key: 'b', style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } }, [
        h(G.ui.Button, { key: 'c', kind: 'ghost', onClick: closeWithConfirm }, 'Annulla'),
        h(G.ui.Button, { key: 's', kind: 'primary', onClick: () => onSave(val) }, 'Salva')
      ])
    ]));
  }

  // ────────────────────────────────────────────────────────────────────
  //  CSV EXPORT — locale IT, BOM UTF-8, separatore ;, sanitizzazione
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
      { key: 'Categoria_S1', label: 'Categoria' },
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

  G.sections = G.sections || {};
  G.sections.DataManager = DataManager;
})(typeof window !== 'undefined' ? window : globalThis);
