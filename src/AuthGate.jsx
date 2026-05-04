/* GHG Tool — AuthGate.jsx
 *
 * Gestisce login Supabase email/password con MFA TOTP per admin/auditor,
 * captcha Cloudflare Turnstile, e routing tra Public Dashboard (faccia A)
 * e Internal Console (faccia B).
 *
 * Output:
 *   <AuthGate>
 *     {role === 'guest' ? <PublicDashboard/> : <App/>}
 *   </AuthGate>
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { useState, useEffect, useRef, createElement: h } = root.React;

  const TURNSTILE_SITE_KEY = '__TURNSTILE_SITE_KEY__';
  const COLORS = G.COLORS || {};

  // ───────────────────────────────────────────────────────────────────
  //  Hash routing: '#app' → console; tutto il resto → public
  // ───────────────────────────────────────────────────────────────────
  function isInternalRoute () {
    return root.location.hash === '#app' || root.location.hash === '#/app';
  }
  function navTo (route) {
    root.location.hash = route;
  }

  // ───────────────────────────────────────────────────────────────────
  //  Hook autenticazione
  // ───────────────────────────────────────────────────────────────────
  function useAuth () {
    const [state, setState] = useState({
      loading: true, session: null, role: 'guest', error: null, mfaRequired: false
    });

    useEffect(() => {
      let mounted = true;
      if (!G.db.isConfigured()) {
        setState(s => ({ ...s, loading: false, error: 'Configurazione mancante' }));
        return () => { mounted = false; };
      }
      const sb = G.db.getClient();

      sb.auth.getSession().then(({ data }) => {
        if (!mounted) return;
        const session = data.session;
        const role = readRoleFromSession(session);
        root.__GHG_ROLE = role;
        setState(s => ({ ...s, loading: false, session, role }));
      });

      const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
        const role = readRoleFromSession(session);
        root.__GHG_ROLE = role;
        setState(s => ({ ...s, session, role, loading: false }));
      });

      return () => {
        mounted = false;
        sub && sub.subscription && sub.subscription.unsubscribe();
      };
    }, []);

    return [state, setState];
  }

  function readRoleFromSession (session) {
    if (!session) return 'guest';
    try {
      // Estrae il ruolo dall'access_token (app_metadata)
      const parts = session.access_token.split('.');
      if (parts.length < 2) return 'viewer';
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      const r = payload && payload.app_metadata && payload.app_metadata.role;
      if (typeof r === 'string' && ['admin','editor','auditor','viewer'].includes(r)) {
        return r;
      }
      return 'viewer';
    } catch (_) { return 'viewer'; }
  }

  // ───────────────────────────────────────────────────────────────────
  //  Component
  // ───────────────────────────────────────────────────────────────────
  function AuthGate ({ children, publicComponent }) {
    const [state, setState] = useAuth();
    const [internal, setInternal] = useState(isInternalRoute());

    useEffect(() => {
      const onHash = () => setInternal(isInternalRoute());
      root.addEventListener('hashchange', onHash);
      return () => root.removeEventListener('hashchange', onHash);
    }, []);

    if (state.loading) {
      return h('div', {
        style: {
          minHeight: '100vh', display: 'grid', placeItems: 'center',
          background: COLORS.bg, color: COLORS.textMid
        }
      }, h(G.ui.Skeleton, { width: 320, height: 80 }));
    }

    // Faccia A — public (no auth o /public)
    if (!internal) {
      return h(publicComponent || (() =>
        h('div', null, 'Public dashboard non disponibile')));
    }

    // Faccia B — internal: serve login
    if (!state.session) {
      return h(LoginScreen, {
        onLoggedIn: (session) => {
          const role = readRoleFromSession(session);
          root.__GHG_ROLE = role;
          setState(s => ({ ...s, session, role }));
        }
      });
    }

    // Loggato — render children con role injection
    root.__GHG_ROLE = state.role;
    root.__GHG_LOGOUT = async () => {
      await G.db.getClient().auth.signOut({ scope: 'global' });
      navTo('');
    };

    return children;
  }

  // ───────────────────────────────────────────────────────────────────
  //  LoginScreen
  // ───────────────────────────────────────────────────────────────────
  function LoginScreen ({ onLoggedIn }) {
    const [email, setEmail] = useState('');
    const [pwd, setPwd]     = useState('');
    const [otp, setOtp]     = useState('');
    const [factorId, setFid] = useState(null);
    const [busy, setBusy]   = useState(false);
    const [err, setErr]     = useState(null);
    const [tToken, setTToken] = useState(null);
    const turnstileRef = useRef(null);

    useEffect(() => {
      // Carica Turnstile lazily se la site key è configurata
      const key = TURNSTILE_SITE_KEY;
      if (!key || key.startsWith('__')) return;
      const exist = document.getElementById('cf-turnstile-script');
      if (!exist) {
        const s = document.createElement('script');
        s.id = 'cf-turnstile-script';
        s.async = true; s.defer = true;
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__cfTurnstileReady';
        document.head.appendChild(s);
      }
      root.__cfTurnstileReady = () => {
        if (root.turnstile) {
          root.turnstile.render('#cf-turnstile-host', {
            sitekey: key,
            callback: (t) => setTToken(t)
          });
        }
      };
    }, []);

    async function handleLogin (e) {
      e && e.preventDefault();
      setErr(null); setBusy(true);
      try {
        const sb = G.db.getClient();
        const { data, error } = await sb.auth.signInWithPassword({
          email: email.trim(), password: pwd,
          options: tToken ? { captchaToken: tToken } : undefined
        });
        if (error) throw error;

        // Verifica se MFA è richiesto
        const { data: aalData } =
          await sb.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData && aalData.nextLevel === 'aal2'
            && aalData.currentLevel !== 'aal2') {
          const { data: factors } = await sb.auth.mfa.listFactors();
          const totp = factors && factors.totp && factors.totp[0];
          if (totp) {
            setFid(totp.id);
            setBusy(false);
            return;
          }
        }
        onLoggedIn(data.session);
      } catch (e2) {
        setErr('Email o password non valide');
      } finally {
        setBusy(false);
      }
    }

    async function handleVerifyMFA (e) {
      e && e.preventDefault();
      setErr(null); setBusy(true);
      try {
        const sb = G.db.getClient();
        const { data: ch, error: chErr } =
          await sb.auth.mfa.challenge({ factorId });
        if (chErr) throw chErr;
        const { data, error } =
          await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code: otp });
        if (error) throw error;
        onLoggedIn(data.session || (await sb.auth.getSession()).data.session);
      } catch (_) {
        setErr('Codice MFA non valido');
      } finally {
        setBusy(false);
      }
    }

    const card = {
      maxWidth: 420, width: '90%', background: '#fff',
      padding: 32, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.07)',
      border: `1px solid ${COLORS.border}`
    };
    const input = {
      width: '100%', padding: '10px 12px',
      border: `1px solid ${COLORS.border}`, borderRadius: 8,
      fontSize: 14, fontFamily: 'inherit', marginTop: 4
    };
    const btn = {
      width: '100%', padding: '12px 16px',
      background: COLORS.brand, color: '#fff', border: 'none', borderRadius: 8,
      fontSize: 14, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
      opacity: busy ? .6 : 1, marginTop: 16
    };

    return h('div', {
      style: {
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: COLORS.bg, fontFamily: 'Sora, sans-serif'
      }
    }, h('div', { style: card }, [
      h('h1', {
        key: 't',
        style: { fontSize: 22, fontWeight: 700, color: COLORS.text, marginBottom: 4 }
      }, 'GHG Tool · Console operatori'),
      h('p', {
        key: 's',
        style: { fontSize: 13, color: COLORS.textMid, marginBottom: 20 }
      }, 'Gruppo Ceramiche Gresmalt'),
      err && h('div', {
        key: 'e',
        style: {
          background: COLORS.criticalPale, color: COLORS.critical,
          padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12
        }
      }, err),
      !factorId
        ? h('form', { key: 'f1', onSubmit: handleLogin }, [
            h('label', {
              key: 'l1',
              style: { fontSize: 11, fontWeight: 600, color: COLORS.textMid,
                       textTransform: 'uppercase', letterSpacing: .5 }
            }, 'Email'),
            h('input', {
              key: 'i1', type: 'email', autoComplete: 'email', required: true,
              value: email, onChange: e => setEmail(e.target.value),
              style: input
            }),
            h('label', {
              key: 'l2',
              style: { fontSize: 11, fontWeight: 600, color: COLORS.textMid,
                       textTransform: 'uppercase', letterSpacing: .5,
                       marginTop: 12, display: 'block' }
            }, 'Password'),
            h('input', {
              key: 'i2', type: 'password', autoComplete: 'current-password', required: true,
              value: pwd, onChange: e => setPwd(e.target.value),
              style: input
            }),
            h('div', { key: 'cap', id: 'cf-turnstile-host', style: { marginTop: 12 } }),
            h('button', { key: 'b', type: 'submit', disabled: busy, style: btn },
              busy ? 'Accesso in corso…' : 'Entra'),
            h('a', {
              key: 'pub', href: '#', onClick: (e) => { e.preventDefault(); navTo(''); },
              style: { display: 'block', textAlign: 'center',
                       marginTop: 12, fontSize: 13, color: COLORS.textMid,
                       textDecoration: 'none' }
            }, '← Continua come ospite')
          ])
        : h('form', { key: 'f2', onSubmit: handleVerifyMFA }, [
            h('p', {
              key: 'h',
              style: { fontSize: 13, color: COLORS.textMid, marginBottom: 12 }
            }, 'Inserisci il codice TOTP a 6 cifre dalla tua app authenticator.'),
            h('input', {
              key: 'i', type: 'text', inputMode: 'numeric', pattern: '[0-9]{6}',
              maxLength: 6, autoComplete: 'one-time-code', required: true,
              value: otp, onChange: e => setOtp(e.target.value),
              style: { ...input, letterSpacing: 4, textAlign: 'center', fontSize: 18 }
            }),
            h('button', { key: 'b', type: 'submit', disabled: busy, style: btn },
              busy ? 'Verifica…' : 'Verifica')
          ])
    ]));
  }

  G.AuthGate = AuthGate;
})(typeof window !== 'undefined' ? window : globalThis);
