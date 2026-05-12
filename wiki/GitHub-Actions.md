# GitHub Actions

4 workflow attivi + Dependabot. Tutti in `.github/`.

```
.github/
├── workflows/
│   ├── build.yml      ← CI: lint + secret scan + npm audit + test + build + e2e
│   ├── deploy.yml     ← CD: build + upload + deploy GitHub Pages
│   ├── keepalive.yml  ← Cron: keepalive_ping ogni 3 giorni
│   └── backup.yml     ← Cron: pg_dump + GPG AES256 weekly
└── dependabot.yml     ← PR weekly per bump npm + GitHub Actions
```

## `build.yml` — CI

**Trigger**:
- Push su `main` o branch `claude/**`
- PR su `main`
- Manual via `workflow_dispatch`
- Paths: `src/**`, `test/**`, `sql/**`, `package.json`, `build.mjs`

**Job `build`** (timeout 10 min):

```yaml
- uses: actions/checkout@v6
- uses: actions/setup-node@v6
  with: { node-version: '20' }

- name: Install
  run: |
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

- name: Lint sources for dangerouslySetInnerHTML
  run: npm run lint:no-dangerous-html

- name: ESLint
  run: npm run lint

- name: Secret scan (sources)
  run: |
    grep -rEn --include='*.js' --include='*.jsx' --include='*.ts' --include='*.mjs' \
        -e 'eyJhbGciOiJIUzI1NiIs[A-Za-z0-9._-]{40,}' \
        -e 'service_role[^a-zA-Z0-9_].{0,80}eyJ'    \
        -e 'SUPABASE_DB_URL[ =:][^<].{0,8}postgres://' \
        -e 'SNAPSHOT_HMAC_KEY[ =:][a-fA-F0-9]{32,}' \
        src/ supabase/ test/ build.mjs

- name: npm audit (alta + critica)
  run: npm audit --audit-level=high --omit=dev

- name: Unit tests
  run: npm test
  # 67/67 test: calc, io.enrichForUpsert, zip, redactPII

- name: Build
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY || secrets.SUPABASE_ANON_KEY }}
    TURNSTILE_SITE_KEY: ${{ secrets.TURNSTILE_SITE_KEY }}
    SCHEMA_VERSION: '1'
    COMPANY_LEGAL_NAME: 'Gruppo Ceramiche Gresmalt S.p.A.'
    ...
  run: node build.mjs

- name: Upload site
  uses: actions/upload-artifact@v7
  with:
    name: site
    path: site/
    retention-days: 7
```

**Job `e2e`** (timeout 10 min, depends on `build`):

```yaml
- uses: actions/checkout@v6
- uses: actions/setup-node@v6

- name: Install npm deps
  run: |
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

- name: Cache Playwright browsers
  id: playwright-cache
  uses: actions/cache@v5
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

- name: Install Playwright browser (chromium only)
  if: steps.playwright-cache.outputs.cache-hit != 'true'
  run: npx playwright install --with-deps chromium

- name: Build site (stub env)
  env:
    SUPABASE_URL: 'https://stub.supabase.co'
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_stub_for_e2e'
  run: node build.mjs

- name: Run smoke tests
  run: npm run test:e2e

- name: Upload Playwright report on failure
  if: failure()
  uses: actions/upload-artifact@v7
  with:
    name: playwright-report
    path: |
      test-results/
      playwright-report/
    retention-days: 7
```

Job separato perché:
1. Richiede chromium binary (~150 MB)
2. Più lento di unit test (~30-60s in più)
3. Se fallisce non blocca il build, ma flagga il problema

