import type { BrowserContext, Page } from '@playwright/test';

import { navigateTab, openTab } from '../fixtures/browser-tabs';
import { buildVariantPath, createBuildVariant, removeBuildVariant } from '../fixtures/build-variant';
import { flushCapture, readCapturedEntries, type StoredEntry } from '../fixtures/capture-store';
import { expect, test } from '../fixtures/extension';
import { SLOW_ASSET_PATH, SLOW_PAGE_PATH, startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * Which of the two layers writes the entry, on a real browser (phase 4 of the CDP capture plan).
 *
 * The rule is substitution, decided per request at its terminal event: a request that started
 * inside a live session belongs to the deep layer and `webRequest` writes nothing for it. The two
 * layers share no request id, so what makes the count come out right is time and nothing else —
 * which is exactly what a unit test cannot state. `capture/cdp/ownership.test.ts` holds the
 * boundaries as arithmetic; this file holds them as traffic.
 *
 * Everything about how tabs are driven, and why never through Playwright, is in
 * `fixtures/browser-tabs.ts`.
 *
 * ## Why every visit carries a query
 *
 * The assertions count entries per URL, and "exactly one" is the whole point. The test site
 * propagates the query onto the sub-resource it pulls, so one navigation produces two URLs no
 * other visit in the run can produce — a count that stays a measurement rather than a sum.
 */

const CDP_BUILD = buildVariantPath('cdp-substitution');

const SESSION_KEY = 'vigie:cdp-session';

test.use({ extensionPath: CDP_BUILD });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let site: TestSite;

test.beforeAll(async () => {
  // `debugger` required rather than optional: the grant prompt is a native bubble no automation can
  // answer. `fixtures/build-variant.ts` carries the reasoning and what the swap costs.
  await createBuildVariant(CDP_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(CDP_BUILD);
});

/** The `chrome` surfaces this spec drives beyond the tabs, as `fixtures/browser-tabs.ts` explains. */
interface ChromeSurface {
  storage: { session: { get(key: string): Promise<Record<string, unknown>> } };
  debugger: { attach(target: { tabId: number }, version: string): Promise<void> };
}

async function openExtensionPage(
  context: BrowserContext,
  extensionId: string,
  name: 'popup' | 'options',
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${name}.html`);
  await expect(page.getByTestId(name === 'popup' ? 'popup-root' : 'options-root')).toBeVisible();
  return page;
}

/** Watches the test site through the settings form, which is what grants the host permission. */
async function watchTestSite(context: BrowserContext, extensionId: string): Promise<void> {
  const options = await openExtensionPage(context, extensionId, 'options');
  await options.getByTestId('add-domain-input').fill(site.host);
  await options.getByTestId('add-domain-submit').click();
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);
  await options.close();
}

/** Arms the layer the way a user does. The click carries the gesture `permissions.request` wants. */
async function armFromPopup(popup: Page): Promise<void> {
  const action = popup.getByTestId('deep-layer-action');
  await expect(action).toHaveAttribute('data-intent', 'start');
  await action.click();
  await expect(popup.getByTestId('deep-layer')).toHaveAttribute('data-state', 'active');
}

async function attachedTabs(driver: Page): Promise<number[]> {
  const attached = await driver.evaluate(async (key) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    const held = await chrome.storage.session.get(key);
    return ((held[key] as { attachedTabs?: number[] } | undefined)?.attachedTabs ?? []) as number[];
  }, SESSION_KEY);

  return [...attached].sort((left, right) => left - right);
}

function expectAttached(driver: Page, tabIds: number[]) {
  return expect
    .poll(() => attachedTabs(driver), { timeout: 20_000 })
    .toEqual([...tabIds].sort((left, right) => left - right));
}

/** Every stored entry, after the worker has been made to write what it still held. */
async function captured(page: Page): Promise<StoredEntry[]> {
  await flushCapture(page);
  return readCapturedEntries(page);
}

/** The entries stored for one exact URL. Its length is what "one request, one entry" means here. */
async function entriesFor(page: Page, url: string): Promise<StoredEntry[]> {
  return (await captured(page)).filter((entry) => entry.url === url);
}

function visit(run: string): { document: string; asset: string } {
  return { document: `${site.origin}/?run=${run}`, asset: `${site.origin}/asset.js?run=${run}` };
}

/** Sends the tab to a visit nobody else in the run produces, and waits for both its entries. */
async function browse(driver: Page, tabId: number, run: string): Promise<{ document: string; asset: string }> {
  const urls = visit(run);
  await navigateTab(driver, tabId, urls.document);
  await expect
    .poll(async () => (await entriesFor(driver, urls.document)).length, { timeout: 20_000 })
    .toBe(1);
  await expect
    .poll(async () => (await entriesFor(driver, urls.asset)).length, { timeout: 20_000 })
    .toBe(1);
  return urls;
}

test('an attached tab produces one entry per request, and the deep layer wrote all of them', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const tabId = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [tabId]);

  const urls = await browse(popup, tabId, 'attached');

  const [document] = await entriesFor(popup, urls.document);
  const [asset] = await entriesFor(popup, urls.asset);

  expect(document).toMatchObject({
    kind: 'network',
    domain: site.host,
    method: 'GET',
    outcome: 'completed',
    statusCode: 200,
    provenance: 'cdp',
  });
  expect(asset).toMatchObject({ outcome: 'completed', statusCode: 200, provenance: 'cdp' });

  // The protocol's own vocabulary, kept verbatim. `webRequest` would have said `main_frame` and
  // `script`; a mapping between the two enums would be a guess written into the data.
  expect(document?.resourceType).toBe('Document');
  expect(asset?.resourceType).toBe('Script');
});

test('a tab the browser refused keeps webRequest, while the armed layer owns the other', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  // An extension gets one session per target. Taking this one from the popup is what makes the
  // layer's own attach come back refused on that tab and succeed on the other.
  const refused = await openTab(popup, site.origin);
  const attached = await openTab(popup, site.origin);
  await popup.evaluate((tabId) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    return chrome.debugger.attach({ tabId }, '1.3');
  }, refused);

  await armFromPopup(popup);
  await expectAttached(popup, [attached]);

  const shallow = await browse(popup, refused, 'refused');
  const deep = await browse(popup, attached, 'covered');

  expect((await entriesFor(popup, shallow.document))[0]).toMatchObject({
    provenance: 'webRequest',
    responseBody: 'unavailable',
    resourceType: 'main_frame',
  });
  expect((await entriesFor(popup, deep.document))[0]).toMatchObject({ provenance: 'cdp' });
});

test('an attached tab entry carries what only the protocol sees', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const refused = await openTab(popup, site.origin);
  const attached = await openTab(popup, site.origin);
  await popup.evaluate((tabId) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    return chrome.debugger.attach({ tabId }, '1.3');
  }, refused);

  await armFromPopup(popup);
  await expectAttached(popup, [attached]);

  const shallow = await browse(popup, refused, 'headers-shallow');
  const deep = await browse(popup, attached, 'headers-deep');

  const [shallowDocument] = await entriesFor(popup, shallow.document);
  const [deepDocument] = await entriesFor(popup, deep.document);

  // The same navigation, seen twice. `requestWillBeSentExtraInfo` reports what actually went out on
  // the wire; `webRequest` reports what it was given, even with `extraHeaders` asked for.
  expect(deepDocument?.requestHeaders?.length ?? 0).toBeGreaterThan(
    shallowDocument?.requestHeaders?.length ?? 0,
  );
  expect(deepDocument?.responseHeaders?.length ?? 0).toBeGreaterThan(0);
});

/**
 * The boundary the whole design exists for.
 *
 * The document lands at once and the page holds one fetch open behind it. Stopping the layer while
 * that fetch is in flight drops the record the deep layer had started, and `webRequest` — which
 * never stopped observing — is what closes the request. The entry says so: `out-of-session` is not
 * the same absence as a tab the deep layer never covered.
 */
test('a session that closes over a request in flight hands it back whole', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const tabId = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [tabId]);

  const held = `${site.origin}${SLOW_PAGE_PATH}?ms=6000`;
  const slow = `${site.origin}${SLOW_ASSET_PATH}?ms=6000`;
  await navigateTab(popup, tabId, held);

  await popup.getByTestId('deep-layer-action').click();
  await expect(popup.getByTestId('deep-layer')).toHaveAttribute('data-state', 'stopped');

  await expect.poll(async () => (await entriesFor(popup, slow)).length, { timeout: 30_000 }).toBe(1);

  expect((await entriesFor(popup, slow))[0]).toMatchObject({
    provenance: 'webRequest',
    outcome: 'completed',
    responseBody: 'out-of-session',
  });
  // The document concluded before the stop, so it stayed the deep layer's. One request, one entry,
  // on either side of the boundary.
  expect((await entriesFor(popup, held))[0]).toMatchObject({ provenance: 'cdp' });
  expect(await entriesFor(popup, held)).toHaveLength(1);
});

/**
 * An export fired the instant traffic stops.
 *
 * Three flushes back to back, because one would only say the entry arrived eventually. What is
 * asserted is that draining the hold under that pressure neither loses an entry nor writes a second
 * one — the two failures the 50 ms delay could produce on its own.
 */
test('flushing right after the traffic neither loses an entry nor doubles one', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const tabId = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [tabId]);

  const urls = visit('drained');
  await navigateTab(popup, tabId, urls.document);
  await flushCapture(popup);
  await flushCapture(popup);
  await flushCapture(popup);

  await expect
    .poll(async () => (await entriesFor(popup, urls.document)).length, { timeout: 20_000 })
    .toBe(1);
  await expect
    .poll(async () => (await entriesFor(popup, urls.asset)).length, { timeout: 20_000 })
    .toBe(1);
});
