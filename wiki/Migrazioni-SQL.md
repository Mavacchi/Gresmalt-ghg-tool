# Migrazioni SQL

Le migrazioni vivono in `sql/` numerate `01..18`. Eseguibili in ordine
nel SQL Editor di Supabase. Ogni file è **idempotente** (drop-if-exists,
create-if-not-exists, `ON CONFLICT DO NOTHING`).

## Inventario file

```
sql/
├── 01_schema.sql           ← schema base 9 tabelle + audit_log + trigger + RPC keepalive
├── 02_data_seed.sql        ← 7 anagrafiche + 74 FE + ~31 S1 + ~15 S2 + ~95 S3
├── 03_roles.sql            ← RLS + current_role() + policy generiche + verify_audit_chain
├── 04_public_view.sql      ← public_facts MV + RPC pubbliche + s3_materiality_public
├── 05_app_meta.sql         ← app_meta + keepalive_ping
├── 06_client_errors.sql    ← log errori client + retention 90gg
├── 07_invite_operators.sql ← role_map + trigger auto-apply
├── 08_year_lock.sql        ← sign-off lock anni inventario
├── 13_hardening.sql        ← RPC atomiche + pseudonim. + brute-force + pg_cron
├── 14_mfa_editor.sql       ← MFA aal2 forzato per editor (override policy)
├── 15_mfa_auditor.sql      ← MFA aal2 forzato per auditor (audit_log SELECT)
├── 16_audit_chain_cron.sql ← verify_audit_chain_scheduled + log + cron weekly
├── 17_fe_search_log.sql    ← audit tabella + RPC per Edge Function search_fe
└── 18_ai_assist_log.sql    ← audit tabella + RPC per Edge Function ai_assist
```

I file `09..12` sono **non committati** (in `.gitignore`) perché contengono
PII/dati operativi (es. role_map reale con email aziendali, password reset
one-shot). Si eseguono manualmente nel SQL Editor o si conservano in
`private/`.

## Ordine di esecuzione

```
01_schema.sql           Eseguire UNA SOLA volta su DB vergine.
↓
02_data_seed.sql        Seed iniziale. Idempotente con ON CONFLICT DO NOTHING.
↓
03_roles.sql            Crea RLS policy generiche. Da rieseguire se modifichi i ruoli.
↓
04_public_view.sql      Crea MV public_facts. Idempotente (drop materialized view if exists cascade).
↓
05_app_meta.sql         app_meta + keepalive. Idempotente.
↓
06_client_errors.sql    client_errors + retention. Idempotente.
↓
07_invite_operators.sql role_map + trigger su auth.users. Idempotente.
↓
08_year_lock.sql        Override INSERT/UPDATE per year lock. Idempotente.
↓
(09-12 non committati: dati operativi reali, eseguire localmente)
↓
13_hardening.sql        RPC atomiche + pseudonim + brute-force + pg_cron. Idempotente.
↓
14_mfa_editor.sql       Override policy editor con aal=aal2. Idempotente.
↓
15_mfa_auditor.sql      Override audit_log SELECT auditor con aal=aal2. Idempotente.
↓
16_audit_chain_cron.sql Schedulato verify_audit_chain. Idempotente.
↓
17_fe_search_log.sql    Audit ricerche FE LLM. Idempotente.
↓
18_ai_assist_log.sql    Audit chiamate AI generiche. Idempotente.
```

## Dettaglio file per file

### `01_schema.sql`

Crea lo schema base. Contenuto:

* **Estensione `pgcrypto`** nello schema `extensions` (best practice
  Supabase). Gestisce 3 scenari: non installata, installata in `public`
  (vecchia versione → spostata), già in `extensions`.
* **Helper `set_updated_at()`** — trigger function per popolare
  automaticamente `updated_at = now()` + `updated_by = auth.uid()`.
* **9 tabelle base**: `anagrafiche`, `produzione`, `fe`, `s1`, `s2`,
  `s3`, `s3_materiality`, `audit_log`.
* **Indici**: tutti i lookup pattern principali.
* **Trigger updated_at** su tutte le 7 tabelle dati.
* **Hash chain audit**: `audit_hash_chain()` + trigger `BEFORE INSERT` su
  `audit_log`.
* **Generic audit**: `write_audit()` security definer + trigger `AFTER
  INSERT/UPDATE/DELETE` su 7 tabelle (l'8va, `app_meta`, viene aggiunta
  in `05`).

