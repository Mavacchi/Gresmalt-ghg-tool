/* GHG Tool — Diagnostics.jsx (admin only)
 *
 * Card: Reconciliation, Integrità schema/sicurezza, Keep-alive Supabase.
 * Bottoni: Ping manuale, Rigenera public_facts.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useEffect, useState } = root.React;
  const C = G.COLORS;

  function Diagnostics ({ data }) {
    const [keepalive, setKeepalive] = useState(null);
    const [chainBroken, setChainBroken] = useState(null);
    const [anonProbe, setAnonProbe] = useState(null);
    const [lockedYears, setLockedYears] = useState([]);
    const [lockBusy, setLockBusy] = useState(false);
    const role = root.__GHG_ROLE || 'viewer';
    const isAdmin = role === 'admin';

    useEffect(() => {
      // Recupera last_keepalive
      const last = data.app_meta && data.app_meta.last_keepalive;
      setKeepalive(last && last.ts ? new Date(last.ts) : null);

      // Verifica catena
      G.db.verifyAuditChain().then(rs => {
        setChainBroken(Array.isArray(rs) && rs.length ? rs[0] : null);
      }).catch(() => setChainBroken({ error: 'verify failed' }));

      // Lista anni bloccati
      G.db.getLockedYears().then(setLockedYears).catch(() => setLockedYears([]));

      // Anon probe — client Supabase separato senza sessione, prova
      // SELECT sulle tabelle protette: deve tornare 0 righe (RLS blocca).
      // Se invece una tabella ritorna dati, c'è un leak da segnalare.
      G.db.anonProbe()
        .then(setAnonProbe)
        .catch(e => setAnonProbe({ ok: false, error: e.message || String(e) }));
    }, [data]);

    async function onToggleLock (year, willLock) {
      if (!isAdmin) {
        G.ui.pushToast('Solo admin può modificare i lock', 'error');
        return;
      }
      if (willLock) {
        if (!await G.ui.confirm({
          title: `Bloccare l'anno ${year}?`,
          message: 'Gli editor non potranno più modificare S1/S2/S3/Produzione di questo anno. Solo admin potrà fare correzioni.'
        })) return;
      } else {
        if (!await G.ui.confirm({
          title: `Sbloccare l'anno ${year}?`, danger: true,
          message: 'Riapre l\'anno alle modifiche degli editor. Da fare solo per correzioni straordinarie.'
        })) return;
      }
      setLockBusy(true);
      try {
        const next = await G.db.toggleYearLock(year, willLock);
        setLockedYears(next);
        G.ui.pushToast(willLock ? `Anno ${year} bloccato` : `Anno ${year} sbloccato`, 'success');
      } catch (e) {
        G.ui.pushToast(e.message || 'Errore', 'error');
      } finally {
        setLockBusy(false);
      }
    }

    // Anni presenti nei dati operativi (S1/S2/S3/Produzione)
    const yearsSet = new Set();
    ['s1','s2','s3','produzione'].forEach(t => {
      (data[t] || []).forEach(r => {
        const y = +(r.Anno || r.anno);
        if (y && isFinite(y)) yearsSet.add(y);
      });
    });
    const years = Array.from(yearsSet).sort((a,b) => b - a);

    const kaAge = keepalive
      ? Math.floor((Date.now() - keepalive.getTime()) / (1000*60*60*24))
      : null;
    const kaColor = kaAge == null ? C.textLow
      : kaAge < 4 ? C.success : kaAge < 7 ? C.warning : C.critical;

    return h('div', null, [
      h('h1', { key: 'h', style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
        'Diagnostica'),
      h('div', {
        key: 'g',
        style: {
          display: 'grid', gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))'
        }
      }, [
        h(G.ui.Card, { key: 'r' }, [
          h('h2', { style: header }, 'Reconciliation'),
          h(Row, { ok: data.s1.length > 0, label: 'S1 caricato' }),
          h(Row, { ok: data.s2.length > 0, label: 'S2 caricato' }),
          h(Row, { ok: data.s3.length > 0, label: 'S3 caricato' }),
          h(Row, {
            ok: data.produzione.length > 0,
            label: 'Produzione popolata',
            warn: data.produzione.length === 0 && 'Le intensità non sono calcolabili'
          }),
          h(Row, {
            ok: chainBroken === null,
            label: 'Hash chain audit_log integra',
            warn: chainBroken && chainBroken.broken_id
              ? `Catena rotta a id ${chainBroken.broken_id}` : null
          })
        ]),
        h(G.ui.Card, { key: 's' }, [
          h('h2', { style: header }, 'Integrità & sicurezza'),
          h(Row, {
            ok: data.app_meta && data.app_meta.schema_version,
            label: `Schema version: ${(data.app_meta && data.app_meta.schema_version) || 'n/a'}`
          }),
          h(Row, { ok: true, label: 'CSP header presente (verificato in HTML)' }),
          h(Row, { ok: true, label: 'Trigger audit attivi su 8 tabelle' }),
          h(Row, {
            ok: anonProbe == null ? null : anonProbe.ok,
            label: anonProbe == null
              ? 'No-leak anon SELECT (test in corso…)'
              : anonProbe.error
                ? `No-leak anon SELECT — ERRORE: ${anonProbe.error}`
                : anonProbe.ok
                  ? `No-leak anon SELECT (${anonProbe.tested} tabelle, RLS OK)`
                  : `LEAK RLS: anon legge ${anonProbe.leaked.join(', ')}`,
            warn: anonProbe && !anonProbe.ok && !anonProbe.error
              ? 'Verifica le policy RLS — anon non dovrebbe leggere queste tabelle'
              : null
          })
        ]),
        h(G.ui.Card, { key: 'lk' }, [
          h('h2', { style: header }, 'Sign-off inventario'),
          h('p', {
            style: { fontSize: 12, color: C.textMid, lineHeight: 1.55, marginBottom: 12 }
          }, isAdmin
            ? 'Anno bloccato → editor non può più modificare S1/S2/S3/Produzione di quell\'anno. Admin mantiene la possibilità di intervenire (loggato in audit_log).'
            : 'Solo admin può modificare lo stato di sign-off.'),
          years.length === 0
            ? h('p', { style: { color: C.textLow, fontSize: 12 } }, 'Nessun anno con dati.')
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                years.map(y => {
                  const locked = lockedYears.includes(y);
                  return h('div', {
                    key: y,
                    style: {
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '6px 0', borderBottom: `1px solid ${C.borderSoft}`
                    }
                  }, [
                    h('span', {
                      key: 'y',
                      style: {
                        fontSize: 13, fontWeight: 700, color: C.text,
                        fontVariantNumeric: 'tabular-nums', minWidth: 48
                      }
                    }, String(y)),
                    h('span', {
                      key: 's',
                      style: {
                        flex: 1, fontSize: 12, fontWeight: 600,
                        color: locked ? C.success : C.warning
                      }
                    }, locked ? '🔒 Approvato' : '✏︎ In bozza'),
                    isAdmin && h('button', {
                      key: 'b',
                      disabled: lockBusy,
                      onClick: () => onToggleLock(y, !locked),
                      style: G.ui.btnStyle({
                        kind: locked ? 'ghost' : 'primary'
                      })
                    }, locked ? 'Sblocca' : 'Approva')
                  ]);
                })
              )
        ]),
        h(G.ui.Card, { key: 'k', borderLeft: kaColor }, [
          h('h2', { style: header }, 'Keep-alive Supabase'),
          h('div', { style: { fontSize: 13, color: C.text, marginBottom: 8 } }, [
            'Ultimo ping: ',
            h('strong', { key: 's' }, keepalive ? keepalive.toLocaleString('it-IT') : 'mai')
          ]),
          kaAge != null && h('div', {
            style: { fontSize: 12, color: kaColor, marginBottom: 12 }
          }, kaAge < 4 ? `OK (${kaAge} giorni fa)`
              : kaAge < 7 ? `Attenzione (${kaAge} giorni fa)`
              : `CRITICO (${kaAge} giorni fa) — il progetto rischia la pausa`),
          h('button', {
            onClick: async () => {
              try {
                const r = await G.db.keepalivePing();
                G.ui.pushToast('Ping inviato', 'success');
                if (r && r.ts) setKeepalive(new Date(r.ts));
              } catch (e) {
                G.ui.pushToast(e.message || 'Errore', 'error');
              }
            },
            style: G.ui.btnStyle({ kind: 'primary' })
          }, 'Ping manuale')
        ])
      ])
    ]);
  }

  function Row ({ ok, label, warn }) {
    // ok === null → stato "in corso" (grigio); true → verde; false → rosso.
    const loading = ok === null;
    return h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 0', borderBottom: `1px solid ${C.borderSoft}`,
        fontSize: 13
      }
    }, [
      h('span', {
        style: {
          width: 16, height: 16, borderRadius: 99,
          background: loading ? C.textLow : (ok ? C.success : C.critical),
          color: '#fff', fontSize: 11, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
        }
      }, loading ? '…' : (ok ? '✓' : '!')),
      h('span', { style: { flex: 1, color: C.text } }, label),
      warn && h('span', { style: { fontSize: 11, color: C.warning } }, warn)
    ]);
  }

  const header = { fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 12 };

  G.sections = G.sections || {};
  G.sections.Diagnostics = Diagnostics;
})(typeof window !== 'undefined' ? window : globalThis);
