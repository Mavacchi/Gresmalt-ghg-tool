# Sicurezza

Difese a strati. Niente è basato su una sola linea di protezione: tutto
ha almeno **due gate** indipendenti.

## Stack a strati

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Browser-side                                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ CSP via <meta> + _headers                               │    │
│  │ SRI integrity sui bundle lazy                           │    │
│  │ Forbidden tokens check build-time                       │    │
│  │ React (no XSS by default)                               │    │
│  │ Cloudflare Turnstile (opzionale anti-bot)               │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  2. Client-side (JS)                                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Rate limit sliding window (30 mut / 10s)                │    │
│  │ PII redaction prima dell'insert in client_errors        │    │
│  │ ErrorBoundary React per cattura errori                  │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  3. Supabase Auth                                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Email/password con captcha Turnstile                    │    │
│  │ TOTP MFA forzato (editor/auditor) via UI                │    │
│  │ JWT con app_metadata.role + aal                         │    │
│  │ Cookie httpOnly + SameSite                              │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  4. Edge Functions (Deno)                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Origin allow-list (ALLOWED_ORIGINS env)                 │    │
│  │ JWT validation via sb.auth.getUser()                    │    │
│  │ Role check (admin/editor) lato funzione                 │    │
│  │ Body size limits                                        │    │
│  │ Constant-time eq per HMAC verify                        │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  5. PostgreSQL                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ENABLE + FORCE RLS su tutte le tabelle                  │    │
│  │ Policy granulari per ruolo                              │    │
│  │ Year lock per editor (override admin)                   │    │
│  │ MFA aal2 forzato per editor/auditor (sql/14, sql/15)    │    │
│  │ Default deny per anon (REVOKE all)                      │    │
│  │ Hash chain SHA-256 su audit_log                         │    │
│  │ Security definer functions con search_path safe         │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  6. Operations                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ pg_dump weekly criptato GPG AES256                      │    │
│  │ Replica S3 opzionale (off-GitHub)                       │    │
│  │ Pseudonimizzazione audit_log (GDPR)                     │    │
│  │ Secret scan in CI                                       │    │
│  │ npm audit high+critical in CI                           │    │
│  │ Dependabot weekly                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## 1. CSP (Content Security Policy)

Iniettata via `<meta http-equiv>` nel `site/index.html` (compat GitHub
Pages che non supporta header HTTP custom).

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
img-src 'self' data:;
frame-src https://challenges.cloudflare.com;
base-uri 'self';
object-src 'none';
```

* `'unsafe-inline'` su `script-src` è necessario perché il bundle è inline
  nel HTML (no hash perché il contenuto cambia ad ogni build). Tradeoff:
  semplicità di deploy vs XSS protection rigorosa. La compensazione è:
  * Niente `dangerouslySetInnerHTML` (bloccato a build-time)
  * React rendering safe by default
  * Origin allow-list rigorosa
* `cdn.jsdelivr.net` per i bundle lazy SheetJS/pptxgenjs (con SRI)
* `challenges.cloudflare.com` per Turnstile
* `connect-src` solo Supabase (HTTPS + WSS per realtime)
* `img-src data:` per i logo inlined base64
* `frame-ancestors 'none'` + `X-Frame-Options: DENY` sono solo in `_headers`
  (la CSP `<meta>` ignora `frame-ancestors`).

## 2. SRI (Subresource Integrity)

`@e965/xlsx` e `pptxgenjs` sono caricati lazy da `cdn.jsdelivr.net` con
`integrity=sha384-…` calcolato a build-time:

```js
function sri (path) {
  const h = createHash('sha384').update(readFileSync(path)).digest('base64');
  return `sha384-${h}`;
}

