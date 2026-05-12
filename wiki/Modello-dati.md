# Modello dati

Le migrazioni SQL vivono in `sql/` numerate `01..18`. Vanno eseguite **una
sola volta** sul SQL Editor di Supabase (o via `supabase db push`), in
ordine. Ogni file è **idempotente** (drop-if-exists + create-if-not-exists
+ `ON CONFLICT DO NOTHING`), quindi può essere ri-eseguito senza side-effect.

```
sql/
├── 01_schema.sql            ← 9 tabelle base + audit_log + trigger
├── 02_data_seed.sql         ← 7 anagrafiche + 74 FE + ~95 S3 (Opzione A/B)
├── 03_roles.sql             ← RLS + current_role() + policy generiche
├── 04_public_view.sql       ← public_facts MV + RPC pubbliche
├── 05_app_meta.sql          ← app_meta + keepalive_ping
├── 06_client_errors.sql     ← log errori client + retention 90 gg
├── 07_invite_operators.sql  ← role_map + trigger auto-apply
├── 08_year_lock.sql         ← sign-off lock anni inventario
├── 13_hardening.sql         ← RPC atomiche + pseudonim. + pg_cron
├── 14_mfa_editor.sql        ← MFA aal2 forzato per editor
├── 15_mfa_auditor.sql       ← MFA aal2 forzato per auditor
├── 16_audit_chain_cron.sql  ← verify_audit_chain_scheduled + log
├── 17_fe_search_log.sql     ← audit ricerche FE via LLM
└── 18_ai_assist_log.sql     ← audit chiamate AI generiche
```

> I file `09..12` sono **non committati** (sono in `.gitignore`) perché
> contengono dati operativi / email reali / password reset. Si gestiscono
> in `private/` o si eseguono direttamente nel SQL Editor.

## Tabelle (14)

### `anagrafiche` — i 7 siti del Gruppo

```sql
codice_sito       text primary key      -- es. 'IANO', 'VIANO_GARGOLA'
nome_sito         text not null
tipologia         text                  -- 'Stabilimento' | 'Magazzino' | 'Logistica'
presenza_chp      boolean default false -- Combined Heat & Power
regime_ets        boolean default false -- EU Emissions Trading Scheme
note_produzione   text
created_at, created_by, updated_at, updated_by
```

I 7 siti seed: `IANO`, `VIANO`, `VIANO_GARGOLA`, `FRASSINORO`, `SASSUOLO`,
`FIORANO`, `CASALGRANDE`. Tre sotto regime ETS con CHP (IANO, VIANO,
SASSUOLO).

### `produzione` — volumi kg + m² per sito/anno

```sql
codice_sito       text references anagrafiche
anno              int check (anno between 2000 and 2100)
produzione_kg     numeric  >= 0   -- nullable
produzione_m2     numeric  >= 0   -- nullable
note              text
primary key (codice_sito, anno)
check (coalesce(produzione_kg,0) + coalesce(produzione_m2,0) > 0)
```

PK **composita** (codice_sito, anno). Sì, è gestita correttamente
dall'app: vedi `G.db.saveProduzione` che chiama la RPC atomica
`save_produzione` per gestire l'edit della PK (vedi [[Sorgenti-File-per-File]]).

### `fe` — Fattori di Emissione

```sql
id              uuid primary key default gen_random_uuid()
fe_id           text           -- codice "umano" es. 'FE_GN_2024'
famiglia        text           -- Combustibili | Elettricità | WTT | Materiali | Trasporti | Rifiuti
codice_voce     text           -- lookup key (es. 'metano', 'argilla')
descrizione     text
anno_validita   int
valore          numeric  >= 0  -- kgCO2e per unità
unita           text           -- es. 'kgCO2e/Sm3', 'kgCO2e/kWh'
gas             text           -- 'CO2e' (di solito) o singolo gas
fonte           text           -- 'ISPRA 2024', 'DEFRA 2024', 'AIB 2024', …
nota            text
created_at, created_by, updated_at, updated_by

unique (fe_id, anno_validita) where fe_id is not null
```

