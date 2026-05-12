# Gresmalt GHG Tool — Wiki

Piattaforma di **sustainability** per il Gruppo Ceramiche Gresmalt: inventario delle
emissioni di gas serra Scope 1 + 2 + 3 secondo lo standard **GHG Protocol
Corporate**, con dashboard pubblica per trasparenza verso i clienti e console
interna per operatori.

* **Hosting frontend**: GitHub Pages (single-file `site/index.html`, ~1.1 MB autocontenuto)
* **Backend**: Supabase (Postgres 17 + Auth + Edge Functions)
* **Stack**: React 18 (UMD), Chart.js 4, SheetJS + pptxgenjs (lazy via CDN+SRI)
* **Build**: `node build.mjs` — pre-compila con Babel, inlina UMD da `node_modules`, inietta SRI hash, sostituisce placeholder, applica CSP, genera anti-stale-cache

## Indice

### Architettura e modello
- [[Architettura]] — stack tecnico, IIFE pattern, build pipeline, namespace globali
- [[Modello-dati]] — 14 tabelle, viste materializzate, 25+ funzioni RPC, RLS, hash chain audit
- [[Sorgenti-File-per-File]] — guida riga per riga dei 28 file in `src/`

### Frontend
- [[Public-Dashboard]] — Faccia A (anonima), contenuti, i18n IT/EN
- [[Console-Interna]] — Faccia B (login), 11 sezioni operatore
- [[Gestione-Dati]] — 7 tab CRUD: anagrafiche, S1, S2, S3, FE, produzione, target
- [[Audit-Trail]] — log con hash chain SHA-256, verifica integrità, export firmato

### Backend
- [[Edge-Functions]] — sign_snapshot, verify_snapshot, verify_audit_chain, ai_assist, search_fe
- [[Sicurezza]] — CSP, SRI, MFA TOTP, PII redaction, HMAC snapshot, backup criptato
- [[Migrazioni-SQL]] — 18 file SQL numerati, idempotenti

### Operazioni
- [[Build-e-Deploy]] — `npm run build`, env vars, GitHub Pages
- [[GitHub-Actions]] — deploy, build, keepalive, backup weekly
- [[Test]] — 67 unit test + Playwright e2e
- [[Operazioni-Comuni]] — playbook per task ricorrenti (nuovo anno, sign-off, …)
- [[Configurazione]] — env vars + Supabase secrets + GitHub secrets

### Riferimenti
- [[Glossario]] — tCO₂e, GHG Protocol, GO, LB/MB, AAL, …
- [[FAQ-e-Troubleshooting]] — errori comuni e soluzioni
- [[Piano-di-Decarbonizzazione]] — target 2034 / vision 2050 / leve

## Routing client-side (hash-based)

| URL | Destinazione | Componente |
|---|---|---|
| `https://<host>/` | Faccia A — Public Dashboard (anonima) | `G.PublicDashboard` |
| `https://<host>/#app` | Faccia B — Console interna (login) | `G.AuthGate` → `G.App` |

`AuthGate.jsx` legge `location.hash` e renderizza l'una o l'altra.

## Quick start

```bash
# 1. Clone
git clone https://github.com/Mavacchi/Gresmalt-ghg-tool.git
cd Gresmalt-ghg-tool
npm install

# 2. Configura env (vedi [[Configurazione]])
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# 3. Build
npm run build           # produce site/index.html

# 4. Dev server
npm run dev             # http://localhost:8000

# 5. Test
npm test                # 67 unit test
npm run test:e2e        # Playwright smoke test
```

## Diagramma logico

