# Configurazione

Tutte le env vars e i secrets necessari per il tool, raggruppati per
contesto.

## Build-time (`build.mjs`)

Lette da `process.env`. Se non impostate, `build.mjs` usa default (o
emette warning se mancano i mandatory).

### Obbligatorie

| Variabile | Tipo | Note |
|---|---|---|
| `SUPABASE_URL` | URL | URL del progetto Supabase (`https://xxx.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | string | anon key Supabase (formato `sb_publishable_...`). Legacy fallback: `SUPABASE_ANON_KEY` |

### Opzionali

| Variabile | Default | Note |
|---|---|---|
| `TURNSTILE_SITE_KEY` | (vuoto) | Site key Cloudflare Turnstile per captcha login. Se vuoto, skip Turnstile |
| `COMPANY_LEGAL_NAME` | `'Gruppo Ceramiche Gresmalt S.p.A.'` | usata in JSON-LD + footer + PPTX |
| `COMPANY_VAT` | `'IT00000000000'` | usata in JSON-LD |
| `SUSTAINABILITY_EMAIL` | `'sustainability@gresmalt.it'` | CTA "Scrivi all'Innovability Unit" + JSON-LD |
| `PUBLIC_DASHBOARD_URL` | `'https://sustainability.gresmalt.it'` | `<link rel=canonical>` + OG url |
| `SCHEMA_VERSION` | `'1'` | versione schema, usata in metadata.json del backup |
| `LOGO_PATH` | (auto-detect `assets/logo.{svg,png,jpg,jpeg}`) | override esplicito |
| `LOGO_MARK_PATH` | (auto-detect `assets/Logo-ridotto.{svg,png,jpg,jpeg}`) | override esplicito |

### Backward-compat: `SUPABASE_ANON_KEY`

Supabase ha rinominato `SUPABASE_ANON_KEY` → `SUPABASE_PUBLISHABLE_KEY`
(formato `sb_publishable_...`). `build.mjs` accetta entrambi:

```js
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
                  || process.env.SUPABASE_ANON_KEY
                  || '';
if (!process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_ANON_KEY) {
  console.warn('⚠ Stai usando SUPABASE_ANON_KEY (deprecata). Rinominala in SUPABASE_PUBLISHABLE_KEY.');
}
```

## GitHub Actions secrets

Settings → Secrets and variables → Actions → "Repository secrets":

| Secret | Workflow | Note |
|---|---|---|
| `SUPABASE_URL` | build, deploy, keepalive | required |
| `SUPABASE_PUBLISHABLE_KEY` | build, deploy, keepalive | required (legacy `SUPABASE_ANON_KEY` accettato) |
| `TURNSTILE_SITE_KEY` | build, deploy | optional |
| `SUPABASE_DB_URL` | backup | URI Postgres con password — formato `postgres://user:pwd@host:5432/db` |
| `BACKUP_PASSPHRASE` | backup | passphrase GPG AES256. Genera con `openssl rand -base64 32` |
| `AWS_S3_BACKUP_BUCKET` | backup | bucket S3 per replica off-GitHub (opzionale) |
| `AWS_ACCESS_KEY_ID` | backup | credenziali AWS (opzionale) |
| `AWS_SECRET_ACCESS_KEY` | backup | credenziali AWS (opzionale) |
| `AWS_DEFAULT_REGION` | backup | default `eu-central-1` |

## GitHub Actions vars

Settings → Secrets and variables → Actions → "Repository variables"
(NON secret, visibili in clear):

| Variable | Default fallback in workflow |
|---|---|
| `COMPANY_LEGAL_NAME` | `'Gruppo Ceramiche Gresmalt S.p.A.'` |
| `COMPANY_VAT` | `'IT00000000000'` |
| `SUSTAINABILITY_EMAIL` | `'sustainability@gresmalt.it'` |
| `PUBLIC_DASHBOARD_URL` | `''` |
| `SCHEMA_VERSION` | `'1'` |

## Supabase secrets (Edge Functions)

```bash
# Pre-requisito: Supabase CLI installato + linkato al progetto
supabase link --project-ref jtextnqspxpdtaaiqrya
```

### Universali (per tutte le Edge Function)

| Secret | Note |
|---|---|
| `SUPABASE_URL` | auto-iniettato da Supabase (ma controlla con `supabase secrets list`) |
| `SUPABASE_PUBLISHABLE_KEY` | auto-iniettato (o legacy `SUPABASE_ANON_KEY`) |
| `ALLOWED_ORIGINS` | CSV delle origin consentite (CORS). Es. `https://sustainability.gresmalt.it,https://gresmalt.github.io` |

### Per `sign_snapshot` / `verify_snapshot`

| Secret | Note |
|---|---|
| `SNAPSHOT_HMAC_KEY` | Hex stringa ≥ 32 bytes. Genera con `openssl rand -hex 32`. **Non condividere mai**. |

```bash
supabase secrets set SNAPSHOT_HMAC_KEY=$(openssl rand -hex 32)
```

### Per `ai_assist` / `search_fe`

| Secret | Note |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key. Crea su https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | (opt) modello per `search_fe`. Default: `gemini-2.5-flash-lite` |
| `GEMINI_MODEL_PLAIN` | (opt) modello per `ai_assist`. Default: `gemini-3.1-flash-lite` |

```bash
supabase secrets set GEMINI_API_KEY=AIzaSy...
supabase secrets set GEMINI_MODEL=gemini-2.5-flash-lite
supabase secrets set GEMINI_MODEL_PLAIN=gemini-3.1-flash-lite
```

> **Quote Gemini free tier** (snapshot dashboard utente):
> * `gemini-2.5-flash`: 20 RPD model + 1.5K/giorno grounding pool 2.5
> * `gemini-2.5-flash-lite`: 20 RPD + grounding 2.5 condivisa
> * `gemini-3.x-*`: model RPD ok ma **grounding pool 0/0** (non free) →
>   `search_fe` su Gemini 3 fallisce su free tier
> * Per uso intensivo: piano Pay-as-you-go su https://aistudio.google.com

## Setup completo step-by-step

### 1. Crea progetto Supabase

```bash
# Via dashboard https://supabase.com/dashboard
# Region: eu-central-1 (per Gresmalt) o quello più vicino
# Nome: gresmalt-ghg-tool
```

### 2. Applica le migration SQL

```bash
# Opzione A: CLI
supabase link --project-ref <ref>
supabase db push

# Opzione B: SQL Editor manuale
# Vai a SQL Editor in dashboard, copy/paste ogni file 01_, 02_, …, 18_
# in ordine, eseguendo uno per volta.
```

### 3. Configura segreti Edge Functions

```bash
supabase secrets set ALLOWED_ORIGINS=https://sustainability.gresmalt.it,http://localhost:8000
supabase secrets set SNAPSHOT_HMAC_KEY=$(openssl rand -hex 32)
supabase secrets set GEMINI_API_KEY=AIzaSy...
```

### 4. Deploy Edge Functions

```bash
supabase functions deploy sign_snapshot      --no-verify-jwt
supabase functions deploy verify_snapshot    --no-verify-jwt
supabase functions deploy verify_audit_chain --no-verify-jwt
supabase functions deploy ai_assist          --no-verify-jwt
supabase functions deploy search_fe          --no-verify-jwt
```

> `--no-verify-jwt` significa che il gate auth è gestito **manualmente** dal
> codice Deno (legge `Authorization: Bearer <jwt>`, valida via `sb.auth.getUser()`,
> fa role check). Più flessibile dell'auto-verify.

### 5. Configura GitHub Pages

* Settings → Pages → Source = "GitHub Actions"
* (Opzionale) Custom domain: `sustainability.gresmalt.it` + CNAME
* HTTPS automatico via Let's Encrypt

### 6. Configura GitHub Actions secrets

Settings → Secrets and variables → Actions → New secret:

```
SUPABASE_URL                 = https://xxx.supabase.co
SUPABASE_PUBLISHABLE_KEY     = sb_publishable_...
TURNSTILE_SITE_KEY           = 0xAAAA... (opzionale)
SUPABASE_DB_URL              = postgres://... (per backup)
BACKUP_PASSPHRASE            = <random base64> (per backup)
```

### 7. (Opzionale) Cloudflare Turnstile

Solo se vuoi captcha login (anti-bot).

* Crea sito su https://dash.cloudflare.com/?to=/:account/turnstile
* Tipo: "Managed challenge"
* Aggiungi domini consentiti
* Copia "Site Key" → `TURNSTILE_SITE_KEY` GitHub secret
* (Secret Key non serve a build-time, è usata server-side da Supabase Auth
  se attivi captcha nei settings Supabase)

### 8. (Opzionale) Custom DNS

* Aggiungi record CNAME nel DNS che punti a `<user>.github.io`
* Crea `assets/CNAME` con `sustainability.gresmalt.it` (un file vuoto con
  solo il dominio)
* Settings → Pages → Custom domain
* Aspetta certificato Let's Encrypt (può richiedere 1-24h al primo setup)

### 9. (Opzionale) Cloudflare proxy

Se vuoi header HTTP custom (X-Frame-Options, HSTS, ecc.):

* Cloudflare CNAME proxied (cloud arancio attivo)
* SSL/TLS encryption mode: "Full (strict)"
* Page Rules: cache `*.html` per 0 secondi; `/build.txt` no-cache

Cloudflare leggerà automaticamente `site/_headers` (formato Pages-compatibile).

### 10. Crea il primo admin

```sql
-- SQL Editor
INSERT INTO public.role_map (email, role)
VALUES ('admin@gresmalt.it', 'admin');
```

Poi invita l'utente via Authentication → Users.

Al primo login, il trigger applica `app_metadata.role = 'admin'`. Admin
non è forzato a MFA TOTP (override d'emergenza).

### 11. Primo build manuale (verifica)

```bash
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
node build.mjs
ls -la site/
# site/index.html ~1.1 MB
```

Apri `site/index.html` in browser → Public Dashboard si carica con dati seed?

### 12. Push su main → deploy automatico

```bash
git commit -am "feat: initial deploy"
git push origin main
# → workflow deploy.yml → live su https://<user>.github.io/<repo>/
```

## Verifica configurazione

### Dashboard interna

Una volta loggato come admin, vai a **Diagnostica**:

* **anonProbe**: verifica RLS leak (deve essere `ok: true, leaked: []`)
* **Audit chain**: verifica hash chain (deve essere `🟢 OK`)
* **Keep-alive ping**: forza un ping manuale
* **Year sign-off lock**: vedi anni bloccati

### Health check

```bash
# Pubblico (anon)
curl -sS "https://<project>.supabase.co/rest/v1/rpc/keepalive_ping" \
  -H "apikey: <SUPABASE_PUBLISHABLE_KEY>" \
  -H "Authorization: Bearer <SUPABASE_PUBLISHABLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'
# → {"ok":true,"ts":"2025-..."}

# Public dashboard data
curl -sS "https://<project>.supabase.co/rest/v1/rpc/get_public_dashboard?p_year=2025" \
  -H "apikey: <SUPABASE_PUBLISHABLE_KEY>" \
  -H "Authorization: Bearer <SUPABASE_PUBLISHABLE_KEY>" \
  -H "Content-Type: application/json"
# → { "anno": 2025, "em_tco2e_total": ..., ... }
```

### Workflow GitHub Actions

* Actions → workflow runs → verifica che `build.yml` passi (lint + secret
  scan + npm audit + test + e2e)
* `deploy.yml` deve fare deploy su push to main
* `keepalive.yml` esegue ogni 3 giorni (manual trigger una volta per
  verificare)
* `backup.yml` esegue lunedì 04:00 UTC (manual trigger una volta)

## Generazione segreti random

### `SNAPSHOT_HMAC_KEY`

```bash
openssl rand -hex 32
# es. 8f3a7b4c1e9d6f2a5c8b3e7d1f4a9c6b8e2d5f7a1c4b6e9d2f5a8c1b4e7d2f
```

Hex perché è quello che si attende `crypto.subtle.importKey(...,'raw')` in
Deno (tramite TextEncoder).

### `BACKUP_PASSPHRASE`

```bash
openssl rand -base64 32
# es. 9aB2cD4eF6gH8iJ0kL1mN3oP5qR7sT9uV1xZ3aB5cD7eF=
```

Conserva in password manager. **Mai** condividere via email/Slack.

### Re-generation dei segreti

Se sospetti compromission:

1. Genera nuovo `SNAPSHOT_HMAC_KEY` → `supabase secrets set ...`
   * **Conseguenza**: snapshot firmati prima del cambio NON sono più
     verificabili. Conserva la vecchia chiave se serve audit retroattivo.
2. Genera nuovo `BACKUP_PASSPHRASE` → GitHub secret update
   * **Conseguenza**: backup precedenti restano cifrati con la vecchia
     passphrase. Conserva la vecchia.
3. Reset `GEMINI_API_KEY` → revoca su https://aistudio.google.com → genera
   nuova → `supabase secrets set GEMINI_API_KEY=...`
4. Reset `SUPABASE_PUBLISHABLE_KEY` → roll della anon key da Supabase
   Studio → aggiorna GitHub secrets → rebuild + redeploy

## Troubleshooting configurazione

### "SUPABASE_URL or KEY missing"

Verifica i secrets:
```bash
# In GitHub Actions log:
echo "URL set: ${SUPABASE_URL:+YES}"
echo "KEY set: ${SUPABASE_PUBLISHABLE_KEY:+YES}"
```

### Edge Function "Forbidden · origin not allowed"

Aggiungi l'origin a `ALLOWED_ORIGINS`:

```bash
supabase secrets set ALLOWED_ORIGINS="https://sustainability.gresmalt.it,https://<user>.github.io,http://localhost:8000"
```

Le origin devono essere **esatte** (https://, niente trailing slash).

### Gemini "Quota esaurita: richieste/giorno (RPD)"

* Su tier free: max 20 RPD per modello + 1.5K/giorno grounding pool 2.5
* Per uso intensivo: pianifica un piano Pay-as-you-go su Google AI Studio
* Alternativa: cambia il modello con `GEMINI_MODEL=gemini-3.1-flash-lite`
  (500 RPD ma niente grounding)

### `keepalive_ping` ritorna 401

* La RPC è chiamabile da `anon` (grant explicit in `05_app_meta.sql`)
* Verifica che la `SUPABASE_PUBLISHABLE_KEY` non sia scaduta o ruotata
* Verifica che la `SECURITY DEFINER` sia corretta (`grant execute … to anon`)

## Risorse

- [[Build-e-Deploy]] — pipeline + env usage
- [[GitHub-Actions]] — workflow + secrets
- [[Edge-Functions]] — secrets specifici per ogni function
- [[Sicurezza]] — generazione random + rotation
