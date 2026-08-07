import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, test as base, type BrowserContext } from '@playwright/test';

const UNPACKED_BUILD = fileURLToPath(
  new URL('../../apps/extension/.output/chrome-mv3', import.meta.url),
);

interface ExtensionFixtures {
  /** Persistent context running on a throwaway profile with the unpacked build loaded. */
  context: BrowserContext;
  /** Runtime id Chrome assigned to the extension, needed to reach `chrome-extension://` pages. */
  extensionId: string;
}

/**
 * Every run starts from a profile created for it and deleted after it. Reusing one carries the
 * previous run's IndexedDB, watched-domain list and consent state over, which is exactly what
 * makes an extension suite non-deterministic.
 */
export const test = base.extend<ExtensionFixtures>({
  // Playwright reads the fixture's dependencies from the destructuring pattern and rejects any
  // other parameter form, so the empty pattern is required rather than sloppy.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'vigie-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Extensions do not load in the headless shell; the full Chromium build is required.
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${UNPACKED_BUILD}`,
        `--load-extension=${UNPACKED_BUILD}`,
      ],
    });

    await use(context);

    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const [, , extensionId] = worker.url().split('/');
    if (!extensionId) throw new Error(`could not read an extension id from ${worker.url()}`);
    await use(extensionId);
  },
});

export { expect } from '@playwright/test';
