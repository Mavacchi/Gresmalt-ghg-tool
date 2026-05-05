/* GHG Tool — DataManager.scopeModals.jsx
 *
 * Modal di edit per le righe Scope 1, 2, 3. Ognuno ha logica
 * specifica (FE auto-fill, lookup voce, calcolo Em derivato).
 *
 * Estratto da DataManager.jsx in PR di splitting.
 *
 * Espone su window.GHG.DM = { S1EditModal, S2EditModal, S3EditModal }.
 *
 * Consuma da G.DM: Field, fmtNum, makeConfirmedClose, isYearLocked,
 *                  LockBanner, feFillBtnStyle.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;

  // Helper esposti da DataManager.shared.jsx (caricato prima)
  const {
    Field, fmtNum, makeConfirmedClose, isYearLocked,
    LockBanner, feFillBtnStyle,
    modalScrim, modalCard, titleStyle, modalGrid,
    calcPanel, calcLabel, calcRow,
    calcResult, errBox, warnBox, btnRow,
    QD_OPTS, SD_OPTS
  } = G.DM;

  function S1EditModal ({ row, sites, fe, onClose, onSave, lockedYears = [], role }) {
    const [val, setVal] = useState(row);
    const update = (k, v) => setVal(p => ({ ...p, [k]: v }));
    const locked = isYearLocked(val.Anno, lockedYears, role);
    const closeWithConfirm = makeConfirmedClose(row, val, onClose);

    const lookup = G.calc.lookupFE('s1', val, fe);
    const feFromCatalog = lookup.fe ? +(lookup.fe.Valore || lookup.fe.valore || 0) : null;
    const feUnita  = lookup.fe ? (lookup.fe.Unità || lookup.fe.unita || '') : '';
    const feAnno   = lookup.fe ? +(lookup.fe.Anno_Validità || lookup.fe.anno_validita || 0) : null;
    // FE applicato: se l'utente ha scritto un valore custom (val.FE_Valore),
    // usa quello; altrimenti il valore di catalogo. Stessa logica di
    // io.enrichForUpsert (formula canonica em = Q × FE / 1000).
    const feValore = val.FE_Valore != null && val.FE_Valore !== ''
      ? +val.FE_Valore : feFromCatalog;
    const isOverride = val.FE_Valore != null && val.FE_Valore !== ''
      && feFromCatalog != null && +val.FE_Valore !== feFromCatalog;
    const qty      = G.calc.num(val.Quantità);
    const em       = feValore != null && qty > 0 ? G.calc.emS1(qty, feValore) : null;

    const v = G.calc.validateRow('s1', val);
    const errors = [...v.errors];
    if (val.Combustibile && lookup.err && !isOverride) errors.push(lookup.err);
    const warnings = [...v.warnings];
    if (lookup.warn && !isOverride) warnings.push(lookup.warn);
    if (isOverride) warnings.push(`FE custom (${fmtNum(+val.FE_Valore, 6)}) ≠ catalogo (${fmtNum(feFromCatalog, 6)}) — verificare la giustificazione.`);
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

    function fillFEFromCatalog () {
      if (feFromCatalog == null) {
        G.ui.pushToast('FE non trovato per Combustibile + Anno', 'warning');
        return;
      }
      setVal(p => ({ ...p, FE_Valore: feFromCatalog }));
      G.ui.pushToast(`FE compilato da catalogo (${feFromCatalog} ${feUnita})`, 'success');
    }
    const canFillFE = !!(val.Combustibile && val.Anno);

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
              // Cambiando combustibile, resetta FE_Valore così il lookup
              // fresco per Anno+Combustibile prende il sopravvento (evita
              // override "appiccicati" da combustibili diversi).
              const next = { ...val, Combustibile: cb, FE_Valore: null };
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
        h(Field, { key: 'fv', label: `FE Valore${feUnita ? ' (' + feUnita + ')' : ''}` },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'stretch' } }, [
            h(G.ui.Input, { key: 'i', type: 'number', step: 'any',
              value: feValore == null ? '' : feValore,
              onChange: e => update('FE_Valore', e.target.value === '' ? null : +e.target.value),
              style: { flex: 1 } }),
            h('button', {
              key: 'b', type: 'button',
              disabled: !canFillFE,
              onClick: fillFEFromCatalog,
              title: canFillFE
                ? 'Compila FE Valore dal catalogo per Combustibile + Anno'
                : 'Imposta Anno e Combustibile',
              style: feFillBtnStyle(canFillFE)
            }, '⤓ catalogo')
          ])),
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
          h('span', null, 'Fattore emissivo' +
            (isOverride ? ' · custom'
              : feAnno && feAnno !== +val.Anno ? ` (anno ${feAnno})` : '')),
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
  function S2EditModal ({ row, sites, fe, onClose, onSave, lockedYears = [], role }) {
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

    // Auto-compila FE Location e FE Market dal catalogo FE in base a
    // Voce_S2 + Anno. Logica:
    //   FE Location → sempre dal mix nazionale (codice_voce 'EE_LOCATION')
    //   FE Market → dipende dalla voce:
    //     EE_Acquistata_GO → 'EE_GO' (= 0 con Garanzie d'Origine)
    //     EE_Acquistata    → 'EE_RESIDUAL' (residual mix Italia)
    //     vapore/calore/freddo → niente auto-fill (mercato termico).
    function pickFE (codice, anno) {
      const list = (fe || []).filter(f =>
        (f.Codice_Voce || f.codice_voce) === codice);
      if (!list.length) return null;
      const exact = list.find(f => +(f.Anno_Validità || f.anno_validita) === +anno);
      if (exact) return exact;
      // Fallback al più recente disponibile per quel codice
      return list.slice().sort((a, b) =>
        (b.Anno_Validità || b.anno_validita || 0) -
        (a.Anno_Validità || a.anno_validita || 0))[0];
    }
    function autoFillFE () {
      const yr = +val.Anno;
      if (!yr) { G.ui.pushToast('Imposta prima l\'Anno', 'warning'); return; }
      if (!val.Voce_S2) { G.ui.pushToast('Seleziona prima la Voce S2', 'warning'); return; }
      const next = { ...val };
      const loc = pickFE('EE_LOCATION', yr);
      if (loc) next.FE_Location = +(loc.Valore || loc.valore);
      let mktCode = null;
      if (val.Voce_S2 === 'EE_Acquistata_GO') mktCode = 'EE_GO';
      else if (val.Voce_S2 === 'EE_Acquistata') mktCode = 'EE_RESIDUAL';
      if (mktCode) {
        const mkt = pickFE(mktCode, yr);
        if (mkt) next.FE_Market = +(mkt.Valore || mkt.valore);
      }
      setVal(next);
      G.ui.pushToast(loc ? `Compilati FE da catalogo (anno ${yr})` : 'Catalogo FE non disponibile', loc ? 'success' : 'warning');
    }
    const canAutoFill = (fe || []).length > 0
      && val.Anno && (val.Voce_S2 === 'EE_Acquistata' || val.Voce_S2 === 'EE_Acquistata_GO');

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
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'stretch' } }, [
            h(G.ui.Input, { key: 'i', type: 'number', step: 'any',
              value: val.FE_Location == null ? '' : val.FE_Location,
              onChange: e => update('FE_Location', e.target.value === '' ? '' : +e.target.value),
              style: { flex: 1 } }),
            h('button', {
              key: 'b', type: 'button',
              disabled: !canAutoFill,
              onClick: autoFillFE,
              title: canAutoFill
                ? 'Compila FE Location e FE Market dal catalogo per Voce S2 + Anno'
                : 'Imposta Anno e Voce S2 (EE_Acquistata o EE_Acquistata_GO)',
              style: feFillBtnStyle(canAutoFill)
            }, '⤓ catalogo')
          ])),
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
    const feFromCatalog = lookup.fe ? +(lookup.fe.Valore || lookup.fe.valore || 0) : null;
    const feUnita  = lookup.fe ? (lookup.fe.Unità || lookup.fe.unita || '') : '';
    const feAnno   = lookup.fe ? +(lookup.fe.Anno_Validità || lookup.fe.anno_validita || 0) : null;
    // Stessa logica di S1: override custom da val.FE_Valore se presente,
    // altrimenti valore di catalogo.
    const feValore = val.FE_Valore != null && val.FE_Valore !== ''
      ? +val.FE_Valore : feFromCatalog;
    const isOverride = val.FE_Valore != null && val.FE_Valore !== ''
      && feFromCatalog != null && +val.FE_Valore !== feFromCatalog;
    const qty      = G.calc.num(val.Quantità);
    const em       = feValore != null && qty > 0 ? G.calc.emS3(qty, feValore) : null;

    const v = G.calc.validateRow('s3', val);
    const errors = [...v.errors];
    if (val.Codice_FE && lookup.err && !isOverride) errors.push(lookup.err);
    const warnings = [...v.warnings];
    if (lookup.warn && !isOverride) warnings.push(lookup.warn);
    if (isOverride) warnings.push(`FE custom (${fmtNum(+val.FE_Valore, 6)}) ≠ catalogo (${fmtNum(feFromCatalog, 6)}) — verificare la giustificazione.`);

    // Codici FE disponibili (FE_ID o Codice_Voce — entrambi accettati dal lookup)
    const feOpts = Array.from(new Set(
      (fe || []).flatMap(f => [
        f.FE_ID || f.fe_id,
        f.Codice_Voce || f.codice_voce
      ]).filter(Boolean)
    )).sort();

    const catLabel = (G.CAT_NAMES && G.CAT_NAMES[+val.Categoria_S3]) || '';

    function fillFEFromCatalog () {
      if (feFromCatalog == null) {
        G.ui.pushToast('FE non trovato per Codice_FE + Anno', 'warning');
        return;
      }
      setVal(p => ({ ...p, FE_Valore: feFromCatalog }));
      G.ui.pushToast(`FE compilato da catalogo (${feFromCatalog} ${feUnita})`, 'success');
    }
    const canFillFE = !!(val.Codice_FE && val.Anno);

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
              // Cambiando Codice_FE, resetta FE_Valore così il lookup
              // prende il sopravvento (no override "appiccicati").
              const next = { ...val, Codice_FE: cf, FE_Valore: null };
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
        h(Field, { key: 'fv', label: `FE Valore${feUnita ? ' (' + feUnita + ')' : ''}` },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'stretch' } }, [
            h(G.ui.Input, { key: 'i', type: 'number', step: 'any',
              value: feValore == null ? '' : feValore,
              onChange: e => update('FE_Valore', e.target.value === '' ? null : +e.target.value),
              style: { flex: 1 } }),
            h('button', {
              key: 'b', type: 'button',
              disabled: !canFillFE,
              onClick: fillFEFromCatalog,
              title: canFillFE
                ? 'Compila FE Valore dal catalogo per Codice FE + Anno'
                : 'Imposta Anno e Codice FE',
              style: feFillBtnStyle(canFillFE)
            }, '⤓ catalogo')
          ])),
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
          h('span', null, 'Fattore emissivo' +
            (isOverride ? ' · custom'
              : feAnno && feAnno !== +val.Anno ? ` (anno ${feAnno})` : '')),
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

  G.DM = G.DM || {};
  Object.assign(G.DM, { S1EditModal, S2EditModal, S3EditModal });
})(typeof window !== 'undefined' ? window : globalThis);
