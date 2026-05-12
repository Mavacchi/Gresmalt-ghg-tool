/* GHG Tool — sanitize.js
 *
 * Funzione unica `sanitizeForSpreadsheet(v)` riusata da CSV, Excel,
 * PPTX writer per prevenire formula injection in Excel/Numbers/Calc.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});

  function sanitizeForSpreadsheet (v) {
    if (v == null) return '';
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    const s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }

  G.sanitize = { sanitizeForSpreadsheet };
})(typeof window !== 'undefined' ? window : globalThis);
