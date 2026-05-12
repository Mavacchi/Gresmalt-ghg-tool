# Wiki — contenuto da pubblicare su GitHub Wiki

Questa cartella contiene **19 pagine markdown** pronte da copiare nella
[GitHub Wiki](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki) del progetto.

## Pagine

| File | Pagina wiki | Argomento |
|---|---|---|
| `Home.md` | [Home](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Home) | Indice + quick start + diagramma |
| `_Sidebar.md` | sidebar | navigazione laterale standard wiki |
| `_Footer.md` | footer | link standard wiki |
| `Architettura.md` | [Architettura](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Architettura) | stack, IIFE, build pipeline, namespace globali |
| `Modello-dati.md` | [Modello-dati](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Modello-dati) | 14 tabelle, MV, RLS, hash chain |
| `Public-Dashboard.md` | [Public-Dashboard](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Public-Dashboard) | Faccia A anonima |
| `Console-Interna.md` | [Console-Interna](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Console-Interna) | Faccia B operatori, 11 sezioni |
| `Gestione-Dati.md` | [Gestione-Dati](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Gestione-Dati) | 7 tab CRUD + import/export |
| `Audit-Trail.md` | [Audit-Trail](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Audit-Trail) | hash chain + pseudonimizzazione GDPR |
| `Edge-Functions.md` | [Edge-Functions](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Edge-Functions) | sign_snapshot, ai_assist, search_fe, … |
| `Sicurezza.md` | [Sicurezza](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Sicurezza) | CSP, SRI, MFA, RLS, HMAC, backup |
| `Migrazioni-SQL.md` | [Migrazioni-SQL](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Migrazioni-SQL) | 18 file SQL idempotenti |
| `Build-e-Deploy.md` | [Build-e-Deploy](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Build-e-Deploy) | env vars + GitHub Pages |
| `GitHub-Actions.md` | [GitHub-Actions](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/GitHub-Actions) | 4 workflow + Dependabot |
| `Test.md` | [Test](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Test) | 67 unit + Playwright e2e |
| `Operazioni-Comuni.md` | [Operazioni-Comuni](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Operazioni-Comuni) | playbook task ricorrenti |
| `Configurazione.md` | [Configurazione](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Configurazione) | env vars + secrets + setup completo |
| `Glossario.md` | [Glossario](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Glossario) | terminologia GHG/CSRD/sicurezza |
| `FAQ-e-Troubleshooting.md` | [FAQ-e-Troubleshooting](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/FAQ-e-Troubleshooting) | problemi comuni e soluzioni |
| `Piano-di-Decarbonizzazione.md` | [Piano-di-Decarbonizzazione](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Piano-di-Decarbonizzazione) | target 2034 / 2050 / 6 leve |
| `Sorgenti-File-per-File.md` | [Sorgenti-File-per-File](https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki/Sorgenti-File-per-File) | guida ai 28 file in src/ |

Totale: ~260 KB di documentazione markdown.

## Come pubblicare sulla wiki GitHub

### Opzione A — Clone + push (raccomandato)

La wiki di GitHub è un repository git separato all'URL
`<repo>.wiki.git`.

```bash
# 1. Assicurati che la wiki sia inizializzata
#    (vai su https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki
#    e crea almeno la pagina Home dalla UI se non esiste ancora)

# 2. Clone della wiki
git clone https://github.com/Mavacchi/Gresmalt-ghg-tool.wiki.git
cd Gresmalt-ghg-tool.wiki

# 3. Copia tutti i file da wiki/ del repo principale
cp /path/to/Gresmalt-ghg-tool/wiki/*.md .

# 4. Commit & push
git add .
git commit -m "docs: wiki omnicomprensiva del progetto"
git push origin master
```

### Opzione B — Upload manuale via UI

1. Vai a https://github.com/Mavacchi/Gresmalt-ghg-tool/wiki
2. Click "New Page"
3. Inserisci nome esatto del file (senza `.md`)
4. Copia/incolla il contenuto del file markdown
5. "Save Page"
6. Ripeti per ogni file

> File `_Sidebar.md` e `_Footer.md` sono nomi speciali GitHub Wiki: appaiono
> rispettivamente come sidebar e footer su tutte le pagine.

## Aggiornamenti futuri

Quando aggiorni il codice del progetto, considera anche di aggiornare la
wiki:

1. Modifica i file in `wiki/` del repo principale (versionati nel git
   normale, review via PR)
2. Riapplica il push alla wiki seguendo Opzione A sopra

Idealmente avresti un GitHub Action che fa il sync automatico dal repo
principale alla wiki repo, ma richiede un PAT con `repo` scope per pushare
nella wiki (GitHub Actions GITHUB_TOKEN non funziona sulla wiki di
default).

Esempio workflow `.github/workflows/sync-wiki.yml`:

```yaml
name: Sync wiki

on:
  push:
    branches: [main]
    paths: ['wiki/**']
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Clone wiki
        env:
          PAT: ${{ secrets.WIKI_SYNC_PAT }}
        run: |
          git clone "https://x-access-token:${PAT}@github.com/${{ github.repository }}.wiki.git" wiki-repo
      - name: Copy + push
        run: |
          cp wiki/*.md wiki-repo/
          cd wiki-repo
          git config user.name 'github-actions[bot]'
          git config user.email 'github-actions[bot]@users.noreply.github.com'
          git add .
          git diff --staged --quiet || git commit -m "docs: sync wiki from main"
          git push
```

`WIKI_SYNC_PAT` deve essere un Personal Access Token (classic) con scope
`repo` (perché GITHUB_TOKEN non ha grants sulla wiki).
