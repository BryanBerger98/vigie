import type { BrowserContext, Page } from '@playwright/test';

import {
  buildVariantPath,
  createBuildVariant,
  removeBuildVariant,
} from '../fixtures/build-variant';
import { flushCapture, readCapturedEntries, seedCapturedEntry } from '../fixtures/capture-store';
import { expect, test } from '../fixtures/extension';
import { FAILING_PATH, startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The network capture, end to end: what a real visit puts on disk, and what never gets there.
 *
 * The assertions read IndexedDB rather than the worker's own counters. What a report is cut from
 * is what landed, and the phase-2 measurement counters — still in the popup, replaced in phase 8 —
 * only say that a listener fired.
 *
 * Same shared build variant as the other suites: the host permission is required rather than
 * optional, so adding a domain grants it without a prompt. Nothing here depends on that beyond
 * getting the traffic delivered.
 */

const CAPTURE_BUILD = buildVariantPath('network-capture');

test.use({ extensionPath: CAPTURE_BUILD });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(CAPTURE_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(CAPTURE_BUILD);
});

async function openOptions(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByTestId('options-root')).toBeVisible();
  return page;
}

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

test('a visit to a watched domain lands in the store', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  await site.visit(context);

  await expect.poll(async () => (await captured(options)).length).toBeGreaterThan(0);

  const entries = await captured(options);
  const document = entries.find((entry) => entry.url === `${site.origin}/`);
  const asset = entries.find((entry) => entry.url === `${site.origin}/asset.js`);

  // One visit, two requests: the page and the script it pulls. Finding only one would mean the
  // listener fired rather than that the capture works.
  expect(document).toBeDefined();
  expect(asset).toBeDefined();

  expect(document).toMatchObject({
    kind: 'network',
    domain: site.host,
    method: 'GET',
    outcome: 'completed',
    statusCode: 200,
    // Stated, never omitted: `webRequest` exposes no response body in any Chrome version.
    responseBody: 'unavailable',
  });
  expect(document?.tabId).toBeGreaterThanOrEqual(0);
});

test('the request and response headers are captured, cookies included', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  await site.visit(context);
  await expect.poll(async () => (await captured(options)).length).toBeGreaterThan(0);

  const entries = await captured(options);
  const document = entries.find((entry) => entry.url === `${site.origin}/`);

  expect(document?.requestHeaders?.length).toBeGreaterThan(0);
  expect(document?.responseHeaders?.map((header) => header.name.toLowerCase())).toContain(
    'content-type',
  );
});

test('a request the server drops is stored as a failure, not lost', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  await site.visitFailing(context);

  await expect
    .poll(async () => (await captured(options)).filter((entry) => entry.outcome === 'failed').length)
    .toBeGreaterThan(0);

  const failure = (await captured(options)).find((entry) => entry.outcome === 'failed');

  expect(failure).toMatchObject({ url: `${site.origin}${FAILING_PATH}`, domain: site.host });
  expect(failure?.error).toMatch(/^net::ERR_/);
  expect(failure?.statusCode).toBeUndefined();
});

test('entries are stored in the order the requests happened', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  await site.visit(context);
  await expect.poll(async () => (await captured(options)).length).toBeGreaterThanOrEqual(2);
  await site.visit(context);
  await expect.poll(async () => (await captured(options)).length).toBeGreaterThanOrEqual(4);

  const timestamps = (await captured(options)).map((entry) => entry.timestamp);

  expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
});

test('a domain nobody watches leaves the store empty', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);

  await site.visit(context);
  await site.visit(context);

  // The build variant's host permission is required, so the browser delivered every one of those
  // requests to the listener. Emptiness here is the scope filter refusing them, not a silent browser.
  await expect(options.getByTestId('watched-domains-empty')).toBeVisible();
  expect(await captured(options)).toEqual([]);
});

test('an entry older than the rolling hour is gone at the next write', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  await site.visit(context);
  await expect.poll(async () => (await captured(options)).length).toBeGreaterThan(0);

  await seedCapturedEntry(options, {
    kind: 'network',
    timestamp: Date.now() - 61 * 60_000,
    tabId: 1,
    domain: site.host,
    requestId: 'seeded-old',
    method: 'GET',
    url: `${site.origin}/ancient`,
    outcome: 'completed',
    statusCode: 200,
    responseBody: 'unavailable',
  });

  expect((await readCapturedEntries(options)).some((entry) => entry.url?.endsWith('/ancient'))).toBe(
    true,
  );

  await site.visit(context);

  await expect
    .poll(async () => (await captured(options)).some((entry) => entry.url?.endsWith('/ancient')))
    .toBe(false);
  // Only the old one goes: the purge is a window, not a reset.
  expect((await captured(options)).length).toBeGreaterThan(0);
});

/**
 * The plan's "service worker terminé" scenario has no test here, for the reason recorded as gap G2
 * in `measure-permissions.md`: Chrome keeps an extension service worker alive as long as a debugger
 * is attached, and Playwright attaches to every worker target it opens. Three ways of forcing the
 * stop were measured in phase 2 and none worked. The scenario stays in phase 11's manual recipe.
 *
 * What the code does about it is stated rather than tested: the four `addListener` calls sit at the
 * top level of `background.ts`, which is what makes Chrome restart the worker on the next matching
 * request, and the batch delay is 250 ms so that little can be in flight when it does stop.
 */

test('removing a domain erases what was captured for it', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  await site.visit(context);
  await expect.poll(async () => (await captured(options)).length).toBeGreaterThan(0);

  await options.getByTestId('watched-domain-remove').click();
  await options.getByTestId('remove-confirm').click();
  await expect(options.getByTestId('watched-domains-empty')).toBeVisible();

  await expect.poll(async () => (await captured(options)).length).toBe(0);
});
