/* GHG Tool — DataManager.tabs.jsx
 *
 * Tab principali della Gestione Dati: Anagrafiche, Produzione, Targets, FE,
 * con i loro modal di edit "leggeri" (no Scope edit modal — quelli sono
 * in DataManager.scopeModals.jsx).
 *
 * Estratto da DataManager.jsx in PR di splitting.
 *
 * Espone su window.GHG.DM = {
 *   AnagraficheTab, AnagraficaEditModal,
 *   ProduzioneTab, EditModal,
 *   TargetsTab, TargetsView,
 *   FETab, FEEditModal
 * }
 *
 * Consuma da G.DM: getLockedYears, isYearLocked, LockBanner,
 *                  Field, GenericTab, fmtNum, exportCSV, csvCell.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;

  // Helper esposti dal modulo DataManager.shared.jsx (caricato prima)
  const {
    getLockedYears, isYearLocked, LockBanner, makeConfirmedClose,
    Field, exportCSV
  } = G.DM;

  function AnagraficheTab ({ data, canEdit, canDelete, reload, role }) {
    const [editing, setEditing] = useState(null);
    const rows = data.anagrafiche || [];

    // Conteggio righe associate per sito (per warning su edit/delete).
    // S3 non ha Codice_Sito (è organizzativo), quindi non lo contiamo.
    const refCount = {};
    ['s1', 's2', 'produzione'].forEach(t => {
      (data[t] || []).forEach(r => {
        const code = r.Codice_Sito || r.codice_sito;
        if (!code) return;
        if (!refCount[code]) refCount[code] = { s1: 0, s2: 0, produzione: 0 };
        refCount[code][t]++;
      });
    });

    const openNew = () => setEditing({
      Codice_Sito: '', Nome_Sito: '', Tipologia: 'Stabilimento produttivo',
      Presenza_CHP: false, Regime_ETS: false, Note_Produzione: '',
      _isNew: true
    });

    return h('div', null, [
      canEdit && h('div', {
        key: 'tb',
        style: { display: 'flex', gap: 8, marginBottom: 16 }
      }, [
        h(G.ui.Button, { key: 'a', kind: 'primary', onClick: openNew },
          '+ Aggiungi sito')
      ]),
      h(G.ui.DataTable, {
        columns: [
          { key: 'Codice_Sito', label: 'Codice', mono: true,
            render: v => h('strong', null, v) },
          { key: 'Nome_Sito',   label: 'Nome' },
          { key: 'Tipologia',   label: 'Tipologia' },
          { key: 'Presenza_CHP', label: 'CHP', align: 'center',
            render: v => v ? '✓' : '—' },
          { key: 'Regime_ETS',  label: 'ETS', align: 'center',
            render: v => v ? '✓' : '—' },
          { key: '_refs', label: 'Righe associate', align: 'right',
            render: (_, r) => {
              const c = refCount[r.Codice_Sito] || { s1: 0, s2: 0, produzione: 0 };
              const total = c.s1 + c.s2 + c.produzione;
              if (total === 0) return h('span', { style: { color: C.textLow } }, '—');
              return h('span', {
                style: { fontSize: 11, color: C.textMid, fontVariantNumeric: 'tabular-nums' }
              }, `S1:${c.s1} · S2:${c.s2} · Prod:${c.produzione}`);
            } },
          { key: 'Note_Produzione', label: 'Note',
            render: v => v
              ? h('span', { style: { fontSize: 12, color: C.textMid } },
                  String(v).slice(0, 40) + (v.length > 40 ? '…' : ''))
              : h('span', { style: { color: C.textLow } }, '—') }
        ],
        rows,
        canEdit, canDelete,
        onEdit: r => setEditing({ ...r, _isNew: false }),
        onDelete: async r => {
          const refs = refCount[r.Codice_Sito] || { s1: 0, s2: 0, produzione: 0 };
          const total = refs.s1 + refs.s2 + refs.produzione;
          if (total > 0) {
            G.ui.pushToast(
              `Impossibile eliminare ${r.Codice_Sito}: ha ${total} righe ` +
              `associate (S1:${refs.s1}, S2:${refs.s2}, Prod:${refs.produzione}). ` +
              `Cancella prima quelle.`,
              'error'
            );
            return;
          }
          if (!await G.ui.confirm({
            title: `Eliminare il sito ${r.Codice_Sito}?`, danger: true,
            message: 'Operazione irreversibile (verrà loggata in audit_log).'
          })) return;
          try {
            await G.db.delAnagrafica(r.Codice_Sito);
            G.ui.pushToast('Sito eliminato', 'success');
            reload && reload();
          } catch (e) { G.ui.pushToast(e.message, 'error'); }
        }
      }),
      editing && h(AnagraficaEditModal, {
        row: editing,
        existing: rows.filter(r => r.Codice_Sito !== editing.Codice_Sito),
        refs: refCount[editing.Codice_Sito] || { s1: 0, s2: 0, produzione: 0 },
        role, onClose: () => setEditing(null),
        onSave: async (payload) => {
          try {
            await G.db.upsert('anagrafiche', payload);
            G.ui.pushToast(editing._isNew ? 'Sito creato' : 'Sito aggiornato', 'success');
            setEditing(null);
            reload && reload();
          } catch (e) { G.ui.pushToast(e.message || 'Errore', 'error'); }
        }
      })
    ]);
  }

  function AnagraficaEditModal ({ row, existing, refs, role: _role, onClose, onSave }) {
    const [val, setVal] = useState(row);
    const update = (k, v) => setVal(p => ({ ...p, [k]: v }));
    const closeWithConfirm = makeConfirmedClose(row, val, onClose);
    const isNew = !!row._isNew;
    const refTotal = refs.s1 + refs.s2 + refs.produzione;
    // Codice_Sito non modificabile su esistenti se referenziato
    const codeReadOnly = !isNew;
    const errors = [];
    if (!val.Codice_Sito) errors.push('Codice sito mancante');
    if (val.Codice_Sito && !/^[A-Z0-9_]+$/.test(val.Codice_Sito)) {
      errors.push('Codice sito: solo MAIUSCOLE, numeri, underscore');
    }
    if (!val.Nome_Sito) errors.push('Nome sito mancante');
    if (isNew && existing.some(e => e.Codice_Sito === val.Codice_Sito)) {
      errors.push(`Codice ${val.Codice_Sito} già esistente`);
    }

    return h('div', {
      role: 'dialog', 'aria-modal': true,
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'grid', placeItems: 'center', zIndex: 9000
      }
    }, h(G.ui.Card, { style: { maxWidth: 560, width: '92%' } }, [
      h('h2', { key: 'h', style: { fontSize: 18, fontWeight: 700, marginBottom: 16 } },
        isNew ? 'Nuovo sito' : `Modifica sito ${row.Codice_Sito}`),
      !isNew && refTotal > 0 && h('div', {
        key: 'lk',
        style: {
          background: '#FFF7E6', color: '#7A5510',
          border: '1px solid #F0C97A',
          padding: '10px 14px', borderRadius: 8, fontSize: 13,
          marginBottom: 12
        }
      }, `Questo sito ha ${refTotal} righe associate (S1:${refs.s1}, S2:${refs.s2}, Prod:${refs.produzione}). Il codice non è modificabile per non rompere i riferimenti.`),
      h(Field, { key: 'cs', label: 'Codice Sito (PK)' },
        h(G.ui.Input, {
          value: val.Codice_Sito || '',
          disabled: codeReadOnly,
          onChange: e => update('Codice_Sito', e.target.value.toUpperCase()),
          placeholder: 'Es. IANO, VIANO, FRASSINORO',
          style: {
            width: '100%',
            background: codeReadOnly ? C.bg : '#fff',
            color: codeReadOnly ? C.textMid : C.text
          }
        })
      ),
      h(Field, { key: 'ns', label: 'Nome Sito' },
        h(G.ui.Input, {
          value: val.Nome_Sito || '',
          onChange: e => update('Nome_Sito', e.target.value),
          placeholder: 'Es. Stabilimento Iano',
          style: { width: '100%' }
        })
      ),
      h(Field, { key: 'tp', label: 'Tipologia' },
        h(G.ui.Select, {
          value: val.Tipologia || '',
          onChange: e => update('Tipologia', e.target.value),
          options: [
            { value: '', label: '—' },
            { value: 'Stabilimento produttivo', label: 'Stabilimento produttivo' },
            { value: 'Magazzino',               label: 'Magazzino' },
            { value: 'Logistica',               label: 'Logistica / hub' },
            { value: 'Uffici',                  label: 'Uffici' },
            { value: 'Altro',                   label: 'Altro' }
          ],
          style: { width: '100%' }
        })
      ),
      h('div', {
        key: 'cb',
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }
      }, [
        h('label', {
          key: 'chp',
          style: { display: 'flex', alignItems: 'center', gap: 8,
                   fontSize: 13, color: C.text, cursor: 'pointer' }
        }, [
          h('input', {
            type: 'checkbox',
            checked: !!val.Presenza_CHP,
            onChange: e => update('Presenza_CHP', e.target.checked)
          }),
          'Presenza CHP (cogenerazione)'
        ]),
        h('label', {
          key: 'ets',
          style: { display: 'flex', alignItems: 'center', gap: 8,
                   fontSize: 13, color: C.text, cursor: 'pointer' }
        }, [
          h('input', {
            type: 'checkbox',
            checked: !!val.Regime_ETS,
            onChange: e => update('Regime_ETS', e.target.checked)
          }),
          'Regime ETS'
        ])
      ]),
      h(Field, { key: 'np', label: 'Note produzione' },
        h('textarea', {
          rows: 2,
          value: val.Note_Produzione || '',
          onChange: e => update('Note_Produzione', e.target.value),
          placeholder: 'Es. capacità produttiva, linee specifiche…',
          style: {
            width: '100%', padding: 8, border: `1px solid ${C.border}`,
            borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical'
          }
        })
      ),
      errors.length > 0 && h('div', {
        key: 'e',
        style: {
          background: C.criticalPale, color: C.critical, padding: 8,
          borderRadius: 8, fontSize: 12, marginTop: 12
        }
      }, errors.join(' · ')),
      h('div', {
        key: 'b',
        style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }
      }, [
        h(G.ui.Button, { key: 'c', kind: 'ghost', onClick: closeWithConfirm }, 'Annulla'),
        h(G.ui.Button, {
          key: 's', kind: 'primary',
          disabled: errors.length > 0,
          onClick: () => {
            const payload = {
              Codice_Sito: val.Codice_Sito,
              Nome_Sito: val.Nome_Sito,
              Tipologia: val.Tipologia || null,
              Presenza_CHP: !!val.Presenza_CHP,
              Regime_ETS: !!val.Regime_ETS,
              Note_Produzione: val.Note_Produzione || null
            };
            onSave(payload);
          }
        }, 'Salva')
      ])
    ]));
  }

  // ────────────────────────────────────────────────────────────────────
  //  TARGETS TAB — modifica i target di Piano (baseline + 2034 + 2050)
  //  I valori vengono salvati su app_meta.targets (JSON) e sovrascrivono
  //  G.TARGETS al prossimo loadAll(). Solo admin (RLS app_meta).
  //  Campi: scope, baselineYear, baseline_tco2e, baseline_intensity,
  //         shortTermYear, shortTerm_tco2e, shortTerm_intensity,
  //         longTermYear, longTerm_tco2e, longTerm_intensity, alignment.
  // ────────────────────────────────────────────────────────────────────
  function TargetsTab ({ data: _data, role, reload }) {
    const isAdmin = role === 'admin';
    // Inizializza dal G.TARGETS attuale (già mergiato con app_meta.targets
    // dal loadAll). Così l'utente vede i valori live, non quelli costanti.
    const [val, setVal] = useState(() => Object.assign({}, G.TARGETS));
    const [busy, setBusy] = useState(false);

    const upd = (k, v) => setVal(p => Object.assign({}, p, { [k]: v }));
    const num = (s) => {
      if (s === '' || s == null) return null;
      const n = +String(s).replace(',', '.');
      return isFinite(n) ? n : null;
    };

    const errors = [];
    if (!val.scope) errors.push('Scope mancante');
    if (!Number.isInteger(+val.baselineYear) || +val.baselineYear < 2000)
      errors.push('Baseline year non valido');
    if (num(val.baseline_tco2e) == null || num(val.baseline_tco2e) < 0)
      errors.push('Baseline tCO₂e non valido');
    if (num(val.baseline_intensity) == null || num(val.baseline_intensity) < 0)
      errors.push('Baseline intensità non valida');
    if (+val.shortTermYear <= +val.baselineYear) errors.push('shortTermYear deve essere > baselineYear');
    if (+val.longTermYear  <= +val.shortTermYear) errors.push('longTermYear deve essere > shortTermYear');

    async function save () {
      // Coerce ai tipi attesi prima di salvare. Campi S3 restano null
      // se vuoti (target non ancora definito ufficialmente).
      const payload = {
        scope:               String(val.scope),
        baselineYear:        +val.baselineYear,
        baseline_tco2e:      num(val.baseline_tco2e),
        baseline_intensity:  num(val.baseline_intensity),
        shortTermYear:       +val.shortTermYear,
        shortTerm_tco2e:     num(val.shortTerm_tco2e),
        shortTerm_intensity: num(val.shortTerm_intensity),
        longTermYear:        +val.longTermYear,
        longTerm_tco2e:      num(val.longTerm_tco2e),
        longTerm_intensity:  num(val.longTerm_intensity),
        s3_baseline_tco2e:   num(val.s3_baseline_tco2e),
        s3_shortTerm_tco2e:  num(val.s3_shortTerm_tco2e),
        s3_longTerm_tco2e:   num(val.s3_longTerm_tco2e),
        alignment:           String(val.alignment || '')
      };
      setBusy(true);
      try {
        await G.db.saveTargets(payload);
        // Aggiorna il global runtime così il cambio è visibile subito,
        // senza attendere il prossimo full reload (loadAll lo rifarà
        // comunque al refresh).
        Object.assign(G.TARGETS, payload);
        G.ui.pushToast('Target salvati', 'success');
        reload && reload();
      } catch (e) {
        G.ui.pushToast(e.message || 'Errore di salvataggio', 'error');
      } finally {
        setBusy(false);
      }
    }

    function reset () {
      setVal(Object.assign({}, G.TARGETS));
    }

    if (!isAdmin) {
      return h(G.ui.Card, null, [
        h('h2', { key: 'h', style: { fontSize: 18, fontWeight: 700, marginBottom: 8 } },
          'Target di Piano'),
        h('p', { key: 'p', style: { fontSize: 13, color: C.textMid, lineHeight: 1.55 } },
          'Solo admin può modificare i target. Valori correnti:'),
        h(TargetsView, { key: 'v', t: val })
      ]);
    }

    const labelStyle = {
      display: 'block', fontSize: 11, fontWeight: 600, color: C.textMid,
      textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4
    };
    const groupStyle = {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 12, marginBottom: 16
    };

    return h('div', null, [
      h('div', { key: 'i', style: {
        background: '#FFF7E6', border: '1px solid #F0C97A',
        padding: '10px 14px', borderRadius: 8, fontSize: 12,
        color: '#7A5510', marginBottom: 16, lineHeight: 1.5
      } }, [
        h('strong', null, 'Attenzione: '),
        'questi valori sono il riferimento per tutti i KPI di trend (delta % vs baseline, on-track/off-track, traiettoria target). Modifica solo se la baseline o i target di Piano sono ufficialmente cambiati. Operazione tracciata in audit_log.'
      ]),

      h('h3', { key: 'h1', style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 } },
        'Perimetro'),
      h('div', { key: 'sc', style: { marginBottom: 16 } }, [
        h('label', { style: labelStyle }, 'Scope target'),
        h(G.ui.Input, {
          value: val.scope || '',
          onChange: e => upd('scope', e.target.value),
          style: { width: '100%', maxWidth: 480 }
        })
      ]),

      h('h3', { key: 'h2', style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 } },
        'Anno baseline'),
      h('div', { key: 'b', style: groupStyle }, [
        h('div', null, [
          h('label', { style: labelStyle }, 'Anno'),
          h(G.ui.Input, { type: 'number',
            value: val.baselineYear || '',
            onChange: e => upd('baselineYear', e.target.value), style: { width: '100%' } })
        ]),
        h('div', null, [
          h('label', { style: labelStyle }, 'Emissioni S1+S2 MB (tCO₂e)'),
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.baseline_tco2e ?? '',
            onChange: e => upd('baseline_tco2e', e.target.value), style: { width: '100%' } })
        ]),
        h('div', null, [
          h('label', { style: labelStyle }, 'Intensità (kgCO₂e/m²)'),
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.baseline_intensity ?? '',
            onChange: e => upd('baseline_intensity', e.target.value), style: { width: '100%' } })
        ])
      ]),

      h('h3', { key: 'h3', style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 } },
        'Target a breve termine (near-term)'),
      h('div', { key: 's', style: groupStyle }, [
        h('div', null, [
          h('label', { style: labelStyle }, 'Anno'),
          h(G.ui.Input, { type: 'number',
            value: val.shortTermYear || '',
            onChange: e => upd('shortTermYear', e.target.value), style: { width: '100%' } })
        ]),
        h('div', null, [
          h('label', { style: labelStyle }, 'Emissioni target (tCO₂e)'),
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.shortTerm_tco2e ?? '',
            onChange: e => upd('shortTerm_tco2e', e.target.value), style: { width: '100%' } })
        ]),
        h('div', null, [
          h('label', { style: labelStyle }, 'Intensità target (kgCO₂e/m²)'),
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.shortTerm_intensity ?? '',
            onChange: e => upd('shortTerm_intensity', e.target.value), style: { width: '100%' } })
        ])
      ]),

      h('h3', { key: 'h4', style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 } },
        'Target a lungo termine (Vision)'),
      h('div', { key: 'l', style: groupStyle }, [
        h('div', null, [
          h('label', { style: labelStyle }, 'Anno'),
          h(G.ui.Input, { type: 'number',
            value: val.longTermYear || '',
            onChange: e => upd('longTermYear', e.target.value), style: { width: '100%' } })
        ]),
        h('div', null, [
          h('label', { style: labelStyle }, 'Emissioni target (tCO₂e)'),
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.longTerm_tco2e ?? '',
            onChange: e => upd('longTerm_tco2e', e.target.value), style: { width: '100%' } })
        ]),
        h('div', null, [
          h('label', { style: labelStyle }, 'Intensità target (kgCO₂e/m²)'),
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.longTerm_intensity ?? '',
            onChange: e => upd('longTerm_intensity', e.target.value), style: { width: '100%' } })
        ])
      ]),

      h('h3', { key: 'hs3', style: {
        fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4
      } }, 'Scope 3 (opzionale)'),
      h('p', { key: 'hs3p', style: {
        fontSize: 11, color: C.textLow, lineHeight: 1.5, marginBottom: 8,
        marginTop: 0, fontStyle: 'italic'
      } }, 'Target Scope 3 in tCO₂e (assoluti). Anni baseline/near-term/long-term coincidono con quelli del Piano S1+S2 sopra. Lasciare vuoti finché non c\'è un commitment formale (SBTi richiede target S3 separati: 67% delle emissioni Scope 3 coperte da target near-term).'),
      h('div', { key: 's3', style: groupStyle }, [
        h('div', null, [
          h('label', { style: labelStyle }, `Baseline ${val.baselineYear || ''} (tCO₂e)`),
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.s3_baseline_tco2e ?? '',
            onChange: e => upd('s3_baseline_tco2e', e.target.value),
            placeholder: 'non definito',
            style: { width: '100%' } })
        ]),
        h('div', null, [
          h('label', { style: labelStyle }, `Target ${val.shortTermYear || ''} (tCO₂e)`),
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.s3_shortTerm_tco2e ?? '',
            onChange: e => upd('s3_shortTerm_tco2e', e.target.value),
            placeholder: 'non definito',
            style: { width: '100%' } })
        ]),
        h('div', null, [
          h('label', { style: labelStyle }, `Target ${val.longTermYear || ''} (tCO₂e)`),
          h(G.ui.Input, { type: 'number', step: 'any',
            value: val.s3_longTerm_tco2e ?? '',
            onChange: e => upd('s3_longTerm_tco2e', e.target.value),
            placeholder: 'non definito',
            style: { width: '100%' } })
        ])
      ]),

      h('h3', { key: 'h5', style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 } },
        'Note di allineamento'),
      h('div', { key: 'al', style: { marginBottom: 16 } }, [
        h('label', { style: labelStyle }, 'Riferimento (es. "SBTi 1,5°C · European Climate Law · GHG Protocol")'),
        h(G.ui.Input, {
          value: val.alignment || '',
          onChange: e => upd('alignment', e.target.value),
          style: { width: '100%' }
        })
      ]),

      errors.length > 0 && h('div', {
        key: 'e',
        style: {
          background: C.criticalPale, color: C.critical, padding: 8,
          borderRadius: 8, fontSize: 12, marginBottom: 12
        }
      }, errors.join(' · ')),

      h('div', { key: 'a', style: { display: 'flex', gap: 8 } }, [
        h(G.ui.Button, { key: 'r', kind: 'ghost', onClick: reset }, 'Annulla modifiche'),
        h(G.ui.Button, {
          key: 's', kind: 'primary',
          disabled: busy || errors.length > 0,
          onClick: save
        }, busy ? 'Salvataggio…' : 'Salva target')
      ])
    ]);
  }

  // Vista read-only dei target (per editor/auditor/viewer)
  function TargetsView ({ t }) {
    const row = (label, value) => h('div', {
      style: { display: 'flex', justifyContent: 'space-between',
               padding: '6px 0', borderBottom: `1px solid ${C.borderSoft}`, fontSize: 13 }
    }, [
      h('span', { style: { color: C.textMid } }, label),
      h('strong', null, value == null || value === '' ? '—' : String(value))
    ]);
    const hasS3 = t.s3_baseline_tco2e != null
               || t.s3_shortTerm_tco2e != null
               || t.s3_longTerm_tco2e != null;
    return h('div', { style: { marginTop: 12 } }, [
      row('Scope target', t.scope),
      row(`Baseline (${t.baselineYear})`, `${t.baseline_tco2e} tCO₂e · ${t.baseline_intensity} kgCO₂e/m²`),
      row(`Target ${t.shortTermYear}`, `${t.shortTerm_tco2e} tCO₂e · ${t.shortTerm_intensity} kgCO₂e/m²`),
      row(`Target ${t.longTermYear}`, `${t.longTerm_tco2e} tCO₂e · ${t.longTerm_intensity} kgCO₂e/m²`),
      hasS3 && row(`S3 Baseline (${t.baselineYear})`, t.s3_baseline_tco2e != null ? `${t.s3_baseline_tco2e} tCO₂e` : '—'),
      hasS3 && row(`S3 Target ${t.shortTermYear}`,    t.s3_shortTerm_tco2e != null ? `${t.s3_shortTerm_tco2e} tCO₂e` : '—'),
      hasS3 && row(`S3 Target ${t.longTermYear}`,     t.s3_longTerm_tco2e != null ? `${t.s3_longTerm_tco2e} tCO₂e` : '—'),
      row('Allineamento', t.alignment)
    ]);
  }

  // ────────────────────────────────────────────────────────────────────
  //  PRODUZIONE TAB
  // ────────────────────────────────────────────────────────────────────
  function ProduzioneTab ({ data, canEdit, canDelete, reload, role }) {
    // editing.row = riga in modifica; editing.origKey = PK originale
    // (null se riga nuova). Necessario perché produzione ha PK composita
    // (codice_sito, anno) — se l'utente cambia anno o sito, dobbiamo
    // DELETE la vecchia riga prima dell'UPSERT, altrimenti resta orfana
    // creando "anni doppi" nella tabella.
    const [editing, setEditing] = useState(null);
    const rows = data.produzione || [];
    const sites = (data.anagrafiche || []).map(a => a.Codice_Sito || a.codice_sito);
    const lockedYears = getLockedYears(data);

    const openNew = () => setEditing({
      row: {
        Codice_Sito: sites[0] || '', Anno: new Date().getFullYear(),
        Produzione_kg: '', Produzione_m2: '', Note: ''
      },
      origKey: null
    });
    const openEdit = (r) => setEditing({
      row: { ...r },
      origKey: {
        codice_sito: r.Codice_Sito || r.codice_sito,
        anno: +(r.Anno || r.anno)
      }
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
        onEdit:   openEdit,
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
        row: editing.row, sites,
        // Filtra dalla list dei "existing" la riga che stiamo modificando
        // (per evitare il falso positivo nel dup-check): identifichiamo
        // la riga per la sua PK originale, perché non c'è id surrogato.
        existing: rows.filter(r => {
          const ok = editing.origKey;
          if (!ok) return true;
          return (r.Codice_Sito || r.codice_sito) !== ok.codice_sito
              || +(r.Anno || r.anno) !== ok.anno;
        }),
        lockedYears, role,
        onClose: () => setEditing(null),
        onSave: async (payload) => {
          try {
            await G.db.saveProduzione(payload, editing.origKey);
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
        key: 'btn',
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

  G.DM = G.DM || {};
  Object.assign(G.DM, {
    AnagraficheTab, AnagraficaEditModal,
    ProduzioneTab, EditModal,
    TargetsTab, TargetsView,
    FETab, FEEditModal
  });
})(typeof window !== 'undefined' ? window : globalThis);
