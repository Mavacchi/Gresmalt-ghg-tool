/* GHG Tool — AuditTrail.jsx (admin/auditor)
 *
 * Tabella audit_log con filtri tabella/utente/range, badge operazione,
 * diff sintetico e modal JSON old/new. Indicatore catena hash.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useEffect, useMemo } = root.React;
  const C = G.COLORS;

  const OP_COLOR = { INSERT: C.success, UPDATE: C.info, DELETE: C.critical };

  // Paginazione: prima fetch carica PAGE_SIZE righe più recenti.
  // "Carica altri" ne aggiunge altrettante in coda (ordine desc su id).
  // Su dataset > 10k righe il vecchio limite hard 2000 nascondeva
  // silenziosamente eventi vecchi senza alcun feedback utente.
  const PAGE_SIZE = 500;

  function AuditTrail () {
    const [rows, setRows]   = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [filt, setFilt]   = useState({ table: '', user: '', range: 'all', op: '' });
    const [open, setOpen]   = useState(null);
    const [chainOk, setChainOk] = useState(null);

    async function fetchPage (beforeId) {
      const sb = G.db.getClient();
      let q = sb.from('audit_log').select('*')
        .order('id', { ascending: false }).limit(PAGE_SIZE);
      if (beforeId != null) q = q.lt('id', beforeId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }

    useEffect(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          const data = await fetchPage(null);
          if (cancelled) return;
          setRows(data);
          setHasMore(data.length === PAGE_SIZE);
        } catch (e) {
          G.ui.pushToast(e.message || 'Errore audit', 'error');
        } finally {
          if (!cancelled) setLoading(false);
        }
        try {
          const broken = await G.db.verifyAuditChain();
          if (!cancelled) setChainOk(!Array.isArray(broken) || broken.length === 0);
        } catch (_) {
          if (!cancelled) setChainOk(null);
        }
      })();
      return () => { cancelled = true; };
    }, []);

    async function loadMore () {
      if (!rows.length || loadingMore) return;
      setLoadingMore(true);
      try {
        const lastId = rows[rows.length - 1].id;
        const next = await fetchPage(lastId);
        setRows(prev => prev.concat(next));
        setHasMore(next.length === PAGE_SIZE);
      } catch (e) {
        G.ui.pushToast(e.message || 'Errore caricamento pagina', 'error');
      } finally {
        setLoadingMore(false);
      }
    }

    const filtered = useMemo(() => {
      let r = rows;
      if (filt.table) r = r.filter(x => x.table_name === filt.table);
      if (filt.user)  r = r.filter(x => (x.user_email || '').includes(filt.user));
      if (filt.op)    r = r.filter(x => x.operation === filt.op);
      if (filt.range !== 'all') {
        const ms = filt.range === '24h' ? 86400000 : 7*86400000;
        r = r.filter(x => new Date(x.ts).getTime() > Date.now() - ms);
      }
      return r;
    }, [rows, filt]);

    return h('div', null, [
      h('div', {
        key: 'h',
        style: { display: 'flex', justifyContent: 'space-between', marginBottom: 16 }
      }, [
        h('h1', { style: { fontSize: 22, fontWeight: 700 } }, 'Audit Trail'),
        h('div', {
          style: {
            fontSize: 12, color: chainOk ? C.success : chainOk === false ? C.critical : C.textMid,
            fontWeight: 600
          }
        }, chainOk == null ? '— catena hash non verificata —'
          : chainOk ? '✓ catena hash integra' : '✗ catena hash rotta')
      ]),
      h('div', {
        key: 'f',
        style: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }
      }, [
        h(G.ui.Select, {
          key: 't', value: filt.table,
          onChange: e => setFilt({ ...filt, table: e.target.value }),
          options: [
            { value: '', label: 'Tutte le tabelle' },
            ...['anagrafiche','produzione','fe','s1','s2','s3','s3_materiality','app_meta']
              .map(t => ({ value: t, label: t }))
          ]
        }),
        h(G.ui.Input, {
          key: 'u', placeholder: 'Filtra utente…', value: filt.user,
          onChange: e => setFilt({ ...filt, user: e.target.value })
        }),
        h(G.ui.Select, {
          key: 'op', value: filt.op,
          onChange: e => setFilt({ ...filt, op: e.target.value }),
          options: [
            { value: '',       label: 'Tutte le operazioni' },
            { value: 'INSERT', label: 'INSERT' },
            { value: 'UPDATE', label: 'UPDATE' },
            { value: 'DELETE', label: 'DELETE' }
          ]
        }),
        ...['24h','week','all'].map(r => h('button', {
          key: r, type: 'button',
          'aria-pressed': filt.range === r,
          onClick: () => setFilt({ ...filt, range: r }),
          style: {
            ...G.ui.btnStyle({ kind: filt.range === r ? 'primary' : 'ghost' }),
            padding: '4px 12px'
          }
        }, r === '24h' ? 'Ultime 24h' : r === 'week' ? 'Settimana' : 'Tutto')),
        h(G.ui.Button, {
          key: 'csv', kind: 'ghost',
          onClick: () => exportAuditCSV(filtered)
        }, 'Esporta CSV'),
        h(G.ui.Button, {
          key: 'sig', kind: 'ghost',
          onClick: () => exportAuditSigned(filtered, chainOk)
        }, '⤓ Esporta firmato'),
        h('span', {
          key: 'c',
          style: { marginLeft: 'auto', fontSize: 12, color: C.textMid }
        }, `${filtered.length} eventi`)
      ]),
      loading
        ? h(G.ui.Skeleton, { height: 240 })
        : h(G.ui.DataTable, {
            columns: [
              { key: 'ts', label: 'Timestamp', render: v =>
                v ? new Date(v).toLocaleString('it-IT') : '—', nowrap: true },
              { key: 'user_email', label: 'Utente', nowrap: true },
              { key: 'table_name', label: 'Tabella', nowrap: true },
              { key: 'operation', label: 'Op', render: v =>
                h(G.ui.Pill, { color: OP_COLOR[v] || C.textMid }, v) },
              { key: 'row_id', label: 'Row', mono: true, nowrap: true },
              { key: '_diff', label: 'Diff sintetico',
                render: (_, r) => h('span', {
                  style: { fontSize: 11, color: C.textMid }
                }, summarizeDiff(r))
              }
            ],
            rows: filtered,
            onRowClick: r => setOpen(r)
          }),
      // Footer paginazione: bottone "Carica altri" se ci sono altre
      // pagine; altrimenti messaggio "tutti caricati" — evita
      // l'effetto "il bottone è scomparso, è un bug?".
      !loading && h('div', {
        key: 'lm',
        style: {
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          gap: 12, marginTop: 12, fontSize: 12, color: C.textMid
        }
      }, hasMore
          ? h(G.ui.Button, {
              kind: 'ghost',
              onClick: loadMore,
              disabled: loadingMore
            }, loadingMore
                ? 'Caricamento…'
                : `Carica altri ${PAGE_SIZE} eventi (${rows.length} caricati)`)
          : h('span', null, rows.length === 0
              ? 'Nessun evento di audit'
              : `✓ Tutti gli eventi caricati (${rows.length} totali)`)),
      open && h(DiffModal, { row: open, onClose: () => setOpen(null) })
    ]);
  }

  // Diff sintetico: prende fino a 2 campi cambiati e li formatta come
  // "Quantità: 1234 → 1456 (+18%)"
  function summarizeDiff (r) {
    if (r.operation === 'INSERT') return '+ riga creata';
    if (r.operation === 'DELETE') return '− riga eliminata';
    if (!r.old_data || !r.new_data) return '—';
    const changes = [];
    for (const k of Object.keys(r.new_data)) {
      if (k.startsWith('_')) continue;
      if (k === 'updated_at' || k === 'updated_by') continue;
      const ov = r.old_data[k], nv = r.new_data[k];
      if (ov == null && nv == null) continue;
      if (JSON.stringify(ov) === JSON.stringify(nv)) continue;
      if (typeof ov === 'number' && typeof nv === 'number' && ov !== 0) {
        const pct = ((nv - ov) / Math.abs(ov)) * 100;
        changes.push(`${k}: ${ov} → ${nv} (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`);
      } else {
        const sov = String(ov ?? '∅').slice(0, 12);
        const snv = String(nv ?? '∅').slice(0, 12);
        changes.push(`${k}: ${sov} → ${snv}`);
      }
      if (changes.length >= 2) break;
    }
    return changes.join(' · ') || 'invariato';
  }

  // Export firmato per audit esterno: bundle audit_log + metadata,
  // HMAC via Edge Function sign_snapshot. Auditor verifica
  // l'integrità del file e contemporaneamente la hash chain dei
  // singoli row tramite prev_hash → row_hash.
  async function exportAuditSigned (rows, chainOk) {
    try {
      const payload = {
        kind: 'audit_log_export',
        version: 1,
        generated_at: new Date().toISOString(),
        chain_status: chainOk == null ? 'unknown' : (chainOk ? 'integra' : 'rotta'),
        row_count: rows.length,
        first_id: rows.length ? rows[rows.length - 1].id : null,
        last_id:  rows.length ? rows[0].id : null,
        rows
      };
      const sb = G.db.getClient();
      const { data: signed, error } = await sb.functions
        .invoke('sign_snapshot', { body: payload });
      if (error) throw error;
      const file = { ...payload, _signature: signed };
      const blob = new Blob([JSON.stringify(file, null, 2)],
        { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = root.document.createElement('a');
      a.href = url;
      a.download = `ghg_audit_signed_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      G.ui.pushToast(`Audit firmato scaricato (${rows.length} eventi)`, 'success');
    } catch (e) {
      G.ui.pushToast(
        'Export firmato fallito: ' + (e.message || 'errore Edge Function'),
        'error'
      );
    }
  }

  function exportAuditCSV (rows) {
    const sanitize = (G.sanitize && G.sanitize.sanitizeForSpreadsheet) || (v => v);
    const lines = ['﻿' + ['Timestamp','Utente','Tabella','Op','Row','Old','New'].join(';')];
    rows.forEach(r => {
      const cell = v => {
        const s = String(v == null ? '' : v).replace(/"/g, '""');
        return /[;"\n]/.test(s) ? `"${sanitize(s)}"` : sanitize(s);
      };
      lines.push([
        cell(r.ts), cell(r.user_email), cell(r.table_name), cell(r.operation),
        cell(r.row_id),
        cell(JSON.stringify(r.old_data || {})),
        cell(JSON.stringify(r.new_data || {}))
      ].join(';'));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = root.document.createElement('a');
    a.href = url;
    a.download = `ghg_audit_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    G.ui.pushToast(`Esportati ${rows.length} eventi`, 'success');
  }

  function DiffModal ({ row, onClose }) {
    useEffect(() => {
      const onKey = e => { if (e.key === 'Escape') onClose(); };
      root.addEventListener('keydown', onKey);
      return () => root.removeEventListener('keydown', onKey);
    }, []);
    return h('div', {
      role: 'dialog', 'aria-modal': true,
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'grid', placeItems: 'center', zIndex: 9000
      }
    }, h(G.ui.Card, {
      style: {
        maxWidth: 720, width: '90%', maxHeight: '80vh', overflow: 'auto'
      }
    }, [
      h('div', {
        key: 'h',
        style: { display: 'flex', justifyContent: 'space-between', marginBottom: 12 }
      }, [
        h('h2', { style: { fontSize: 18, fontWeight: 700 } },
          `${row.operation} · ${row.table_name}`),
        h('button', {
          type: 'button',
          'aria-label': 'Chiudi',
          onClick: onClose,
          style: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 20 }
        }, h('span', { 'aria-hidden': 'true' }, '×'))
      ]),
      h('div', {
        key: 'g',
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }
      }, [
        h('div', { key: 'o' }, [
          h('h3', { style: { fontSize: 12, fontWeight: 600, color: C.textMid, marginBottom: 4 } }, 'Old'),
          h('pre', {
            style: {
              background: '#f6f6f6', padding: 12, borderRadius: 8,
              fontSize: 11, fontFamily: 'ui-monospace,monospace', overflow: 'auto'
            }
          }, JSON.stringify(row.old_data, null, 2) || 'null')
        ]),
        h('div', { key: 'n' }, [
          h('h3', { style: { fontSize: 12, fontWeight: 600, color: C.textMid, marginBottom: 4 } }, 'New'),
          h('pre', {
            style: {
              background: '#f6f6f6', padding: 12, borderRadius: 8,
              fontSize: 11, fontFamily: 'ui-monospace,monospace', overflow: 'auto'
            }
          }, JSON.stringify(row.new_data, null, 2) || 'null')
        ])
      ])
    ]));
  }

  G.sections = G.sections || {};
  G.sections.AuditTrail = AuditTrail;
})(typeof window !== 'undefined' ? window : globalThis);