Indici:
- `fe_id_anno_uk` (unique partial)
- `fe_codice_voce_idx` su `(codice_voce, anno_validita)`
- `fe_famiglia_idx` su `(famiglia)`

Versionati per anno: il lookup in `G.calc.lookupFE` fa exact match + fallback
al più recente (warn se Δ=2, err se Δ>2).

### `s1` — Emissioni dirette

```sql
id              uuid primary key
scope           int default 1 check (scope = 1)
anno            int not null
codice_sito     text references anagrafiche
categoria_s1    text           -- 'Combustione_Stazionaria' | 'Combustione_Mobile' | 'Fugitivi'
combustibile    text           -- lookup key in fe.codice_voce
quantita        numeric  >= 0
unita           text           -- attesa: vedi G.EXPECTED_UNIT_S1
fonte_dato      text
qualita_dato    text check in (P,S,E)
stato_dato      text check in (Definitivo, Provvisorio, Stimato)
note            text
fe_valore       numeric        -- FE applicato (denormalizzato per perf)
em_tco2e        numeric        -- quantita * fe_valore / 1000
```

### `s2` — Elettricità acquistata (dual reporting LB + MB)

```sql
id, scope=2, anno, codice_sito
voce_s2         text           -- 'EE_Acquistata' | 'EE_Acquistata_GO' | 'Teleriscaldamento' | …
quantita        numeric        -- in kWh tipicamente
unita           text
strumento_mb    text           -- 'GO' | 'PPA' | 'contract' | …
fonte_dato, qualita_dato, stato_dato, note
fe_location     numeric        -- mix di rete (ISPRA Terna)
fe_market       numeric        -- contratto reale (AIB residual o 0 per GO)
em_loc_tco2e    numeric        -- quantita * fe_location / 1000
em_mkt_tco2e    numeric        -- quantita * fe_market   / 1000
```

Il dual reporting è obbligatorio per CSRD/GHG Protocol. La Public Dashboard
ha un toggle LB/MB che il visitatore può cambiare.

### `s3` — Catena del valore (15 categorie GHG Protocol)

```sql
id, scope=3, anno
categoria_s3    int check between 1 and 15
sottocategoria  text
metodo          text           -- 'Spend-based' | 'Activity-based' | 'Distance-based' | 'Avg-data' | 'Calculated'
combustibile    text           -- per WTT / waste / fugitive
quantita        numeric  >= 0
unita           text
codice_fe       text           -- fe.fe_id o fe.codice_voce
fonte_dato, qualita_dato, stato_dato, note
fe_valore       numeric
em_tco2e        numeric
tabella         text default 'Main'
```

Non ha `codice_sito` — Scope 3 è organizzativo (catena del valore globale),
non per-sito.

### `s3_materiality` — status delle 15 categorie

```sql
cat_id              int primary key check between 1 and 15
status              text check in (Inclusa, Esclusa, N.A., Da valutare)
justification       text
methodological_ref  text         -- 'GHG Protocol Scope 3 cat.4', 'PCAF v2.0', …
review_year         int
```

Setup Gresmalt corrente:
- **Incluse**: 1, 2, 3, 4, 5, 6, 7, 9, 12
- **Escluse**: 8 (leasing upstream), 11 (use of sold products — piastrelle passive)
- **N.A.**: 10, 13, 14
- **Da valutare**: 15 (investimenti finanziari → PCAF)

### `audit_log` — log con hash chain SHA-256

```sql
id           bigserial primary key
ts           timestamptz not null default now()
user_id      uuid
user_email   text                       -- pseudonimizzabile per GDPR
table_name   text not null
operation    text check in (INSERT, UPDATE, DELETE)
row_id       text
old_data     jsonb
new_data     jsonb
prev_hash    text
row_hash     text
```

Vedi [[Audit-Trail]] per dettagli sulla hash chain e sulla pseudonimizzazione GDPR.

### `app_meta` — chiave-valore generico

```sql
key         text primary key   -- 'targets', 'locked_years', 'last_keepalive', 'schema_version'
value       jsonb not null
updated_at, updated_by
```

