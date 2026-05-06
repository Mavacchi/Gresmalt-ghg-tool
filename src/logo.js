/* GHG Tool — logo Gresmalt
 *
 * Fallback SVG inline che riproduce il wordmark "gresmalt GROUP" del
 * cliente. Al build, `build.mjs` può sostituire l'intero data-URI con
 * la versione PNG ufficiale tramite variabile env LOGO_PATH (file
 * letto e codificato in base64). Se LOGO_PATH non è impostata, resta
 * questo SVG.
 *
 * Esposto come window.GHG.LOGO_DATA_URI.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});

  // Wordmark SVG: "gresmalt" in bold + "GROUP" sotto in grigio chiaro.
  // Il piccolo accento sopra la "g" replica il quadrato nero del logo
  // originale.
  const SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 88" role="img" aria-label="Gresmalt Group">',
      '<rect x="6" y="6" width="14" height="14" fill="#1F1E1F"/>',
      '<text x="0" y="58" font-family="Sora, sans-serif" font-size="48" font-weight="700" fill="#1F1E1F" letter-spacing="-1">gresmalt</text>',
      '<text x="148" y="80" font-family="Sora, sans-serif" font-size="14" font-weight="600" fill="#A6A6A6" letter-spacing="2">GROUP</text>',
    '</svg>'
  ].join('');

  // Build placeholder: viene sostituito da build.mjs se LOGO_PATH è impostata
  const PLACEHOLDER = '__LOGO_DATA_URI__';

  G.LOGO_DATA_URI = PLACEHOLDER.startsWith('__')
    ? 'data:image/svg+xml;utf8,' + encodeURIComponent(SVG)
    : PLACEHOLDER;

  // Logo ridotto (brand mark compatto): usato quando la sidebar è
  // collassata (vedi src/App.jsx). Sostituito da build.mjs se
  // assets/Logo-ridotto.* è presente. Se non c'è, resta null e
  // App.jsx fa fallback al box bianco con "G" inline.
  const MARK_PLACEHOLDER = '__LOGO_MARK_DATA_URI__';
  G.LOGO_MARK_DATA_URI = MARK_PLACEHOLDER.startsWith('__')
    ? null
    : MARK_PLACEHOLDER;
})(typeof window !== 'undefined' ? window : globalThis);