const SHEETJS_SRI   = sri('node_modules/@e965/xlsx/dist/xlsx.full.min.js');
const PPTXGENJS_SRI = sri('node_modules/pptxgenjs/dist/pptxgen.bundle.js');
```

Iniettati nei placeholder `__SHEETJS_SRI__` e `__PPTXGENJS_SRI__`. A
runtime:

```js
sc.src = `https://cdn.jsdelivr.net/npm/@e965/xlsx@0.20.3/dist/xlsx.full.min.js`;
sc.crossOrigin = 'anonymous';
sc.integrity = '<sha384-...>';
```

Se la CDN serve un file con hash diverso, il browser blocca il load
(error event).

Le versioni sono **pinnate** (no caret) in `package.json` per garantire
build deterministica e SRI stabili.

## 3. Forbidden tokens (build-time)

`build.mjs` blocca il build se trova nei sorgenti `src/`:

```js
const FORBIDDEN_TOKENS = [
  'dangerouslySetInnerHTML',  // React: bypass del rendering safe
  'eval(',                    // JS: code injection
  'new Function(',            // JS: equivalente di eval
  'document.write(',          // DOM: deprecato, può rompere CSP
  'innerHTML ='               // DOM: bypass del rendering React safe
];
```

Lo script `npm run lint:no-dangerous-html` ripete il check più ristretto
in CI come second gate.

ESLint config (`.eslintrc.json`):

```json
{
  "rules": {
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "no-script-url": "error",
    "no-with": "error",
    ...
  }
}
```

## 4. Auth & MFA TOTP

* Supabase Auth con flow PKCE (`flowType: 'pkce'`)
* Storage: `sessionStorage` (non `localStorage` — la sessione muore con il
  tab; refresh token comunque permette resume in altro tab via Supabase
  cookies)
* Captcha **Cloudflare Turnstile** opzionale, gated dietro `TURNSTILE_SITE_KEY`
  env. Se non impostata, skip silenzioso.

### MFA TOTP enforcement

Forzato lato **DB** (non solo UI):

#### Editor (sql/14_mfa_editor.sql)

```sql
-- Esempio policy per s1:
CREATE POLICY s1_insert ON public.s1
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_role() = 'admin'
    OR (public.current_role() = 'editor'
        AND NOT public.is_year_locked(anno)
        AND (auth.jwt() ->> 'aal') = 'aal2')
  );
```

Tabelle protette: `s1, s2, s3, produzione` (con year-lock) + `fe,
anagrafiche, s3_materiality` (senza year-lock).

#### Auditor (sql/15_mfa_auditor.sql)

```sql
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    public.current_role() = 'admin'
    OR (public.current_role() = 'auditor'
        AND (auth.jwt() ->> 'aal') = 'aal2')
  );
```

`audit_log`, `audit_chain_check`, `fe_search_log`, `ai_assist_log`.

#### Admin

**Non** forzato (override d'emergenza per device perso, evita lockout).

#### UI enforcement

`AuthGate.MFAEnrollScreen` (`src/AuthGate.jsx`):
- Detect editor/auditor a aal=aal1 senza factor TOTP verificato
- Mostra wizard QR code (Google Authenticator/Authy/1Password)
- Gestisce il caso "factor unverified" residuo da tentativo abbandonato
  (unenroll + re-enroll per ottenere QR fresco)

## 5. Row Level Security (RLS)

Tutte le tabelle: `ENABLE + FORCE ROW LEVEL SECURITY`. Il `FORCE` significa
che anche il table owner deve passare per le policy (no bypass accidentale
con superuser).

Policy generiche (da `03_roles.sql`):

```sql
-- SELECT: tutti authenticated
CREATE POLICY s1_select ON public.s1 FOR SELECT TO authenticated USING (true);

-- INSERT/UPDATE: admin OR editor
CREATE POLICY s1_insert ON public.s1 FOR INSERT TO authenticated
  WITH CHECK (current_role() IN ('admin','editor'));

CREATE POLICY s1_update ON public.s1 FOR UPDATE TO authenticated
  USING       (current_role() IN ('admin','editor'))
  WITH CHECK  (current_role() IN ('admin','editor'));

-- DELETE: admin only
CREATE POLICY s1_delete ON public.s1 FOR DELETE TO authenticated
  USING (current_role() = 'admin');
```

Overridate poi da `08_year_lock.sql` (year lock), `14_mfa_editor.sql` e
`15_mfa_auditor.sql` (MFA enforcement).

### Default deny per anon

```sql
REVOKE ALL ON public.anagrafiche, public.produzione, public.fe,
              public.s1, public.s2, public.s3, public.s3_materiality
       FROM anon;