Usato per:
- `targets` (sovrascrive `G.TARGETS` runtime — admin può aggiornare senza redeploy)
- `locked_years` (array JSONB di anni bloccati)
- `last_keepalive` (timestamp aggiornato da `keepalive_ping`)
- `schema_version` (intero che identifica la versione schema corrente)

### `client_errors` — log errori client (insert-only)

```sql
id, ts, user_id, route, message, stack
```

Insert da anon e authenticated (con anon → `user_id IS NULL` obbligatorio).
SELECT solo admin. Retention 90 giorni via `purge_old_client_errors()`
schedulato. PII è redatto lato client da `G.db.redactPII` prima dell'insert.

### `role_map` — mappa email → ruolo

```sql
email      text primary key
role       text check in (admin, editor, auditor, viewer)
added_at, added_by, updated_at, updated_by
```

RLS: solo admin legge e scrive. Due trigger fanno tutto il lavoro:

1. `apply_role_from_map_trg` (BEFORE INSERT/UPDATE OF email ON auth.users):
   quando un utente Supabase viene creato o cambia email, applica il ruolo
   da `role_map` direttamente in `raw_app_meta_data.role`.

2. `propagate_role_map_change_trg` (AFTER INSERT/UPDATE/DELETE ON role_map):
   quando admin modifica una entry, propaga il cambio a `auth.users` per
   utenti già registrati.

L'ordine `invita utente ↔ mappa ruolo` non importa più: in entrambi i casi
il ruolo arriva al primo login.

### `audit_chain_check` — log dei verify schedulati

```sql
id, ts, status (ok|broken|error), broken_id, expected_hash, actual_hash,
total_rows, duration_ms, triggered_by (cron|manual), error_message
```

Popolato weekly da `verify_audit_chain_scheduled()` via pg_cron (o GitHub
Actions su free tier). La view `audit_chain_status` mostra gli ultimi 10
record per la UI Diagnostica.

### `fe_search_log` — audit ricerche FE via LLM

```sql
id, ts, user_id, user_email,
query, sources_used (text[]), response (jsonb),
selected_idx, saved_fe_id, duration_ms, error_message
```

Loggato dalla Edge Function `search_fe`. La feature è **disabilitata in UI**
attualmente (risultati inaffidabili), ma il backend è pronto.

### `ai_assist_log` — audit chiamate AI generiche

```sql
id, ts, user_id, user_email,
task (es. 'explain_balance', 'chat_balance', …),
input (jsonb), output (jsonb), duration_ms, error_message
```

Loggato dalla Edge Function `ai_assist`.

## Vista materializzata `public_facts`

Aggrega per anno: totali per scope, breakdown per categoria S3, percentuali
per sito, copertura GO, intensità per m² e per kg.

**Importante**: la MV **non espone** `total_kg` né `total_m2` (i volumi
assoluti di produzione sono dati sensibili). Espone solo i due rapporti di
intensità.

Self-check post-DDL in `04_public_view.sql` verifica:
1. `site_pct` contiene percentuali 0..100 (non valori assoluti)
2. Le colonne `total_kg` e `total_m2` NON esistono
3. `intensity_per_kg` e `intensity_per_m2` SONO presenti

Refresh:
- **On-write**: trigger `refresh_public_facts()` su INSERT/UPDATE/DELETE di
  s1, s2, s3, produzione (`FOR EACH STATEMENT`, refresh CONCURRENTLY)
- **Schedulato**: settimanale (domenica 02:15 UTC) via `force_refresh_public_facts()`
  in `13_hardening.sql` come safety-net

## View pubbliche

- `public_facts` (MV) — `SELECT` granted ad `anon` e `authenticated`.
- `s3_materiality_public` (`SELECT cat_id, status FROM s3_materiality`) — `SELECT`
  granted ad `anon` e `authenticated`. Tiene fuori `justification`, `methodological_ref`
  e gli audit field.
- `audit_chain_status` — wrapper `LIMIT 10 ORDER BY ts DESC` per UI Diagnostica.
  Eredita le policy di `audit_chain_check` via `security_invoker=on`.

## Funzioni RPC

### Sistema / auth

