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
  __PUBLIC_DASHBOARD_URL__:process.env.PUBLIC_DASHBOARD_URL|| 'https://sustainability.gresmalt.it',
  __SHEETJS_VERSION__:     '0.18.5',
  __PPTXGENJS_VERSION__:   '3.12.0',
  __SHEETJS_SRI__:         '',  // popolato sotto, dopo il calcolo
  __PPTXGENJS_SRI__:       ''
};

const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.warn(`⚠ Mancano env vars richieste: ${missing.join(', ')} — il build genera comunque l'output ma il client non potrà connettersi al backend finché non sostituisci i placeholder.`);
}

// Logo: auto-detect ad assets/logo.{svg,png,jpg,jpeg} oppure usa
// LOGO_PATH se passato esplicitamente (override). Se nessun file
// reale è disponibile, resta lo SVG fallback in src/logo.js.
function resolveLogo () {
  if (process.env.LOGO_PATH && existsSync(process.env.LOGO_PATH)) {
    return process.env.LOGO_PATH;
  }
  for (const ext of ['svg', 'png', 'jpg', 'jpeg']) {
    const p = root('assets/logo.' + ext);
    if (existsSync(p)) return p;
  }
  return null;
}
const _logoPath = resolveLogo();
if (_logoPath) {
  const buf = readFileSync(_logoPath);
  const ext = _logoPath.split('.').pop().toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml'
             : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
             : 'image/png';
  placeholders.__LOGO_DATA_URI__ = `data:${mime};base64,${buf.toString('base64')}`;
  console.log(`✓ Logo caricato da ${_logoPath} (${buf.length} byte)`);
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
    if (got) return patchInlinedUMD(got);
  }
  return null;
}