### `02_data_seed.sql`

Seed iniziale del cliente Gresmalt:

* **7 anagrafiche** dei siti del Gruppo (IANO, VIANO, VIANO_GARGOLA,
  FRASSINORO, SASSUOLO, FIORANO, CASALGRANDE).
* **Produzione**: vuota (Opzione B confermata dal cliente — popolata da
  UI dopo deploy).
* **74 FE** (Opzione A confermata): combustibili (ISPRA), elettricità
  (ISPRA/AIB), WTT (DEFRA), materiali (ecoinvent/EPD), trasporti (DEFRA),
  rifiuti (ISPRA). Tutti per anno 2024 + alcuni per 2025.
* **~31 righe S1** anno 2024-2025: combustione stazionaria + mobile +
  fugitivi per ogni sito.
* **~15 righe S2** anno 2024-2025: EE_Acquistata + EE_Acquistata_GO con
  dual reporting LB+MB.
* **~95 righe S3** anno 2024-2025: categorie 1, 2, 3, 4, 5, 6, 7, 9, 12.
* **15 righe `s3_materiality`**: Incluse (1,2,3,4,5,6,7,9,12), Escluse
  (8, 11), N.A. (10, 13, 14), Da valutare (15).

> Tutte le righe seed S1/S2/S3 hanno `qualita_dato='P'` e `stato_dato='Definitivo'`
> o `'Provvisorio'` (le 2025 sono Provvisorie).

### `03_roles.sql`

RLS, ruoli, helper `current_role()`.

```sql
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role',''),
    'viewer'
  );
$$;
```

Default `viewer` se `app_metadata.role` non è valorizzato. **Non legge
da `user_metadata`** (user-controllato, non sicuro).

Anche definisce `verify_audit_chain()` (poi sovrascritta in `15_mfa_auditor.sql`
con check aal2 per auditor).

REVOKE espliciti da anon. GRANT base + RLS policy generiche per
`authenticated`. ENABLE + FORCE RLS su tutte le 8 tabelle.

### `04_public_view.sql`

Crea la MV `public_facts` per la dashboard pubblica anonima.

Schema MV (output `select * from public_facts`):

| Colonna | Tipo | Note |
|---|---|---|
| `anno` | int | PK |
| `em_tco2e_total` | numeric | s1 + s2_lb + s3 |
| `em_per_scope` | jsonb | `{s1, s2_lb, s2_mb, s3}` |
| `s3_breakdown` | jsonb | `{1: em_cat1, 2: em_cat2, ...}` |
| `site_pct` | jsonb | `{IANO: pct, VIANO: pct, ...}` (percentuali 0..100) |
| `go_coverage_pct` | numeric | % GO su totale kWh acquistati |
| `intensity_per_kg` | numeric | g per kg (totale × 1e6 / total_kg) |
| `intensity_per_m2` | numeric | kg per m² (totale × 1000 / total_m2) |
| `refresh_ts` | timestamptz | `now()` quando la MV è stata refreshed |

**Critico**: `total_kg` e `total_m2` **NON sono esposti** (solo i due
rapporti di intensità). Self-check post-DDL verifica questa proprietà
ispezionando `pg_attribute`.

Refresh on-write: trigger `refresh_public_facts()` su s1/s2/s3/produzione
(FOR EACH STATEMENT, CONCURRENTLY con fallback).

RPC pubbliche:
* `get_public_dashboard(p_year int) → json` (un row di `public_facts`)
* `list_public_years() → json` (array desc di anni disponibili)

Vista pubblica filtrata `s3_materiality_public` (solo `cat_id`, `status`).

Test no-leak inline (DO $$ ... $$): verifica che `site_pct` sia ≤ 100,
che `total_kg`/`total_m2` non esistano, che `intensity_*` esistano.

### `05_app_meta.sql`

* Tabella `app_meta(key text PK, value jsonb)`.
* Trigger di audit su app_meta (write_audit già definita in `01`).
* RLS: SELECT tutti authenticated; INSERT/UPDATE solo admin; DELETE revocato.
* Seed: `schema_version=1`, `last_data_refresh=now()`, `app_locked=false`,
  `last_keepalive={ts:now()}`.
