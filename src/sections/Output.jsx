/* GHG Tool — Output.jsx
 *
 * Sezione "Download" della console interna: solo i 2 download del tool.
 *   1. Report GHG (PowerPoint) — accessibile a tutti i ruoli con
 *      visibilità sulla sezione (vedi NAV in App.jsx).
 *   2. Snapshot inventario firmato HMAC-SHA256 (admin only).
 *
 * Estratta dal vecchio Stub.jsx in PR di splitting; semplificata su
 * feedback utente: rimossi KPI strip, insight automatici e riepilogo
 * ESG testuale (informazioni già presenti in Dashboard, ScopeAnalysis,
 * SiteAnalysis e nel report PPT generato).
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState } = root.React;
  const C = G.COLORS;

  function Output ({ data, year }) {
    const role = root.__GHG_ROLE || 'viewer';

    // Lingua per il PPT export. Default dal localStorage 'ghg_lang'
    // (impostato dal selettore Public Dashboard); fallback IT.
    const [pptLang, setPptLang] = useState(() => {
      try {
        const v = root.localStorage.getItem('ghg_lang');
        return (v === 'en') ? 'en' : 'it';
      } catch (_) { return 'it'; }
    });

    async function downloadSnapshot () {
      const payload = {
        year, generated_at: new Date().toISOString(),
        schema_version: '1', anagrafiche: data.anagrafiche, produzione: data.produzione,
        fe: data.fe, s1: data.s1, s2: data.s2, s3: data.s3,
        s3_materiality: data.s3_materiality
      };
      // Tenta firma HMAC via Edge Function. Se fallisce (function non
      // deployata, CORS, network), fallback a snapshot NON firmato così
      // l'utente ha comunque un backup utilizzabile, con annotazione
      // esplicita dell'errore nel campo _signature_error.
      let signed = null, sigErr = null;
      try {
        const sb = G.db.getClient();
        const r = await sb.functions.invoke('sign_snapshot', { body: payload });
        if (r.error) throw r.error;
        signed = r.data;
      } catch (e) {
        sigErr = e && e.message ? e.message : String(e);
      }

      try {
        const file = signed
          ? Object.assign({}, payload, { _signature: signed })
          : Object.assign({}, payload, {
              _signature: null,
              _signature_error: sigErr || 'Edge Function non disponibile',
              _note: 'Snapshot NON firmato — verificare deploy della function sign_snapshot e secret SNAPSHOT_HMAC_KEY (vedi docs/RUNBOOK.md).'
            });
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = root.document.createElement('a');
        a.href = url;
        a.download = `snapshot${signed ? '' : '_unsigned'}_${year}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (signed) {
          G.ui.pushToast('Snapshot firmato scaricato', 'success');
        } else {
          G.ui.pushToast(`Snapshot scaricato senza firma · ${sigErr || 'Edge Function non disponibile'}`, 'warning');
        }
      } catch (e) {
        G.ui.pushToast('Snapshot fallito: ' + (e.message || 'errore'), 'error');
      }
    }

    return h('div', null, [
      h('h1', {
        key: 'h1',
        style: { fontSize: 22, fontWeight: 700, marginBottom: 16 }
      }, `Download · ${year}`),

      // ─── Report GHG (PPTX) ──────────────────────────────────
      h(G.ui.Card, { key: 'pp', style: { marginBottom: 16 } }, [
        h('h2', { key: 't', style: { fontSize: 16, fontWeight: 700, marginBottom: 8 } },
          'Report GHG'),
        h('p', {
          key: 'd',
          style: { fontSize: 13, color: C.textMid, marginBottom: 12, lineHeight: 1.55 }
        }, 'Genera la presentazione completa dell\'inventario GHG dell\'anno selezionato.'),
        // Selettore lingua report
        h('div', {
          key: 'lang',
          style: {
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '10px 14px', marginBottom: 12,
            background: C.borderSoft || '#F0F0F0', borderRadius: 8
          }
        }, [
          h('span', {
            key: 'l',
            style: { fontSize: 11, fontWeight: 700, color: C.textMid,
                     textTransform: 'uppercase', letterSpacing: .5 }
          }, 'Lingua report:'),
          h('div', {
            key: 'g', role: 'group', 'aria-label': 'Lingua del report PPT',
            style: { display: 'inline-flex', gap: 4,
                     padding: 3, background: '#E5E5E5', borderRadius: 8 }
          }, ['it', 'en'].map(L => h('button', {
            key: L, type: 'button',
            'aria-pressed': pptLang === L,
            onClick: () => setPptLang(L),
            style: {
              padding: '5px 16px', borderRadius: 6, border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: pptLang === L ? '#fff' : 'transparent',
              color:      pptLang === L ? C.text : C.textMid,
              boxShadow:  pptLang === L ? '0 1px 2px rgba(0,0,0,.08)' : 'none'
            }
          }, L === 'it' ? 'Italiano' : 'English')))
        ]),
        h('div', { key: 'btn', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(G.ui.Button, {
            key: 'pp', kind: 'primary',
            onClick: async () => {
              try {
                G.ui.pushToast('Generazione PPTX in corso…', 'info');
                await G.io.exportPPTX(data, year, { lang: pptLang });
                G.ui.pushToast('Presentazione scaricata', 'success');
              } catch (e) { G.ui.pushToast(e.message || 'Export PPTX fallito', 'error'); }
            }
          }, '⤓ Scarica PPTX')
        ])
      ]),

      // ─── Snapshot firmato (admin only) ──────────────────────
      G.can.delete(role) && h(G.ui.Card, { key: 'snap' }, [
        h('h2', { key: 't', style: { fontSize: 16, fontWeight: 700, marginBottom: 8 } },
          'Snapshot inventario firmato'),
        h('p', {
          key: 'd',
          style: { fontSize: 13, color: C.textMid, marginBottom: 12, lineHeight: 1.55 }
        }, 'Genera un file JSON di tutti i dati con firma HMAC-SHA256 ' +
           '(via Edge Function sign_snapshot). Utile per audit di terzi e ' +
           'recovery a freddo.'),
        h(G.ui.Button, {
          key: 'b', kind: 'primary', onClick: downloadSnapshot
        }, '⤓ Scarica snapshot firmato')
      ])
    ]);
  }

  G.sections = G.sections || {};
  Object.assign(G.sections, { Output });
})(typeof window !== 'undefined' ? window : globalThis);