| Funzione | Lang | Auth | Scopo |
|---|---|---|---|
| `current_role()` | SQL | anon+auth | legge `app_metadata.role` dal JWT, fallback `viewer` |
| `current_aal()` | SQL | auth | legge `aal` (`aal1`/`aal2`) dal JWT — UI MFA |
| `set_updated_at()` | plpgsql trigger | — | `new.updated_at = now()` + `updated_by = auth.uid()` |
| `apply_role_from_map()` | plpgsql trigger | — | applica `role_map` al login (security definer) |
| `propagate_role_map_change()` | plpgsql trigger | — | propaga cambi `role_map` a `auth.users` |

### Audit

| Funzione | Auth | Scopo |
|---|---|---|
| `audit_hash_chain()` | trigger | costruisce SHA-256 chain su INSERT in audit_log |
| `write_audit()` | trigger AFTER | scrive in audit_log su 8 tabelle |
| `verify_audit_chain()` | admin / auditor a aal2 | ricalcola chain, ritorna primo break |
| `verify_audit_chain_scheduled()` | postgres only (pg_cron) | versione no-role-check + log su audit_chain_check |
| `pseudonymize_audit_email(uuid)` | admin | hash-sostituzione email PII (GDPR) |
| `purge_audit_emails_for_disabled_users()` | postgres only | pseudonimizza utenti cessati/dormienti > 24 mesi |
| `count_failed_logins(window_minutes)` | admin/auditor | sentinella brute-force (legge `auth.audit_log_entries`) |

### Data ops

| Funzione | Auth | Scopo |
|---|---|---|
| `save_produzione(codice_sito, anno, kg, m2, note, orig_sito, orig_anno)` | admin/editor (year-lock-aware) | DELETE+UPSERT atomico per PK composita |
| `cascade_fe_update(fe_id, codice_voce, anno_validita)` | admin/editor | ricalcola S1+S3 referenziati transazionalmente |
| `is_year_locked(year)` | auth | true se l'anno è in `app_meta.locked_years` |
| `refresh_public_facts()` | trigger | refresh `public_facts` CONCURRENTLY con fallback |
| `force_refresh_public_facts()` | auth | safety-net per refresh esplicito (Diagnostica) |
| `purge_old_client_errors()` | postgres only (cron) | DELETE WHERE ts < now() - 90 days + `GET DIAGNOSTICS row_count` |

### Public RPC (chiamabili anche da anon)

| Funzione | Scopo |
|---|---|
| `get_public_dashboard(year)` | JSON di tutti i campi di `public_facts` per l'anno |
| `list_public_years()` | array desc di anni disponibili |
| `keepalive_ping()` | aggiorna `app_meta.last_keepalive`, ritorna `{ok:true, ts}` |

### Audit LLM

| Funzione | Auth | Scopo |
|---|---|---|
| `log_fe_search(query, sources_used, response, duration_ms, error)` | admin/editor (security definer) | INSERT in fe_search_log |
| `mark_fe_search_selected(log_id, selected_idx, saved_fe_id)` | admin/editor | UPDATE selected_idx + saved_fe_id |
| `log_ai_assist(task, input, output, duration_ms, error)` | admin/editor (security definer) | INSERT in ai_assist_log |

## Trigger di audit (hash chain SHA-256)

Ogni mutazione su 8 tabelle scrive una riga in `audit_log`:

```sql
-- Tabelle con trigger write_audit:
anagrafiche, produzione, fe, s1, s2, s3, s3_materiality, app_meta
```

Il trigger `audit_hash_chain` calcola **prima dell'INSERT in audit_log**:

```sql
new.prev_hash := (select row_hash from audit_log order by id desc limit 1);
new.row_hash  := encode(extensions.digest(
   coalesce(v_prev,'') ||
   new.ts::text ||
   new.table_name ||
   new.operation ||
   coalesce(new.new_data::text,'') ||
   coalesce(new.old_data::text,''),
   'sha256'
), 'hex');
```

Risultato: ogni riga è "linkata" alla precedente. Modifiche tampering al log
diventano evidenti perché la chain si rompe. Vedi [[Audit-Trail]] per detailed
flow + verify + pseudonimizzazione GDPR.

