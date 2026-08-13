import type { BrowserContext, Page } from '@playwright/test';

import {
  buildVariantPath,
  createBuildVariant,
  removeBuildVariant,
} from '../fixtures/build-variant';
import { flushCapture, readCapturedEntries } from '../fixtures/capture-store';
import { expect, test } from '../fixtures/extension';
import { startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The agreement, and what it gates.
 *
 * The unit tests state that the write path refuses an entry without consent, and that the readout
 * splits per domain. Neither of them can state the product claim, which is the one this file is
 * about: on a real profile, with a real host permission and real traffic, *nothing is written*
 * before the disclosure has been answered — and the surfaces say so instead of pretending to work.
 *
 * The whole file runs on a pristine profile: the fixture's automatic acceptance is turned off with
 * `test.use({ consent: 'pristine' })`, and the tests that need an agreement give it through the
 * screen, which is also how the acceptance itself gets covered.
 *
 * Same build variant as the other capture suites: the host permission is required rather than
 * optional, so the browser delivers every request. An empty store here is therefore the consent
 * lock refusing to write, never a browser that handed nothing over.
 */

const CONSENT_BUILD = buildVariantPath('consent-flow');

test.use({ extensionPath: CONSENT_BUILD, consent: 'pristine' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

/** The keys the extension stores its two locks under, as `storage/` declares them. */
const WATCHED_DOMAINS_KEY = 'vigie:watched-domains';
const CONSENT_KEY = 'vigie:consent';

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(CONSENT_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(CONSENT_BUILD);
});

/** An extension page, opened without asserting on what it renders — the gate may be up. */
async function openExtensionPage(
  context: BrowserContext,
  extensionId: string,
  page: 'options' | 'popup' | 'consent',
): Promise<Page> {
  const opened = await context.newPage();
  await opened.goto(`chrome-extension://${extensionId}/${page}.html`);
  return opened;
}

/**
 * Designates a domain without going through the settings.
 *
 * The settings are behind the gate, which is the very thing under test: the form cannot be used to
 * set up a scenario about what happens before the agreement. Writing the key directly is the same
 * state the form produces — the worker follows `storage.local` either way — and it keeps this
 * scenario about the consent lock rather than about the form.
 */
async function watchDirectly(page: Page, key: string, domain: string): Promise<void> {
  await page.evaluate(
    ([storageKey, value]) =>
      new Promise<void>((resolve) => {
        const { chrome } = globalThis as unknown as {
          chrome: { storage: { local: { set(items: object, callback: () => void): void } } };
        };
        chrome.storage.local.set({ [storageKey]: [value] }, resolve);
      }),
    [key, domain] as const,
  );
}

/** Overwrites the stored agreement, to state a profile that agreed to an older wording. */
async function storeConsentVersion(page: Page, key: string, version: number): Promise<void> {
  await page.evaluate(
    ([storageKey, acceptedVersion]) =>
      new Promise<void>((resolve) => {
        const { chrome } = globalThis as unknown as {
          chrome: { storage: { local: { set(items: object, callback: () => void): void } } };
        };
        chrome.storage.local.set(
          { [storageKey]: { acceptedVersion, acceptedAt: Date.now() } },
          resolve,
        );
      }),
    [key, version] as const,
  );
}

/** Answers the disclosure the way a user does, and waits for the screen to say it landed. */
async function agree(context: BrowserContext, extensionId: string): Promise<void> {
  const screen = await openExtensionPage(context, extensionId, 'consent');
  await screen.getByTestId('consent-accept').click();
  await expect(screen.getByTestId('consent-accepted')).toBeVisible();
  await screen.close();
}

/** Adds a domain through the settings, once the gate is down. */
async function watch(options: Page, domain: string): Promise<void> {
  await options.getByTestId('add-domain-input').fill(domain);
  await options.getByTestId('add-domain-submit').click();
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);
}

/** Every stored entry, after the worker has been made to write what it still held. */
async function captured(page: Page) {
  await flushCapture(page);
  return readCapturedEntries(page);
}

test('a watched domain browsed before the agreement leaves the store empty', async ({
  context,
  extensionId,
}) => {
  const options = await openExtensionPage(context, extensionId, 'options');
  await watchDirectly(options, WATCHED_DOMAINS_KEY, site.host);

  await site.visit(context);
  await site.visit(context);

  // The variant's host permission is required and the domain is watched, so every one of those
  // requests reached the listener. Emptiness is the consent lock and nothing else.
  expect(await captured(options)).toEqual([]);
});

test('the popup shows the gate instead of itself while the agreement is missing', async ({
  context,
  extensionId,
}) => {
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const gate = popup.getByTestId('consent-required');
  await expect(gate).toBeVisible();
  await expect(gate).toHaveAttribute('data-state', 'missing');

  // Not "hidden behind the gate" but absent: a depth button would export a window that was never
  // captured, and a scope line would announce a capture that is not happening.
  await expect(popup.getByTestId('scope-status')).toHaveCount(0);
  await expect(popup.getByTestId('export-run')).toHaveCount(0);
  await expect(popup.getByTestId('open-sidepanel')).toHaveCount(0);
  // The deep layer least of all: it asks for a permission and puts a banner on every tab of the
  // profile, and offering that before the disclosure is answered would be the gate's exact inverse.
  await expect(popup.getByTestId('deep-layer')).toHaveCount(0);

  // The header is the exception, and deliberately so: someone landing on the disclosure does not
  // yet know what this window is, which is the moment the brand and the title matter most. Its
  // settings button leads to a page that shows the very same gate, so it opens nothing early.
  await expect(popup.getByTestId('popup-header')).toContainText('Vigie');
  await expect(popup.getByTestId('open-options')).toBeVisible();
});

test('the settings show the gate instead of the domain list', async ({ context, extensionId }) => {
  const options = await openExtensionPage(context, extensionId, 'options');

  await expect(options.getByTestId('consent-required')).toBeVisible();
  await expect(options.getByTestId('add-domain-input')).toHaveCount(0);
  await expect(options.getByTestId('purge-store')).toHaveCount(0);
});

test('the consent screen names the three categories it captures', async ({
  context,
  extensionId,
}) => {
  const screen = await openExtensionPage(context, extensionId, 'consent');

  await expect(screen.getByTestId('consent-disclosure')).toBeVisible();
  await expect(screen.getByTestId('consent-promise')).toBeVisible();

  // One per capture layer. A fourth layer shipped without its paragraph fails here.
  await expect(screen.getByTestId('consent-captured')).toHaveCount(3);
  for (const category of ['network', 'console', 'error']) {
    await expect(screen.locator(`[data-testid="consent-captured"][data-category="${category}"]`))
      .toHaveCount(1);
  }

  await expect(screen.getByTestId('consent-limit')).toHaveCount(3);
  await expect(screen.getByTestId('privacy-policy-link')).toHaveAttribute(
    'href',
    /privacy-policy/,
  );
});

test('agreeing opens the surfaces and the capture starts landing', async ({
  context,
  extensionId,
}) => {
  await agree(context, extensionId);

  const popup = await openExtensionPage(context, extensionId, 'popup');
  await expect(popup.getByTestId('consent-required')).toHaveCount(0);
  await expect(popup.getByTestId('open-options')).toBeVisible();

  const options = await openExtensionPage(context, extensionId, 'options');
  await expect(options.getByTestId('options-root')).toBeVisible();
  await watch(options, site.host);

  await site.visit(context);

  await expect.poll(async () => (await captured(options)).length).toBeGreaterThan(0);
});

test('the settings state what is held: volume, oldest entry and split per domain', async ({
  context,
  extensionId,
}) => {
  await agree(context, extensionId);

  const options = await openExtensionPage(context, extensionId, 'options');
  await watch(options, site.host);

  await site.visit(context);
  await expect.poll(async () => (await captured(options)).length).toBeGreaterThan(0);

  await options.getByTestId('stored-refresh').click();

  await expect.poll(async () => Number(await options.getByTestId('stored-entries').innerText()))
    .toBeGreaterThan(0);
  // Captured moments ago, so the age reads as under a minute rather than as an empty store.
  await expect(options.getByTestId('stored-oldest')).toHaveText('less than a minute ago');

  // One row, for the one domain designated. A domain nobody watches has nothing to show here,
  // which is the scope promise made auditable rather than believed.
  const rows = options.getByTestId('stored-domain-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-domain', site.host);
});

test('erasing everything empties the store, and the capture goes on', async ({
  context,
  extensionId,
}) => {
  await agree(context, extensionId);

  const options = await openExtensionPage(context, extensionId, 'options');
  await watch(options, site.host);

  await site.visit(context);
  await expect.poll(async () => (await captured(options)).length).toBeGreaterThan(0);

  await options.getByTestId('purge-store').click();
  await expect(options.getByTestId('stored-empty')).toBeVisible();
  expect(await readCapturedEntries(options)).toEqual([]);

  // The erasure is not a stop. The domain stays watched, the agreement stands, and the next hour
  // starts from empty — which is exactly what the settings text promises.
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);
  await site.visit(context);
  await expect.poll(async () => (await captured(options)).length).toBeGreaterThan(0);
});

test('a wording newer than the one agreed to asks again', async ({ context, extensionId }) => {
  await agree(context, extensionId);

  const options = await openExtensionPage(context, extensionId, 'options');
  await expect(options.getByTestId('options-root')).toBeVisible();

  // What a shipped build does when a sentence changes: the stored agreement covers less than the
  // capture now discloses. Stated here by ageing the record rather than by rebuilding the extension.
  await storeConsentVersion(options, CONSENT_KEY, 0);

  const gate = options.getByTestId('consent-required');
  await expect(gate).toBeVisible();
  await expect(gate).toHaveAttribute('data-state', 'stale');

  const popup = await openExtensionPage(context, extensionId, 'popup');
  await expect(popup.getByTestId('consent-required')).toHaveAttribute('data-state', 'stale');

  // And the way out is the same door: agreeing to the current wording lifts it again.
  await agree(context, extensionId);
  await expect(options.getByTestId('consent-required')).toHaveCount(0);
});
