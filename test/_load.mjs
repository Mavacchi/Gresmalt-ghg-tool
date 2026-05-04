/* GHG Tool — test loader
 *
 * I sorgenti in src/ sono IIFE che si attaccano a window/globalThis
 * (`)(typeof window !== 'undefined' ? window : globalThis)`).
 * Qui creiamo un context Node con `globalThis.GHG = {}`, leggiamo
 * il file come stringa e lo eseguiamo via vm.runInThisContext.
 *
 * Niente bundler, niente Babel: i sorgenti che testiamo (calc.js,
 * io.jsx limitatamente a enrichForUpsert) sono JS puro, non JSX.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '..', 'src');

export function loadSource (relPath) {
  const full = path.join(SRC_DIR, relPath);
  const code = fs.readFileSync(full, 'utf8');
  vm.runInThisContext(code, { filename: relPath });
}

// Reset GHG namespace fra test suites (ogni file di test parte pulito).
export function resetGHG () {
  globalThis.GHG = {};
  // Stub minimo per evitare reference error in moduli che leggono
  // window.document a top-level (io.jsx no, ma per sicurezza futura).
  if (typeof globalThis.window === 'undefined') globalThis.window = undefined;
}
