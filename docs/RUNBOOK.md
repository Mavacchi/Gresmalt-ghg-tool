# RUNBOOK — GHG Tool · Gruppo Ceramiche Gresmalt

Procedure operative per il go-live, manutenzione e disaster recovery.

---

## 1. Setup iniziale (one-time)

### 1.1 Supabase

1. Creare un nuovo progetto Supabase (region EU per CSRD compliance).
2. Settings → API → annota `Project URL` e `anon public` key.
3. SQL Editor → eseguire **in ordine** i file di `sql/`:
   ```
   01_schema.sql
   02_data_seed.sql
   03_roles.sql
   04_public_view.sql
   05_app_meta.sql
   06_client_errors.sql
   08_year_lock.sql
   13_hardening.sql        ← RPC atomiche, pseudonimizzazione, cron retention
   14_mfa_editor.sql       ← MFA TOTP obbligatoria per editor (aal2 in RLS)
   ```
   Ogni file termina con `end of …` se ha funzionato.
   `07_invite_operators.sql` va eseguito DOPO che gli utenti hanno
   accettato l'invito (vedi 1.2).
   `13_hardening.sql` è opzionale per partire ma fortemente raccomandato:
   senza di esso `saveProduzione` e `cascadeFEUpdate` cadono in fallback
   non transazionale (warning visibile in console del browser).
4. Authentication → Providers → abilitare solo email; impostare:
   - **Prevent email enumeration**: ON
   - **Password complexity**: min 12 caratteri, mix
   - **HIBP** (haveibeenpwned): ON
   - **Captcha** (Cloudflare Turnstile): site key + secret key
5. Authentication → Site URL: dominio finale; Redirect URLs ristrette.
6. Authentication → MFA: TOTP enabled. Aggiungere policy "AAL2 required"
   per ruoli `admin`, `auditor`.
7. Database → Replication → assicurarsi che la materialized view
   `public_facts` sia presente.

### 1.1bis MFA per editor (TOTP obbligatoria)

Le policy RLS (vedi `sql/14_mfa_editor.sql`) richiedono `aal=aal2`
per qualunque INSERT/UPDATE da parte di un `editor`. Conseguenza:

- L'editor che apre il sito senza TOTP enrollato vede automaticamente
  il **wizard di enrollment** (QR code + 6 cifre) prima di poter usare
  l'app — vedi `src/AuthGate.jsx` componente `MFAEnrollScreen`.
- Una volta enrollato, al login successivo viene chiesto il codice TOTP
  (challenge step già presente in `LoginScreen`).
- L'admin NON è soggetto a questo enforcement RLS (evita lockout in caso
  di MFA device perso); resta comunque buona prassi enrollarsi anche
  per admin/auditor (Authentication → MFA del dashboard Supabase).
- Il viewer non scrive, quindi non è coinvolto.

App di TOTP supportate: Google Authenticator, Authy, 1Password, Bitwarden,
Microsoft Authenticator (qualunque app TOTP RFC 6238).

### 1.2 Inviti operatori

1. Authentication → Users → Invite per ognuno degli operatori
   (le email reali sono nella documentazione interna, non
   esposte qui per evitare PII in repo pubblico):
   - 1× admin (con MFA obbligatorio)
   - N× editor
2. Dopo che gli utenti hanno accettato l'invito e completato la
   registrazione, eseguire `sql/07_invite_operators.sql` dal SQL editor
   per impostare i ruoli in `app_metadata`.

### 1.3 GitHub repo

1. Settings → Secrets and variables → Actions → New repository secret:
   - `SUPABASE_URL` (Project URL)
   - `SUPABASE_PUBLISHABLE_KEY` (formato `sb_publishable_...`,
     vedi Supabase Dashboard → Project Settings → API Keys).
     Il vecchio nome `SUPABASE_ANON_KEY` è ancora supportato come
     fallback dai workflow durante la migrazione.
   - (opzionale) `SUPABASE_DB_URL` per backup, `BACKUP_PASSPHRASE`,
     `TURNSTILE_SITE_KEY`
2. Verificare che `.github/workflows/keepalive.yml` sia attivo:
   Actions → Supabase keep-alive → Run workflow manualmente la prima volta.
3. (opzionale) Abilitare Dependabot per `package.json`.

### 1.4 Build & deploy

```bash
npm install
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
TURNSTILE_SITE_KEY=0xAAAA... \
LOGO_PATH=./assets/logo-gresmalt.png \
COMPANY_LEGAL_NAME='Gruppo Ceramiche Gresmalt S.p.A.' \
COMPANY_VAT='IT00000000000' \
SUSTAINABILITY_EMAIL='sustainability@gresmalt.it' \
PUBLIC_DASHBOARD_URL='https://sustainability.gresmalt.it' \
node build.mjs
```

