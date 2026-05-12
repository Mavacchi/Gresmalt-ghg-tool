# Operazioni comuni — Playbook

Procedure operative per i task ricorrenti. Tutti i task richiedono almeno
ruolo **admin** o **editor** sulla console interna (`/#app`).

## 1. Aggiungere un nuovo anno di inventario

**Quando**: chiusura inventario per un anno (es. gennaio 2026 per anno 2025).
**Ruolo**: editor o admin con MFA TOTP attivo.

### Step

1. **Inserire produzione** per ogni sito:
   * Console → **Gestione Dati > Produzione**
   * `+ Aggiungi` → seleziona sito + anno + kg + m²
   * Ripeti per i 7 siti
   * Validazione: almeno uno tra kg e m² > 0

2. **(Opzionale) Clone da anno precedente**:
   * Console → **Gestione Dati > "🔄 Clona da anno"**
   * Sorgente: anno precedente; Destinazione: nuovo anno
   * Conferma. L'app cloners S1+S2+S3+Produzione azzerando FE/Em e
     forzando `stato_dato='Provvisorio'`
   * Dedup automatico: se nel dst esiste già una riga per la stessa chiave
     business, viene skippata

3. **Aggiornare i FE per il nuovo anno**:
   * Console → **Gestione Dati > FE**
   * Per ogni FE rilevante: click edit → bottone "Nuova versione"
   * Imposta `Anno_Validità` al nuovo anno; aggiorna `Valore` con il dato
     ISPRA/AIB/DEFRA aggiornato; salva
   * Il cascade ricalcola automaticamente S1/S3 referenziati
     (`cascadeFEUpdate` RPC)

4. **Verificare le righe S1/S2/S3** clonate (se step 2) o crearle
   manualmente:
   * Console → **Gestione Dati > S1**, **S2**, **S3**
   * Per ogni riga, inserisci la `Quantità` reale; l'`Em_tCO2e` si calcola
     in automatico nella preview del modal
   * Aggiorna `stato_dato` da "Provvisorio" a "Definitivo" quando validato

5. **Cross-check su Data Quality**:
   * Console → **Data Quality**
   * Sub-tab "YoY anomalies": variazioni > 30% rispetto all'anno precedente
   * Per ognuna, verifica se è una variazione reale o un errore di input.
     Aggiungi una `Note` se è giustificata (skippa l'anomaly check)

6. **Aggiornare la Materialità** se serve:
   * Console → **Materialità S3**
   * Verifica che le 15 categorie abbiano lo status corretto per il nuovo anno
   * Aggiorna `review_year` su quelle riviste

## 2. Chiudere un anno (sign-off / lock)

**Quando**: l'anno è stato approvato per pubblicazione (es. Bilancio di
Sostenibilità approvato dal CdA).
**Ruolo**: admin only.

### Step

1. Console → **Diagnostica > Year sign-off lock**
2. Toggle ON sull'anno desiderato
3. L'anno viene aggiunto a `app_meta.locked_years`
4. **Effetto immediato**:
   * Editor non possono più INSERT/UPDATE/DELETE su s1/s2/s3/produzione
     per quell'anno (RLS via `is_year_locked(anno)`)
   * Admin mantiene override d'emergenza per correzioni straordinarie
   * Tutte le modifiche admin restano comunque tracciate in `audit_log`
5. La PublicDashboard mostra immediatamente i dati dell'anno

### Rollback

Se serve ri-aprire un anno (es. revisione tardiva):
* Console → **Diagnostica > Year sign-off lock** → toggle OFF
* Editor torna a poter modificare quell'anno

## 3. Pubblicare un nuovo report

**Quando**: dopo la chiusura dell'anno (sign-off lock applicato).

### Step

1. **Verifica numeri** sul Dashboard interno:
   * Console → **Dashboard** (con anno selezionato)
   * Check KPI strip (totali, intensità, GO)
   * Check donut composizione (S1/S2/S3 ratio plausibile)
   * Check trend forecast (linea on-track vs target 2034)

