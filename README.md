# GHG Tool — Sustainability Platform · Gruppo Ceramiche Gresmalt

Piattaforma single-page per l'inventario GHG (Scope 1 + 2 + 3) del
gruppo ceramico, con doppia esperienza:

- **Faccia A — Public Sustainability Dashboard**: vetrina pubblica
  per i clienti del gruppo. Niente login, solo aggregati e intensità.
- **Faccia B — Internal Operations Console**: console operativa per
  dipendenti e auditor, con permessi per ruolo e audit log immutabile.

Tutto vive in un singolo `site/index.html` (~700 KB) generato da
`build.mjs` a partire dai sorgenti in `src/`.

---

## Quickstart

```bash
# 1. Backend (Supabase)
#    SQL Editor → eseguire in ordine:
#      sql/01_schema.sql
#      sql/02_data_seed.sql
#      sql/03_roles.sql
#      sql/04_public_view.sql
#      sql/05_app_meta.sql
#      sql/06_client_errors.sql
#    Dopo gli inviti utenti, anche:
#      sql/07_invite_operators.sql

# 2. Build
npm install
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_ANON_KEY=eyJ... \
TURNSTILE_SITE_KEY=0xAAAA... \
LOGO_PATH=./assets/logo-gresmalt.png \
node build.mjs

# 3. Deploy
#    Pubblicare site/ su GitHub Pages, Cloudflare Pages, Netlify o
#    Vercel statico.

# 4. Keep-alive
#    Configurare i secret SUPABASE_URL e SUPABASE_ANON_KEY nel repo
#    GitHub. Il workflow .github/workflows/keepalive.yml fa un ping
#    ogni 3 giorni che impedisce la pausa del progetto Free.
```

Procedure complete in [`docs/RUNBOOK.md`](docs/RUNBOOK.md);
threat model in [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Struttura repo

```
.github/workflows/   keepalive.yml · backup.yml · build.yml
sql/                 01_schema → 07_invite_operators
src/
  constants.js       palette ESG, ruoli, i18n IT/EN
  calc.js            formule emissioni + intensità + lookupFE
  sanitize.js        anti formula injection
  SupabaseDB.jsx     client + traduzione campi + load + RPC
  AuthGate.jsx       login email+pwd + MFA + Turnstile
  components/        ui · DataTable · Charts
  sections/          PublicDashboard · Dashboard · SiteAnalysis ·
                     ScopeAnalysis · Materiality · DataQuality ·
                     FEExplorer · Scenarios · Output · DataManager ·
                     AuditTrail · Diagnostics
  App.jsx            shell console interna (sidebar + topbar)
  build.mjs          inline libs + babel JSX + CSP + SRI + placeholders
docs/                RUNBOOK · SECURITY
site/                output autocontenuto (committato per GitHub Pages)
```

---

## Decisioni di configurazione (confermate dal cliente)

| Voce                         | Valore                                                    |
|------------------------------|-----------------------------------------------------------|
| Anni di inventario           | 2024 + 2025                                               |
| Categorie S3 incluse         | 1, 2, 3, 4, 5, 6, 7, 9, 12                                |
| Categorie S3 escluse         | 8, 11, 15                                                 |
| Categorie S3 N.A.            | 10, 13, 14                                                |
| Produzione (kg, m²)          | Vuota (Opzione B): si popola da GUI dopo deploy          |
| FE seed                      | 74 fattori plausibili (ISPRA / AIB / DEFRA / ecoinvent)   |
| Hosting                      | GitHub Pages (Cloudflare proxy raccomandato per HSTS)    |
| Lingue Public Dashboard      | Italiano (default) + Inglese                              |
| Operatori iniziali           | marco.vacchi (admin), davide.settembre (editor),         |
|                              | luca.iattici (editor)                                     |
| Anagrafiche siti             | IANO, VIANO, VIANO_GARGOLA, FRASSINORO (Stab.)           |
|                              | SASSUOLO (Stab.), FIORANO (Magazzino),                   |
|                              | CASALGRANDE (Logistica)                                   |

---

## Chi può fare cosa (matrice)

|                          | admin | editor | auditor | viewer | guest |
|--------------------------|:-----:|:------:|:-------:|:------:|:-----:|
| Public Dashboard         |  ✓    |   ✓    |   ✓     |   ✓    |   ✓   |
| Internal Dashboard       |  ✓    |   ✓    |   ✓     |   ✓    |   ✗   |
| Materialità S3           |  ✓    |   ✓    |   ✓     |   ✓    |   ✗   |
| Data Quality             |  ✓    |   ✓    |   ✓     |   ✗    |   ✗   |
| FE Explorer              |  ✓    |   ✓    |   ✓     |   ✗    |   ✗   |
| Output / Report          |  ✓    |   ✓    |   ✓     |   ✓    |   ✗   |
| Gestione Dati            |  ✓    |   ✓    |   ✗     |   ✗    |   ✗   |
| Audit Trail              |  ✓    |   ✗    |   ✓     |   ✗    |   ✗   |
| Diagnostica              |  ✓    |   ✗    |   ✗     |   ✗    |   ✗   |
| Reset / Delete           |  ✓    |   ✗    |   ✗     |   ✗    |   ✗   |

Il ruolo è letto da `auth.jwt() -> 'app_metadata' ->> 'role'` —
**mai** da `user_metadata` (che è scrivibile dall'utente e abiliterebbe
privilege escalation).

---

## Licenza

Proprietà Gruppo Ceramiche Gresmalt S.p.A. Tutti i diritti riservati.
