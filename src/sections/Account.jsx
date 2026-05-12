/* GHG Tool — Account.jsx
 *
 * Sezione Account / Sicurezza della console interna.
 * Mostra info utente + permette enrollment/disenrollment del TOTP MFA.
 *
 * Editor e auditor sono GIÀ forzati al wizard di enrollment al primo
 * login (AuthGate.jsx → MFAEnrollScreen). Questa sezione serve
 * principalmente agli admin (che non sono forzati per evitare lockout)
 * e per disattivare/rigenerare il factor quando serve.
 *
 * Nota: se editor/auditor disattivano qui il loro TOTP, il prossimo
 * login li ribloccherà al wizard di enrollment (le policy DB richiedono
 * aal2 per scrivere/leggere audit_log).
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useState, useEffect } = root.React;
  const C = G.COLORS;

  function Account ({ role }) {
    const [email, setEmail] = useState('');
    const [aalCurrent, setAalCurrent] = useState(null);
    const [factors, setFactors] = useState(null);   // null = loading, [] = no factor
    const [enrolling, setEnrolling] = useState(null); // { id, qrSvg, secret, code }
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);

    async function refresh () {
      const sb = G.db.getClient();
      const [u, aal, f] = await Promise.all([
        sb.auth.getUser(),
        sb.auth.mfa.getAuthenticatorAssuranceLevel(),
        sb.auth.mfa.listFactors()
      ]);
      setEmail((u.data && u.data.user && u.data.user.email) || '—');
      setAalCurrent(aal.data && aal.data.currentLevel);
      setFactors((f.data && f.data.totp) || []);
    }

    useEffect(() => { refresh().catch(e => setErr(e.message)); }, []);

    const totpVerified   = (factors || []).find(f => f.status === 'verified');
    const totpUnverified = (factors || []).find(f => f.status === 'unverified');

    async function startEnroll () {
      setErr(null); setBusy(true);
      try {
        const sb = G.db.getClient();
        // Pulisci unverified residuo (altrimenti enroll() fallisce con
        // "MFA enrollment in progress").
        if (totpUnverified) {
          await sb.auth.mfa.unenroll({ factorId: totpUnverified.id });
        }
        const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
        if (error) throw error;
        setEnrolling({
          id: data.id,
          qrSvg: data.totp.qr_code,
          secret: data.totp.secret,
          code: ''
        });
      } catch (e) {
        setErr(e.message || 'Errore avvio enrollment');
      } finally { setBusy(false); }
    }

    async function verifyEnroll () {
      if (!enrolling || !enrolling.id) return;
      setErr(null); setBusy(true);
      try {
        const sb = G.db.getClient();
        const { data: ch, error: chErr } =
          await sb.auth.mfa.challenge({ factorId: enrolling.id });
        if (chErr) throw chErr;
        const { error: vErr } = await sb.auth.mfa.verify({
          factorId: enrolling.id,
          challengeId: ch.id,
          code: (enrolling.code || '').replace(/\s/g, '')
        });
        if (vErr) throw vErr;
        setEnrolling(null);
        await refresh();
        G.ui.pushToast('MFA attivato · da ora servirà il codice OTP a ogni login', 'success');
      } catch (_) {
        setErr('Codice non valido. Verifica l\'orario del dispositivo e riprova.');
      } finally { setBusy(false); }
    }

    async function cancelEnroll () {
      if (!enrolling) return;
      setBusy(true);
      try {
        const sb = G.db.getClient();
        await sb.auth.mfa.unenroll({ factorId: enrolling.id });
      } catch (_) {}
      setEnrolling(null);
      setBusy(false);
      refresh().catch(() => {});
    }

    async function disableMFA () {
      if (!totpVerified) return;
      const isLockedRole = role === 'editor' || role === 'auditor';
      const msg = isLockedRole
        ? `Sei ${role}: senza MFA non potrai più modificare i dati o leggere l'audit log. Al prossimo login il sistema ti chiederà comunque di riattivarlo.`
        : 'Senza MFA il login richiede solo email + password. Sicuro?';
      if (!await G.ui.confirm({
        title: 'Disattivare l\'autenticazione a due fattori?',
        message: msg, danger: true
      })) return;
      setErr(null); setBusy(true);
      try {
        const sb = G.db.getClient();
        const { error } = await sb.auth.mfa.unenroll({ factorId: totpVerified.id });
        if (error) throw error;
        await refresh();
        G.ui.pushToast('MFA disattivato', 'success');
      } catch (e) {
        setErr(e.message || 'Errore durante la disattivazione');
      } finally { setBusy(false); }
    }

    // ── Render ────────────────────────────────────────────────────
    if (factors === null) {
      return h('div', null, [
        h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } },
          'Account · Sicurezza'),
        h(G.ui.Skeleton, { width: '100%', height: 200 })
      ]);
    }

    const roleLabel = {
      admin:   'Amministratore',
      editor:  'Editor (può modificare dati)',
      auditor: 'Auditor (sola lettura + audit log)',
      viewer:  'Lettore'
    }[role] || role;

    return h('div', null, [
      h('h1', {
        key: 't',
        style: { fontSize: 22, fontWeight: 700, marginBottom: 16 }
      }, 'Account · Sicurezza'),

      err && h('div', {
        key: 'err',
        style: {
          background: C.criticalPale, color: C.critical,
          padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12
        }
      }, err),

      // ── Card 1: Info utente ───────────────────────────────────
      h(G.ui.Card, { key: 'u', style: { marginBottom: 16 } }, [
        h('h2', { key: 'h', style: { fontSize: 15, fontWeight: 700, marginBottom: 12 } },
          'Profilo'),
        h('div', { key: 'r1', style: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, fontSize: 13 } }, [
          h('span', { key: 'k1', style: { color: C.textMid } }, 'Email'),
          h('span', { key: 'v1', style: { fontFamily: 'ui-monospace, monospace' } }, email),
          h('span', { key: 'k2', style: { color: C.textMid } }, 'Ruolo'),
          h('span', { key: 'v2' }, roleLabel),
          h('span', { key: 'k3', style: { color: C.textMid } }, 'Sessione'),
          h('span', { key: 'v3' }, [
            aalCurrent === 'aal2'
              ? h('span', { key: 's', style: { color: C.success, fontWeight: 600 } }, '✓ MFA verificato (aal2)')
              : h('span', { key: 's', style: { color: C.textMid } }, 'Solo password (aal1)')
          ])
        ])
      ]),

      // ── Card 2: MFA ───────────────────────────────────────────
      h(G.ui.Card, { key: 'm' }, [
        h('h2', { key: 'h', style: { fontSize: 15, fontWeight: 700, marginBottom: 4 } },
          'Autenticazione a due fattori (TOTP)'),
        h('p', { key: 'd', style: { fontSize: 12, color: C.textMid, marginBottom: 16, lineHeight: 1.5 } },
          'Una volta attivato, dopo email + password servirà un codice a 6 cifre generato dalla tua app authenticator (Google Authenticator, Authy, 1Password).'),

        // Stato corrente + azione
        enrolling ? h(EnrollWizard, {
          key: 'wz',
          enrolling, setEnrolling, busy,
          onVerify: verifyEnroll,
          onCancel: cancelEnroll
        }) : totpVerified ? h('div', { key: 'on' }, [
          h('div', {
            key: 'b',
            style: {
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: C.successPale || '#E8F5E9',
              borderRadius: 8, marginBottom: 12
            }
          }, [
            h('span', { key: 'i', style: { fontSize: 20 } }, '✓'),
            h('span', { key: 't', style: { color: C.success, fontWeight: 600 } },
              'MFA attivo · TOTP'),
            h('span', { key: 's', style: { color: C.textMid, fontSize: 12, marginLeft: 'auto' } },
              `Attivato il ${new Date(totpVerified.updated_at || totpVerified.created_at).toLocaleDateString('it-IT')}`)
          ]),
          h(G.ui.Button, {
            key: 'btn', kind: 'ghost',
            disabled: busy,
            onClick: disableMFA
          }, busy ? 'Attendere…' : 'Disattiva MFA')
        ]) : h('div', { key: 'off' }, [
          h('div', {
            key: 'b',
            style: {
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: C.warningPale || '#FFF7E6',
              borderRadius: 8, marginBottom: 12
            }
          }, [
            h('span', { key: 'i', style: { fontSize: 20 } }, '⚠'),
            h('span', { key: 't', style: { color: C.warning, fontWeight: 600 } },
              totpUnverified ? 'Enrollment incompleto' : 'MFA non attivo')
          ]),
          h(G.ui.Button, {
            key: 'btn', kind: 'primary',
            disabled: busy,
            onClick: startEnroll
          }, busy ? 'Preparazione…' : (totpUnverified ? 'Riprendi enrollment' : 'Attiva MFA'))
        ])
      ])
    ]);
  }

  // ── Sub-component: wizard QR + verifica ─────────────────────────
  function EnrollWizard ({ enrolling, setEnrolling, busy, onVerify, onCancel }) {
    const [showSecret, setShowSecret] = useState(false);
    return h('form', {
      onSubmit: (e) => { e.preventDefault(); onVerify(); }
    }, [
      h('div', {
        key: 's1',
        style: {
          fontSize: 11, fontWeight: 700, color: C.textMid,
          textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8
        }
      }, '1. Scansiona il QR'),
      h('div', {
        key: 'qr',
        style: {
          display: 'flex', justifyContent: 'center',
          padding: 16, background: '#fff',
          border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12
        }
      }, h('img', {
        src: enrolling.qrSvg,
        alt: 'QR code TOTP',
        style: { width: 200, height: 200 }
      })),
      h('button', {
        key: 'sb', type: 'button',
        onClick: () => setShowSecret(s => !s),
        style: {
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: 12, color: C.textMid, padding: 0, marginBottom: 12,
          textDecoration: 'underline'
        }
      }, showSecret ? 'Nascondi codice manuale' : 'Mostra codice manuale'),
      showSecret && h('div', {
        key: 'sv',
        style: {
          background: C.bg, padding: 10, borderRadius: 6,
          fontFamily: 'ui-monospace, monospace', fontSize: 12,
          wordBreak: 'break-all', marginBottom: 12, userSelect: 'all'
        }
      }, enrolling.secret),

      h('div', {
        key: 's2',
        style: {
          fontSize: 11, fontWeight: 700, color: C.textMid,
          textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8
        }
      }, '2. Inserisci il codice a 6 cifre'),
      h('input', {
        key: 'i', type: 'text', inputMode: 'numeric',
        pattern: '[0-9]{6}', maxLength: 6, autoComplete: 'one-time-code',
        required: true, autoFocus: true, placeholder: '000 000',
        value: enrolling.code,
        onChange: e => setEnrolling(p => ({ ...p, code: e.target.value })),
        style: {
          width: '100%', padding: '12px 14px',
          border: `1px solid ${C.border}`, borderRadius: 8,
          fontSize: 18, letterSpacing: 6, textAlign: 'center',
          fontFamily: 'inherit', marginBottom: 12
        }
      }),
      h('div', { key: 'btns', style: { display: 'flex', gap: 8 } }, [
        h(G.ui.Button, {
          key: 'v', kind: 'primary',
          disabled: busy || (enrolling.code || '').replace(/\s/g, '').length !== 6,
          onClick: onVerify,
          style: { flex: 1 }
        }, busy ? 'Verifica…' : 'Conferma e attiva'),
        h(G.ui.Button, {
          key: 'c', kind: 'ghost',
          disabled: busy,
          onClick: onCancel
        }, 'Annulla')
      ])
    ]);
  }

  G.sections = G.sections || {};
  Object.assign(G.sections, { Account });
})(typeof window !== 'undefined' ? window : globalThis);