Cattura bug runtime tipo `ReferenceError` mascherati da split di file
(vedi commit history per i bug storici PR #31, #32, #34).

## `deploy.yml` — CD GitHub Pages

**Trigger**:
- Push su `main`
- Manual via `workflow_dispatch`

**Permissions**: `contents: read`, `pages: write`, `id-token: write`.

**Concurrency**: `group: pages, cancel-in-progress: false` (una sola
esecuzione di deploy alla volta; nuovi push **non** cancellano quello in
corso).

**Job `build`**:

```yaml
- uses: actions/checkout@v6
- uses: actions/setup-node@v6
  with: { node-version: '20', cache: 'npm' }

- name: Install deps
  run: npm ci

- name: Build site
  env:
    SUPABASE_URL:             ${{ secrets.SUPABASE_URL }}
    SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY || secrets.SUPABASE_ANON_KEY }}
    TURNSTILE_SITE_KEY:       ${{ secrets.TURNSTILE_SITE_KEY }}
    COMPANY_LEGAL_NAME:       ${{ vars.COMPANY_LEGAL_NAME   || 'Gruppo Ceramiche Gresmalt S.p.A.' }}
    COMPANY_VAT:              ${{ vars.COMPANY_VAT          || 'IT00000000000' }}
    SUSTAINABILITY_EMAIL:     ${{ vars.SUSTAINABILITY_EMAIL || 'sostenibilita@gresmalt.it' }}
    PUBLIC_DASHBOARD_URL:     ${{ vars.PUBLIC_DASHBOARD_URL || '' }}
    SCHEMA_VERSION:           ${{ vars.SCHEMA_VERSION       || '1' }}
  run: |
    if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_PUBLISHABLE_KEY" ]; then
      echo "::error::Mancano i secrets SUPABASE_URL e/o SUPABASE_PUBLISHABLE_KEY"
      exit 1
    fi
    node build.mjs

- uses: actions/configure-pages@v6
- uses: actions/upload-pages-artifact@v5
  with: { path: site }
```

**Job `deploy`** (`needs: build`):

```yaml
environment:
  name: github-pages
  url: ${{ steps.deployment.outputs.page_url }}
steps:
  - uses: actions/deploy-pages@v5
    id: deployment
```

## `keepalive.yml` — Cron heartbeat

**Scopo**: evitare che Supabase Free Tier metta in pausa il progetto dopo
**7 giorni** di inattività.

**Trigger**:
- `cron: '0 12 */3 * *'` — ogni 3 giorni alle 12:00 UTC.
- Manual `workflow_dispatch`.

> Nota: `*/3` su day-of-month dà i giorni 1, 4, 7, ..., 31 → max gap ~3
> giorni. GitHub disabilita gli schedule dopo **60 giorni** di inattività
> del repo — qualunque commit sul default branch li riattiva.

**Job `ping`** (timeout 2 min):

```bash
response=$(curl -sS -X POST \
  --max-time 30 \
  --retry 3 --retry-delay 5 --retry-connrefused \
  -w "\nHTTP_STATUS=%{http_code}" \
  "${SUPABASE_URL}/rest/v1/rpc/keepalive_ping" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}')

status=$(echo "$response" | sed -n 's/^HTTP_STATUS=\([0-9]*\)$/\1/p')
body=$(echo "$response" | sed '$d')

# Verifica HTTP 200
if [ "$status" != "200" ]; then
  echo "::error::HTTP $status (atteso 200). Body: $body"
  exit 1
fi

# Verifica {"ok": true}
if ! echo "$body" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "::error::Risposta non contiene \"ok\": true"
  exit 1
fi
```

* `--max-time 30`: timeout duro per non appendere il job
* `--retry 3` con backoff: resiste a flap di rete temporanei
* Regex tollera spazi opzionali tra chiave e valore (PostgREST ritorna
  `{"ok": true, ...}` con spazio)

L'RPC `keepalive_ping()` aggiorna `app_meta.last_keepalive = {ts: now()}`
e ritorna `{ok: true, ts}`.

## `backup.yml` — Cron weekly DB dump

**Trigger**:
- `cron: '0 4 * * 1'` — lunedì 04:00 UTC
- Manual `workflow_dispatch`

**Job `dump`** (timeout 30 min):

```yaml
- name: Install pg_dump
  run: |
    sudo apt-get update -qq
    sudo apt-get install -qq -y postgresql-client gnupg

- name: Dump
  env:
    DATABASE_URL: ${{ secrets.SUPABASE_DB_URL }}
  run: |
    stamp=$(date -u +%Y%m%d_%H%M)
    out="ghg_dump_${stamp}.sql"
    pg_dump --no-owner --no-privileges --clean "$DATABASE_URL" > "$out"
    gzip -9 "$out"
    echo "ARCHIVE=${out}.gz" >> $GITHUB_ENV

- name: Encrypt artifact (AES-256)
  env:
    BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
  run: |
    if [ -z "$BACKUP_PASSPHRASE" ]; then
      echo "::error::BACKUP_PASSPHRASE secret missing"
      exit 1
    fi
    gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase "$BACKUP_PASSPHRASE" "$ARCHIVE"
    rm -f "$ARCHIVE"  # rimuovi il .gz non-criptato

- uses: actions/upload-artifact@v7
  with:
    name: ghg-dump-${{ github.run_number }}
    path: '*.gpg'
    retention-days: 30
```

`pg_dump` opzioni:
- `--no-owner`: il dump può essere ripristinato in un'altra istanza senza
  errori di proprietà
- `--no-privileges`: niente GRANT (verranno ri-applicati da `03_roles.sql`
  + altri SQL)
- `--clean`: include `DROP <object>` prima delle `CREATE` (sicuro per
  ripristino fresco)

**Replica S3 opzionale**:

```yaml
- name: Replicate to S3 (off-GitHub)
  env:
    AWS_S3_BACKUP_BUCKET: ${{ secrets.AWS_S3_BACKUP_BUCKET }}
    AWS_ACCESS_KEY_ID:    ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_DEFAULT_REGION:    ${{ secrets.AWS_DEFAULT_REGION || 'eu-central-1' }}
  if: ${{ env.AWS_S3_BACKUP_BUCKET != '' }}
  run: |
    for f in *.gpg; do
      aws s3 cp "$f" "s3://${AWS_S3_BACKUP_BUCKET}/$(date -u +%Y/%m)/$f" \
        --sse AES256 --acl bucket-owner-full-control
    done
```

Se i secrets AWS non sono presenti, step skipped (no-op).

### Ripristino backup

```bash
# Scarica artifact via UI GitHub o gh CLI
gh run download <run-id> -n ghg-dump-<n>

# Decifra
gpg --batch --decrypt -o ghg_dump.sql.gz \
    --passphrase "$BACKUP_PASSPHRASE" \
    ghg_dump_YYYYMMDD_HHMM.sql.gz.gpg
gunzip ghg_dump.sql.gz

# Ripristina in nuovo DB (es. staging Supabase)
psql "$NEW_DATABASE_URL" < ghg_dump.sql

# Riapplica le RLS policy + RPC (se non incluse nel dump)
psql "$NEW_DATABASE_URL" -f sql/03_roles.sql
psql "$NEW_DATABASE_URL" -f sql/08_year_lock.sql
psql "$NEW_DATABASE_URL" -f sql/13_hardening.sql
# ...
```

## `dependabot.yml` — bump weekly

**Trigger**: lunedì 06:00 Europe/Rome.

**Policy raggruppamento** — solo `minor` + `patch`:

```yaml
groups:
  runtime:
    patterns: ['react', 'react-dom', 'chart.js', '@supabase/supabase-js']
    update-types: ['minor', 'patch']
  sri-libs:
    patterns: ['@e965/xlsx', 'pptxgenjs']
    update-types: ['minor', 'patch']
  babel:
    patterns: ['@babel/*']
    update-types: ['minor', 'patch']
```

I bump `major` finiscono in **PR singole**, dove il review umano può:
* leggere release notes / migration guide del nuovo major
* verificare API compatibility del codice
* preparare PR di adeguamento prima del merge

**Lesson learned PR #9 (2026-05-05)**:
* Una PR "runtime group" raggruppava più bump in un singolo merge
* Dentro c'era un MAJOR bump React 18→19 mascherato come "minor"
* Il merge ha rotto la Public Dashboard senza warning
* Hotfix #20 + #21 hanno richiesto rollback completo

→ Da allora policy: i major bump dei pacchetti runtime non vengono mai
raggruppati.

**`ignore`** esplicito:

```yaml
ignore:
  - dependency-name: 'react'
    update-types: ['version-update:semver-major']
  - dependency-name: 'react-dom'
    update-types: ['version-update:semver-major']
```

Major su React/ReactDOM bloccato finché audit dedicato (createRoot già OK
ma il bundle contiene alcuni pattern legacy da verificare).

**GitHub Actions ecosystem**:

```yaml
- package-ecosystem: 'github-actions'
  directory: '/'
  schedule:
    interval: 'weekly'
    day: 'monday'
    time: '06:00'
    timezone: 'Europe/Rome'
  commit-message:
    prefix: 'ci'
```

Bump degli step `actions/checkout@vN`, `actions/setup-node@vN`, ecc.

## Secrets richiesti

| Secret | Usato in | Note |
|---|---|---|
| `SUPABASE_URL` | build, deploy, keepalive | URL del progetto Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | build, deploy, keepalive | anon key Supabase (formato `sb_publishable_...`) |
| `SUPABASE_ANON_KEY` | (legacy) | accettato come fallback se `SUPABASE_PUBLISHABLE_KEY` non esiste |
| `TURNSTILE_SITE_KEY` | build, deploy | opzionale (vuoto = skip captcha) |
| `SUPABASE_DB_URL` | backup | URI Postgres per `pg_dump` (con password!) |
| `BACKUP_PASSPHRASE` | backup | passphrase GPG AES256, ≥ 32 byte entropia |
| `AWS_S3_BACKUP_BUCKET` | backup (opt) | bucket S3 per replica off-GitHub |
| `AWS_ACCESS_KEY_ID` | backup (opt) | credenziali AWS |
| `AWS_SECRET_ACCESS_KEY` | backup (opt) | credenziali AWS |
| `AWS_DEFAULT_REGION` | backup (opt) | default `eu-central-1` |

## Vars (non secret) — Settings → Actions → Variables

| Variable | Default fallback in workflow |
|---|---|
| `COMPANY_LEGAL_NAME` | `'Gruppo Ceramiche Gresmalt S.p.A.'` |
| `COMPANY_VAT` | `'IT00000000000'` |
| `SUSTAINABILITY_EMAIL` | `'sostenibilita@gresmalt.it'` (deploy) o `'sustainability@gresmalt.it'` (build) |
| `PUBLIC_DASHBOARD_URL` | `''` |
| `SCHEMA_VERSION` | `'1'` |

## Risorse

- [[Build-e-Deploy]] — env vars + build pipeline
- [[Sicurezza]] — secret scan, npm audit, backup criptato
- [[Configurazione]] — lista completa secrets Supabase
