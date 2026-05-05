# RUNBOOK — GHG Tool · Gruppo Ceramiche Gresmalt

Procedure operative basate sullo stato attuale del codice. Tutti i
riferimenti sono verificabili in `sql/`, `src/`, `supabase/functions/`,
`.github/workflows/`.

---

## 1. Setup iniziale (one-time)

### 1.1 Progetto Supabase

1. Creare un nuovo progetto Supabase. Per CSRD compliance scegliere una
   region UE (es. Frankfurt). Annotare `Project URL` e `Project ref`
   da Settings → General.
2. Settings → API → annotare:
   - **Publishable key** (formato `sb_publishable_...`).
     Il vecchio nome **anon key** (legacy JWT) è ancora supportato come
     fallback dai workflow e dal `build.mjs`.
   - **Service role key** (mai esposta al client; serve per backup e
     Edge Functions internamente).
3. SQL Editor → eseguire **in ordine** i 12 file di `sql/`:

   ```
   01_schema.sql              ← 9 tabelle base + audit hash chain
   02_data_seed.sql           ← 7 anagrafiche, 80 FE, S1/S2/S3 esempio
   03_roles.sql               ← RLS forced + current_role + verify_audit_chain
   04_public_view.sql         ← public_facts MV + RPC pubbliche + no-leak self-check
   05_app_meta.sql            ← app_meta + keepalive_ping
   06_client_errors.sql       ← logging client + retention 90gg
   07_invite_operators.sql    ← role_map + trigger di propagazione ruoli
   08_year_lock.sql           ← sign-off anno (RLS aggiuntiva)
   13_hardening.sql           ← RPC atomiche + GDPR + 3 cron pg_cron
   14_mfa_editor.sql          ← MFA TOTP obbligatoria editor (aal2 in RLS)
   15_mfa_auditor.sql         ← MFA TOTP obbligatoria auditor (aal2 su audit_log)
   16_audit_chain_cron.sql    ← verify_audit_chain settimanale + audit_chain_check
   ```

   Tutti idempotenti. Ogni file termina con un commento `end of …`.
4. Authentication → Providers → abilitare solo email. Configurare:
   - **Prevent email enumeration**: ON
   - **Password complexity**: minimo consigliato 12 caratteri
   - **HIBP** (haveibeenpwned): ON
   - **Captcha** (Cloudflare Turnstile): site key + secret key
5. Authentication → Site URL e Redirect URLs ristrette al dominio prod.
6. Authentication → MFA → TOTP enabled.
7. Database → Extensions → verificare `pgcrypto` (creato da `01_schema.sql`)
   e — su tier Pro+ — `pg_cron` per le 4 schedulazioni in 13/16.
   Sul tier Free, `pg_cron` non è disponibile e i blocchi `do $cron$`
   in 13/16 emettono `raise notice` senza schedulare nulla.

### 1.2 MFA per editor e auditor

`sql/14_mfa_editor.sql` e `sql/15_mfa_auditor.sql` impongono `aal=aal2`
nelle policy RLS:

