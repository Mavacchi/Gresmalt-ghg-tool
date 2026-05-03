# assets/

Asset binari del progetto inlined nel bundle dal `build.mjs`.

## Logo

Il file logo è auto-rilevato in questo ordine:

1. `assets/logo.svg` — preferito (vettoriale, scala perfettamente)
2. `assets/logo.png`
3. `assets/logo.jpg` / `.jpeg`

Il primo trovato vince. Se nessuno è presente, viene usato lo SVG
fallback inline in `src/logo.js`.

Il file viene letto a build-time, codificato in base64 e iniettato
come `data:` URI nel placeholder `__LOGO_DATA_URI__` di
`src/logo.js`. Il bundle resta self-contained: nessuna fetch a
runtime.

Per usare un logo diverso senza toccare la cartella, esportare la
env `LOGO_PATH` prima del build (es. `LOGO_PATH=./altro/path.png
node build.mjs`).

## Vincoli pratici

- **Dimensione consigliata**: < 100 KB. Tutto ciò che è qui finisce
  inline nel bundle e pesa sull'HTML che gli utenti scaricano.
- **PNG**: trasparenza OK; usare `pngquant` per ridurre senza
  perdere qualità.
- **SVG**: rimuovere metadati Adobe (`svgo --pretty`).