```
                ┌──────────────────────────────────┐
                │     GitHub Pages (statico)        │
                │     site/index.html (~1.1 MB)     │
                │  ┌────────────────────────────┐   │
                │  │ React + ReactDOM (inline)  │   │
                │  │ Chart.js (inline)          │   │
                │  │ Supabase JS (inline)       │   │
                │  │ src/* compilato (inline)   │   │
                │  └────────────────────────────┘   │
                │  ┌────────────────────────────┐   │
                │  │ SheetJS (lazy CDN + SRI)   │   │
                │  │ pptxgenjs (lazy CDN + SRI) │   │
                │  └────────────────────────────┘   │
                └──────────────┬───────────────────┘
                               │
                               ▼ HTTPS + JWT
                ┌──────────────────────────────────┐
                │          Supabase                │
                │  ┌────────────────────────────┐  │
                │  │ Postgres 17 + RLS          │  │
                │  │   14 tabelle               │  │
                │  │   1 MV public_facts        │  │
                │  │   25+ funzioni RPC         │  │
                │  │   Hash chain audit_log     │  │
                │  └────────────────────────────┘  │
                │  ┌────────────────────────────┐  │
                │  │ Auth (email + TOTP MFA)    │  │
                │  └────────────────────────────┘  │
                │  ┌────────────────────────────┐  │
                │  │ Edge Functions (5)         │  │
                │  │  sign_snapshot HMAC        │  │
                │  │  verify_snapshot           │  │
                │  │  verify_audit_chain        │  │
                │  │  ai_assist (Gemini)        │  │
                │  │  search_fe (Gemini ground.)│  │
                │  └────────────────────────────┘  │
                └──────────────┬───────────────────┘
                               │
                               ▼ schedule (cron)
                ┌──────────────────────────────────┐
                │       GitHub Actions             │
                │  ┌────────────────────────────┐  │
                │  │ keepalive.yml  every 3d    │  │
                │  │ backup.yml  weekly         │  │
                │  │ deploy.yml  on push main   │  │
                │  │ build.yml   on push/PR     │  │
                │  └────────────────────────────┘  │
                └──────────────────────────────────┘
```

## Hosting & ambiente

| Componente | Provider | Tier | Note |
|---|---|---|---|
| Static site | GitHub Pages | Free | servito dal repo `main` branch, autocontenuto |
| Database | Supabase (eu-central-1) | dipende | progetto `gresmalt-ghg-tool` |
| Auth | Supabase Auth | dipende | TOTP MFA + Cloudflare Turnstile opzionale |
| Edge Functions | Supabase Functions (Deno) | dipende | 5 funzioni serverless |
| CDN librerie lazy | jsdelivr.net | free | `@e965/xlsx` + `pptxgenjs` con SRI |
| LLM | Google Gemini API | free/paid | `gemini-2.5-flash-lite` (grounding) + `gemini-3.1-flash-lite` |
| Captcha | Cloudflare Turnstile | free | opzionale, gated dietro env var |
| Backup | GitHub Actions artifacts + S3 (opzionale) | — | criptato GPG AES256, retention 30 gg |

## Standard di riferimento

* **GHG Protocol Corporate Standard** + **Scope 3 Standard**
* **GRI** (Global Reporting Initiative) standards
* **SBTi** (Science Based Targets initiative) — allineamento target 1.5 °C
* **European Climate Law**
* **CSRD** (Corporate Sustainability Reporting Directive) — perimetro reporting
* **PCAF v2.0** — categoria S3 cat.15 (investimenti finanziari)
* **ISPRA / Min. Ambiente / Terna / AIB** — fattori di emissione nazionali
* **DEFRA / EPA / IPCC** — fattori di emissione internazionali

## Contatti & team

* **Innovability Unit**: `sustainability@gresmalt.it`
* **Sito corporate**: https://www.gresmalt.it/
* **Piano di Decarbonizzazione 2024**: PDF pubblico [link Gresmalt.it](https://www.gresmalt.it/wp-content/uploads/2025/09/GRESMALT_PIANO_DI_DECARBONIZZAZIONE_2025_IT.pdf)

---

*Wiki generata insieme al README.md della repo. Le pagine seguono il README in [`/README.md`](https://github.com/Mavacchi/Gresmalt-ghg-tool/blob/main/README.md) ma sono molto più approfondite (la wiki sostituisce il vecchio `docs/`).*
