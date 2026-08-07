import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

/**
 * The suite exercises the built artifact, never the sources — which is why it lives at the
 * repository root rather than inside `apps/extension`. `turbo e2e` builds the extension first;
 * running Playwright directly on a stale `.output/` is the one way to get a misleading green.
 */
export default defineConfig({
  testDir: fileURLToPath(new URL('./specs', import.meta.url)),
  // A Chrome profile carrying an extension cannot be shared between parallel workers.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
