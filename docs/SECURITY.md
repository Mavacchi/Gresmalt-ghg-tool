# SECURITY — GHG Tool · Gruppo Ceramiche Gresmalt

Threat model, controlli implementati nel codice, gap noti, procedure
di risposta agli incidenti. Ogni claim è verificabile in
`sql/`, `src/`, `supabase/functions/`, `build.mjs` o `.github/`.

> **Stato del documento (2026-05-05)**: questa revisione corregge
> diverse imprecisioni della versione precedente — in particolare:
>
> - HSTS è attivo ma fornito da GitHub Pages stesso, non da Cloudflare
>   (verificato via securityheaders.com).
> - Cloudflare proxy davanti a GitHub Pages **non è attivo**.
> - 4 header HTTP (`X-Frame-Options`, `X-Content-Type-Options`,
>   `Referrer-Policy`, `Permissions-Policy`) sono **preparati nel
>   `_headers` ma non applicati** in produzione attuale.
> - `frame-ancestors 'none'` non è nella CSP perché ignorata dal
>   browser quando in `<meta>`; è solo nel `_headers` (non applicato).

---

## 1. Threat model

### Asset

| Asset                        | Sensibilità | Note |
|------------------------------|-------------|------|
| Inventario GHG (S1/S2/S3)    | Media       | Dato regolamentare CSRD |
| Volumi produzione (kg, m²)   | **Alta**    | Dato commerciale; **mai** in Public Dashboard |
| Audit log (`audit_log`)      | **Alta**    | Prova legale di chi ha modificato cosa |
| Email operatori              | **PII**     | Pseudonimizzata post-cessazione (GDPR) |
| Fattori di emissione (FE)    | Bassa       | Dati pubblici (ISPRA, DEFRA, ecoinvent) |
| Materialità S3               | Bassa       | Pubblica |
| Hash chain integrità         | **Critica** | SHA-256 link-list su audit_log |
| Snapshot firmato (HMAC key)  | **Critica** | Mai esposto al client (Edge Function only) |

### Attori e capacità presunte

| Attore                 | Capacità                                       |
|------------------------|------------------------------------------------|
| Cliente (anon)         | Naviga PublicDashboard, scarica PDF (window.print) |
| Operatore interno      | Login email+password; ruolo dal JWT            |
| Attaccante esterno     | Scraping pubblico, brute-force login, XSS     |
| Insider malevolo       | Editor/auditor che tentano privilege escalation |
| Compromise device      | Token rubato da sessionStorage; replay        |

### Vie di attacco principali e mitigazioni