## RLS — Row Level Security

Tutte le tabelle dati hanno `ENABLE + FORCE ROW LEVEL SECURITY`. Lo `FORCE`
applica RLS anche al table owner (no bypass accidentale).

### Default policies (`03_roles.sql`)

```
SELECT       : tutti gli authenticated
INSERT       : admin + editor (year-lock-aware via 08)
UPDATE       : admin + editor (year-lock-aware via 08)
DELETE       : admin only
```

### Override per year lock (`08_year_lock.sql`)

```
INSERT/UPDATE su s1, s2, s3, produzione:
  admin OR (editor AND NOT is_year_locked(anno))
```

### Override per MFA enforcement (`14_mfa_editor.sql`, `15_mfa_auditor.sql`)

```
INSERT/UPDATE su s1, s2, s3, produzione, fe, anagrafiche, s3_materiality:
  admin OR (editor AND NOT is_year_locked AND aal=aal2)

SELECT su audit_log, audit_chain_check, fe_search_log, ai_assist_log:
  admin OR (auditor AND aal=aal2)
```

### Tabelle special

- `audit_log`: nessun INSERT/UPDATE/DELETE diretto (revocato). Solo il
  trigger `write_audit` (security definer) scrive.
- `app_meta`: SELECT a tutti gli authenticated; INSERT/UPDATE solo admin;
  DELETE revocato per tutti (le entry esistono per sempre).
- `client_errors`: INSERT da anon (con `user_id IS NULL`) o auth (con
  `user_id = auth.uid()`). SELECT solo admin. UPDATE/DELETE revocati.
- `role_map`: SELECT/INSERT/UPDATE/DELETE solo admin.

### Default deny per anon

```sql
revoke all on s1, s2, s3, fe, anagrafiche, produzione,
              s3_materiality, audit_log, ...
       from anon;
```

`anon` ha SELECT solo su `public_facts` e `s3_materiality_public`, INSERT
su `client_errors`, e EXECUTE su `get_public_dashboard`, `list_public_years`,
`keepalive_ping`.

## Hash chain audit — workflow completo

```
1. Editor modifica una riga S1 dalla console interna
2. PostgREST riceve UPDATE → RLS valuta:
   - current_role() in (admin, editor) ✓
   - NOT is_year_locked(anno) ✓
   - aal = 'aal2' ✓
   → UPDATE va a buon fine
3. AFTER UPDATE trigger write_audit() (security definer):
   - legge auth.uid(), email
   - INSERT in audit_log con table_name='s1', operation='UPDATE',
     old_data=to_jsonb(OLD), new_data=to_jsonb(NEW)
4. BEFORE INSERT su audit_log trigger audit_hash_chain():
   - legge l'ultimo row_hash della tabella → diventa prev_hash della
     nuova riga
   - calcola row_hash = sha256(prev_hash || ts || table || op ||
     new_data || old_data)
5. AFTER UPDATE trigger su s1: refresh_public_facts() (CONCURRENTLY)
```

Cron weekly:
```
1. pg_cron (o GitHub Actions su free tier) chiama
   verify_audit_chain_scheduled() ogni lunedì 03:30 UTC
2. Ricalcola tutta la chain, scrive in audit_chain_check
3. UI Diagnostica mostra status (ok/broken/error) + dettagli rottura
```

## Estensione `pgcrypto`

Vive nello schema `extensions` (best practice + default Supabase). Le
function `SECURITY DEFINER` qualificano esplicitamente `extensions.digest(...)`
perché il `search_path` è ristretto a `public`.

Lo script `01_schema.sql` gestisce 3 scenari:
1. Estensione non installata → crea in `extensions`
2. Installata in `public` (vecchia versione) → la sposta
3. Già in `extensions` → no-op

## Risorse

- [[Migrazioni-SQL]] — dettaglio dei 14 file `.sql`
- [[Sicurezza]] — RLS, MFA, hash chain, pseudonimizzazione
- [[Audit-Trail]] — verify chain, export firmato HMAC
