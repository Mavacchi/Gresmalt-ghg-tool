/* GHG Tool — DataManager.jsx (admin/editor)
 *
 * Shell della Gestione Dati: tab S1/S2/S3/FE/Produzione/Anagrafiche/Targets
 * + onboarding card + import/export pulsantiera.
 *
 * Splittato in PR di refactoring: i sub-componenti (tab + modal di edit
 * + helper) vivono in:
 *   - DataManager.shared.jsx     OnboardingCard, ImportPreviewModal,
 *                                Field, GenericTab, helper logici,
 *                                costanti modal/style, exportCSV
 *   - DataManager.tabs.jsx       AnagraficheTab + ProduzioneTab + TargetsTab
 *                                + FETab + relativi modal
 *   - DataManager.scopeModals.jsx S1/S2/S3 EditModal
 *
 * Tutti caricati PRIMA di questo file in build.mjs:SRC_FILES, espongono
 * le proprie API su window.GHG.DM.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;

  // Sub-componenti dai moduli DataManager.shared/tabs (caricati prima)
  const {
    OnboardingCard, ImportPreviewModal, GenericTab,
    AnagraficheTab, ProduzioneTab, TargetsTab
  } = G.DM;

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
        // Passa data per FE pool durante l'enrichment (auto-calc em).
        const s = await G.io.commitImport(importPreview, data);
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
        h(G.ui.Button, {
          key: 'bk', kind: 'ghost',
          // Backup ZIP completo: data.xlsx + metadata.json (materialità +
          // app_meta) + README.txt. Disaster-recovery utente offline.
          onClick: async () => {
            try {
              G.ui.pushToast('Generazione backup ZIP…', 'info');
              const r = await G.io.exportBackup(data);
              G.ui.pushToast(`Backup ${r.filename} (${(r.bytes/1024).toFixed(0)} KB)`, 'success');
            } catch (e) {
              G.ui.pushToast(e.message || 'Backup fallito', 'error');
            }
          }
        }, '⤓ Backup completo (ZIP)'),
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
        role: 'tablist',
        'aria-label': 'Sezioni Gestione Dati',
        style: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }
      }, ['anagrafiche','s1','s2','s3','fe','produzione','targets'].map(t => h('button', {
        key: t, type: 'button',
        role: 'tab',
        'aria-selected': tab === t,
        'aria-controls': `dm-panel-${t}`,
        id: `dm-tab-${t}`,
        // Niente roving tabindex (richiederebbe arrow-key handler):
        // i <button> nel naturale tab order danno Tab→Enter funzionante.
        onClick: () => setTab(t),
        style: {
          padding: '10px 16px', border: 'none', background: 'transparent',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
          color: tab === t ? C.text : C.textMid,
          borderBottom: `2px solid ${tab === t ? C.brand : 'transparent'}`,
          textTransform: 'uppercase', letterSpacing: .5
        }
      }, t === 'produzione'  ? 'Produzione'
       : t === 'anagrafiche' ? 'Siti'
       : t === 'targets'     ? 'Target'
       : t.toUpperCase()))),
      // Wrapper tabpanel per la scheda attiva (a11y: lega tab a contenuto)
      h('div', {
        key: 'panel',
        role: 'tabpanel',
        id: `dm-panel-${tab}`,
        'aria-labelledby': `dm-tab-${tab}`
      },
      tab === 'anagrafiche'
        ? h(AnagraficheTab, { data, canEdit, canDelete, reload, role })
        : tab === 'produzione'
        ? h(ProduzioneTab, { data, canEdit, canDelete, reload, role })
        : tab === 'targets'
        ? h(TargetsTab, { data, role, reload })
        : h(GenericTab, { table: tab, data, canEdit, canDelete, reload, role })
      )
    ]);
  }

  G.sections = G.sections || {};
  G.sections.DataManager = DataManager;
})(typeof window !== 'undefined' ? window : globalThis);
