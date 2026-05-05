/* GHG Tool — sections/_shared.jsx
 *
 * Helper condivisi tra le sezioni della console interna estratte
 * da Stub.jsx (PR di splitting). Esposti su window.GHG.sectionsHelpers
 * per riuso da SiteAnalysis, ScopeAnalysis, DataQuality, ecc.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h } = root.React;

  // ── helper: loading state coerente per sezioni vuote ────────────
  function isLoading (data) {
    return !data || (
      (data.s1 || []).length === 0 &&
      (data.s2 || []).length === 0 &&
      (data.s3 || []).length === 0 &&
      (data.produzione || []).length === 0 &&
      (data.anagrafiche || []).length === 0
    );
  }
  function loadingSkeleton (title) {
    return h('div', null, [
      h('h1', { style: { fontSize: 22, fontWeight: 700, marginBottom: 16 } }, title),
      h('div', {
        style: { display: 'grid', gap: 12, marginBottom: 20,
                 gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }
      }, [1,2,3,4].map(i => h(G.ui.Skeleton, { key: i, height: 110, radius: 12 }))),
      h(G.ui.Skeleton, { height: 280, radius: 12 })
    ]);
  }

  G.sectionsHelpers = G.sectionsHelpers || {};
  Object.assign(G.sectionsHelpers, { isLoading, loadingSkeleton });
})(typeof window !== 'undefined' ? window : globalThis);