| Ruolo    | Conseguenza senza MFA TOTP                                   |
|----------|--------------------------------------------------------------|
| editor   | INSERT/UPDATE su s1/s2/s3/produzione/fe/anagrafiche/materiality rifiutati |
| auditor  | SELECT su `audit_log` e `audit_chain_check` rifiutato; `verify_audit_chain()` lancia exception |
| admin    | nessun enforcement DB-side (override d'emergenza per evitare lockout) |
| viewer   | non scrive, non legge audit_log → enforcement non applicabile |

UI wizard di enrollment forzato in `src/AuthGate.jsx:103-140`:
copre sia editor sia auditor. Copy del wizard ruolo-sensibile
(editor: "Per modificare i dati...", auditor: "Per consultare l'audit
log...") da PR #38.

App TOTP RFC 6238 supportate: Google Authenticator, Authy, 1Password,
Bitwarden, Microsoft Authenticator.

### 1.3 Inviti operatori

1. Authentication → Users → Invite per ognuno degli operatori. Le
   email reali NON sono in repo (vedi nota in `sql/07_invite_operators.sql:155-160`).
2. Aggiungere mapping email → ruolo nella tabella `public.role_map`:
   ```sql
   insert into public.role_map (email, role) values
     ('admin@esempio.com',   'admin'),
     ('editor1@esempio.com', 'editor')
   on conflict (email) do update set role = excluded.role;
   ```
3. I trigger `apply_role_from_map_trg` (su `auth.users`) e
   `propagate_role_map_change_trg` (su `role_map`) si occupano di
   scrivere `app_metadata.role` su `auth.users.raw_app_meta_data`.
   Vedi `sql/07_invite_operators.sql:81-148`.
4. Per **promuovere** un utente esistente:
   ```sql
   insert into public.role_map (email, role) values
     ('utente@esempio.com', 'admin')
   on conflict (email) do update set role = excluded.role;
   ```
   L'utente deve fare logout/login per ricevere un JWT con il nuovo ruolo.

### 1.4 GitHub repo (secret + variables)

Settings → Secrets and variables → Actions:

**Secrets obbligatori**:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (con fallback `SUPABASE_ANON_KEY` legacy)

**Secrets opzionali**:
- `TURNSTILE_SITE_KEY` — captcha login (se non configurata, captcha
  disabilitato; vedi `src/AuthGate.jsx:215-235`)
- `SUPABASE_DB_URL` — connection string per backup workflow
- `BACKUP_PASSPHRASE` — passphrase GPG AES-256 per backup
- `AWS_S3_BACKUP_BUCKET` + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
  + `AWS_DEFAULT_REGION` — replica off-GitHub del backup (no-op se
  mancanti, vedi `.github/workflows/backup.yml:56-74`)

**Variables (override di default)**:
- `COMPANY_LEGAL_NAME` (default `'Gruppo Ceramiche Gresmalt S.p.A.'`)
- `COMPANY_VAT` (default `'IT00000000000'`)
- `SUSTAINABILITY_EMAIL` (default `'sostenibilita@gresmalt.it'`)
- `PUBLIC_DASHBOARD_URL`
- `SCHEMA_VERSION` (default `'1'`)

Workflow attivi (verificare in Actions tab):
- **Build site** (`build.yml`): trigger push/PR — lint + secret scan + npm audit + 67 unit + 15 smoke e2e + build artifact
- **Build & Deploy to GitHub Pages** (`deploy.yml`): trigger push main — build + deploy automatico
- **Supabase keep-alive** (`keepalive.yml`): cron `0 12 */3 * *` (ogni 3 giorni alle 12:00 UTC)
- **Weekly DB backup** (`backup.yml`): cron `0 4 * * 1` (lunedì 04:00 UTC)

### 1.5 Build & deploy iniziale

```bash
npm install
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
TURNSTILE_SITE_KEY=0xAAAA... \
COMPANY_LEGAL_NAME='Gruppo Ceramiche Gresmalt S.p.A.' \
COMPANY_VAT='IT00000000000' \
SUSTAINABILITY_EMAIL='sostenibilita@gresmalt.it' \
PUBLIC_DASHBOARD_URL='https://sustainability.gresmalt.it' \
node build.mjs
```

Output: `site/index.html` (~1058 KB autocontenuto) + `site/.nojekyll`
+ `site/build.txt` + `site/_headers`.

### 1.6 Hosting su GitHub Pages

Configurazione attuale (vedi `.github/workflows/deploy.yml`):
- Source: GitHub Actions workflow `actions/deploy-pages@v5`
- Trigger: push su `main`
- Concurrency group `pages` con `cancel-in-progress: false`
- Permissions: `contents: read`, `pages: write`, `id-token: write`

GitHub Pages serve direttamente `site/` con HTTPS forzato e HSTS
fornito da GitHub stesso (verificato 2026-05-05 via securityheaders.com:
`strict-transport-security: max-age=31556952` con `server: GitHub.com`,
no Cloudflare proxy).

**Limitazione nota**: GitHub Pages **non** legge il file `site/_headers`
generato da `build.mjs:614-633`. Conseguenza: 4 header HTTP non sono
applicati in produzione attuale:
- `X-Frame-Options`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

Per applicare questi 4 header serve mettere un CDN davanti che legga
`_headers` (Cloudflare proxy con Transform Rules, oppure migrare a
Cloudflare Pages / Netlify che supportano `_headers` nativamente).
Vedi [`docs/SECURITY.md`](SECURITY.md) §6 per i dettagli.

CSP è invece iniettata via `<meta http-equiv="Content-Security-Policy">`
direttamente in `site/index.html` (`build.mjs:372`), quindi è attiva
indipendentemente dall'hosting. Nota: `frame-ancestors 'none'` non è
nella CSP perché ignorata dal browser quando in `<meta>` (deve essere
header HTTP) — la protezione clickjacking è quindi attualmente
**non applicata** in produzione su GitHub Pages.

### 1.7 Edge Functions (Deno)

Necessarie per Output → "Snapshot inventario firmato" e per il wrapper
`verify_audit_chain` esposto in Diagnostica. Senza deploy il client
cade in fallback: lo snapshot viene scaricato non firmato con
annotazione esplicita.

```bash
# CLI Supabase (una volta)
supabase login
supabase link --project-ref <project-ref>

# Generare la chiave HMAC (32 byte hex)
openssl rand -hex 32   # → es. e8f2...

# Configurare i secret
supabase secrets set SNAPSHOT_HMAC_KEY=<32-byte-hex>
supabase secrets set ALLOWED_ORIGINS=https://sustainability.gresmalt.it,https://<github-pages>.github.io

# Deploy delle 3 Edge Functions
supabase functions deploy sign_snapshot       --no-verify-jwt
supabase functions deploy verify_snapshot     --no-verify-jwt
supabase functions deploy verify_audit_chain  --no-verify-jwt
```

`--no-verify-jwt` perché ogni function fa il check JWT internamente
(vedi `supabase/functions/sign_snapshot/index.ts:86-100`).

`ALLOWED_ORIGINS` è una lista CSV di origin esatti consentiti dalla
Edge Function. Se non configurata, la function **esegue lo stesso**
ma con CORS aperto a `*` e log di warning (vedi
`supabase/functions/sign_snapshot/index.ts:23-27`). In produzione
configurarla sempre.

Tutte e 3 le Edge Functions importano `@supabase/supabase-js@2.105.3`
(allineato col main bundle dopo PR #38).

---

## 2. Operazioni ricorrenti

### 2.1 Aggiornamento dati di produzione (kg, m²)

La tabella `produzione` è inizialmente vuota (Opzione B confermata).

1. Login admin/editor → Gestione Dati → tab Produzione.
2. **+ Aggiungi**: Sito, Anno, Produzione_kg, Produzione_m². Salvare.
3. Verificare in Dashboard interna che le KPI Intensità m² e Intensità kg
   non mostrino più "n.d.".
4. Verificare in Public Dashboard che la KPI Intensità sia popolata.

### 2.2 Aggiornamento FE annuale

1. Gestione Dati → tab FE → trovare l'FE da aggiornare (filtro su
   `Codice_Voce` e `Anno_Validità`).
2. **Modifica** sulla riga → cambiare `Valore`. Salvare.
3. Lo stesso modal espone un'opzione di **cascade**: ricalcola
   atomicamente `em_tco2e` su tutte le righe S1/S3 dell'anno
   target che usano quel FE. Implementato dalla RPC
   `cascade_fe_update` (`sql/13_hardening.sql:69-143`) con
   transazione singola e rispetto del year-lock.
4. Le righe del nuovo anno che usano lo stesso `Codice_Voce`
   risolveranno il valore aggiornato tramite `lookupFE`
   (`src/calc.js:60-93`).

### 2.3 Sign-off / chiusura inventario di un anno

`sql/08_year_lock.sql` introduce `app_meta.locked_years` (jsonb array
di interi). Quando un anno è bloccato, le policy RLS rifiutano
INSERT/UPDATE da editor su s1/s2/s3/produzione di quell'anno.
Admin override naturale (è nel ramo OR delle policy).

UI: Diagnostica → Sign-off inventario → toggle per anno. Endpoint
`G.db.toggleYearLock(year, locked)` in `src/SupabaseDB.jsx:581-586`.

### 2.4 Snapshot inventario firmato (admin)

1. Output → "Snapshot inventario firmato" → la UI invoca la Edge
   Function `sign_snapshot` con il payload corrente.
2. La function verifica che il chiamante abbia `app_metadata.role === 'admin'`,
   calcola `data_sha256` e `signature = HMAC-SHA256(SNAPSHOT_HMAC_KEY,
   payload || '|' || data_sha256)`, ritorna sidecar JSON con
   firma + timestamp + signer email.
3. Conservare payload + sidecar.
4. Verifica: Output → "Verifica snapshot" → carica i due file → la
   UI invoca `verify_snapshot` (constant-time compare).

Se `sign_snapshot` non è deployata, la UI scarica lo snapshot non
firmato con un banner di avviso esplicito.

### 2.5 Verifica integrità audit log

Due percorsi:

**On-demand (admin/auditor a aal2)**:
- Diagnostica → card "Reconciliation" → riga "Hash chain audit_log"
- Codice: `G.db.verifyAuditChain()` invoca la RPC
  `public.verify_audit_chain()` (`sql/03_roles.sql:34-71` poi sovrascritta
  da `sql/15_mfa_auditor.sql:63-109`).

**Schedulato (settimanale, automatico)**:
- pg_cron job `ghg_verify_audit_chain` schedulato lunedì 03:30 UTC.
- Esegue `public.verify_audit_chain_scheduled()` (no role check —
  callable solo da postgres/pg_cron, REVOKE per anon/authenticated).
- Inserisce ogni run in `public.audit_chain_check` con `status`
  (ok/broken/error), `total_rows`, `duration_ms`, eventuale
  `broken_id` + `expected_hash` + `actual_hash`.
- UI: Diagnostica → card "Audit chain — check schedulati" mostra
  ultimi 10 run dalla view `public.audit_chain_status`.

Vedi `sql/16_audit_chain_cron.sql`.

---

## 3. Disaster recovery

### 3.1 Backup

**Tier Pro+ Supabase**:
- Point-In-Time Recovery 7 giorni (gestito da Supabase).

**Tier Free + workflow GitHub** (`.github/workflows/backup.yml`):
- Cron: lunedì 04:00 UTC.
- `pg_dump --no-owner --no-privileges --clean` → gzip → GPG
  symmetric AES-256 con `BACKUP_PASSPHRASE`.
- Upload artifact GitHub, retention 30 giorni.
- **Replica off-GitHub opzionale**: se `AWS_S3_BACKUP_BUCKET` è
  configurato (+ AWS keys + region default `eu-central-1`), copia
  il file `.gpg` su S3 con `--sse AES256`. No-op se i secret
  mancano, con warning. Alla data di scrittura di questo runbook,
  questa replica **non è configurata** (l'azienda non ha account
  AWS). Alternative free: Backblaze B2, Wasabi.

### 3.2 Onboarding / offboarding operatori (GDPR)

**Disattivazione di un operatore**:

1. Authentication → Users → ban/delete user (Supabase Dashboard).
2. Cancellare la riga corrispondente in `public.role_map` (admin):
   ```sql
   delete from public.role_map where email = 'utente@esempio.com';
   ```
   Il trigger `propagate_role_map_change_trg` rimuove la chiave
   `role` da `raw_app_meta_data` per quell'utente
   (`sql/07_invite_operators.sql:120-143`).
3. La pseudonimizzazione delle email in `audit_log` è automatica via
   pg_cron mensile (`ghg_pseudo_audit`, 1° del mese 04:00 UTC).
   Per forzarla immediatamente:
   ```sql
   select public.pseudonymize_audit_email('<uuid>'::uuid);
   ```
   Sostituisce `user_email` con `pseudo:<sha256_hex16>` per tutte
   le righe di quell'utente. Vedi `sql/13_hardening.sql:156-196`.

**Trade-off documentato**: la pseudonimizzazione cambia il campo
`user_email` quindi rompe il `row_hash` calcolato su quei record.
`verify_audit_chain()` segnerà come "rotti" i record pseudonimizzati.
È un compromesso accettato: integrità sacrificata sulle sole righe
pseudonimizzate per conformità GDPR (right-to-be-forgotten su CSRD
inventory data).

### 3.3 Restore

```bash
# 1. Decifrare l'artifact
gpg --decrypt ghg_dump_YYYYMMDD_HHMM.sql.gz.gpg | gunzip > restore.sql

# 2. Restore su un nuovo progetto Supabase (mai sul live!)
psql "${SUPABASE_DB_URL_STAGING}" < restore.sql

# 3. Verificare integrità:
#    - Diagnostica → Reconciliation
#    - select * from public.verify_audit_chain();
#      (ritorna 0 righe se integro)
```

### 3.4 Rotazione secret

| Secret               | Frequenza   | Procedura |
|----------------------|-------------|-----------|
| Publishable key      | annuale     | Dashboard Supabase → API Keys → "Rotate publishable key" → aggiornare secret GitHub Actions → rebuild + redeploy site |
| Service role key     | semestrale  | Stessa via; non esposta al client |
| `SNAPSHOT_HMAC_KEY`  | annuale     | Generare nuova chiave; archiviare la vecchia per verifiche storiche; redeploy Edge Function |
| `BACKUP_PASSPHRASE`  | annuale     | Aggiornare GitHub secret; archiviare la vecchia per accedere a backup pre-rotazione |
| MFA recovery code    | per utente  | Archiviato offline cifrato (responsabilità utente) |

Procedura rotazione publishable key dopo leak documentata in
[`docs/SECURITY.md`](SECURITY.md) §5.

---

## 4. Troubleshooting

### 4.1 "public_facts.refresh_ts > 24h"

La materialized view `public_facts` non si è aggiornata. Cause
possibili: trigger fallito, partial restore, `pg_cron` non
disponibile (Free tier).

Refresh manuale:
```sql
refresh materialized view public.public_facts;
-- oppure
select public.force_refresh_public_facts();
```

Su tier Pro+ il pg_cron job `ghg_refresh_public_facts` (domenica
02:15 UTC) è il safety net automatico (`sql/13_hardening.sql:347-353`).

### 4.2 "Catena hash audit_log rotta"

Diagnostica → Reconciliation segna in rosso "Hash chain audit_log"
oppure il cron `ghg_verify_audit_chain` ha registrato `status='broken'`
in `audit_chain_check`.

1. **Lock down dell'app**:
   ```sql
   update public.app_meta set value = to_jsonb(true) where key = 'app_locked';
   ```
2. Recuperare il `broken_id` e ispezionare la riga:
   ```sql
   select * from public.audit_chain_status order by ts desc limit 1;
   select * from public.audit_log where id >= <broken_id> - 5 order by id limit 10;
   ```
3. Confrontare con l'ultimo backup PITR / dump integro.
4. Se manomesso:
   - PITR su tier Pro+
   - Restore da dump GPG su tier Free
5. Rieseguire `select * from public.verify_audit_chain();` — deve
   tornare 0 righe.
6. Indagare l'incidente. Vedi [`docs/SECURITY.md`](SECURITY.md) §4.
7. Riaprire l'app:
   ```sql
   update public.app_meta set value = to_jsonb(false) where key = 'app_locked';
   ```

**Nota**: se il `broken_id` cade su un record con `user_email LIKE
'pseudo:%'`, la rottura è **attesa** (vedi §3.2). Verificare con
`select user_email from public.audit_log where id = <broken_id>`.

### 4.3 Keep-alive in rosso (>7 giorni)

Diagnostica → Keep-alive Supabase mostra "CRITICO (X giorni fa) —
il progetto rischia la pausa".

1. Verificare GitHub Actions → Supabase keep-alive: ultime esecuzioni.
2. Run manuale: Actions → Supabase keep-alive → Run workflow.
3. Bottone "Ping manuale" in Diagnostica.
4. Se il progetto Supabase è già paused: Dashboard Supabase → Resume project.

GitHub disabilita gli schedule dopo 60 giorni di inattività del
default branch. Qualunque commit/push lo riattiva.

### 4.4 Importazione Excel rifiutata

Vincoli enforced lato client (`src/io.jsx:importExcel`):
- File > 5 MB → respinto
- Estensione non `.xls`/`.xlsx` (regex check, non solo MIME) → respinto
- Anteprima diff mostra errori riga per riga (`validateRow`):
  scartare le righe in errore o correggerle nel file sorgente

### 4.5 Errore "Configurazione Supabase mancante"

Public Dashboard mostra "Configurazione richiesta". Significa che il
build è stato fatto senza `SUPABASE_URL` o `SUPABASE_PUBLISHABLE_KEY`,
quindi i placeholder `__SUPABASE_URL__` / `__SUPABASE_PUBLISHABLE_KEY__`
non sono stati sostituiti. `src/SupabaseDB.jsx:113-116` lo rileva
controllando se il valore inizia con `__`.

Soluzione: ri-eseguire `node build.mjs` con le variabili impostate, o
configurare i GitHub secret e ri-triggerare `deploy.yml`.

### 4.6 Bundle stantio in cache

Sintomo: utente vede una versione vecchia dopo un deploy. Il bundle
ha 3 difese (`build.mjs:482-543`):

1. **bfcache flash**: al `pageshow` con `e.persisted=true`, nasconde
   l'HTML e ricarica.
2. **`/build.txt` fetch**: ad ogni boot, fetcha `/build.txt` (12 byte
   con il `BUILD_HASH` corrente, cache-busted) e confronta col
   `BH` inlined. Se diverso → hard reload con query string `?_b=<hash>`.
   Loop guard: max 1 reload per 10 secondi.
3. **localStorage marker**: scrive `ghg_build` in localStorage (no-op
   funzionale, utile per Diagnostica).

Se il problema persiste: l'utente svuoti la cache del browser
manualmente.

### 4.7 Edge Function risponde "Failed to send a request"

Cause possibili:
- Function non deployata
- `ALLOWED_ORIGINS` non include l'origin del client → la function
  risponde 403
- Bearer token non valido / sessione scaduta

Verifica via Supabase Dashboard → Edge Functions → Logs.

### 4.8 Editor riceve "permission denied" su INSERT

Cause:
- L'editor non ha completato l'enrollment MFA TOTP → `aal=aal1` →
  RLS rifiuta. Soluzione: forzare logout/login e completare il
  wizard MFA.
- L'anno è bloccato (sign-off attivo) → editor non può modificare,
  solo admin. Verificare in Diagnostica → Sign-off inventario.
- Rate limit client-side: 30 mutazioni in 10s sliding window
  (`src/SupabaseDB.jsx:127-142`). Aspettare 10 secondi.

---

## 5. Contatti

Le email reali degli operatori non sono pubblicate qui per evitare
esposizione di PII e phishing mirato. Lista completa in
documentazione interna riservata (es. `private/contacts.md`,
coperto da `.gitignore`).

| Ruolo                | Riferimento documentazione         |
|----------------------|------------------------------------|
| Admin tecnico        | (runbook interno aziendale)         |
| Editor inventario    | (runbook interno aziendale)         |
| Sostenibilità        | sostenibilita@gresmalt.it           |
| Supabase Support     | support@supabase.io (tier Pro+)     |