* RPC `keepalive_ping()`: security definer, **chiamabile da anon**.
  Aggiorna SOLO `last_keepalive`. Ritorna `{ok:true, ts}`.

### `06_client_errors.sql`

* Tabella `client_errors(id BIGSERIAL, ts, user_id, route, message, stack)`.
* RLS: INSERT da anon (con user_id IS NULL obbligatorio per anon) o auth
  (con user_id=auth.uid()). SELECT solo admin. UPDATE/DELETE revocati.
* `purge_old_client_errors()`: DELETE WHERE ts < now() - 90 days +
  `GET DIAGNOSTICS row_count` (questo era il bug del commit di cleanup —
  prima usava `RETURNING 1 INTO v_count` che ritornava sempre 1).

### `07_invite_operators.sql`

Vedi [[Modello-dati]] per dettagli. `role_map(email, role)` + 2 trigger:

1. `apply_role_from_map_trg` BEFORE INSERT/UPDATE OF email ON `auth.users`
2. `propagate_role_map_change_trg` AFTER INSERT/UPDATE/DELETE ON `role_map`

Vantaggio: l'ordine "invita utente ↔ mappa ruolo" non importa più.

Migrazione idempotente: `ALTER TABLE role_map ADD COLUMN IF NOT EXISTS
updated_by` per schemi pre-esistenti (bug storico: il trigger
`set_updated_at()` la presupponeva).

### `08_year_lock.sql`

Sign-off / lock di un anno di inventario.

* `is_year_locked(p_year int) → boolean`: legge `app_meta.locked_years`
  (array jsonb di int) e verifica con `@>`.
* **Override delle policy INSERT/UPDATE** su s1, s2, s3, produzione:

  ```sql
  WITH CHECK (
    current_role() = 'admin'
    OR (current_role() = 'editor' AND NOT is_year_locked(anno))
  )
  ```

* `UPDATE` ha lock check su **entrambi** i lati: `USING` blocca update di
  righe in anno bloccato; `WITH CHECK` blocca spostamento di una riga in
  anno bloccato.

### `13_hardening.sql`

Indurimento post-review. Idempotente:

1. **`save_produzione(...)`**: RPC atomica DELETE+UPSERT per PK composita
   `(codice_sito, anno)`. Risolve la race window della vecchia implementazione
   client-side che faceva DELETE poi UPSERT separati.

2. **`cascade_fe_update(fe_id, codice_voce, anno_validita)`**: ricalcola
   S1 + S3 referenziati transazionalmente in due `WITH UPDATE` CTE.
   Risolve il problema della vecchia implementazione client-side che
   caricava tutto in memoria e faceva 2 batch upsert non transazionali.

3. **`pseudonymize_audit_email(user_id uuid)`**: GDPR-compliant. Sostituisce
   `user_email` in `audit_log` con `'pseudo:' || substr(sha256(email_or_uid), 1, 16)`.
   Solo admin.

4. **`purge_audit_emails_for_disabled_users()`**: cron mensile. Pseudonimizza
   email di:
   - Utenti cessati (`user_id` in audit_log NOT IN `auth.users`)
   - Utenti dormienti > 24 mesi (`auth.users WHERE last_sign_in_at < now() - 24m`)

5. **`count_failed_logins(window_minutes)`**: sentinella brute-force.
   Legge `auth.audit_log_entries` (audit nativo Supabase) e conta tentativi
   falliti recenti. admin/auditor only.

6. **`force_refresh_public_facts()`**: safety-net per refresh esplicito
   della MV (in caso il trigger automatic fallisca).

