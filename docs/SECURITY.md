# SECURITY — GHG Tool · Gruppo Ceramiche Gresmalt

Threat model, controlli implementati e procedure di risposta agli incidenti.

---

## 1. Threat model (sintesi)

### Asset
- **Inventario GHG** (S1, S2, S3): dato regolamentare CSRD.
- **Audit trail**: prova legale di chi ha modificato cosa.
- **Volumi di produzione** (kg, m²): dato commercialmente sensibile —
  mai esposto al pubblico.
- **Email operatori**: PII soggetto a pseudonimizzazione post-cessazione.

### Attori e capacità
| Attore                 | Capacità presunta                              |
|------------------------|------------------------------------------------|
| Cliente (anon)         | Naviga la PublicDashboard, scarica PDF.        |
| Operatore interno      | Login email+password; ruolo da JWT.            |
| Attaccante esterno     | Scraping pubblico, brute-force login, XSS.     |
| Insider malevolo       | Editor che tenta privilege escalation.         |
| Compromissione device  | Token rubato da localStorage; replay.          |

### Vie di attacco principali
1. **Scraping volumi produzione** → mitigato: anon non può leggere `produzione`,
   `public_facts` espone solo rapporti.
2. **Privilege escalation via user_metadata** → mitigato: `current_role()`
   legge da `app_metadata` (immutabile per l'utente).
3. **XSS in note/justification** → mitigato: niente `dangerouslySetInnerHTML`,
   CSP rigida, JSX pre-compilato (no `eval`/`Function()`).
4. **Formula injection in export** → mitigato: `sanitizeForSpreadsheet`
   prefissa `'` su celle che iniziano con `=+-@\t\r`.
5. **Manomissione audit_log** → mitigato: hash chain SHA-256;
   `revoke update, delete on audit_log`; verifica via `verify_audit_chain()`.
6. **Brute-force login** → mitigato: rate limit Supabase (5/15min/IP);
   captcha Turnstile; HIBP password check; "prevent email enumeration".
7. **Token theft** → mitigato: `sessionStorage` (non `localStorage`);
   PKCE flow; `signOut({ scope: 'global' })`.

---

## 2. Controlli di sicurezza implementati

### Autenticazione
- Email + password (Supabase Auth)
- PKCE flow
- MFA TOTP **obbligatorio**:
  - per `admin`, `auditor` (organizzativo)
  - per `editor` (enforcement DB-side via RLS `aal=aal2`,
    sql/14_mfa_editor.sql + UI wizard di enrollment forzato in
    AuthGate.jsx). Editor senza TOTP non possono fare INSERT/UPDATE.
- HIBP password check abilitato
- Rate limit: 5 tentativi / 15 min / IP
- Captcha Cloudflare Turnstile sul form login
- Site URL e Redirect URLs ristrette al dominio prod

### Autorizzazione
- 5 ruoli: admin, editor, auditor, viewer, guest
- Ruolo letto da `app_metadata.role` (mai `user_metadata`)
- ENABLE + FORCE ROW LEVEL SECURITY su tutte le tabelle private
- REVOKE ALL espliciti per `anon` (default deny)
- Solo policy con `current_role() in (...)` autorizzano write

### Integrità audit
- Trigger SECURITY DEFINER `write_audit` su 8 tabelle
- Hash chain SHA-256 (prev_hash + row_hash)
- REVOKE update, delete su audit_log per authenticated/anon
- Verifica esposta in Diagnostica via `verify_audit_chain()`
- Retention 10 anni; pseudonimizzazione email post-cessazione

### XSS / iniezioni
- CSP via `<meta http-equiv>`:
  ```
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://cdn.sheetjs.com https://cdn.jsdelivr.net https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://*.supabase.co wss://*.supabase.co;
  img-src 'self' data:;
  frame-ancestors 'none';
  frame-src https://challenges.cloudflare.com;
  base-uri 'self';
  object-src 'none';
  ```
- Niente `dangerouslySetInnerHTML` (verificato da `npm run lint:no-dangerous-html`)
- JSX pre-compilato offline (no `eval` runtime)
- SRI hash su SheetJS / pptxgenjs (lazy-loaded da CDN)
- Pinning rigido (no caret) di SheetJS, pptxgenjs

### Sanitizzazione export
- `sanitizeForSpreadsheet(v)` su CSV, Excel, PPTX
- Test in checklist QA: `=HACK()` deve essere salvato come `'=HACK()`.

### Import limits
- Max 5 MB
- Solo .xls / .xlsx (regex check, non solo MIME)
- Anteprima diff prima del commit DB

### Snapshot firmato
- HMAC-SHA256 calcolato server-side (Edge Function)
- Chiave non esposta al client
- Verifica via `verify_snapshot`

### Logging
- `client_errors` insert-only, leggibile solo da admin
- Retention 90 giorni — **purge automatico via pg_cron** schedulato
  quotidianamente da `sql/13_hardening.sql` (`ghg_purge_client_errors`)
- **Filtro PII client-side** in `logClientError` (src/SupabaseDB.jsx):
  email, JWT, Bearer, IBAN, codice fiscale e numero telefono vengono
  redatti prima dell'INSERT (defense in depth oltre alla policy admin-only)
- Allerta su >10 login falliti consecutivi: usare la SQL function
  `count_failed_logins(60)` da una Edge Function chiamata via cron
  esterno (Supabase pg_cron tier Pro o GitHub Actions)

### Backup
- Pro+: PITR 7 giorni
- Free: dump SQL settimanale cifrato AES-256

### Hosting
- HTTPS forzato
- HSTS / Permissions-Policy via Cloudflare proxy davanti a GitHub Pages
- `frame-ancestors 'none'` previene clickjacking

---

## 3. Privacy & CSRD

- Dati personali nei sistemi: solo email operatori (autenticazione).
- **Pseudonimizzazione automatica delle email in audit_log**:
  implementata in `sql/13_hardening.sql` come function
  `purge_audit_emails_for_disabled_users()` schedulata via pg_cron
  il 1° di ogni mese (`ghg_pseudo_audit`). Sostituisce `user_email`
  con `pseudo:<sha256_hex16>` per:
  - utenti cessati (presenti nell'audit_log ma non più in `auth.users`);
  - utenti dormienti (`last_sign_in_at` > 24 mesi).
- Trigger ad-hoc (admin) per il "right to be forgotten":
  `select public.pseudonymize_audit_email('<uuid>'::uuid);`
- Retention dati operativi: 10 anni (CSRD/CRSF).
- Diritti GDPR: cancellazione utente (auth.users) lascia audit_log
  con email pseudonimizzata; `user_id` nullable.

---

## 4. Risposta agli incidenti

### Severità

| Livello   | Esempio                                               | SLA risposta |
|-----------|-------------------------------------------------------|--------------|
| Critica   | Catena hash rotta, leak su tabelle private            | 1 ora        |
| Alta      | Brute-force riuscito, dati alterati                   | 4 ore        |
| Media     | Rate limit aggirato, login anomalo                    | 24 ore       |
| Bassa     | Errori client persistenti                             | 1 settimana  |

### Procedura "lock down" (admin)

```sql
update public.app_meta set value = to_jsonb(true) where key = 'app_locked';
```

L'app rispetta `app_locked` mostrando un banner di manutenzione e
disattivando le mutation. Per riaprire:

```sql
update public.app_meta set value = to_jsonb(false) where key = 'app_locked';
```

### Verifica catena audit

```sql
select * from public.verify_audit_chain();
```

Se ritorna righe → catena rotta. Recuperare l'ultimo backup integro
e indagare l'incidente.

### Rotazione publishable key dopo leak

1. Supabase Dashboard → Project Settings → API Keys → "Rotate publishable key"
   (o, se il progetto è ancora su legacy keys, "Rotate anon key").
2. Aggiornare il secret `SUPABASE_PUBLISHABLE_KEY` (o, se ancora in
   uso, il legacy `SUPABASE_ANON_KEY`) su GitHub Actions.
3. Rebuild + redeploy site.
4. Aggiornare il workflow `keepalive.yml` (usa lo stesso secret).
5. Notificare i clienti che gli URL vecchi non funzionano più.

### Contatti incidente

- Internal: marco.vacchi@gresmalt.it (admin)
- Supabase support: support@supabase.io (Pro+ tier)
- Cloudflare: support@cloudflare.com

---

## 5. Checklist pre-deploy

- [ ] CSP iniettata via meta http-equiv (verifica HTML output)
- [ ] Niente `dangerouslySetInnerHTML` (`npm run lint:no-dangerous-html`)
- [ ] SRI hash valorizzati per pptxgenjs e SheetJS
- [ ] Test SQL no-leak di `04_public_view.sql` passa
- [ ] Anonymous SELECT su s1/s2/s3/produzione/fe → 0 righe (Diagnostica → Anon Probe)
- [ ] `auth.jwt()` legge da `app_metadata` (non `user_metadata`)
- [ ] Rate limit Supabase configurato (5/15min/IP)
- [ ] Captcha Turnstile site key configurato
- [ ] MFA TOTP enforced per admin/auditor (organizzativo) + editor (RLS aal2 + UI wizard, sql/14_mfa_editor.sql)
- [ ] `client_errors` retention 90 giorni attivo (job pg_cron `ghg_purge_client_errors`)
- [ ] Pseudonimizzazione email audit_log attiva (job pg_cron `ghg_pseudo_audit`)
- [ ] `sql/13_hardening.sql` eseguito (RPC atomiche save_produzione + cascade_fe_update)
- [ ] Workflow keepalive.yml verde
- [ ] Backup workflow testato (anche solo dry-run)
- [ ] Replica off-GitHub configurata (`AWS_S3_BACKUP_BUCKET` + credenziali) — raccomandato
- [ ] `ALLOWED_ORIGINS` impostata sulle 3 Edge Functions
- [ ] Edge Function `sign_snapshot` deployata (oppure UI mostra fallback non firmato)
- [ ] Dependabot attivo (`.github/dependabot.yml`)
- [ ] `npm audit --audit-level=high --omit=dev` pulito
- [ ] Test unit verdi (`npm test` — calc, io, zip, redactPII)
- [ ] Rotazione publishable key documentata in calendario operativo