2. **Genera report PPTX**:
   * Console → **Download**
   * Toggle lingua (IT/EN) se serve
   * Click "Scarica report PPTX"
   * SheetJS + pptxgenjs caricati lazy da CDN; il file `ghg_report_<anno>_<lang>.pptx`
     (~22 slide) viene scaricato

3. **Snapshot JSON firmato** (admin only, evidenza forense):
   * Stessa sezione, card "Snapshot JSON firmato"
   * Click "Genera snapshot"
   * Edge Function `sign_snapshot` calcola HMAC-SHA256
   * Scarica file `ghg_snapshot_<anno>_signed.json` con `{payload,
     signature, data_sha256, signed_at, signer_email, algorithm}`
   * Archivia il file in posto sicuro (Drive aziendale, S3, ecc.)

4. **Pubblica sito GitHub Pages**:
   * Push qualunque commit su `main` (anche solo update README) → workflow
     `deploy.yml` ricostruisce il bundle con i dati live e fa publish
   * Anti-stale-cache forza i visitatori a vedere il bundle nuovo entro
     ~10 sec dal primo visit dopo il deploy

## 4. Aggiungere un nuovo operatore

**Ruolo**: admin only.

### Step

1. **SQL Editor Supabase** (insert in role_map):

   ```sql
   INSERT INTO public.role_map (email, role)
   VALUES ('mario.rossi@gresmalt.it', 'editor')
   ON CONFLICT (email) DO UPDATE SET role = excluded.role;
   ```

   Ruoli ammessi: `admin`, `editor`, `auditor`, `viewer`.

2. **Invito utente** via Supabase dashboard:
   * Authentication → Users → "Invite user" con la stessa email
   * Supabase invia mail di invito; l'utente clicca link e imposta password

3. **Al primo login**:
   * Trigger `apply_role_from_map_trg` applica `app_metadata.role = 'editor'`
   * Se editor/auditor: il bundle mostra `MFAEnrollScreen` per setup TOTP
   * Utente scansiona QR con Google Authenticator/Authy/1Password
   * Inserisce codice 6 cifre → JWT con `aal=aal2` → accesso completo

### Cambio ruolo

```sql
UPDATE public.role_map SET role = 'admin'
WHERE email = 'mario.rossi@gresmalt.it';
```

Il trigger `propagate_role_map_change_trg` propaga il nuovo ruolo a
`auth.users` immediatamente. L'utente vedrà il nuovo ruolo al successivo
refresh della sessione (entro 1h tipicamente, con `autoRefreshToken: true`).

### Rimozione operatore

```sql
DELETE FROM public.role_map WHERE email = 'mario.rossi@gresmalt.it';
```

Il trigger rimuove `app_metadata.role` da `auth.users`. L'utente
ricade a ruolo `viewer` (default).

Per disattivare completamente:
* Supabase Auth → Users → ban user

Per **pseudonimizzare** le email PII di operatore cessato dall'audit_log:

```sql
SELECT public.pseudonymize_audit_email(
  (SELECT id FROM auth.users WHERE email = 'mario.rossi@gresmalt.it')
);
```

→ tutte le righe `audit_log.user_email` con quel `user_id` diventano
`pseudo:<hash16>`.

## 5. Modificare i target del Piano

**Ruolo**: admin only.

### Step

1. Console → **Gestione Dati > Target**
2. Modifica i campi:
   * `scope` (es. "Scope 1 + 2 Market-based")
   * `baselineYear`, `baseline_tco2e`, `baseline_intensity`
   * `shortTermYear`, `shortTerm_tco2e`, `shortTerm_intensity`
   * `longTermYear`, `longTerm_tco2e`, `longTerm_intensity`
   * `s3_baseline_tco2e`, `s3_shortTerm_tco2e`, `s3_longTerm_tco2e` (opt)
   * `alignment` (es. "Auto-allineato SBTi 1.5°C")
3. Salva. I valori vengono persistiti in `app_meta.targets` (jsonb).
4. **Effetto immediato**: tutti i componenti (Dashboard, PublicDashboard,
   Scenarios) leggono `G.TARGETS` che viene sovrascritto dal merge runtime
   di `app_meta.targets` al successivo `loadAll`. **Nessun redeploy**.

