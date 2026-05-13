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
  const { useState, useEffect, createElement: h } = root.React;

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
  //
  //  Espone su `state`:
  //   - session       : sessione Supabase (null se loggout)
  //   - role          : ruolo dall'app_metadata del JWT
  //   - mfaRequired   : true se l'utente HA un factor TOTP verified
  //                     ma la sessione corrente è aal1. In quel caso
  //                     l'AuthGate mostra MFAChallengeScreen invece di
  //                     children, evitando il bypass silenzioso che si
  //                     verificava facendo gestire il prompt OTP al
  //                     LoginScreen (smontato dall'AuthGate non appena
  //                     onAuthStateChange annunciava la sessione aal1).
  // ───────────────────────────────────────────────────────────────────
  function useAuth () {
    const [state, setState] = useState({
      loading: true, session: null, role: 'guest', error: null,
      mfaRequired: false, mfaChecked: false
    });

    useEffect(() => {
      let mounted = true;
      if (!G.db.isConfigured()) {
        setState(s => ({ ...s, loading: false, error: 'Configurazione mancante' }));
        return () => { mounted = false; };
      }
      const sb = G.db.getClient();

      // Step 1: sblocca il loading subito leggendo solo la sessione.
      // Il check MFA è in un useEffect separato per evitare che API
      // MFA lente/in errore blocchino la prima paint.
      sb.auth.getSession().then(({ data }) => {
        if (!mounted) return;
        const session = data.session;
        const role = readRoleFromSession(session);
        root.__GHG_ROLE = role;
        setState(s => ({
          ...s, loading: false, session, role,
          mfaChecked: !session  // se non c'è sessione, niente da controllare
        }));
      });

      const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
        if (!mounted) return;
        const role = readRoleFromSession(session);
        root.__GHG_ROLE = role;
        setState(s => {
          // Eventi "soft" che NON richiedono di rifare il check MFA
          // se è lo stesso utente già autenticato:
          // - TOKEN_REFRESHED: auto-refresh (~ogni ora, e al ritorno tab)
          // - USER_UPDATED:    cambio metadati profilo
          // - MFA_CHALLENGE_VERIFIED: verify riuscita, sappiamo già aal2
          // - SIGNED_IN/INITIAL_SESSION con sessione preesistente:
          //   Supabase a volte le riemette al cambio focus.
          // In tutti questi casi mfaChecked/mfaRequired sono già corretti.
          const sameUser = session && s.session
            && s.session.user && session.user
            && s.session.user.id === session.user.id;
          const softEvents = [
            'TOKEN_REFRESHED', 'USER_UPDATED', 'MFA_CHALLENGE_VERIFIED',
            'SIGNED_IN', 'INITIAL_SESSION'
          ];
          if (sameUser && softEvents.includes(event)) {
            return { ...s, session, role, loading: false };
          }
          // Cambio utente o SIGNED_OUT → reset completo dello stato MFA
          return {
            ...s, session, role, loading: false,
            mfaChecked: !session,
            mfaRequired: false  // verrà ricalcolato dall'altro effect
          };
        });
      });

      return () => {
        mounted = false;
        sub && sub.subscription && sub.subscription.unsubscribe();
      };
    }, []);

    // Step 2: calcola mfaRequired in modo asincrono ogni volta che la
    // sessione cambia o serve un re-check (mfaChecked=false dopo cambio
    // utente). Timeout 3s di safety: se Supabase Auth tarda (network
    // glitch), non blocchiamo l'utente — l'enforcement DB bloccherà
    // comunque le scritture in aal1.
    useEffect(() => {
      if (!state.session) return;
      if (state.mfaChecked) return;
      let cancelled = false;
      let timeoutId = null;
      const sb = G.db.getClient();

      const timeout = new Promise(resolve => {
        timeoutId = setTimeout(() => resolve('timeout'), 3000);
      });
      const check = (async () => {
        try {
          // Parallelizza: listFactors e getAuthenticatorAssuranceLevel
          // sono indipendenti, su rete ad alta latenza vincono ~100ms.
          const [factorsResp, aalResp] = await Promise.all([
            sb.auth.mfa.listFactors(),
            sb.auth.mfa.getAuthenticatorAssuranceLevel()
          ]);
          const factors = factorsResp.data;
          const hasVerified = factors && factors.totp
            && factors.totp.some(f => f.status === 'verified');
          if (!hasVerified) return false;
          const aal = aalResp.data;
          return !!(aal && aal.currentLevel !== 'aal2');
        } catch (_) { return false; }
      })();

      Promise.race([check, timeout]).then(result => {
        if (cancelled) return;
        const required = result === 'timeout' ? false : !!result;
        setState(s => ({ ...s, mfaRequired: required, mfaChecked: true }));
      });

      return () => {
        cancelled = true;
        if (timeoutId) clearTimeout(timeoutId);
      };
      // mfaChecked nella dep array funge anche da trigger: se viene
      // resettato a false (es. cambio utente) il check riparte.
    }, [
      state.session && state.session.user && state.session.user.id,
      state.mfaChecked
    ]);

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
    // null = check pending; false = OK; true = serve enrollment wizard
    const [needsEnroll, setNeedsEnroll] = useState(null);

    useEffect(() => {
      const onHash = () => setInternal(isInternalRoute());
      root.addEventListener('hashchange', onHash);
      return () => root.removeEventListener('hashchange', onHash);
    }, []);

    // Detect MFA enrollment requirement: editor o auditor a aal1
    // senza factor TOTP. Vedi sql/14_mfa_editor.sql per l'enforcement
    // DB-side che blocca le INSERT/UPDATE di un editor non a aal2,
    // e sql/15_mfa_auditor.sql per il SELECT su audit_log dell'auditor.
    useEffect(() => {
      if (!state.session) { setNeedsEnroll(null); return; }
      // editor + auditor: forzati all'enrollment dalla UI.
      // admin: lasciamo a Supabase Auth il flusso standard (challenge
      //   se factor enrolled) — non forziamo per evitare lockout.
      // viewer: lettura sola, niente enrollment necessario.
      if (state.role !== 'editor' && state.role !== 'auditor') {
        setNeedsEnroll(false);
        return;
      }

      let cancelled = false;
      (async () => {
        try {
          const sb = G.db.getClient();
          const { data: aalData } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
          if (cancelled) return;
          if (aalData && aalData.currentLevel === 'aal2') {
            setNeedsEnroll(false);
            return;
          }
          const { data: factors } = await sb.auth.mfa.listFactors();
          if (cancelled) return;
          const totp = factors && factors.totp;
          // verified factors → user dovrebbe già aver completato il
          // challenge in LoginScreen, qui non insistiamo
          const hasVerified = totp && totp.some(f => f.status === 'verified');
          if (hasVerified) { setNeedsEnroll(false); return; }
          setNeedsEnroll(true);
        } catch (_) {
          // In caso di errore di rete, NON blocchiamo l'utente:
          // l'enforcement DB-side respingerà comunque i write se
          // l'editor non è a aal2.
          if (!cancelled) setNeedsEnroll(false);
        }
      })();
      return () => { cancelled = true; };
    }, [state.session, state.role]);

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

    // Sessione caricata ma MFA-check ancora pending → skeleton.
    // Evita un flash dei children prima che mfaRequired sia noto.
    if (state.session && !state.mfaChecked) {
      return h('div', {
        style: {
          minHeight: '100vh', display: 'grid', placeItems: 'center',
          background: COLORS.bg, color: COLORS.textMid
        }
      }, h(G.ui.Skeleton, { width: 320, height: 80 }));
    }

    // Sessione aal1 + factor TOTP verified → prompt MFA challenge.
    // Gestito qui (non più nel LoginScreen) per evitare race condition:
    // appena sb.auth.onAuthStateChange annunciava la sessione aal1,
    // AuthGate smontava LoginScreen e l'utente entrava senza prompt.
    if (state.mfaRequired) {
      return h(MFAChallengeScreen, {
        onVerified: async () => {
          const sb = G.db.getClient();
          const { data } = await sb.auth.getSession();
          const session = data && data.session;
          const role = readRoleFromSession(session);
          root.__GHG_ROLE = role;
          // Settiamo esplicitamente anche mfaChecked: true perché
          // onAuthStateChange potrebbe arrivare dopo questo setState con
          // un evento non-soft (raro post-verify) e riazzererebbe il flag.
          setState(s => ({
            ...s, session, role,
            mfaRequired: false, mfaChecked: true
          }));
        },
        onCancel: async () => {
          // Annulla: torna alla schermata di login (logout sicuro).
          // mfaChecked è ridondante qui — il branch !state.session
          // intercetta prima del check su mfaChecked nel render.
          await G.db.getClient().auth.signOut({ scope: 'global' });
          setState(s => ({
            ...s, session: null, role: 'guest', mfaRequired: false
          }));
        }
      });
    }

    // Editor senza TOTP → wizard di enrollment forzato
    if (needsEnroll === null && (state.role === 'editor' || state.role === 'auditor')) {
      return h('div', {
        style: {
          minHeight: '100vh', display: 'grid', placeItems: 'center',
          background: COLORS.bg, color: COLORS.textMid
        }
      }, h(G.ui.Skeleton, { width: 320, height: 80 }));
    }
    if (needsEnroll === true) {
      return h(MFAEnrollScreen, {
        onEnrolled: async () => {
          // Refresh sessione per leggere il nuovo aal=aal2 nel JWT
          const sb = G.db.getClient();
          const { data } = await sb.auth.getSession();
          const session = data && data.session;
          const role = readRoleFromSession(session);
          root.__GHG_ROLE = role;
          setState(s => ({ ...s, session, role }));
          setNeedsEnroll(false);
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
    const [busy, setBusy]   = useState(false);
    const [err, setErr]     = useState(null);
    const [tToken, setTToken] = useState(null);

    // Turnstile è attivo solo se la site key è stata sostituita al build
    // (cioè TURNSTILE_SITE_KEY env era presente). Se non lo è, non
    // mostriamo il widget e il login non lo richiede.
    const captchaKey      = TURNSTILE_SITE_KEY;
    const captchaRequired = !!captchaKey && !captchaKey.startsWith('__');

    useEffect(() => {
      if (!captchaRequired) return;
      let widgetId = null;

      // 1. La callback DEVE essere registrata PRIMA di creare il tag <script>:
      //    se il browser ha lo script in cache, il load è sincrono e la
      //    callback può scattare prima dell'assegnazione → captcha invisibile.
      root.__cfTurnstileReady = () => {
        if (root.turnstile) {
          widgetId = root.turnstile.render('#cf-turnstile-host', {
            sitekey: captchaKey,
            callback: (t) => setTToken(t),
            'error-callback':   () => setTToken(null),
            'expired-callback': () => setTToken(null),
            'timeout-callback': () => setTToken(null)
          });
        }
      };

      // 2. Se turnstile è già caricato (ritorno al login dopo logout,
      //    seconda render, ecc.) lo script <script id="cf-turnstile-script">
      //    esiste ma onload non scatterà più → renderizziamo direttamente.
      if (root.turnstile) {
        root.__cfTurnstileReady();
      } else if (!document.getElementById('cf-turnstile-script')) {
        const s = document.createElement('script');
        s.id = 'cf-turnstile-script';
        s.async = true; s.defer = true;
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__cfTurnstileReady';
        document.head.appendChild(s);
      }

      return () => {
        // Cleanup: rimuove il widget al unmount (es. cambio route) per
        // evitare un widget duplicato al prossimo render.
        if (widgetId != null && root.turnstile && root.turnstile.remove) {
          try { root.turnstile.remove(widgetId); } catch (_) {}
        }
      };
    }, [captchaRequired, captchaKey]);

    async function handleLogin (e) {
      e && e.preventDefault();
      setErr(null);
      // Difesa lato client: se il captcha è richiesto, blocchiamo il
      // submit senza token. È un guard locale — l'enforcement reale
      // dev'essere lato server (Supabase Auth → Captcha protection).
      if (captchaRequired && !tToken) {
        setErr('Completa la verifica anti-bot per continuare');
        return;
      }
      setBusy(true);
      try {
        const sb = G.db.getClient();
        const { data, error } = await sb.auth.signInWithPassword({
          email: email.trim(), password: pwd,
          options: tToken ? { captchaToken: tToken } : undefined
        });
        if (error) throw error;
        // Il prompt MFA (se l'utente ha factor verified) NON lo facciamo
        // più qui: ci pensa l'AuthGate via state.mfaRequired, mostrando
        // MFAChallengeScreen. Vedi useAuth → computeMfaRequired().
        onLoggedIn(data.session);
      } catch (e2) {
        setErr('Email o password non valide');
        // Reset token captcha: Turnstile token è single-use lato server.
        // Forza re-challenge.
        if (captchaRequired && root.turnstile) {
          try { root.turnstile.reset(); } catch (_) {}
          setTToken(null);
        }
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
      h('form', { key: 'f1', onSubmit: handleLogin }, [
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
        captchaRequired && h('div', {
          key: 'cap', id: 'cf-turnstile-host',
          style: { marginTop: 12, minHeight: 65 }
        }),
        captchaRequired && !tToken && h('div', {
          key: 'caph',
          style: { fontSize: 11, color: COLORS.textLow, marginTop: 4 }
        }, 'Completa la verifica anti-bot per abilitare il bottone.'),
        h('button', {
          key: 'b', type: 'submit',
          disabled: busy || (captchaRequired && !tToken),
          style: {
            ...btn,
            cursor: (busy || (captchaRequired && !tToken)) ? 'not-allowed' : 'pointer',
            opacity: (busy || (captchaRequired && !tToken)) ? .5 : 1
          }
        }, busy ? 'Accesso in corso…' : 'Entra'),
        h('a', {
          key: 'pub', href: '#', onClick: (e) => { e.preventDefault(); navTo(''); },
          style: { display: 'block', textAlign: 'center',
                   marginTop: 12, fontSize: 13, color: COLORS.textMid,
                   textDecoration: 'none' }
        }, '← Continua come ospite')
      ])
    ]));
  }

  // ───────────────────────────────────────────────────────────────────
  //  MFAChallengeScreen — prompt OTP per utenti con factor TOTP
  //  verified ma sessione corrente aal1. Montato dall'AuthGate (vedi
  //  state.mfaRequired), NON dal LoginScreen.
  // ───────────────────────────────────────────────────────────────────
  function MFAChallengeScreen ({ onVerified, onCancel }) {
    const [otp, setOtp]     = useState('');
    const [busy, setBusy]   = useState(false);
    const [err, setErr]     = useState(null);

    async function verify (e) {
      e && e.preventDefault();
      setErr(null); setBusy(true);
      try {
        const sb = G.db.getClient();
        // Trova il factor TOTP verified dell'utente.
        const { data: factors, error: lfErr } = await sb.auth.mfa.listFactors();
        if (lfErr) throw lfErr;
        const totp = factors && factors.totp
          && factors.totp.find(f => f.status === 'verified');
        if (!totp) throw new Error('Nessun factor TOTP attivo');
        const { data: ch, error: chErr } =
          await sb.auth.mfa.challenge({ factorId: totp.id });
        if (chErr) throw chErr;
        const { error: vErr } = await sb.auth.mfa.verify({
          factorId: totp.id,
          challengeId: ch.id,
          code: (otp || '').replace(/\s/g, '')
        });
        if (vErr) throw vErr;
        await onVerified();
      } catch (_) {
        setErr('Codice non valido. Riprova.');
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
      width: '100%', padding: '12px 14px',
      border: `1px solid ${COLORS.border}`, borderRadius: 8,
      fontSize: 18, fontFamily: 'inherit', marginTop: 4,
      letterSpacing: 6, textAlign: 'center'
    };
    const btn = (kind = 'primary') => ({
      width: '100%', padding: '12px 16px',
      background: kind === 'ghost' ? 'transparent' : COLORS.brand,
      color: kind === 'ghost' ? COLORS.textMid : '#fff',
      border: kind === 'ghost' ? `1px solid ${COLORS.border}` : 'none',
      borderRadius: 8, fontSize: 14, fontWeight: 600,
      cursor: busy ? 'not-allowed' : 'pointer',
      opacity: busy ? .6 : 1
    });

    return h('div', {
      style: {
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: COLORS.bg, fontFamily: 'Sora, sans-serif'
      }
    }, h('div', { style: card }, [
      h('h1', {
        key: 't',
        style: { fontSize: 22, fontWeight: 700, color: COLORS.text, marginBottom: 4 }
      }, 'Verifica a due fattori'),
      h('p', {
        key: 'd',
        style: { fontSize: 13, color: COLORS.textMid, marginBottom: 20, lineHeight: 1.5 }
      }, 'Inserisci il codice a 6 cifre generato dalla tua app authenticator.'),
      err && h('div', {
        key: 'e',
        style: {
          background: COLORS.criticalPale, color: COLORS.critical,
          padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12
        }
      }, err),
      h('form', { key: 'f', onSubmit: verify }, [
        h('input', {
          key: 'i', type: 'text', inputMode: 'numeric',
          pattern: '[0-9]{6}', maxLength: 6, autoComplete: 'one-time-code',
          required: true, autoFocus: true, placeholder: '000 000',
          value: otp, onChange: e => setOtp(e.target.value),
          style: input
        }),
        h('button', {
          key: 'b', type: 'submit',
          disabled: busy || (otp || '').replace(/\s/g, '').length !== 6,
          style: { ...btn('primary'), marginTop: 16 }
        }, busy ? 'Verifica…' : 'Verifica'),
        h('button', {
          key: 'c', type: 'button', onClick: onCancel, disabled: busy,
          style: { ...btn('ghost'), marginTop: 8 }
        }, 'Annulla e torna al login')
      ])
    ]));
  }

  // ───────────────────────────────────────────────────────────────────
  //  MFAEnrollScreen
  //
  //  Wizard QR-code per enrollment TOTP, mostrato all'editor che non ha
  //  ancora un factor verificato. Lavora in tandem con sql/14_mfa_editor.sql:
  //  finché l'editor non è a aal2, le policy RLS respingono qualunque
  //  INSERT/UPDATE → l'editor è quindi forzato a completare l'enrollment
  //  prima di poter lavorare.
  //
  //  Gestisce l'edge case del factor "unverified" residuo da un tentativo
  //  precedente abbandonato: lo riusa invece di crearne uno nuovo (Supabase
  //  altrimenti rifiuta enroll() con "MFA enrollment in progress").
  // ───────────────────────────────────────────────────────────────────
  function MFAEnrollScreen ({ onEnrolled }) {
    const [enroll, setEnroll] = useState(null);  // { id, qr_code, secret, uri }
    const [code, setCode]     = useState('');
    const [busy, setBusy]     = useState(false);
    const [err, setErr]       = useState(null);
    const [showSecret, setShowSecret] = useState(false);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const sb = G.db.getClient();

          // Riusa un eventuale factor unverified pregresso
          const { data: factors } = await sb.auth.mfa.listFactors();
          let totp = factors && factors.totp && factors.totp.find(f => f.status === 'unverified');

          if (!totp) {
            const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
            if (error) throw error;
            // data: { id, type, totp: { qr_code, secret, uri } }
            if (cancelled) return;
            setEnroll({
              id: data.id,
              qr_code: data.totp.qr_code,
              secret: data.totp.secret,
              uri: data.totp.uri
            });
          } else {
            // Per un factor unverified pregresso non abbiamo qr_code/secret
            // restituiti da listFactors → ricavabili solo via re-enroll.
            // Strategia: unenroll e ricrea, così abbiamo qr_code fresco.
            await sb.auth.mfa.unenroll({ factorId: totp.id });
            const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
            if (error) throw error;
            if (cancelled) return;
            setEnroll({
              id: data.id,
              qr_code: data.totp.qr_code,
              secret: data.totp.secret,
              uri: data.totp.uri
            });
          }
        } catch (e) {
          if (!cancelled) setErr(e.message || 'Errore durante l\'enrollment MFA');
        }
      })();
      return () => { cancelled = true; };
    }, []);

    async function verify (e) {
      e && e.preventDefault();
      if (!enroll || !enroll.id) return;
      setErr(null); setBusy(true);
      try {
        const sb = G.db.getClient();
        const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId: enroll.id });
        if (chErr) throw chErr;
        const { error: vErr } = await sb.auth.mfa.verify({
          factorId: enroll.id,
          challengeId: ch.id,
          code: code.replace(/\s/g, '')
        });
        if (vErr) throw vErr;
        // Successo: il JWT contiene aal=aal2; il parent refresh-erà la sessione
        await onEnrolled();
      } catch (_) {
        setErr('Codice non valido. Verifica l\'orario del dispositivo e riprova.');
      } finally {
        setBusy(false);
      }
    }

    async function logoutAndAbort () {
      try {
        await G.db.getClient().auth.signOut({ scope: 'global' });
      } catch (_) {}
      navTo('');
      // Forza reload per pulire state
      try { root.location.reload(); } catch (_) {}
    }

    const card = {
      maxWidth: 540, width: '92%', background: '#fff',
      padding: 32, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.07)',
      border: `1px solid ${COLORS.border}`
    };
    const input = {
      width: '100%', padding: '12px 14px',
      border: `1px solid ${COLORS.border}`, borderRadius: 8,
      fontSize: 18, fontFamily: 'inherit', marginTop: 4,
      letterSpacing: 6, textAlign: 'center'
    };
    const btn = (kind = 'primary') => ({
      width: '100%', padding: '12px 16px',
      background: kind === 'ghost' ? 'transparent' : COLORS.brand,
      color: kind === 'ghost' ? COLORS.textMid : '#fff',
      border: kind === 'ghost' ? `1px solid ${COLORS.border}` : 'none',
      borderRadius: 8, fontSize: 14, fontWeight: 600,
      cursor: busy ? 'not-allowed' : 'pointer',
      opacity: busy ? .6 : 1
    });

    return h('div', {
      style: {
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: COLORS.bg, fontFamily: 'Sora, sans-serif', padding: 16
      }
    }, h('div', { style: card }, [
      h('h1', {
        key: 't',
        style: { fontSize: 22, fontWeight: 700, color: COLORS.text, marginBottom: 4 }
      }, 'Configura MFA'),
      h('p', {
        key: 's',
        style: { fontSize: 13, color: COLORS.textMid, marginBottom: 20, lineHeight: 1.5 }
      }, root.__GHG_ROLE === 'auditor'
          ? 'Per consultare l\'audit log gli auditor devono attivare l\'autenticazione a due fattori (TOTP). Procedi una volta sola.'
          : 'Per modificare i dati dell\'inventario gli operatori devono attivare l\'autenticazione a due fattori (TOTP). Procedi una volta sola.'),

      err && h('div', {
        key: 'e',
        style: {
          background: COLORS.criticalPale, color: COLORS.critical,
          padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12
        }
      }, err),

      !enroll ? h('div', {
        key: 'sk',
        style: { textAlign: 'center', padding: 24 }
      }, h(G.ui.Skeleton, { width: 240, height: 240 })) :
      h('div', { key: 'wz' }, [
        h('div', {
          key: 'step1',
          style: {
            fontSize: 11, fontWeight: 700, color: COLORS.textMid,
            textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8
          }
        }, '1. Scansiona il QR'),
        h('p', {
          key: 'p1',
          style: { fontSize: 13, color: COLORS.textMid, marginBottom: 16, lineHeight: 1.5 }
        }, [
          'Apri ',
          h('strong', { key: 'b' }, 'Google Authenticator'),
          ', ',
          h('strong', { key: 'b2' }, 'Authy'),
          ' o ',
          h('strong', { key: 'b3' }, '1Password'),
          ' sul tuo telefono e scansiona il codice qui sotto.'
        ]),
        h('div', {
          key: 'qr',
          style: {
            display: 'flex', justifyContent: 'center',
            padding: 16, background: '#fff', border: `1px solid ${COLORS.border}`,
            borderRadius: 8, marginBottom: 12
          }
        }, h('img', {
          src: enroll.qr_code,
          alt: 'QR code per enrollment MFA TOTP',
          style: { width: 220, height: 220 }
        })),
        h('button', {
          key: 'sec',
          type: 'button',
          onClick: () => setShowSecret(s => !s),
          style: {
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 12, color: COLORS.textMid, padding: 0, marginBottom: 16,
            textDecoration: 'underline'
          }
        }, showSecret ? 'Nascondi codice manuale' : 'Non riesci a scansionare? Mostra codice manuale'),
        showSecret && h('div', {
          key: 'secv',
          style: {
            background: COLORS.bg, padding: 12, borderRadius: 8,
            fontFamily: 'ui-monospace, monospace', fontSize: 13,
            wordBreak: 'break-all', marginBottom: 16, userSelect: 'all'
          }
        }, enroll.secret),

        h('form', { key: 'f', onSubmit: verify }, [
          h('div', {
            key: 'step2',
            style: {
              fontSize: 11, fontWeight: 700, color: COLORS.textMid,
              textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8
            }
          }, '2. Inserisci il codice a 6 cifre'),
          h('input', {
            key: 'i', type: 'text', inputMode: 'numeric',
            pattern: '[0-9]{6}', maxLength: 6, autoComplete: 'one-time-code',
            required: true, autoFocus: true,
            placeholder: '000 000',
            value: code, onChange: e => setCode(e.target.value),
            style: input
          }),
          h('button', {
            key: 'b', type: 'submit', disabled: busy || code.replace(/\s/g, '').length !== 6,
            style: { ...btn('primary'), marginTop: 16 }
          }, busy ? 'Verifica…' : 'Conferma e attiva MFA'),
          h('button', {
            key: 'la', type: 'button', onClick: logoutAndAbort, disabled: busy,
            style: { ...btn('ghost'), marginTop: 8 }
          }, 'Esci e rimanda')
        ])
      ])
    ]));
  }

  G.AuthGate = AuthGate;
})(typeof window !== 'undefined' ? window : globalThis);