> Il vecchio nome `SUPABASE_ANON_KEY` (legacy JWT) è ancora supportato
> dal `build.mjs` come fallback. La nuova chiave Supabase ha il prefisso
> `sb_publishable_...` ed è raggiungibile da **Project Settings → API
> Keys → Publishable**. La legacy resta deprecata ma funzionante per la
> finestra di transizione decisa da Supabase.

L'output è in `site/index.html` (~700 KB autocontenuto).

### 1.5 Hosting su GitHub Pages

GitHub Pages è la scelta confermata. Setup:

1. Repo → Settings → Pages.
2. Source: `Deploy from a branch` o GitHub Actions.
3. Branch: `main`, folder: `/site` (o configurare un workflow che
   pubblica la cartella).
4. (opzionale) Custom domain (CNAME → `username.github.io`); attendere
   il provisioning del certificato HTTPS.

**Limitazione di GitHub Pages**: non supporta header HTTP custom
(HSTS, Permissions-Policy). La CSP è iniettata via `<meta http-equiv>`
in HTML, quindi resta attiva. Per alzare il livello di sicurezza:

- **Opzione consigliata**: Cloudflare in fronte a GitHub Pages
  (CNAME via Cloudflare proxy + Page Rules per HSTS, Referrer-Policy,
  Permissions-Policy).
- Alternativa: migrare a Cloudflare Pages / Netlify e usare `_headers`.

### 1.5 Edge Function `sign_snapshot` (firma HMAC degli snapshot)

Necessaria solo se serve scaricare snapshot **firmati** da Output →
Snapshot inventario firmato. Senza deploy il client cade in fallback
e scarica snapshot non firmati con annotazione errore.

```bash
# Login + link al progetto (una volta)
supabase login
supabase link --project-ref <project-ref>

# Genera la chiave HMAC (32 bytes hex random)
openssl rand -hex 32
# → es. e8f2...

# Imposta i secret (HMAC + lista origin CORS) e deploy delle 3 Edge Functions
supabase secrets set SNAPSHOT_HMAC_KEY=e8f2...
supabase secrets set ALLOWED_ORIGINS=https://sustainability.gresmalt.it,https://<github-pages>.github.io
supabase functions deploy sign_snapshot       --no-verify-jwt
supabase functions deploy verify_snapshot     --no-verify-jwt
supabase functions deploy verify_audit_chain  --no-verify-jwt
```

`ALLOWED_ORIGINS` è una CSV degli origin client autorizzati a chiamare
le Edge Functions. Senza questa variabile le function loggano un
warning e cadono su `*` (utile in dev, ma in **PRODUZIONE va sempre
impostata** — vedi `docs/SECURITY.md`). Se l'origin del browser non
è in lista, la function risponde 403.

`--no-verify-jwt` perché la function fa il check JWT internamente
(legge `Authorization` header e chiama `auth.getUser()` per verificare
sessione + ruolo `admin`).

Verifica da terminale:

```bash
TOKEN=$(supabase functions secrets list 2>/dev/null)  # solo per check secret presente
curl -i -X POST https://<project-ref>.functions.supabase.co/sign_snapshot \
  -H "Authorization: Bearer <ACCESS_TOKEN_ADMIN>" \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
# Atteso: 200 + JSON con { ok, signature, data_sha256, signed_at, signer_email }
```

Errore tipico `Failed to send a request to the Edge Function`
dal client = function NON deployata o CORS mancante. Versione
attuale espone già header CORS + handler OPTIONS preflight.

---

## 2. Operazioni ricorrenti

### 2.1 Aggiornamento dati di produzione

(Opzione B: la tabella `produzione` è inizialmente vuota.)

1. Login come admin/editor.
2. Gestione Dati → tab Produzione → + Aggiungi.
3. Compilare: Sito, Anno, Produzione_kg, Produzione_m². Salvare.
4. Verificare in Dashboard interna che le KPI Intensità m² e
   Intensità kg non siano più "n.d.".
5. Verificare in PublicDashboard che la KPI Intensità mostri il
   valore corretto.

### 2.2 Aggiornamento FE annuale

1. Gestione Dati → tab FE → trovare l'FE da aggiornare.
2. Click "Nuova versione" → clona la riga con `Anno_Validità+1` e
   permette di modificare il valore.
3. Salvataggio: trigger `write_audit` registra l'evento; il refresh
   di `public_facts` aggiorna le KPI guest entro pochi secondi.
4. Le righe S1/S3 dell'anno successivo che usano quel `Codice_Voce`
   risolveranno il nuovo valore tramite `lookupFE`.

### 2.3 Snapshot inventario (admin)

1. Output / Report → bottone "Snapshot inventario" → file JSON
   firmato HMAC-SHA256.
