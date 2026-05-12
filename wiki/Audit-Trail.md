# Audit Trail

Sezione della console interna accessibile solo ad **admin** e **auditor**
(quest'ultimo richiede MFA aal2 lato DB). Visualizza il log immutabile di
tutte le mutazioni con verifica di integrità via hash chain SHA-256.

* **Path UI**: `src/sections/AuditTrail.jsx` (345 righe)
* **Storage**: tabella `audit_log` (BIGSERIAL) — vedi [[Modello-dati]]
* **RLS**: solo admin/auditor (auditor solo a aal2 — sql/15_mfa_auditor.sql)

## Hash chain SHA-256

Ogni riga in `audit_log` ha due campi chiave:

* `prev_hash` — il `row_hash` della riga precedente nell'audit
* `row_hash` — `sha256(prev_hash || ts || table || op || new_data || old_data)`

Il trigger `audit_hash_chain` calcola **prima dell'INSERT**:

```sql
CREATE OR REPLACE FUNCTION public.audit_hash_chain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_prev text;
BEGIN
  SELECT row_hash INTO v_prev
    FROM public.audit_log
    ORDER BY id DESC LIMIT 1;
  new.prev_hash := v_prev;
  new.row_hash := encode(
    extensions.digest(
      coalesce(v_prev,'') ||
      new.ts::text ||
      new.table_name ||
      new.operation ||
      coalesce(new.new_data::text,'') ||
      coalesce(new.old_data::text,''),
      'sha256'
    ),
    'hex'
  );
  RETURN new;
END;
$$;

CREATE TRIGGER audit_log_chain
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_hash_chain();
```

## Trigger su 8 tabelle

Le 8 tabelle audited:
* `anagrafiche`, `produzione`, `fe`
* `s1`, `s2`, `s3`
* `s3_materiality`
* `app_meta` (locked_years, targets, schema_version, ecc.)

Per ognuna, un trigger `<table>_audit` (AFTER INSERT/UPDATE/DELETE) chiama
`write_audit()`:

```sql
CREATE OR REPLACE FUNCTION public.write_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_email text; v_row_id text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  IF (tg_op = 'DELETE') THEN
    v_row_id := coalesce(
      (to_jsonb(old)->>'id'),
      (to_jsonb(old)->>'codice_sito'),
      (to_jsonb(old)->>'cat_id'),
      (to_jsonb(old)->>'key')
    );
    INSERT INTO public.audit_log
      (user_id, user_email, table_name, operation, row_id, old_data, new_data)
    VALUES
      (auth.uid(), v_email, tg_table_name, tg_op, v_row_id, to_jsonb(old), NULL);
    RETURN old;
  ELSE
    v_row_id := coalesce(
      (to_jsonb(new)->>'id'),
      (to_jsonb(new)->>'codice_sito'),
      (to_jsonb(new)->>'cat_id'),
      (to_jsonb(new)->>'key')
    );
    INSERT INTO public.audit_log
      (user_id, user_email, table_name, operation, row_id, old_data, new_data)
    VALUES
      (auth.uid(), v_email, tg_table_name, tg_op, v_row_id,
       CASE WHEN tg_op = 'UPDATE' THEN to_jsonb(old) ELSE NULL END,
       to_jsonb(new));
    RETURN new;
  END IF;
END;
$$;
```

Il `row_id` è "qualunque sia la PK": gestisce le 4 tipologie:
* `id` UUID (s1, s2, s3, fe)
* `codice_sito` text (anagrafiche; per produzione c'è anche `anno` ma sta in `old_data`)
* `cat_id` int (s3_materiality)
* `key` text (app_meta)

## Verifica integrità

Due varianti:

### `verify_audit_chain()` — interactive (UI)

```sql
CREATE OR REPLACE FUNCTION public.verify_audit_chain()
RETURNS table(broken_id bigint, expected_hash text, actual_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_prev text := NULL; v_calc text;
        v_role text := public.current_role();
        v_aal text := coalesce(auth.jwt() ->> 'aal', 'aal1');
BEGIN
  IF v_role = 'admin' THEN NULL;
  ELSIF v_role = 'auditor' THEN
    IF v_aal <> 'aal2' THEN
      RAISE EXCEPTION 'verify_audit_chain: auditor richiede MFA aal2';
    END IF;
  ELSE
    RAISE EXCEPTION 'verify_audit_chain: ruolo non autorizzato';
  END IF;

  FOR r IN SELECT * FROM public.audit_log ORDER BY id ASC LOOP
    v_calc := encode(extensions.digest(
      coalesce(v_prev,'') || r.ts::text || r.table_name || r.operation ||
      coalesce(r.new_data::text,'') || coalesce(r.old_data::text,''),
      'sha256'), 'hex');
    IF v_calc <> r.row_hash THEN
      broken_id := r.id;
      expected_hash := v_calc;
      actual_hash := r.row_hash;
      RETURN NEXT;
      RETURN;
    END IF;
    v_prev := r.row_hash;
  END LOOP;
  RETURN;
END;
$$;
```

* Chiamata da `G.db.verifyAuditChain()` lato client
* Pulsante "Verifica integrità" in UI Audit Trail + UI Diagnostica
* Ritorna prima riga rotta (o nessuna se chain integra)
* Anche esposta via Edge Function `verify_audit_chain` per usi automation

### `verify_audit_chain_scheduled()` — cron

```sql
-- in sql/16_audit_chain_cron.sql
CREATE OR REPLACE FUNCTION public.verify_audit_chain_scheduled()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER ...
```

Senza role check (perché pg_cron gira come postgres, no JWT). Esegue la
stessa verifica ma:
- Loop completo della chain (non si ferma al primo break — per metriche)
- INSERT in `audit_chain_check` con `{status, broken_id, expected_hash,
  actual_hash, total_rows, duration_ms, triggered_by='cron'}`
- Cattura eccezioni → `status='error' + error_message`

Schedulato:
* **pg_cron Pro/Enterprise tier Supabase**: ogni lunedì 03:30 UTC
* **Free tier**: schedulato via GitHub Actions (non incluso default, opzionale)

La view `audit_chain_status` espone gli ultimi 10 record per la UI
Diagnostica.

## UI Audit Trail

### Header

* Badge stato hash chain in alto a destra:
  * `🟢 OK` se chain integra
  * `🔴 BROKEN @ id=N` con tooltip dettagli (expected vs actual hash)
* Pulsante "Verifica integrità" per re-run manuale

### Filtri

* Tabella (dropdown: s1, s2, s3, fe, anagrafiche, produzione, s3_materiality, app_meta)
* Operazione (dropdown: INSERT / UPDATE / DELETE / *)
* User (autocomplete email)
* Date range (from / to)
* Search testuale (cerca in `row_id`, `user_email`, contenuto `new_data`/`old_data` JSON)

### Tabella log

Paginata, 500 righe/pagina. "Load more" finché `data.length < PAGE_SIZE`.

Colonne:
* `ts` — timestamptz
* `user_email` — email operatore (o `pseudo:<hash>` se pseudonimizzato)
* `table_name`
* `operation` (INSERT / UPDATE / DELETE — con icone)
* `row_id`
* `summary` — diff conciso (es. `quantita: 18000 → 18450`)
* Pulsante "Diff" per espandere

### Diff modal

Mostra `old_data` vs `new_data` come pretty-printed JSON, con highlighting
delle differenze (campi rossi rimossi, verdi aggiunti, gialli cambiati).

Esempio per UPDATE su s1:

```diff
{
  "id": "abc...",
  "anno": 2024,
  "codice_sito": "IANO",
  "categoria_s1": "Combustione_Stazionaria",
  "combustibile": "Gas_Naturale",
- "quantita": 18000000,
+ "quantita": 18450000,
- "em_tco2e": 35712,
+ "em_tco2e": 36605,
  ...
}
```

### Export

Due opzioni:

1. **CSV** — `G.io.exportCSV(rows, 'audit_log_YYYY-MM-DD.csv')` — semplice
2. **JSON firmato** — chiama Edge Function `sign_snapshot` per applicare
   HMAC-SHA256, scarica il file con `{payload, signature, data_sha256,
   signed_at, signer_email, algorithm: 'HMAC-SHA256'}`. Da usare come
   evidenza forense.

## Pseudonimizzazione GDPR

CSRD + GDPR: dopo cessazione del rapporto con un operatore, l'email PII
deve essere rimossa dall'audit_log preservando l'integrità della hash
chain dove tecnicamente possibile.

### Function `pseudonymize_audit_email(p_user_id uuid)`

```sql
CREATE OR REPLACE FUNCTION public.pseudonymize_audit_email(p_user_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER ...
```

* Solo admin può chiamarla
* Cerca email in `auth.users WHERE id = p_user_id`; se utente già cancellato
  usa `p_user_id::text` come fallback input
* Calcola pseudonimo deterministico: `'pseudo:' || substr(sha256(email_or_id), 1, 16)`
* `UPDATE audit_log SET user_email = v_pseudo WHERE user_id = p_user_id`
* Ritorna count di righe aggiornate

**Importante**: la pseudonimizzazione NON ricalcola il `row_hash` →
`verify_audit_chain()` rileverà volutamente le righe pseudonimizzate come
"rotte" sul primo evento pseudonimizzato. Questo è **atteso** ed è
documentato. Una variante "relaxed" che ignora i record pseudonimizzati può
essere aggiunta se necessario.

### Cron mensile `purge_audit_emails_for_disabled_users()`

```sql
CREATE OR REPLACE FUNCTION public.purge_audit_emails_for_disabled_users()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER ...
```

Loop su:
1. **Utenti cessati**: `user_id in audit_log NOT IN auth.users` → pseudonimizza
2. **Utenti dormienti > 24 mesi**: `auth.users WHERE last_sign_in_at < now() - interval '24 months'` → pseudonimizza

Schedulato:
* pg_cron Pro/Enterprise: 1° di ogni mese, 04:00 UTC
* Free tier: GitHub Actions (opzionale)

## Sentinella brute-force

```sql
CREATE OR REPLACE FUNCTION public.count_failed_logins(p_window_minutes int DEFAULT 60)
RETURNS table (failed_attempts bigint, distinct_emails bigint, last_attempt timestamptz)
...
```

Legge `auth.audit_log_entries` (audit nativo Supabase Auth, distinto da
`public.audit_log` di business) e conta i login falliti recenti.
admin/auditor only.

Utilizzabile da una Edge Function chiamata via cron per spedire mail/Slack
quando supera la soglia. L'azione è esterna; la function ritorna solo le
metriche.

## Edge Function `verify_audit_chain`

`supabase/functions/verify_audit_chain/index.ts` — wrapper Edge che chiama
la SQL function `verify_audit_chain()`. Aggiunge CORS + autenticazione
+ ritorna `{integrity: 'ok'|'broken', first_broken_id, expected_hash,
actual_hash, verified_at}`.

L'enforcement del ruolo è già nella SQL function (admin/auditor only).

## Pattern: niente INSERT/UPDATE/DELETE diretti su audit_log

Per defense-in-depth:

```sql
-- In 03_roles.sql
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated, anon;
```

Solo i trigger `write_audit` (security definer) scrivono, e il trigger
`audit_hash_chain` (security definer) sigilla. Anche se un utente
malintenzionato bypassasse RLS, non potrebbe inserire una riga manualmente.

## Risorse

- [[Modello-dati]] — schema audit_log + trigger
- [[Sicurezza]] — MFA aal2 per auditor, defense-in-depth
- [[Edge-Functions]] — sign_snapshot per export firmato
- [[Operazioni-Comuni]] — playbook GDPR pseudonimizzazione