// Webpack 5 emette un runtime "auto publicPath" che chiama
// `document.currentScript.src`. Quando una UMD viene inlined dentro
// `<script>...</script>`, currentScript.src è "" e webpack lancia
// `throw new Error("Automatic publicPath is not supported in this browser")`,
// bloccando l'init della libreria (es. @supabase/supabase-js → window.supabase
// resta undefined). publicPath non serve a runtime perché le UMD non fanno
// code-splitting dinamico, quindi neutralizziamo il throw assegnando "/".
function patchInlinedUMD (code) {
  return code.replace(
    /if\s*\(\s*!\s*([A-Za-z_$][\w$]*)\s*\)\s*throw\s+(?:new\s+)?Error\(\s*["']Automatic publicPath is not supported in this browser["']\s*\)/g,
    'if(!$1)$1="/"'
  );
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
// NB: `frame-ancestors` qui sarebbe ignorata dal browser
// (https://w3c.github.io/webappsec-csp/#meta) e produce un warning in
// console. Va espressa come header HTTP — vedi site/_headers
// (Content-Security-Policy + X-Frame-Options come fallback).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.sheetjs.com https://cdn.jsdelivr.net https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "img-src 'self' data:",
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
  'src/io.jsx',
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

// ────────────────────────────────────────────────────────────────────
//  Lint pre-compile: sorgenti puliti da pattern XSS-prone.
//  Eseguito PRIMA di Babel così il messaggio d'errore indica il file
//  esatto. Il check post-compile più sotto resta come safety net.
// ────────────────────────────────────────────────────────────────────
// Token vietati nei sorgenti src/ — defense in depth XSS / injection.
const FORBIDDEN_TOKENS = [
  'dangerouslySetInnerHTML',  // React: bypass del rendering safe
  'eval(',                    // JS: code injection
  'new Function(',            // JS: equivalente di eval
  'document.write(',          // DOM: deprecato, può rompere CSP
  'innerHTML ='               // DOM: bypass del rendering React safe
];
for (const p of SRC_FILES) {
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8');
  for (const tok of FORBIDDEN_TOKENS) {
    if (src.includes(tok)) {
      const rel = p.replace(__dirname + '/', '');
      console.error(`✗ FAIL: forbidden token "${tok}" in ${rel}`);
      process.exit(1);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
//  SRI hash per CDN-lazy libs (SheetJS + pptxgenjs)
//  Calcolati dai bundle locali pinnati (versioni in package.json).
//  Il client carica la stessa versione dalla CDN; se l'hash CDN diverge
//  il browser blocca il load (defense-in-depth).
// ────────────────────────────────────────────────────────────────────
const SHEETJS_VERSION = '0.18.5';
const PPTXGENJS_VERSION = '3.12.0';
const SHEETJS_PATH = root('node_modules/xlsx/dist/xlsx.full.min.js');
const PPTXGENJS_PATH = root('node_modules/pptxgenjs/dist/pptxgen.bundle.js');
const SHEETJS_SRI = existsSync(SHEETJS_PATH) ? sri(SHEETJS_PATH) : '';
const PPTXGENJS_SRI = existsSync(PPTXGENJS_PATH) ? sri(PPTXGENJS_PATH) : '';
placeholders.__SHEETJS_SRI__ = SHEETJS_SRI;
placeholders.__PPTXGENJS_SRI__ = PPTXGENJS_SRI;

console.log('▶ Compiling sources…');
const compiled = await compile(SRC_FILES);

// ────────────────────────────────────────────────────────────────────
//  HTML
// ────────────────────────────────────────────────────────────────────
// Favicon SVG inline — letterform "G" su brand color, scalabile,
// CSP-safe (data URI). Niente download separato.
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="12" fill="#2B2A2D"/>' +
  '<text x="32" y="44" font-family="Sora,sans-serif" font-size="38" font-weight="800" fill="#fff" text-anchor="middle">G</text>' +
  '</svg>';
const FAVICON_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent(FAVICON_SVG);

// Meta description (statica, multilingue: si usa IT come default
// perché il primo render della pagina è IT salvo override
// localStorage del visitatore; SEO è un solo lang per pagina).
const META_DESC = 'Inventario delle emissioni di gas serra del Gruppo Ceramiche Gresmalt — Scope 1, 2 e 3 secondo lo standard GHG Protocol Corporate. Trasparenza, target di decarbonizzazione al 2034 e al 2050.';

// JSON-LD Organization + Webpage. Aiuta indicizzazione Google e i
// link preview di alcune piattaforme che leggono structured data.
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      'name':  placeholders.__COMPANY_LEGAL_NAME__,
      'url':   'https://www.gresmalt.it/',
      'logo':  'https://www.gresmalt.it/wp-content/uploads/2024/logo.png',
      'address': {
        '@type': 'PostalAddress',
        'streetAddress':  'Via Statale 467, 45',
        'addressLocality':'Casalgrande',
        'postalCode':     '42013',
        'addressRegion':  'RE',
        'addressCountry': 'IT'
      },
      'taxID': placeholders.__COMPANY_VAT__,
      'email': placeholders.__SUSTAINABILITY_EMAIL__
    },
    {
      '@type': 'WebPage',
      'name':  'Inventario emissioni GHG · ' + placeholders.__COMPANY_LEGAL_NAME__,
      'description': META_DESC,
      'inLanguage': 'it'
    }
  ]
});

const CANONICAL = placeholders.__PUBLIC_DASHBOARD_URL__ || '';

const HTML = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="description" content="${META_DESC}" />
<meta name="robots" content="index, follow" />
<title>Inventario emissioni GHG — Gruppo Ceramiche Gresmalt</title>
${CANONICAL ? `<link rel="canonical" href="${CANONICAL}" />` : ''}
<!-- Open Graph (LinkedIn, Facebook, Slack, WhatsApp link preview) -->
<meta property="og:type" content="website" />
<meta property="og:title" content="Inventario emissioni GHG — Gruppo Ceramiche Gresmalt" />
<meta property="og:description" content="${META_DESC}" />
${CANONICAL ? `<meta property="og:url" content="${CANONICAL}" />` : ''}
<meta property="og:locale" content="it_IT" />
<meta property="og:locale:alternate" content="en_US" />
<meta property="og:site_name" content="Gruppo Ceramiche Gresmalt" />
<!-- Twitter Card -->
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="Inventario emissioni GHG — Gruppo Ceramiche Gresmalt" />
<meta name="twitter:description" content="${META_DESC}" />
<!-- Favicon SVG inline -->
<link rel="icon" type="image/svg+xml" href="${FAVICON_URI}" />
<!-- Structured data per indicizzazione Google -->
<script type="application/ld+json">${JSON_LD}</script>
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
  /* CTA hover — sollevamento + ombra leggera */
  .ghg-cta:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0,0,0,.10);
  }
  .ghg-cta:active { transform: translateY(0); }
  /* Trust chip hover */
  .ghg-trust:hover {
    background: #F6F6F6 !important;
    border-color: #C8CCD0 !important;
  }
  /* Print stylesheet — pagina pubblica leggibile su carta */
  @media print {
    aside, header[role="banner"] button, header[role="banner"] select,
    header[role="banner"] a[href="#app"] { display: none !important; }
    body { background: #fff !important; color: #000 !important; }
    section, article, div { page-break-inside: avoid; }
    a { text-decoration: underline; color: #000; }
    a[href]:after { content: " (" attr(href) ")"; font-size: 10pt; color: #555; }
    /* Hero più sobrio in stampa */
    h1, h2, h3 { color: #000 !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
  /* ─── MOBILE breakpoint < 768px ──────────────────────────── */
  @media (max-width: 768px) {
    .ghg-hero-stat { font-size: 56px !important; }
    .ghg-hero-pad { padding: 32px 20px !important; }
    .ghg-section-pad { padding-left: 16px !important; padding-right: 16px !important; }
    .ghg-header-bar { flex-wrap: wrap !important; gap: 8px !important; padding: 10px 16px !important; }
    .ghg-header-title { display: none !important; }
    .ghg-trust-chip { padding: 10px 14px !important; min-height: 44px !important; }
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
