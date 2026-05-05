// @ts-check
/* GHG Tool — Playwright config (smoke test runtime)
 *
 * Test minimi che aprono il bundle in un browser headless e verificano
 * che le sezioni principali della console interna non lancino
 * ReferenceError o altri errori bloccanti.
 *
 * Uso:
 *   npm run build                     # genera site/index.html
 *   npx playwright install chromium    # primo run, scarica browser
 *   npm run test:e2e                   # esegue gli smoke test
 *
 * In CI il job `e2e:` (.github/workflows/build.yml) si occupa
 * dell'installazione del browser e del lancio.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.mjs',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? [['list'], ['github']] : 'list',

  use: {
    // Server statico locale che serve site/index.html
    baseURL: 'http://127.0.0.1:8123',
    trace: 'retain-on-failure',
    // Niente video/screenshot di default per restare leggeri
    screenshot: 'only-on-failure'
  },

  // Lancia un server statico (Python http.server) durante i test
  // e lo killa alla fine. Server porta 8123 (non confliggente con 8000
  // del `npm run dev`).
  webServer: {
    command: 'python3 -m http.server --directory site 8123',
    url: 'http://127.0.0.1:8123',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
