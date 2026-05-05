/* GHG Tool — test entrypoint
 *
 * `npm test` invoca questo file. Importa tutti i *.test.mjs (l'ordine
 * di import determina l'ordine di esecuzione) e poi chiama runner.run().
 */
import { run } from './_runner.mjs';

await import('./calc.test.mjs');
await import('./io.test.mjs');
await import('./zip.test.mjs');
await import('./redactpii.test.mjs');

await run();
