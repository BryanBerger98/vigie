import type { BrowserContext, Page } from '@playwright/test';

import {
  buildVariantPath,
  createBuildVariant,
  openSiteAccessControl,
  removeBuildVariant,
  setHostAccess,
} from '../fixtures/build-variant';
import { expect, test } from '../fixtures/extension';
import { startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The watched domain list, end to end: what the settings screen writes, what the browser grants,
 * and what the background actually counts as in scope (phase 3 of the extension-scope plan).
 *
 * It runs on the shared build variant, whose host permission is required rather than optional.
 * That has one effect worth naming here: `permissions.request()` resolves `true` without a prompt,
 * because the origin is already granted. So this suite exercises the *granted* branch of the add
 * flow; the refusal branch is covered by `watched-domains.test.ts`, where the browser's answer can
 * be dictated, and by the manual recipe in phase 11.
 */

const WATCHED_BUILD = buildVariantPath('watched-domains');

test.use({ extensionPath: WATCHED_BUILD });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(WATCHED_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(WATCHED_BUILD);
});

async function openOptions(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByTestId('options-root')).toBeVisible();
  return page;
}

/** Adds a domain through the form, the way a user does — the click carries the user gesture. */
async function addDomain(options: Page, input: string): Promise<void> {
  await options.getByTestId('add-domain-input').fill(input);
  await options.getByTestId('add-domain-submit').click();
}

const MEASUREMENT_STATE_KEY = 'vigie:measurement';

/** The slice of the background's measurement state this spec reads back. */
interface MeasurementState {
  networkEvents: number;
  watchedEvents: number;
  permissionChanges: { change: 'added' | 'removed'; origins: string[] }[];
}

/** The `chrome` surface this spec drives from inside the browser. */
interface ChromeSurface {
  storage: { session: { get(key: string): Promise<Record<string, unknown>> } };
}

const NO_MEASUREMENT: MeasurementState = {
  networkEvents: 0,
  watchedEvents: 0,
  permissionChanges: [],
};

/**
 * The worker's counters, read from `chrome.storage.session` through an extension page.
 *
 * The popup used to print them and no longer does — it carries the export gesture and nothing
 * else. The probe itself survives: what this suite needs is the count the background keeps, not
 * the readout that displayed it. An extension page is the only place the session store is
 * reachable from; the worker target is off limits, since attaching to it keeps it alive.
 */
async function readMeasurement(
  context: BrowserContext,
  extensionId: string,
): Promise<MeasurementState> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const state = await page.evaluate(async (key) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    const stored = await chrome.storage.session.get(key);
    return stored[key];
  }, MEASUREMENT_STATE_KEY);
  await page.close();
  return (state as MeasurementState | undefined) ?? NO_MEASUREMENT;
}

function counters(context: BrowserContext, extensionId: string) {
  const read = (field: 'watchedEvents' | 'networkEvents') => async () =>
    (await readMeasurement(context, extensionId))[field];
  return { watched: read('watchedEvents'), network: read('networkEvents') };
}

test('a fresh profile watches nothing', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);

  await expect(options.getByTestId('watched-domains-empty')).toBeVisible();
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(0);
});

test('a granted domain appears in the list with its access', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);

  await addDomain(options, site.host);

  const row = options.getByTestId('watched-domain-row');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-domain', site.host);
  await expect(options.getByTestId('watched-domain-permission')).toHaveAttribute(
    'data-granted',
    'true',
  );
  await expect(options.getByTestId('add-domain-error')).toHaveCount(0);
});

test('an input that is not a domain is refused without reaching the browser', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);

  await addDomain(options, 'not a domain');

  await expect(options.getByTestId('add-domain-error')).toBeVisible();
  await expect(options.getByTestId('watched-domains-empty')).toBeVisible();
  // The input keeps what was typed: the user has a typo to fix, not a field to retype.
  await expect(options.getByTestId('add-domain-input')).toHaveValue('not a domain');

  // Nothing was asked of the browser, so the background recorded no permission change.
  expect((await readMeasurement(context, extensionId)).permissionChanges).toHaveLength(0);
});

test('a domain added starts being captured without restarting the browser', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  const { watched, network } = counters(context, extensionId);

  // Browsing before the domain is watched: the browser delivers the events, the scope rejects them.
  await site.visit(context);
  await expect.poll(network).toBeGreaterThan(0);
  expect(await watched()).toBe(0);

  await addDomain(options, site.host);
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);

  await site.visit(context);

  await expect.poll(watched).toBeGreaterThan(0);
});

test('a domain removed stops being captured immediately', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  const { watched, network } = counters(context, extensionId);

  await addDomain(options, site.host);
  await site.visit(context);
  await expect.poll(watched).toBeGreaterThan(0);

  // The removal announces what it destroys before doing it, and waits for a second click.
  await options.getByTestId('watched-domain-remove').click();
  await expect(options.getByTestId('remove-warning')).toBeVisible();
  await expect(options.getByTestId('remove-warning')).toContainText('cannot be undone');
  const capturedBefore = await watched();
  await options.getByTestId('remove-confirm').click();
  await expect(options.getByTestId('watched-domains-empty')).toBeVisible();

  const deliveredBefore = await network();
  await site.visit(context);

  // The browser keeps delivering — this build's host permission is required and cannot be given
  // back — so `networkEvents` still moves. That is what makes the assertion meaningful: the scope
  // is what stopped the capture, not the absence of traffic.
  await expect.poll(network).toBeGreaterThan(deliveredBefore);
  expect(await watched()).toBe(capturedBefore);
});

test('access revoked from Chrome settings reads as missing without restarting the extension', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await addDomain(options, site.host);

  const permission = options.getByTestId('watched-domain-permission');
  await expect(permission).toHaveAttribute('data-granted', 'true');

  const control = await openSiteAccessControl(context, extensionId);
  expect(await setHostAccess(control, extensionId, 'ON_CLICK')).toBe('ok');

  // The options page was never reloaded: `permissions.onRemoved` is what updates the row.
  await expect(permission).toHaveAttribute('data-granted', 'false');
  await expect(permission).toContainText('Access missing');
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);
});
