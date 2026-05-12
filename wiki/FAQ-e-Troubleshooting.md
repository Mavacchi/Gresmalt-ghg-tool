# FAQ & Troubleshooting

## Login

### Non riesco a fare login

**Sintomo**: "Email o password non valide" anche con credenziali corrette.

**Cause comuni**:

1. **Utente non registrato**: verifica in Supabase Auth → Users.
2. **Email errata in `role_map`**: ricontrolla che l'email in `role_map`
   sia identica a quella usata per login (case-insensitive ok grazie al
   trigger, ma typo no).
3. **Sessione corrotta**: pulisci `sessionStorage` e `localStorage` del
   browser per il dominio del sito; riprova.
4. **Cloudflare Turnstile bloccato**: se hai una rete corporate/VPN
   strana, Turnstile può rifiutare. Disabilita VPN o usa un altro browser.

### Sono editor ma non riesco a salvare le modifiche

**Sintomo**: dopo `+ Aggiungi` o `Salva` modal, toast con errore
`new row violates row-level security policy`.

**Cause**:

1. **Manca MFA TOTP**: le policy `sql/14_mfa_editor.sql` richiedono
   `aal=aal2`. La UI dovrebbe forzare l'enrollment al primo login; se
   non l'ha fatto:
   * Esci e rientra
   * Verrai mandato a `MFAEnrollScreen`
   * Completa enrollment con Google Authenticator/Authy/1Password

2. **Anno bloccato**: l'anno è in `app_meta.locked_years`. Editor non può
   modificare anni lockati. Chiedi all'admin di unlock temporaneo, oppure
   chiedi a un admin di fare la modifica.

3. **Verifica role**:
   ```sql
   SELECT raw_app_meta_data->>'role'
   FROM auth.users WHERE email = '<tua email>';
   ```
   Se è null o `viewer`, controlla `role_map`.

### Ho perso il dispositivo MFA