### Sincronizzare con `constants.js`

I valori in `constants.js` sono **fallback** se `app_meta.targets` è vuoto.
Per allinearli (utile per build standalone senza Supabase):
* PR su `src/constants.js` con i nuovi valori di `TARGETS`
* Merge → rebuild → deploy

## 6. Verificare integrità audit chain

**Ruolo**: admin (sempre) o auditor (con MFA aal2).

### Verifica manuale

1. Console → **Audit Trail**
2. Badge in alto a destra: `🟢 OK` o `🔴 BROKEN @ id=N`
3. Per re-verify: pulsante "Verifica integrità"
4. Se broken: il modal mostra `{first_broken_id, expected_hash, actual_hash}`

### Verifica via Diagnostica

1. Console → **Diagnostica**
2. Sezione "Audit chain"
3. Pulsante "Verify chain now" → live re-check
4. "History" mostra gli ultimi 10 record da `audit_chain_status`
   (verifiche schedulate weekly)

### Verifica via Edge Function

```bash
curl -X POST "https://<project>.supabase.co/functions/v1/verify_audit_chain" \
  -H "Authorization: Bearer <JWT_admin_or_auditor>" \
  -H "Origin: https://sustainability.gresmalt.it"
# → { "integrity": "ok", "first_broken_id": null, "verified_at": "..." }
```

### Se la chain è BROKEN

1. Verifica se è dovuto a `pseudonymize_audit_email` recente (atteso, vedi
   [[Audit-Trail]]).
2. Altrimenti, controlla l'`audit_log` intorno all'`first_broken_id`:
   ```sql
   SELECT id, ts, user_email, table_name, operation, row_id
   FROM audit_log
   WHERE id BETWEEN <first_broken_id - 2> AND <first_broken_id + 2>
   ORDER BY id;
   ```
3. Possibile tampering (DELETE/UPDATE diretto sulla table) — investigare
   con Supabase Studio audit log nativo
4. Restore da backup criptato weekly se serve recovery

## 7. Test no-leak RLS (anonProbe)

**Ruolo**: admin only.

### Step

1. Console → **Diagnostica**
2. Pulsante "Anon probe" / "Test RLS"
3. L'app crea un client Supabase **separato** senza sessione utente
4. Prova `SELECT * LIMIT 1` su 10 tabelle protette
5. Mostra il risultato: `{ ok: true, leaked: [], tested: 10 }`
6. Se `leaked.length > 0`, c'è un bug RLS — leggere immediatamente la lista
   tabelle e ri-eseguire `sql/03_roles.sql` (default deny + policy
   generiche)

## 8. Ripristino backup

**Quando**: corruption DB, restore da snapshot, environment test.

### Scarica artifact

```bash
# Lista degli artifact recenti
gh run list --workflow=backup.yml --limit=5

# Scarica l'artifact più recente
gh run download <run-id> -n ghg-dump-<n>
# → ghg_dump_YYYYMMDD_HHMM.sql.gz.gpg
```

### Decifra & ripristina

```bash
# Decifra con la passphrase BACKUP_PASSPHRASE
gpg --batch --decrypt -o ghg_dump.sql.gz \
    --passphrase "$BACKUP_PASSPHRASE" \
    ghg_dump_YYYYMMDD_HHMM.sql.gz.gpg

gunzip ghg_dump.sql.gz

# Restore in nuovo DB (es. staging Supabase)
# IMPORTANTE: usa solo un DB FRESH, --clean può dropparti dati esistenti
psql "$NEW_DATABASE_URL" < ghg_dump.sql
```

Se `pg_dump` aveva `--no-privileges`, i GRANT non sono inclusi → ri-applica
le migration SQL:

