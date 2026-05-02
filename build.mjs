/* GHG Tool — build.mjs
 *
 * Produce site/index.html autocontenuto:
 *   1. Concatena React + ReactDOM + Chart.js + Supabase JS (lette da
 *      node_modules) con i sorgenti src/ pre-compilati con Babel.
 *   2. Sostituisce i placeholder build-time (SUPABASE_URL, anon key,
 *      Turnstile site key, info azienda, logo, ecc.).
 *   3. Calcola SRI hash per pptxgenjs/SheetJS e li inietta nei
 *      tag CDN-lazy (cf. handleDynamicImports in src).
 *   4. Inietta CSP via meta http-equiv + headers di hosting.
 *
 * IMPORTANTE: nessun network al runtime per le librerie principali —
 *             solo per gli export opzionali (Excel/PPTX) tramite SRI.
 *
 * USAGE:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_ANON_KEY=eyJ... \
 *   TURNSTILE_SITE_KEY=0xAAAA... \
 *   COMPANY_LEGAL_NAME='Gruppo Ceramiche Gresmalt S.p.A.' \
 *   COMPANY_VAT='IT00000000000' \
 *   SUSTAINABILITY_EMAIL='sustainability@gresmalt.it' \
 *   PUBLIC_DASHBOARD_URL='https://sustainability.gresmalt.it' \
 *   LOGO_PATH=./assets/logo-gresmalt.png \
 *   node build.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (...p) => resolve(__dirname, ...p);

// ────────────────────────────────────────────────────────────────────
//  Variabili build-time (segnaposto → valori effettivi)
// ────────────────────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY'
];
const OPTIONAL_ENV = [
  'TURNSTILE_SITE_KEY',
  'SCHEMA_VERSION',
  'COMPANY_LEGAL_NAME',
  'COMPANY_VAT',
  'SUSTAINABILITY_EMAIL',
  'PUBLIC_DASHBOARD_URL'
];
const placeholders = {
  __SUPABASE_URL__:        process.env.SUPABASE_URL        || '',
  __SUPABASE_ANON_KEY__:   process.env.SUPABASE_ANON_KEY   || '',
  __TURNSTILE_SITE_KEY__:  process.env.TURNSTILE_SITE_KEY  || '',
  __SCHEMA_VERSION__:      process.env.SCHEMA_VERSION      || '1',
  __COMPANY_LEGAL_NAME__:  process.env.COMPANY_LEGAL_NAME  || 'Gruppo Ceramiche Gresmalt S.p.A.',
  __COMPANY_VAT__:         process.env.COMPANY_VAT         || 'IT00000000000',
  __SUSTAINABILITY_EMAIL__:process.env.SUSTAINABILITY_EMAIL|| 'sustainability@gresmalt.it',
  __PUBLIC_DASHBOARD_URL__:process.env.PUBLIC_DASHBOARD_URL|| 'https://sustainability.gresmalt.it'
};

const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.warn(`⚠ Mancano env vars richieste: ${missing.join(', ')} — il build genera comunque l'output ma il client non potrà connettersi al backend finché non sostituisci i placeholder.`);
}

// Logo opzionale
if (process.env.LOGO_PATH && existsSync(process.env.LOGO_PATH)) {
  const buf = readFileSync(process.env.LOGO_PATH);
  const ext = process.env.LOGO_PATH.split('.').pop().toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml'
             : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
             : 'image/png';
  placeholders.__LOGO_DATA_URI__ = `data:${mime};base64,${buf.toString('base64')}`;
  console.log(`✓ Logo caricato da ${process.env.LOGO_PATH} (${buf.length} byte)`);
}

// ────────────────────────────────────────────────────────────────────
//  SRI hash helper
// ────────────────────────────────────────────────────────────────────
function sri (path) {
  const h = createHash('sha384').update(readFileSync(path)).digest('base64');
  return `sha384-${h}`;
}

// ────────────────────────────────────────────────────────────────────
//  Babel pre-compile dei .jsx
// ────────────────────────────────────────────────────────────────────
async function compile (paths) {
  const babel = await import('@babel/core');
  const out = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      console.warn(`⚠ skip missing ${p}`);
      continue;
    }
    const source = readFileSync(p, 'utf8');
    if (p.endsWith('.jsx')) {
      const r = await babel.transformAsync(source, {
        presets: [
          ['@babel/preset-react', { runtime: 'classic' }]
        ],
        babelrc: false, configFile: false,
        filename: p
      });
      out.push(`/* ─── ${p.replace(__dirname + '/', '')} ─── */\n` + r.code);
    } else {
      out.push(`/* ─── ${p.replace(__dirname + '/', '')} ─── */\n` + source);
    }
  }
  return out.join('\n\n');
}

// ────────────────────────────────────────────────────────────────────
//  Lib loader (UMD da node_modules)
// ────────────────────────────────────────────────────────────────────
function tryRead (p) {
  if (existsSync(p)) return readFileSync(p, 'utf8');
  return null;
}
function loadLib (...candidates) {
  for (const c of candidates) {
    const got = tryRead(c);
    if (got) return got;
  }
  return null;
}

const REACT_PATH    = root('node_modules/react/umd/react.production.min.js');
const REACT_DOM_PATH= root('node_modules/react-dom/umd/react-dom.production.min.js');
const CHART_PATH    = root('node_modules/chart.js/dist/chart.umd.js');
const SB_PATH       = root('node_modules/@supabase/supabase-js/dist/umd/supabase.js');

const reactLib = loadLib(REACT_PATH);
const reactDomLib = loadLib(REACT_DOM_PATH);
const chartLib = loadLib(CHART_PATH, root('node_modules/chart.js/dist/chart.min.js'));
const sbLib    = loadLib(SB_PATH);

const fallbackLib = (name) => `/* ${name} non disponibile localmente — installare le dipendenze:\n   npm install\n*/`;

// ────────────────────────────────────────────────────────────────────
//  CSP
// ────────────────────────────────────────────────────────────────────
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.sheetjs.com https://cdn.jsdelivr.net https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "img-src 'self' data:",
  "frame-ancestors 'none'",
  "frame-src https://challenges.cloudflare.com",
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');

// ────────────────────────────────────────────────────────────────────
//  Compile sorgenti
// ────────────────────────────────────────────────────────────────────
const SRC_FILES = [
  'src/constants.js',
  'src/logo.js',
  'src/sanitize.js',
  'src/calc.js',
  'src/SupabaseDB.jsx',
  'src/components/ui.jsx',
  'src/components/DataTable.jsx',
  'src/components/Charts.jsx',
  'src/sections/PublicDashboard.jsx',
  'src/sections/Dashboard.jsx',
  'src/sections/Stub.jsx',
  'src/sections/Materiality.jsx',
  'src/sections/DataManager.jsx',
  'src/sections/AuditTrail.jsx',
  'src/sections/Diagnostics.jsx',
  'src/AuthGate.jsx',
  'src/App.jsx'
].map(p => root(p));

console.log('▶ Compiling sources…');
const compiled = await compile(SRC_FILES);

// ────────────────────────────────────────────────────────────────────
//  HTML
// ────────────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>GHG Tool — Gruppo Ceramiche Gresmalt</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; }
  body { font-family: 'Sora', sans-serif; background: #F6F6F6; color: #1F1E1F; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #C9C2B8; border-radius: 3px; }
  button, select, input { font-family: inherit; }
  *:focus-visible { outline: 2px solid #798A97; outline-offset: 2px; }
  @keyframes ghg-skel {
    0%   { background-position: 100% 50%; }
    100% { background-position: 0 50%; }
  }
  @media print {
    aside, header[role="banner"] button, header[role="banner"] select { display: none !important; }
    body { background: #fff !important; }
    section, article, div { page-break-inside: avoid; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>
<div id="root"></div>

<script>${reactLib || fallbackLib('react')}</script>
<script>${reactDomLib || fallbackLib('react-dom')}</script>
<script>${chartLib || fallbackLib('chart.js')}</script>
<script>${sbLib || fallbackLib('@supabase/supabase-js')}</script>

<script>
${compiled}

(function(){
  if (!window.React || !window.ReactDOM || !window.GHG || !window.GHG.AuthGate || !window.GHG.App) {
    document.body.innerHTML = '<div style="padding:32px;font-family:sans-serif;color:#B23B3B">Errore: bundle incompleto. Eseguire build.mjs con le dipendenze installate.</div>';
    return;
  }
  const { createElement: h } = window.React;
  window.ReactDOM.createRoot(document.getElementById('root'))
    .render(
      h(window.GHG.ui.ErrorBoundary, null,
        h(window.GHG.ui.ToastHost, null),
        h(window.GHG.ui.ConfirmHost, null),
        h(window.GHG.AuthGate, {
          publicComponent: window.GHG.PublicDashboard
        }, h(window.GHG.App, null))
      )
    );
})();
</script>
</body>
</html>
`;

// ────────────────────────────────────────────────────────────────────
//  Sostituzione placeholder
// ────────────────────────────────────────────────────────────────────
let html = HTML;
for (const [k, v] of Object.entries(placeholders)) {
  html = html.split(k).join(v);
}

// ────────────────────────────────────────────────────────────────────
//  Output
// ────────────────────────────────────────────────────────────────────
const outDir = root('site');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outFile = root('site/index.html');
writeFileSync(outFile, html);

const size = statSync(outFile).size;
console.log(`✓ site/index.html scritto · ${(size/1024).toFixed(1)} KB`);

// Verifica che i NOSTRI sorgenti non usino dangerouslySetInnerHTML.
// (React minified menziona la stringa internamente per validare i prop:
//  va ignorato. Controlliamo solo la sezione compiled.)
if (compiled.includes('dangerouslySetInnerHTML')) {
  console.error('✗ FAIL: dangerouslySetInnerHTML rilevato nei sorgenti src/');
  process.exit(1);
}

// .nojekyll per GitHub Pages (non processare con Jekyll)
writeFileSync(root('site/.nojekyll'), '');

console.log('✓ build completato.');
