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
   ```
   Ogni file termina con `end of …` se ha funzionato.
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

### 1.2 Inviti operatori

1. Authentication → Users → Invite per ognuno dei 3 indirizzi:
   - marco.vacchi@gresmalt.it (admin, MFA obbligatorio)
   - davide.settembre@gresmalt.it (editor)
   - luca.iattici@gresmalt.it (editor)
2. Dopo che gli utenti hanno accettato l'invito e completato la
   registrazione, eseguire `sql/07_invite_operators.sql` dal SQL editor
   per impostare i ruoli in `app_metadata`.

### 1.3 GitHub repo

1. Settings → Secrets and variables → Actions → New repository secret:
   - `SUPABASE_URL` (Project URL)
   - `SUPABASE_ANON_KEY`
   - (opzionale) `SUPABASE_DB_URL` per backup, `BACKUP_PASSPHRASE`,
     `TURNSTILE_SITE_KEY`
2. Verificare che `.github/workflows/keepalive.yml` sia attivo:
   Actions → Supabase keep-alive → Run workflow manualmente la prima volta.
3. (opzionale) Abilitare Dependabot per `package.json`.

### 1.4 Build & deploy

```bash
npm install
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_ANON_KEY=eyJ... \
TURNSTILE_SITE_KEY=0xAAAA... \
LOGO_PATH=./assets/logo-gresmalt.png \
COMPANY_LEGAL_NAME='Gruppo Ceramiche Gresmalt S.p.A.' \
COMPANY_VAT='IT00000000000' \
SUSTAINABILITY_EMAIL='sustainability@gresmalt.it' \
PUBLIC_DASHBOARD_URL='https://sustainability.gresmalt.it' \
node build.mjs
```

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
- Snapshot HMAC manuali (admin) come backup applicativo.

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
| anon key         | annuale     | Supabase Dashboard → API; rebuild + redeploy |
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
| Admin tecnico      | Marco Vacchi             | marco.vacchi@gresmalt.it           |
| Editor inventario  | Davide Settembre         | davide.settembre@gresmalt.it       |
| Editor inventario  | Luca Iattici             | luca.iattici@gresmalt.it           |
| Sostenibilità      | (TBD)                    | sustainability@gresmalt.it         |