```bash
psql "$NEW_DATABASE_URL" -f sql/03_roles.sql
psql "$NEW_DATABASE_URL" -f sql/05_app_meta.sql
psql "$NEW_DATABASE_URL" -f sql/06_client_errors.sql
psql "$NEW_DATABASE_URL" -f sql/07_invite_operators.sql
psql "$NEW_DATABASE_URL" -f sql/08_year_lock.sql
psql "$NEW_DATABASE_URL" -f sql/13_hardening.sql
psql "$NEW_DATABASE_URL" -f sql/14_mfa_editor.sql
psql "$NEW_DATABASE_URL" -f sql/15_mfa_auditor.sql
psql "$NEW_DATABASE_URL" -f sql/16_audit_chain_cron.sql
psql "$NEW_DATABASE_URL" -f sql/17_fe_search_log.sql
psql "$NEW_DATABASE_URL" -f sql/18_ai_assist_log.sql
```

Oppure usa **Supabase CLI**:

```bash
supabase db reset
supabase db push
```

## 9. Aggiornare le dipendenze npm

Dependabot apre PR weekly. Per merge:

### Bump minor/patch (raggruppati)

1. PR titolo `deps: bump runtime group`
2. Verifica diff su `package-lock.json`
3. Locally:
   ```bash
   git checkout <branch>
   npm ci
   npm test
   npm run lint
   npm run build
   # apri site/index.html in browser → smoke test manuale
   ```
4. Merge se tutto OK

### Bump SRI-libs (@e965/xlsx o pptxgenjs)

Richiede ricalcolo SRI lato `build.mjs`. Dependabot bump:

1. PR titolo `deps: bump @e965/xlsx`
2. Locally:
   ```bash
   git checkout <branch>
   npm ci
   npm run build       # ricalcola SRI automaticamente
   # verifica che gli SRI nuovi non rompano il caricamento
   npm run test:e2e    # smoke su browser
   ```
3. Se in `build.mjs` ci sono hardcoded version (`SHEETJS_VERSION = '0.20.3'`):
   ```bash
   # cerca occorrenze e allinea
   grep "SHEETJS_VERSION\|PPTXGENJS_VERSION" build.mjs
   ```
4. Merge

### Bump major

PR singola (mai raggruppata). Review umano richiesto:
1. Leggi release notes / breaking changes
2. Verifica API compatibility con il codice
3. Eventuale PR di adeguamento prima del merge
4. Test completo: `npm test && npm run test:e2e`
5. Smoke manuale su tutte le sezioni della console

Vedi [[GitHub-Actions#dependabot.yml]] per la policy.

## 10. Debugging produzione

### Errori client

`client_errors` tabella raccoglie errori JS dei visitatori (90gg retention).

```sql
SELECT ts, route, message, stack
FROM client_errors
WHERE ts > now() - interval '7 days'
ORDER BY ts DESC
LIMIT 50;
```

PII è già redatto (email/JWT/IBAN/CF/telefono). Vedi [[Sicurezza#pii-redaction]].

### Audit log per ricostruire timeline

```sql
SELECT id, ts, user_email, table_name, operation, row_id,
       jsonb_pretty(old_data) AS old,
       jsonb_pretty(new_data) AS new
FROM audit_log
WHERE ts > now() - interval '24 hours'
  AND table_name = 's1'
  AND user_email = 'mario.rossi@gresmalt.it'
ORDER BY id DESC;
```

### Edge Function logs

Supabase Studio → Functions → Logs. Filtri per:
* Function name (`sign_snapshot`, `ai_assist`, …)
* Time range
* Search nei messaggi (es. `Gemini status: 429`)

### `build.txt` mismatch (anti-stale-cache loop)

Sintomo: utente riporta che il sito si "ricarica continuamente". Possibili
cause:
* GitHub Actions deploy fallito a metà → `index.html` ha BUILD_HASH X ma
  `build.txt` ha hash Y → infinite reload
* Cloudflare cache TTL su `build.txt` (dovrebbe essere `no-store`)

Soluzione: forza re-deploy + Cloudflare cache purge.

## Risorse

- [[Audit-Trail]] — verifica integrità + pseudonimizzazione
- [[Sicurezza]] — RLS + MFA + anon-probe
- [[Gestione-Dati]] — clone year, cascade FE
- [[GitHub-Actions]] — dependabot policy, backup, deploy