7. **Schedulazione pg_cron** (best-effort, do-nothing se l'estensione non
   c'è sul tier free):
   * `ghg_purge_client_errors`: 03:00 UTC daily
   * `ghg_pseudo_audit`: 04:00 UTC il 1° di ogni mese
   * `ghg_refresh_public_facts`: 02:15 UTC ogni domenica

### `14_mfa_editor.sql`

MFA aal2 obbligatorio per ruolo `editor` su tutte le tabelle dati write.

Override le policy create in `08` (per s1/s2/s3/produzione con year lock)
e in `03` (per fe/anagrafiche/s3_materiality senza year lock):

```sql
WITH CHECK (
  current_role() = 'admin'
  OR (current_role() = 'editor'
      AND NOT is_year_locked(anno)            -- solo per tabelle con year lock
      AND (auth.jwt() ->> 'aal') = 'aal2')
);
```

* Admin: invariato, può scrivere anche con aal=aal1 (override d'emergenza).
* Editor a aal1: INSERT/UPDATE respinti con 403 → la UI in
  `AuthGate.MFAEnrollScreen` forza l'enrollment.
* Auditor/viewer: invariati (non scrivono).
* DELETE: invariato (admin only).

Helper `current_aal()` esposto per la UI (decidere se mostrare il wizard).

### `15_mfa_auditor.sql`

MFA aal2 obbligatorio per `auditor` su `audit_log` SELECT.

Override `audit_log_select`:

```sql
USING (
  current_role() = 'admin'
  OR (current_role() = 'auditor' AND (auth.jwt() ->> 'aal') = 'aal2')
);
```

Aggiorna anche `verify_audit_chain()` per riflettere lo stesso check:
admin sempre, auditor solo a aal2.

### `16_audit_chain_cron.sql`

Verifica schedulata della hash chain audit.

* **Tabella `audit_chain_check`**: log dei check periodici (id, ts, status,
  broken_id, expected_hash, actual_hash, total_rows, duration_ms,
  triggered_by, error_message). RLS: SELECT admin sempre + auditor a aal2.
  No INSERT/UPDATE/DELETE diretti.

* **`verify_audit_chain_scheduled()`**: versione "no-role-check" per pg_cron
  (che gira come postgres senza JWT). Stesso loop di `verify_audit_chain()`
  ma:
  * Non controlla current_role()
  * Inserisce SEMPRE una riga in audit_chain_check
  * In caso di broken, exit al primo mismatch
  * Cattura eccezioni → status='error' + error_message

* **View `audit_chain_status`**: ultimi 10 record per UI Diagnostica.
  `security_invoker=on` eredita le policy della base table.

* **Schedulazione pg_cron**: `ghg_verify_audit_chain` lunedì 03:30 UTC.

### `17_fe_search_log.sql`

Audit log delle ricerche FE via LLM (Edge Function `search_fe`).

* **Tabella `fe_search_log`**: `id, ts, user_id, user_email, query,
  sources_used text[], response jsonb, selected_idx, saved_fe_id,
  duration_ms, error_message`.
* RLS: SELECT solo admin + auditor a aal2. INSERT delegato alla RPC.
* **`log_fe_search(query, sources_used, response, duration_ms, error)`**:
  security definer, admin/editor only, legge auth.uid() dal JWT, inserisce
  la riga.
* **`mark_fe_search_selected(log_id, selected_idx, saved_fe_id)`**: chiamata
  dopo che l'utente conferma il salvataggio di un candidato (safety:
  `WHERE user_id = auth.uid()`).

### `18_ai_assist_log.sql`

Audit log delle chiamate AI generiche (Edge Function `ai_assist`).

* **Tabella `ai_assist_log`**: `id, ts, user_id, user_email, task, input
  jsonb, output jsonb, duration_ms, error_message`.
* RLS: SELECT solo admin + auditor a aal2.
* **`log_ai_assist(task, input, output, duration_ms, error)`**: security
  definer, admin/editor only, registra ogni chiamata anche fallita.

## Pattern idempotenza

Tutte le DDL usano pattern idempotenti:

```sql
-- Tabelle
CREATE TABLE IF NOT EXISTS public.foo (...);

-- Indici
CREATE INDEX IF NOT EXISTS foo_idx ON public.foo(col);

-- Policy: drop+create
DROP POLICY IF EXISTS foo_select ON public.foo;
CREATE POLICY foo_select ON public.foo ...;

-- Trigger: drop+create
DROP TRIGGER IF EXISTS foo_audit ON public.foo;
CREATE TRIGGER foo_audit ...;

-- Functions
CREATE OR REPLACE FUNCTION ...;

-- Seed
INSERT INTO foo (...) VALUES (...) ON CONFLICT DO NOTHING;
```

`ALTER TABLE ADD COLUMN IF NOT EXISTS` è usato per migrazioni di schema
preesistente.

I blocchi `DO $$ ... $$` loopano su array di tabelle per creare policy/trigger
in modo DRY.

## Risorse

- [[Modello-dati]] — schema dettagliato + RLS + funzioni
- [[Sicurezza]] — defense-in-depth
- [[Audit-Trail]] — hash chain SHA-256 + verifica
