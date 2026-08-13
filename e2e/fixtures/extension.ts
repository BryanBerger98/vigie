import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, test as base, type BrowserContext } from '@playwright/test';

const UNPACKED_BUILD = fileURLToPath(
  new URL('../../apps/extension/.output/chrome-mv3', import.meta.url),
);

interface ExtensionOptions {
  /**
   * Unpacked build to load. Defaults to the shipped one; a spec overrides it with `test.use`
   * when it needs a build whose manifest differs — see `optional-host-permission.spec.ts`.
   */
  extensionPath: string;
  /**
   * Whether the run starts with the disclosure agreed to.
   *
   * `'accepted'` for every spec that exercises what comes after it, which is nearly all of them:
   * a fresh profile captures nothing, so leaving this to each spec would turn one product rule
   * into eight copies of the same setup. `'pristine'` is for the specs about the gate itself.
   */
  consent: 'accepted' | 'pristine';
  /**
   * The language Chrome announces to the extension, which decides what the interface speaks on a
   * profile that never chose one.
   *
   * Pinned to English for the whole suite because the assertions are written in English: without
   * it, running the suite on a French machine would fail every one of them, and the failure would
   * read as a broken product rather than as a translated one. `ui-language.spec.ts` overrides it
   * with `test.use` — it is the one spec whose subject is the language itself.
   */
  uiLanguage: string;
}

interface ExtensionFixtures {
  /** Persistent context running on a throwaway profile with the unpacked build loaded. */
  context: BrowserContext;
  /** Runtime id Chrome assigned to the extension, needed to reach `chrome-extension://` pages. */
  extensionId: string;
  /** Runs before every test: answers the disclosure unless the spec asked for a pristine profile. */
  agreement: void;
}

/**
 * Every run starts from a profile created for it and deleted after it. Reusing one carries the
 * previous run's IndexedDB, watched-domain list and consent state over, which is exactly what
 * makes an extension suite non-deterministic.
 */
export const test = base.extend<ExtensionOptions & ExtensionFixtures>({
  extensionPath: [UNPACKED_BUILD, { option: true }],
  consent: ['accepted', { option: true }],
  uiLanguage: ['en-US', { option: true }],

  context: async ({ extensionPath, uiLanguage }, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'vigie-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Extensions do not load in the headless shell; the full Chromium build is required.
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--lang=${uiLanguage}`,
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

  /**
   * The agreement, given through the screen rather than written into storage.
   *
   * Clicking the real button is what keeps this fixture honest: writing `vigie:consent` by hand
   * would keep passing after the button stopped storing it, and every other spec would go on
   * asserting a capture that no longer happens.
   *
   * `onInstalled` already opened the screen on this fresh profile, but the fixture opens its own
   * page instead of hunting for that tab: the install tab is a race, and a second one answering
   * the same question is harmless.
   */
  agreement: [
    async ({ context, extensionId, consent }, use) => {
      if (consent === 'accepted') {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/consent.html`);
        await page.getByTestId('consent-accept').click();
        await page.getByTestId('consent-accepted').waitFor();
        await page.close();
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
