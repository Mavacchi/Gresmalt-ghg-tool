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

  // Sanitizza tutti i valori stringa di un oggetto (one level)
  function sanitizeObject (obj) {
    if (!obj) return obj;
    const out = {};
    for (const k of Object.keys(obj)) {
      out[k] = sanitizeForSpreadsheet(obj[k]);
    }
    return out;
  }

  G.sanitize = { sanitizeForSpreadsheet, sanitizeObject };
})(typeof window !== 'undefined' ? window : globalThis);