| # | Attacco | Mitigazione | Verifica |
|---|---------|-------------|----------|
| 1 | Scraping volumi produzione | Anon non legge `produzione`; `public_facts` MV non espone `total_kg`/`total_m2` | `sql/03_roles.sql:77-84` (revoke anon); `sql/04_public_view.sql:201-255` (self-check) |
| 2 | Privilege escalation via user_metadata | `current_role()` legge da `app_metadata` (read-only per l'utente) | `sql/03_roles.sql:17-29` |
| 3 | XSS in note/justification | No `dangerouslySetInnerHTML`, no `eval`/`Function`; CSP via meta; lint pre-build blocca | `build.mjs:271-288`; `package.json:lint:no-dangerous-html` |
| 4 | Formula injection in export | `sanitizeForSpreadsheet` prefissa `'` su `=+-@\t\r` | `src/sanitize.js:14` |
| 5 | Manomissione audit_log | Hash chain SHA-256; revoke update/delete; verify cron settimanale | `sql/01_schema.sql:255-288`; `sql/16_audit_chain_cron.sql` |
| 6 | Brute-force login | Rate limit Supabase + Captcha Turnstile + HIBP password (config Auth, non in repo) | `src/AuthGate.jsx:215-235` per Turnstile UI |
| 7 | Token theft | `sessionStorage` (non localStorage); PKCE; `signOut({scope:'global'})` | `src/SupabaseDB.jsx:155`; `src/AuthGate.jsx:194-196` |
| 8 | Editor bypass MFA | RLS richiede `aal=aal2` per write | `sql/14_mfa_editor.sql` |
| 9 | Auditor bypass MFA | RLS richiede `aal=aal2` per SELECT su audit_log | `sql/15_mfa_auditor.sql` |
| 10 | Cross-origin sulle Edge Functions | `ALLOWED_ORIGINS` allowlist + `Bearer` obbligatorio | `supabase/functions/*/index.ts` |

---

## 2. Controlli di sicurezza implementati nel codice

### 2.1 Autenticazione e autorizzazione

| Controllo | Implementazione |
|-----------|-----------------|
| Email + password | Supabase Auth (provider configurato manualmente in dashboard) |
| PKCE flow | `src/SupabaseDB.jsx:154` (`flowType: 'pkce'`) |
| Storage token | `sessionStorage` (non `localStorage`) — `src/SupabaseDB.jsx:155` |
| Captcha Turnstile | Lazy loaded in `src/AuthGate.jsx:215-235` se `TURNSTILE_SITE_KEY` configurata; no-op altrimenti |
| MFA TOTP enforcement editor | RLS forza `aal=aal2` su INSERT/UPDATE — `sql/14_mfa_editor.sql` |
| MFA TOTP enforcement auditor | RLS forza `aal=aal2` su SELECT audit_log + `verify_audit_chain()` lancia exception — `sql/15_mfa_auditor.sql` |
| MFA wizard UI | Force enrollment per editor + auditor (no admin) — `src/AuthGate.jsx:103-140`; copy ruolo-sensibile (PR #38) |
| Helper `current_aal()` | Espone `aal` per RLS — `sql/14_mfa_editor.sql` |
| 5 ruoli | admin, editor, auditor, viewer, guest — `src/constants.js:182-192`, `src/AuthGate.jsx:69-82` |
| Ruolo letto da JWT | `auth.jwt() -> 'app_metadata' ->> 'role'` — `sql/03_roles.sql:17-29` |
| RLS forced | `ENABLE + FORCE` su tutte le tabelle private — `sql/03_roles.sql:113-128` |
| Default deny anon | `REVOKE ALL ... FROM anon` — `sql/03_roles.sql:77-84` |
| Year lock | `app_meta.locked_years` jsonb + RLS check — `sql/08_year_lock.sql` |

**Note non implementabili da repo** (configurazione Supabase manuale):
- Min password 12 caratteri
- HIBP password check
- Prevent email enumeration
- Rate limit Supabase Auth
- Site URL / Redirect URLs ristrette
- Turnstile site+secret key

Sono raccomandazioni nel `RUNBOOK.md` §1.1, ma non possono essere
verificate dal codice. Vanno controllate manualmente nel Dashboard
Supabase → Authentication.

### 2.2 Integrità audit log

| Controllo | Implementazione |
|-----------|-----------------|
| Hash chain SHA-256 | `prev_hash` + `row_hash` su ogni riga — `sql/01_schema.sql:255-288` |
| Trigger `write_audit` | SECURITY DEFINER su 8 tabelle: anagrafiche, produzione, fe, s1, s2, s3, s3_materiality, app_meta — `sql/01_schema.sql:333-347` + `sql/05_app_meta.sql:18-21` |
| Revoke write su audit_log | `revoke insert, update, delete on audit_log from authenticated, anon` — `sql/03_roles.sql:174` |
| Verifica on-demand | RPC `verify_audit_chain()` — admin sempre, auditor a aal2 — `sql/03_roles.sql:34-71` + override `sql/15_mfa_auditor.sql:63-109` |
| Verifica schedulata | Cron `ghg_verify_audit_chain` lunedì 03:30 UTC — `sql/16_audit_chain_cron.sql` |
| Storico schedulazioni | Tabella `audit_chain_check` + view `audit_chain_status` (ultimi 10) — `sql/16_audit_chain_cron.sql` |
| UI Diagnostica | Card "Audit chain — check schedulati" — `src/sections/Diagnostics.jsx` |

### 2.3 Difesa XSS / code injection

| Controllo | Implementazione |
|-----------|-----------------|
| CSP via `<meta http-equiv>` | Iniettata in `site/index.html` da `build.mjs:372` |
| Forbidden tokens build-time | Build fallisce su `dangerouslySetInnerHTML`, `eval(`, `new Function(`, `document.write(`, `innerHTML =` — `build.mjs:271-288` |
| ESLint anti-eval | `no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url` come `error` — `.eslintrc.json:27-30` |
| `lint:no-dangerous-html` | Script npm con `grep` ricorsivo che fallisce se trova la stringa — `package.json:13` |
| JSX pre-compilato | Babel preset-react classic offline; nessun transformer runtime — `build.mjs:148-154` |
| SRI sui CDN-lazy | sha384 calcolato da bundle locale; verificato dal browser — `build.mjs:130-133, 300-307` |
| Pinning rigido CDN-lazy | `@e965/xlsx` 0.20.3 + `pptxgenjs` 4.0.1 senza caret — `package.json:18, 21` |

**CSP attuale** (verificata in `build.mjs:214-224`):
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

**Note importanti sulla CSP**:
- `'unsafe-inline'` su `script-src` è necessario perché il bundle è
  inlined in HTML (SRI sui blocchi inline non è supportato dai
  browser). Mitigato da `build.mjs:271-288` che blocca eval/Function
  nei sorgenti.
- `frame-ancestors 'none'` **non è nella CSP attuale** perché ignorata
  dal browser se messa in `<meta>` (deve essere header HTTP). È solo
  nel `_headers` generato — vedi §6.

### 2.4 Sanitizzazione export

`src/sanitize.js:10-16`:
```js
function sanitizeForSpreadsheet (v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}
```

Applicato in `src/io.jsx` su Excel (`exportExcel`), CSV
(`exportCSV`) e PPTX (`exportPPTX`).

### 2.5 Import limits

`src/io.jsx:importExcel`:
- Max 5 MB
- Solo `.xls` / `.xlsx` (regex check, non solo MIME)
- Validazione per riga via `G.calc.validateRow` (`src/calc.js:106-169`)
- Anteprima diff (new/updated/unchanged) prima del commit DB
- Su errore batch upsert, fallback per-riga per identificare il colpevole

### 2.6 Snapshot firmato (Edge Function)

`supabase/functions/sign_snapshot/index.ts`:

| Controllo | File:linea |
|-----------|-----------|
| HMAC-SHA256 con `SNAPSHOT_HMAC_KEY` (mai esposta al client) | `:20, :52-59` |
| Verifica `app_metadata.role === 'admin'` server-side | `:97-100` |
| `ALLOWED_ORIGINS` allowlist (CSV) | `:23-27, :79-84` |
| Body size guard 1 MB | `:103-104` |
| JSON parse safe in try/catch | `:106-111` |
| Constant-time compare in `verify_snapshot` | `supabase/functions/verify_snapshot/index.ts:44-49` |

Tutte le 3 Edge Functions importano `@supabase/supabase-js@2.105.3`
(allineato col main bundle dopo PR #38).

### 2.7 Rate limit client-side

`src/SupabaseDB.jsx:127-142`: sliding window 30 mutazioni / 10s.
Throw esplicito su rate limit per evitare flooding accidentale (es.
loop di import non chiuso). Difesa supplementare oltre ai limiti
Supabase server-side.

### 2.8 Logging client-side con redazione PII

`client_errors` table (`sql/06_client_errors.sql`):
- INSERT consentito anche da anon (errori in PublicDashboard)
- SELECT solo admin
- Retention 90 giorni via cron `ghg_purge_client_errors` (giornaliero
  03:00 UTC) — `sql/13_hardening.sql:331-335`

Filtro `redactPII` in `src/SupabaseDB.jsx:521-544` redatta:
- email → `[email]`
- JWT (eyJ...3 segmenti) → `[jwt]`
- Bearer token → `Bearer [redacted]`
- IBAN (2 lettere + 2 cifre + 11–30 alfanum) → `[iban]`
- Codice fiscale italiano (16 caratteri pattern noto) → `[cf]`
- Telefono internazionale → `[tel]`

Defense-in-depth: SELECT è già admin-only, ma il filtro client-side
evita che PII finisca su disco anche per un breve momento.

### 2.9 Anon Probe

`src/SupabaseDB.jsx:294-324`: client Supabase isolato (no session,
storageKey separato `ghg_anon_probe`) tenta SELECT su 10 tabelle
protette (`s1`, `s2`, `s3`, `fe`, `anagrafiche`, `produzione`,
`audit_log`, `s3_materiality`, `app_meta`, `role_map`). Se ≥1 tabella
ritorna ≥1 riga, c'è un leak RLS. Esposto in Diagnostica → card
"Integrità & sicurezza" → "No-leak anon SELECT".

---

## 3. Privacy & GDPR

### 3.1 Dati personali nei sistemi

Solo email operatori (autenticazione). Nessun altro PII trattato.

### 3.2 Pseudonimizzazione email in audit_log

Implementazione in `sql/13_hardening.sql:156-256`:

- **Trigger admin (right-to-be-forgotten)**:
  ```sql
  select public.pseudonymize_audit_email('<uuid>'::uuid);
  ```
  Sostituisce `user_email` con `pseudo:<sha256_hex16>` per tutte le
  righe di quell'utente.
- **Cron mensile automatico** (`ghg_pseudo_audit`, 1° del mese 04:00 UTC):
  pseudonimizza email di:
  - utenti cessati (presenti in audit_log ma non più in `auth.users`)
  - utenti dormienti (`last_sign_in_at` > 24 mesi)

### 3.3 Trade-off integrità vs GDPR

La pseudonimizzazione cambia `user_email` quindi rompe il `row_hash`
calcolato su quei record. `verify_audit_chain()` segnerà come "rotti"
i record pseudonimizzati. Comportamento documentato in
`sql/13_hardening.sql:148-154`. È un compromesso accettato:
integrità sacrificata sulle sole righe pseudonimizzate per conformità
GDPR.

### 3.4 Retention

| Dato | Retention | Meccanismo |
|------|-----------|------------|
| `audit_log` | 10 anni (CSRD/CRSF) | Nessun delete; pseudonimizzazione email |
| `client_errors` | 90 giorni | Cron `ghg_purge_client_errors` (giornaliero 03:00 UTC) |
| Email operatori | Pseudonimizzate post-cessazione o dopo 24 mesi di dormienza | Cron `ghg_pseudo_audit` (mensile) |
| Backup GitHub artifact | 30 giorni | `actions/upload-artifact` retention-days |
| Backup S3 | Indefinito (se configurato) | Bucket policy esterna |

### 3.5 Diritti GDPR

- **Cancellazione utente**: ban/delete da Supabase Auth + delete da
  `role_map` + `pseudonymize_audit_email`. Procedura completa in
  [`RUNBOOK.md`](RUNBOOK.md) §3.2.
- `audit_log.user_id` è nullable: cancellare l'utente da `auth.users`
  lascia il record con email pseudonimizzata.

---

## 4. Risposta agli incidenti

### 4.1 Severità e SLA

| Livello   | Esempio                                               | SLA risposta |
|-----------|-------------------------------------------------------|--------------|
| Critica   | Catena hash rotta non spiegabile da pseudonimizzazione, leak su tabelle private | 1 ora |
| Alta      | Brute-force riuscito, dati alterati in modo manifesto | 4 ore        |
| Media     | Rate limit aggirato, login anomalo, errori massivi    | 24 ore       |
| Bassa     | Errori client persistenti                             | 1 settimana  |

### 4.2 Procedura "lock down" (admin)

Espone un flag globale `app_meta.app_locked`:

```sql
-- Bloccare l'app
update public.app_meta set value = to_jsonb(true) where key = 'app_locked';

-- Riaprire
update public.app_meta set value = to_jsonb(false) where key = 'app_locked';
```

L'app rispetta il flag mostrando un banner di manutenzione e
disattivando le mutazioni.

### 4.3 Verifica integrità audit chain

Procedura completa in [`RUNBOOK.md`](RUNBOOK.md) §4.2. In sintesi:

```sql
-- On-demand
select * from public.verify_audit_chain();
-- 0 righe = integro

-- Storico schedulato (ultimi 10 run)
select * from public.audit_chain_status;
```

### 4.4 Sentinella brute-force login

Funzione SQL pronta ma **nessun consumer cron attualmente
configurato** (`sql/13_hardening.sql:266-286`):

```sql
select * from public.count_failed_logins(60);
-- failed_attempts | distinct_emails | last_attempt
```

Per attivarla servirebbe una Edge Function schedulata che chiami la
funzione e notifichi via Slack/email su soglia. Attualmente questo
componente **non è implementato**.

### 4.5 Rotazione publishable key dopo leak

1. Supabase Dashboard → Project Settings → API Keys → "Rotate
   publishable key" (o "Rotate anon key" su progetti legacy).
2. Aggiornare il secret `SUPABASE_PUBLISHABLE_KEY` (e/o legacy
   `SUPABASE_ANON_KEY`) su GitHub Actions.
3. Re-trigger `deploy.yml` per rebuild + redeploy site.
4. Il `keepalive.yml` usa lo stesso secret, raccoglie automaticamente.
5. Nessuna comunicazione a clienti necessaria (la chiave è iniettata
   nel bundle a build-time, ma il bundle è trasparente — niente cambia
   per il visitatore).

### 4.6 Contatti

| Soggetto | Riferimento |
|----------|-------------|
| Admin tecnico interno | (documentazione interna riservata, vedi `private/contacts.md`) |
| Supabase support | support@supabase.io (Pro+ tier) |

---

## 5. Hosting e header HTTP — stato reale

### 5.1 Configurazione attuale (verificata 2026-05-05)

Test su `https://mavacchi.github.io/Gresmalt-ghg-tool/` via
securityheaders.com:

| Header HTTP | Stato | Fornito da |
|-------------|-------|-----------|
| `Strict-Transport-Security: max-age=31556952` | ✅ Attivo | GitHub Pages (default su HTTPS forzato) |
| `Content-Security-Policy` | ✅ Attivo via `<meta http-equiv>` | `build.mjs:372` (presente nell'HTML, non come HTTP header) |
| `X-Frame-Options` | ❌ **Non applicato** | _ |
| `X-Content-Type-Options: nosniff` | ❌ **Non applicato** | _ |
| `Referrer-Policy` | ❌ **Non applicato** | _ |
| `Permissions-Policy` | ❌ **Non applicato** | _ |
| `Cross-Origin-Opener-Policy` | ❌ **Non applicato** | _ |
| `Cross-Origin-Resource-Policy` | ❌ **Non applicato** | _ |

**Conseguenze**:
- Protezione clickjacking via `frame-ancestors` non attiva (la
  direttiva è ignorata dai browser quando in `<meta>`)
- Protezione MIME-sniffing non applicata
- Privacy Referrer non controllata
- Permissions-Policy non applicata

### 5.2 Cosa fa il build per gli header

`build.mjs:614-633` genera `site/_headers`:

```
/build.txt
  Cache-Control: no-store, no-cache, must-revalidate
  Pragma: no-cache

/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
```

Questo file è in formato Cloudflare Pages / Netlify e viene
applicato **solo** se davanti al sito c'è uno di quei provider
(o un Cloudflare proxy che li applica via Transform Rules).
Su GitHub Pages diretto è ignorato. Nota esplicita in
`build.mjs:611-613`.

### 5.3 Come attivare i 4 header mancanti

Tre opzioni discusse internamente (free, in ordine di complessità):

1. **Cloudflare proxy davanti a GitHub Pages** (Free tier):
   richiede accesso DNS al dominio `gresmalt.it`. Configurazione via
   Transform Rules → Modify Response Header. Mantiene GitHub Pages.
2. **Migrazione a Cloudflare Pages**: il file `_headers` è letto
   nativamente. Richiede modifica di `deploy.yml` e CNAME.
3. **Migrazione a Netlify**: idem.

Allo stato attuale **nessuna delle 3 è implementata**. Non è una
limitazione del codice ma una scelta operativa pendente. Discussione
con riferimenti pratici per opzione 1 nelle interazioni di sviluppo
(maggio 2026).

---

## 6. Backup

### 6.1 Workflow `.github/workflows/backup.yml`

| Aspetto | Valore |
|---------|--------|
| Schedule | `0 4 * * 1` (lunedì 04:00 UTC) |
| Trigger manuale | `workflow_dispatch` |
| Source | `pg_dump --no-owner --no-privileges --clean "$DATABASE_URL"` |
| Compressione | `gzip -9` |
| Cifratura | `gpg --symmetric --cipher-algo AES256 --passphrase "$BACKUP_PASSPHRASE"` |
| Output | File `.gpg` |
| Storage primario | GitHub artifact, retention 30 giorni |
| Storage replica | S3 con `--sse AES256 --acl bucket-owner-full-control` (no-op se `AWS_S3_BACKUP_BUCKET` non configurato) |

### 6.2 PITR (Pro+ tier Supabase)

7 giorni di Point-In-Time Recovery automatico. Gestito da Supabase,
non in nostro controllo. Su tier Free non disponibile.

### 6.3 Procedura di restore

In [`RUNBOOK.md`](RUNBOOK.md) §3.3.

---

## 7. Difesa in profondità — anti-stale-cache

`build.mjs:482-543` implementa 3 livelli di mitigazione contro
bundle stantio in cache (rilevante per security: un bundle vecchio
potrebbe avere vulnerabilità note risolte nelle versioni successive).

| Livello | Meccanismo |
|---------|-----------|
| 1 | bfcache flash → al `pageshow` con `e.persisted=true`, nasconde HTML e ricarica |
| 2 | `/build.txt` fetch (12 byte cache-busted) → confronto col `BUILD_HASH` inlined; hard reload se diverso. Loop guard 10s |
| 3 | localStorage marker `ghg_build` (no-op funzionale, utile per Diagnostica) |

---

## 8. Dipendenze e CVE

### 8.1 Pinning

Versioni runtime pinnate (no caret) in `package.json:15-23`:
- `react` 18.3.1, `react-dom` 18.3.1
- `chart.js` 4.5.1
- `@supabase/supabase-js` 2.105.3
- `@e965/xlsx` 0.20.3
- `pptxgenjs` 4.0.1
- `@babel/core` 7.29.0, `@babel/preset-react` 7.28.5

### 8.2 Dependabot policy

`.github/dependabot.yml`:
- npm: schedule weekly Monday 06:00 Europe/Rome
- GitHub Actions: schedule weekly idem
- Group `runtime`, `sri-libs`, `babel`: solo `minor` + `patch`
- `react`/`react-dom` major bump: **ignorati** (richiede audit del bundle)
- Major bump fuori dai group → PR singole con label `security-review`

### 8.3 CVE attuali

- `xlsx` upstream era vulnerabile a prototype pollution + ReDoS;
  migrato al fork community `@e965/xlsx` 0.20.x con CVE patchate
  (commento storico in `build.mjs:296-299`).
- `playwright` < 1.55.1 aveva GHSA-7mvr-c777-76hp (cert SSL non
  verificato durante download dei browser); fixato con bump a 1.59.1
  (PR #33).
- `npm audit --audit-level=high --omit=dev`: pulito alla data di
  questo doc.

---

## 9. Checklist pre-deploy

Verifiche da eseguire prima di un release in produzione. Tutte
verificabili tramite codice e/o tooling automatizzato.

### 9.1 Code-level (verificate dalla CI `build.yml`)

- [ ] `npm run lint` → 0 errors (max 50 warnings tollerati)
- [ ] `npm run lint:no-dangerous-html` → no match
- [ ] `npm test` → 67/67 unit test pass
- [ ] `npm run test:e2e` → 15/15 smoke test pass
- [ ] `npm audit --audit-level=high --omit=dev` → 0 vulnerabilità
- [ ] Secret scan in `build.yml:46-62` non rileva pattern sospetti
- [ ] `node build.mjs` completa senza errori (forbidden tokens check)

### 9.2 Database (manuale via SQL Editor Supabase)

- [ ] Tutti i 12 file SQL eseguiti in ordine
- [ ] `select count(*) from cron.job` mostra 4 job (su Pro+)
- [ ] `select * from public.verify_audit_chain()` ritorna 0 righe
- [ ] Self-check di `04_public_view.sql` non lancia exception
- [ ] Anon Probe in Diagnostica mostra "0 leak"

### 9.3 Auth (manuale via Dashboard Supabase)

- [ ] Provider email abilitato; altri provider disabilitati
- [ ] HIBP password check ON
- [ ] Prevent email enumeration ON
- [ ] Min password 12 caratteri
- [ ] Captcha Turnstile site+secret configurati
- [ ] Site URL ristretta al dominio prod
- [ ] Redirect URLs ristrette al dominio prod

### 9.4 Edge Functions (manuale via CLI Supabase)

- [ ] `SNAPSHOT_HMAC_KEY` configurata (`supabase secrets list`)
- [ ] `ALLOWED_ORIGINS` configurata con dominio prod
- [ ] `sign_snapshot`, `verify_snapshot`, `verify_audit_chain` deployate
- [ ] Test manuale di firma + verifica snapshot da UI Output

### 9.5 GitHub (manuale)

- [ ] Secrets configurati: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
      `TURNSTILE_SITE_KEY`, `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`
- [ ] Workflow `keepalive.yml` triggerato manualmente almeno una volta
      (verde in Actions)
- [ ] Workflow `backup.yml` triggerato manualmente almeno una volta
      (artifact `.gpg` scaricabile)
- [ ] Branch protection su `main` (richiede review)

### 9.6 Hosting (manuale)

- [ ] HTTPS forzato (default GitHub Pages)
- [ ] Custom domain configurato (se applicabile)
- [ ] HSTS verificato attivo via securityheaders.com

### 9.7 Gap noti accettati

I seguenti gap sono **conosciuti e accettati**, documentati per
trasparenza. Non bloccano il deploy ma sono nel backlog
operativo:

- 4 header HTTP (X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy) **non applicati** in
  produzione. Risolvibile mettendo Cloudflare proxy davanti a
  GitHub Pages — vedi §5.3.
- Sentinella brute-force `count_failed_logins` non collegata a un
  consumer di alert (vedi §4.4).
- Backup S3 off-GitHub non configurato (manca account AWS — vedi
  `RUNBOOK.md` §3.1).
- Frame-ancestors clickjacking non protetto (CSP meta non onorata
  dai browser; richiede header HTTP).