2. Conservare il file: utile per audit di terzi.
3. Verifica: Output → "Verifica snapshot" → carica file → ✓/✗.

---

## 3. Disaster recovery

### 3.1 Backup

- Tier Pro+ Supabase: PITR 7 giorni (automatico).
- Tier Free: GitHub Action `backup.yml` (lunedì 04:00 UTC) produce
  un dump SQL cifrato AES-256 (artifact retention 30 giorni).
- **Replica off-GitHub** (raccomandata): se sono configurati i secrets
  `AWS_S3_BACKUP_BUCKET` + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
  (+ opzionale `AWS_DEFAULT_REGION`, default `eu-central-1`), lo step
  successivo replica il file `.gpg` su S3 con `--sse AES256`. Lo step
  è no-op se i secrets mancano. Bucket consigliato in region EU
  (Francoforte / Milano) per coerenza CSRD.
- Snapshot HMAC manuali (admin) come backup applicativo.

### 3.1bis Onboarding / offboarding operatori (GDPR)

Per **disattivare** un operatore (cessazione, cambio ruolo, errore di
inserimento):

1. Supabase Dashboard → Authentication → Users → ban / delete user.
2. Cancellare la riga corrispondente in `public.role_map` (admin).
3. (Cron mensile automatico, sql/13_hardening.sql) — pseudonimizza
   le email residue in `audit_log` per quel `user_id`. In alternativa
   eseguire manualmente:
   ```sql
   select public.pseudonymize_audit_email('<uuid>'::uuid);
   ```

Il `verify_audit_chain` continua a funzionare ma segnerà come "rotti"
i record pseudonimizzati (cambio del campo `user_email` ⇒ il `row_hash`
non corrisponde più). È un trade-off accettato e documentato:
l'integrità della catena è rinunciata sulle sole righe pseudonimizzate
in cambio della conformità GDPR (right-to-be-forgotten).

### 3.2 Restore

```bash
# 1. Decifrare l'artifact
gpg --decrypt ghg_dump_YYYYMMDD_HHMM.sql.gz.gpg | gunzip > restore.sql

# 2. Restore su un nuovo progetto Supabase (mai sul progetto live!)
psql "${SUPABASE_DB_URL}" < restore.sql

# 3. Verificare diagnostica:
#    - Dashboard interna → Diagnostica → Reconciliation
#    - verify_audit_chain() deve ritornare 0 righe
```

### 3.3 Rotazione secret

| Secret           | Rotazione   | Dove                                        |
|------------------|-------------|---------------------------------------------|
| publishable key  | annuale     | Supabase Dashboard → API Keys → Publishable; rebuild + redeploy |
| service_role key | semestrale  | Edge Functions; mai esposta al client        |
| HMAC snapshot    | annuale     | Edge Function; archiviare la vecchia chiave  |
| MFA recovery     | per-utente  | Archiviare offline, cifrato                  |

---

## 4. Troubleshooting

### "public_facts.refresh_ts > 24h"

Trigger fallito o policy bloccante.

```sql
refresh materialized view public.public_facts;
```

### "Catena hash audit_log rotta"

Indica una manomissione lato DB. Procedura:

1. Bloccare temporaneamente l'app: `update app_meta set value=true where key='app_locked'`.
2. Confrontare l'audit_log con l'ultimo backup integro.
3. Se manomesso, ripristinare da backup PITR.
4. Indagare l'incidente (vedi `SECURITY.md`).

### Keep-alive in rosso

`Diagnostica → Keep-alive Supabase` mostra `> 7 giorni`.

1. Verificare GitHub Actions → Supabase keep-alive: ultime esecuzioni.
2. Run manuale del workflow.
3. Bottone "Ping manuale" in Diagnostica.
4. Se il progetto è già paused: Supabase Dashboard → Resume project.

### Importazione Excel rifiutata

- File > 5 MB: comprimere o splittare.
- Estensione non valida: rigenerare salvando come .xlsx.
- Anteprima diff mostra errori riga per riga: scartare le righe in
  errore o correggerle nel file sorgente.

---

## 5. Contatti

| Ruolo              | Persona                  | Email                              |
|--------------------|--------------------------|------------------------------------|
| Admin tecnico      | (vedi runbook interno)   | (email aziendale interna)          |
| Editor inventario  | (vedi runbook interno)   | (email aziendale interna)          |
| Editor inventario  | (vedi runbook interno)   | (email aziendale interna)          |
| Sostenibilità      | (TBD)                    | sustainability@gresmalt.it         |

> Le email reali degli operatori non sono pubblicate qui per evitare
> esposizione di PII e phishing mirato. Lista completa in documentazione
> interna riservata (`private/contacts.md` o equivalente).