**Per admin**: niente lockout (MFA non forzato per admin, override
d'emergenza).

**Per editor/auditor**: chiedi a un admin di:

1. SQL Editor:
   ```sql
   -- Lista factors MFA dell'utente
   SELECT id, friendly_name, factor_type, status
   FROM auth.mfa_factors
   WHERE user_id = (SELECT id FROM auth.users WHERE email = '<email>');
   ```
2. Rimuovi il factor:
   ```sql
   DELETE FROM auth.mfa_factors WHERE id = '<factor_id>';
   ```
3. L'utente al successivo login passerà di nuovo per `MFAEnrollScreen`
   per setup con un nuovo dispositivo.

## Dati & visualizzazione

### La Public Dashboard mostra "Nessun dato disponibile" per quest'anno

**Cause**:

1. **Nessun dato S1/S2/S3 nel DB per quell'anno**. Verifica:
   ```sql
   SELECT 's1' AS t, count(*) FROM s1 WHERE anno=2025
   UNION ALL SELECT 's2', count(*) FROM s2 WHERE anno=2025
   UNION ALL SELECT 's3', count(*) FROM s3 WHERE anno=2025;
   ```

2. **MV `public_facts` non refreshed**. Forza il refresh:
   ```sql
   SELECT public.force_refresh_public_facts();
   ```

3. **`list_public_years()` ritorna lista vuota**: verifica i grants
   ```sql
   \df+ public.list_public_years
   ```

### Intensità per kg/m² mostra "n.d."

**Causa**: nessuna riga in `produzione` per quell'anno (o tutti zero).

**Soluzione**:
* Console → **Gestione Dati > Produzione**
* `+ Aggiungi` per ogni sito (anno) con kg + m²
* Refresh MV o attendi il refresh automatico (trigger su INSERT)

### "Em_tCO2e" è null su righe importate da Excel

**Causa**: import minimale (solo Quantità + Combustibile, senza Em).
Questo era un bug storico; ora `enrichForUpsert` ricalcola al commit.

**Verifica**:
```sql
SELECT id, combustibile, quantita, fe_valore, em_tco2e
FROM s1
WHERE em_tco2e IS NULL;
```

**Fix**:

1. Se è un import recente, le righe dovrebbero essere già state arricchite.
   Se non lo sono, ri-fai l'import (la cascade ora funziona).
2. Per fix legacy, esegui manualmente:
   ```sql
   UPDATE s1
   SET fe_valore = fe.valore,
       em_tco2e  = coalesce(s1.quantita, 0) * fe.valore / 1000
   FROM fe
   WHERE s1.em_tco2e IS NULL
     AND s1.combustibile = fe.codice_voce
     AND s1.anno = fe.anno_validita;
   ```

### Hash chain "broken" dopo pseudonimizzazione

**Atteso**. La `pseudonymize_audit_email()` sostituisce `user_email` ma
NON ricalcola `row_hash`. La chain si rompe sul primo record pseudonimizzato.

**Comportamento progettato**: la `verify_audit_chain()` segnala il break;
la UI dovrebbe interpretare lo stato e differenziare "pseudonimizzato
intenzionalmente" da "tampering reale".

In futuro: aggiungere flag `pseudonymized_at` per `audit_log` e un
`verify_audit_chain_relaxed()` che skippa quei record.

## Build & deploy

### "Mancano env vars richieste"

**`build.mjs`** emette warning ma produce comunque l'output. I placeholder
`__SUPABASE_*__` restano nel bundle → client non si connette.

**Fix**: esporta le env e ribuilda.

```bash
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
node build.mjs
```

### Build OK ma `window.supabase` è undefined nel browser

**Causa probabile**: webpack auto-publicPath che `patchInlinedUMD` non ha
patchato.

**Verifica**: apri devtools console del sito → cerca un error
`"Automatic publicPath is not supported in this browser"`.

**Fix**:
* Cambia Supabase JS version (downgrade temporaneo)
* Aggiorna la regex in `build.mjs` `patchInlinedUMD` per matchare il
  nuovo throw pattern di webpack
* PR di adeguamento

### Deploy GitHub Pages fallito con 403

**Cause**:

1. Settings → Pages → Source non è "GitHub Actions" → cambiare
2. Permission del workflow non sono corrette: deve avere `pages: write`,
   `id-token: write`
3. Branch protection block (es. require approval). Push da admin o setup
   bypass.

### Site live non si aggiorna dopo push

**Cause**:

1. **Cloudflare cache TTL** su `index.html`: imposta page rule per cache
   0 secondi sui `*.html`.
2. **Browser cache utente**: l'anti-stale-cache forzerà reload al
   primo `pageshow` o quando `build.txt` mismatch (entro ~10s
   dell'apertura).
3. **GitHub Pages CDN propagation**: solitamente 1-5 min.

Verifica:
```bash
curl -sI "https://sustainability.gresmalt.it/build.txt"
# Cache-Control: ... no-store / max-age
```

## Edge Functions

### Edge Function "Forbidden · origin not allowed"

**Causa**: il client non è in `ALLOWED_ORIGINS`.

**Fix**:
```bash
supabase secrets set ALLOWED_ORIGINS="https://sustainability.gresmalt.it,https://gresmalt.github.io,http://localhost:8000"
```

Le origin devono essere esatte (https://, no trailing slash, no path).

### "Quota Gemini esaurita"

Tier free Gemini ha quote stringenti:
* `gemini-2.5-flash-lite`: 20 RPD model + 1.5K grounding pool 2.5
* `gemini-3.1-flash-lite`: 500 RPD model + grounding pool 3 = **0/0**!

**Sintomo `search_fe`**: 429 anche con quota model intatta = grounding
pool esaurito.

**Fix**:
* Aspetta reset (UTC midnight per RPD)
* Pianifica piano Pay-as-you-go su https://aistudio.google.com
* O switch al modello: `supabase secrets set GEMINI_MODEL=gemini-2.5-flash-lite`

### `sign_snapshot` ritorna 500

**Cause comuni**:

1. **`SNAPSHOT_HMAC_KEY` non impostata**. Verifica:
   ```bash
   supabase secrets list
   ```
   Imposta:
   ```bash
   supabase secrets set SNAPSHOT_HMAC_KEY=$(openssl rand -hex 32)
   ```

2. **`SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` non impostate** (di
   solito auto-iniettate, ma a volte mancano). Imposta esplicitamente:
   ```bash
   supabase secrets set SUPABASE_URL=$(supabase status --output json | jq -r '.url')
   supabase secrets set SUPABASE_PUBLISHABLE_KEY=$(supabase status --output json | jq -r '.publishable_key')
   ```

3. **Errore nel codice**: vedi Supabase Studio → Functions → Logs.

## Performance

### Bundle troppo grande / lento da caricare

`site/index.html` è ~1.1 MB. Sopra 1 MB è considerato "grande" per first
paint. Ottimizzazioni applicate:
* Bundle gzip (Cloudflare lo serve compresso → ~350 KB effettivi)
* Lazy load di SheetJS/pptxgenjs (caricati solo su click "Export Excel/PPTX")
* `<link rel=preconnect>` per Google Fonts

Se serve ridurre ulteriormente:
* Considera "code splitting" delle sezioni (rompe il pattern IIFE, big work)
* Considera React production source-maps stripped (già fatto in UMD prod)

### Query DB lenta

Verifica indici:

```sql
\d+ s1
-- s1_anno_sito_idx, s1_pkey
```

Se aggiungi un filter su una colonna non indicizzata (es. `combustibile`),
aggiungi un indice:

```sql
CREATE INDEX IF NOT EXISTS s1_combustibile_idx ON public.s1(combustibile);
```

### MV refresh `concurrent` fails

```
ERROR: cannot refresh materialized view "public_facts" concurrently
HINT: Create a unique index with no WHERE clause on one or more columns of the materialized view.
```

**Causa**: la prima volta che la MV viene creata, prima del primo unique
index, il refresh concurrent fallisce.

**Fix**: `refresh_public_facts()` ha fallback non-concurrent. Una
volta creato `public_facts_anno_idx` (unique), i refresh successivi
funzionano concurrent.

```sql
SELECT public.force_refresh_public_facts(); -- runs non-concurrent fallback
```

## Anti-stale cache loop infinito

**Sintomo**: il sito si ricarica continuamente.

**Cause**:

1. **`build.txt` non aggiornato** dopo deploy → BUILD_HASH del bundle è
   X, `build.txt` ha Y vecchio → reload. Forza redeploy.

2. **Cloudflare cache su `build.txt`**: imposta `Cache-Control: no-store`
   via `_headers` o page rule.

3. **Loop guard sessionStorage corrotto**: già gestito (max 1 reload / 10s).

**Debug**: in devtools console:

```js
console.log('inlined BH:', document.querySelector('meta[name="ghg-build"]').content);
fetch('build.txt?_=' + Date.now(), {cache:'no-store'})
  .then(r => r.text())
  .then(t => console.log('server BH:', t.trim()));
```

Se i due differiscono, c'è un mismatch da risolvere.

## CSP violations

### "Refused to load the script because it violates the CSP"

La CSP è ristretta. Se aggiungi una nuova lib esterna, devi:
1. Aggiungerla a `connect-src` o `script-src` in `build.mjs`
2. (Preferito) inlinarla nel bundle
3. (Secondo preferito) lazy con SRI

Vedi [[Sicurezza#csp]] per le direttive attuali.

## SQL & RLS

### "permission denied for table xxx"

**Causa**: l'utente authenticated non ha grants base sulla tabella
(non solo policy RLS).

**Fix**: ri-esegui `03_roles.sql` che fa:
```sql
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.anagrafiche, public.produzione, public.fe,
  public.s1, public.s2, public.s3, public.s3_materiality
  TO authenticated;
```

Vedi [[Modello-dati#row-level-security-rls]] per dettagli.

### Anon-probe riporta tabelle leakate

**Sintomo**: Diagnostica → "Anon probe" mostra `leaked: ['xxx']`.

**Causa**: la tabella ha RLS abilitato ma una policy ammette anon.

**Fix immediato**:
```sql
REVOKE ALL ON public.xxx FROM anon;
```

Poi ri-esegui `03_roles.sql` (e `08`, `14`, `15` per applicare le policy
corrette).

## Backup

### `pg_dump` failed: connection refused

**Cause**:
1. `SUPABASE_DB_URL` errato (controlla porta `5432` per direct, `6543` per
   pooler — preferisci direct per `pg_dump`)
2. Supabase ha IP restrictions abilitate; aggiungi l'IP del GitHub Actions
   runner all'allow-list (instabile — meglio usare il pooler con SCRAM)

### `gpg: cannot use 'AES256' as cipher algorithm`

**Causa**: versione `gnupg` troppo vecchia.

**Fix**: nel workflow `backup.yml` aggiorna:
```bash
sudo apt-get install -qq -y postgresql-client gnupg
```

I runner GitHub Actions usano Ubuntu LTS con gnupg ≥ 2.2.

### Ho perso `BACKUP_PASSPHRASE`

I backup precedenti sono **irrecuperabili**. Cripto-pratica: conserva la
passphrase in password manager + condividi con un secondo admin (4-eyes).

Per il futuro: genera nuova passphrase, aggiorna GitHub secret. I prossimi
backup useranno la nuova; i vecchi resteranno bloccati.

## Domande generali

### Posso usare il tool per un'altra azienda?

Sì, è un template generico per inventario GHG. Fork del repo, sostituisci:

* Logo (`assets/logo.png`, `assets/Logo-ridotto.png`, `assets/favicon.png`)
* `COMPANY_LEGAL_NAME`, `COMPANY_VAT`, `SUSTAINABILITY_EMAIL`,
  `PUBLIC_DASHBOARD_URL` (env vars o GitHub vars)
* Seed in `sql/02_data_seed.sql` (anagrafiche dei siti, FE rilevanti)
* `G.TARGETS` in `src/constants.js` (target di decarbonizzazione propri)
* `G.I18N` se serve modificare le label IT/EN

### Quanto costa l'infrastruttura?

* **GitHub Pages**: gratis (limite 100 GB/mese bandwidth, 10 build/h)
* **Supabase Free tier**: 500 MB DB, 2 GB storage, 50K MAU, 500K Edge
  Function invocations/mese. Pausa dopo 7 giorni inattività (mitigata
  da `keepalive.yml`)
* **Supabase Pro**: $25/mese — niente pausa, 8 GB DB, 100 GB storage,
  100K MAU, 2M Edge Function invocations
* **Cloudflare** (opzionale): gratis per il proxy + Turnstile
* **Google Gemini API**: free tier ok per piccoli volumi (20 RPD); Pay-as-you-go
  ~$0.0001 per 1K input tokens

Totale tipico Pro: ~$25/mese.

### Posso esportare i dati e cambiare provider?

Sì:

* **Export dati**: backup `pg_dump` weekly o `G.io.exportExcel(data)`
  per Excel con tutti i fogli
* **Snapshot firmato**: export JSON HMAC-signed da Download
* **PPTX report**: ~22 slide pubblicabili

Il modello dati è standard Postgres con tabelle GHG Protocol-style →
portable a qualunque DB Postgres-compatibile (con re-applicazione delle
RLS).

### Come funziona la rendicontazione biogenica?

Le emissioni di CO₂ da combustibili biogenici (biomassa, biogas,
biodiesel) sono **escluse dal totale Scope 1** come previsto dal GHG
Protocol Corporate Standard. Vengono tracciate separatamente nei sistemi
interni.

Nel tool: il seed include FE biogeniche con `nota='Biogenica'` o
`'Biogenica esclusa'`. Le righe S1 con quei FE possono comunque essere
inserite, ma il `valore` del FE è ridotto a riflettere solo la parte non
biogenica.

### Posso allinearmi formalmente a SBTi?

Gresmalt si **auto-allinea** a SBTi 1.5°C ma **non ha sottomesso** i
target per validazione formale (richiede un commitment esplicito + audit
SBTi).

Per sottomettere:
* Vai a https://sciencebasedtargets.org/companies-taking-action
* Compila application form (~€10k-15k fee per audit)
* Aggiorna `G.TARGETS.alignment = 'SBTi validated 1.5°C'` post-approvazione

## Risorse

- [[Operazioni-Comuni]] — playbook task ricorrenti
- [[Sicurezza]] — defense-in-depth complete
- [[Configurazione]] — secrets + env vars
- [[Glossario]] — terminologia tecnica