REVOKE ALL ON public.audit_log FROM anon, authenticated;
```

`anon` ha SELECT solo su:
- `public_facts` (vista materializzata aggregata)
- `s3_materiality_public` (filtro `cat_id, status` only)

E INSERT su `client_errors` con `user_id IS NULL` (per loggare errori dalla
PublicDashboard anonima).

### Test no-leak: `anonProbe`

Strumento in **Diagnostica** che crea un client Supabase separato senza
sessione e prova `SELECT * LIMIT 1` su tutte le tabelle protette:

```js
async function anonProbe () {
  const probe = root.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'ghg_anon_probe'  // isolato dalla sessione utente
    }
  });
  const TABLES = ['s1','s2','s3','fe','anagrafiche','produzione','audit_log',
                  's3_materiality','app_meta','role_map'];
  const leaked = [];
  for (const t of TABLES) {
    const { data, error } = await probe.from(t).select('*').limit(1);
    if (!error && Array.isArray(data) && data.length > 0) leaked.push(t);
  }
  return { ok: leaked.length === 0, leaked, tested: TABLES.length };
}
```

Se anche solo una tabella ritorna ≥ 1 riga al client anon → leak RLS!

## 6. PII redaction client-side

`G.db.redactPII(s)` in `SupabaseDB.jsx` filtra **prima** dell'insert in
`client_errors`:

```js
const PII_PATTERNS = [
  // Email
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // JWT (eyJ... 3 segmenti dot-separated base64url)
  [/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[jwt]'],
  // Bearer plain
  [/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [redacted]'],
  // IBAN (2 lettere + 2 cifre + 11..30 alfanumerici)
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '[iban]'],
  // Codice fiscale italiano
  [/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g, '[cf]'],
  // Telefono internazionale
  [/\+\d{1,3}(?:[\s.-]?\d{1,4}){1,4}\b/g, '[tel]']
];
```

Anche se la tabella `client_errors` è admin-only via RLS, la redaction
client-side è una **defense in depth GDPR** (data minimization).

Test in `test/redactpii.test.mjs` (8 test).

## 7. Rate limit client-side

Sliding window in `SupabaseDB.jsx`:

```js
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 30;
const _rateStamps = [];

function rateLimit (opName) {
  const now = Date.now();
  while (_rateStamps.length && _rateStamps[0] < now - RATE_WINDOW_MS) {
    _rateStamps.shift();
  }
  if (_rateStamps.length >= RATE_LIMIT) {
    throw new Error(`Rate limit: troppe mutazioni (${RATE_LIMIT} in ${RATE_WINDOW_MS/1000}s)`);
  }
  _rateStamps.push(now);
}
```

Difesa in profondità contro loop accidentali (es. import non chiuso).
Il DB ha comunque i suoi rate limit gestiti da Supabase.

## 8. Snapshot HMAC

Per export verificabili di snapshot/audit:

* `sign_snapshot` Edge Function: HMAC-SHA256 con `SNAPSHOT_HMAC_KEY` (env,
  mai esposta al client). Solo admin può chiamarla.
* `verify_snapshot` Edge Function: verifica con `constantTimeEq` per
  prevenire timing attack.

Output firmato:

```json
{
  "payload": { ... },
  "signature": "8f3a7b...",
  "data_sha256": "abc123...",
  "signed_at": "2025-03-15T10:23:45Z",
  "signer_email": "admin@gresmalt.it",
  "algorithm": "HMAC-SHA256"
}
```

Conservato come evidenza forense per audit esterni.

## 9. Hash chain audit_log (SHA-256)

Vedi [[Audit-Trail]] per dettagli completi. Riassunto:

* Ogni INSERT in `audit_log` ha `row_hash = sha256(prev_hash || ts || table || op || data)`
* Manomissione di una riga rompe la chain dalla riga in poi
* `verify_audit_chain()` ricalcola e ritorna il primo break
* Schedulato weekly (lunedì 03:30 UTC) via `verify_audit_chain_scheduled()` +
  log su `audit_chain_check`
* `pseudonymize_audit_email(uuid)` rimuove email PII (GDPR) — accetta
  che la chain risulti "broken" sul primo record pseudonimizzato

## 10. Backup criptato

`.github/workflows/backup.yml` weekly (lunedì 04:00 UTC):

```bash
pg_dump --no-owner --no-privileges --clean "$DATABASE_URL" > ghg_dump.sql
gzip -9 ghg_dump.sql
gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "$BACKUP_PASSPHRASE" ghg_dump.sql.gz
```

* Upload artifact GitHub Actions, retention 30 giorni
* **Replica S3 opzionale** se i secrets `AWS_S3_BACKUP_BUCKET`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` sono presenti → off-GitHub
  storage (no single point of failure)

`BACKUP_PASSPHRASE` deve essere generata con almeno 32 byte di entropia
(`openssl rand -base64 32`).

## 11. Secret scan in CI

`.github/workflows/build.yml` ha uno step grep-based:

```bash
grep -rEn --include='*.js' --include='*.jsx' --include='*.ts' \
  -e 'eyJhbGciOiJIUzI1NiIs[A-Za-z0-9._-]{40,}'         \  # JWT HS256 reale
  -e 'service_role[^a-zA-Z0-9_].{0,80}eyJ'             \  # service_role + JWT
  -e 'SUPABASE_DB_URL[ =:][^<].{0,8}postgres://'       \  # connection string
  -e 'SNAPSHOT_HMAC_KEY[ =:][a-fA-F0-9]{32,}'          \  # HMAC key
  src/ supabase/ test/ build.mjs
```

I pattern sono scelti per matchare **valori reali** (non placeholder
`__VAR__` o esempi).

## 12. npm audit in CI

```bash
npm audit --audit-level=high --omit=dev
```

Falla solo su CVE high/critical. Le dipendenze sono **pinnate** (no caret)
in `package.json` → audit deterministico.

## 13. Dependabot

`.github/dependabot.yml` apre PR settimanali (lunedì 06:00 Europe/Rome).

Policy raggruppamento:
* `runtime` (react, react-dom, chart.js, supabase-js): minor + patch raggruppati
* `sri-libs` (@e965/xlsx, pptxgenjs): minor + patch raggruppati — richiedono ricalcolo SRI
* `babel` (@babel/*): minor + patch raggruppati
* **Major bumps mai raggruppati** (lesson learned PR #9: un React 18→19
  mascherato come "minor" ruppe la Public Dashboard)
* Major su react/react-dom: `ignore` finché audit dedicato

## 14. Defense-in-depth riassunto

| Minaccia | Difesa 1 | Difesa 2 |
|---|---|---|
| **XSS via input utente** | React rendering safe | CSP `script-src` |
| **XSS via librerie compromised** | bundle inline | SRI integrity sui lazy |
| **CSRF** | Supabase JWT (no cookie session) | `connect-src 'self'` |
| **SQL injection** | parameterized queries (sb client) | RLS limita comunque |
| **Privilege escalation** | role check in RLS | role check in Edge Function |
| **MFA bypass** | UI forza enrollment | RLS richiede aal=aal2 |
| **Audit tampering** | hash chain SHA-256 | INSERT/UPDATE/DELETE revocati |
| **PII leak** | RLS admin-only su audit | redactPII client-side prima |
| **Brute-force login** | Cloudflare Turnstile | count_failed_logins sentry |
| **Compromise CDN** | bundle core inline | SRI sui lazy |
| **DoS Edge Function** | body size limits | rate limit Supabase |
| **Secret leak in code** | gitignore env | secret scan CI |
| **DB compromise** | RLS + FORCE | backup criptato off-GitHub |
| **Dipendenza vulnerabile** | npm audit CI | Dependabot weekly |
| **Bundle stantio** | build hash + anti-stale | SRI catch mismatch |

## Risorse

- [[Audit-Trail]] — hash chain + pseudonimizzazione GDPR
- [[Edge-Functions]] — HMAC sign/verify, CORS, role check
- [[Modello-dati]] — RLS + MFA enforcement policy
- [[Configurazione]] — secrets e env vars
