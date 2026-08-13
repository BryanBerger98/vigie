import type { BrowserContext, Page } from '@playwright/test';

import { navigateTab, openTab } from '../fixtures/browser-tabs';
import { buildVariantPath, createBuildVariant, removeBuildVariant } from '../fixtures/build-variant';
import { flushCapture, readCapturedEntries, type StoredEntry } from '../fixtures/capture-store';
import { expect, test } from '../fixtures/extension';
import {
  BODIES_PATH,
  BODY_STYLE_PATH,
  LARGE_BODY_PATH,
  SLOW_ASSET_PATH,
  SLOW_PAGE_PATH,
  SMALL_BODY,
  SMALL_BODY_PATH,
  startTestSite,
  type TestSite,
} from '../fixtures/test-site';

/**
 * The response bodies, on a real browser (phase 5 of the CDP capture plan).
 *
 * Reading a body is the one operation of the deep layer that cannot be deferred: it runs inside the
 * `Network.loadingFinished` handler, against a buffer the renderer empties on its own schedule. A
 * unit test can state what the filter decides and where a truncation cuts — `capture/cdp/body.test.ts`
 * does — but it cannot state that the bytes were still there when the read reached them. That is
 * what this file is for.
 *
 * Everything about how tabs are driven, and why never through Playwright, is in
 * `fixtures/browser-tabs.ts`. Every visit carries a query so a run's URLs are nobody else's.
 */

const CDP_BUILD = buildVariantPath('cdp-response-body');

const SESSION_KEY = 'vigie:cdp-session';

/** The export message, as `@vigie/contract` declares it. This workspace does not depend on it. */
const EXPORT_MESSAGE = 'vigie:export';

/** The ceiling `capture/cdp/body.ts` cuts at, restated because this workspace cannot import it. */
const BODY_CEILING_BYTES = 256 * 1024;

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
  runtime: { sendMessage(message: unknown, callback: (answer: ExportAnswer) => void): void };
}

interface ExportAnswer {
  bundle?: { gaps: { kind: string }[] };
  markdown?: string;
  error?: string;
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

/** Takes the debugger session on a tab, so the layer's own attach comes back refused on it. */
function holdDebugger(driver: Page, tabId: number): Promise<unknown> {
  return driver.evaluate((target) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    return chrome.debugger.attach({ tabId: target }, '1.3');
  }, tabId);
}

/** The entries stored for one exact URL, after the worker has written what it still held. */
async function entriesFor(page: Page, url: string): Promise<StoredEntry[]> {
  await flushCapture(page);
  return (await readCapturedEntries(page)).filter((entry) => entry.url === url);
}

async function entryFor(page: Page, url: string): Promise<StoredEntry> {
  await expect.poll(async () => (await entriesFor(page, url)).length, { timeout: 30_000 }).toBe(1);
  return (await entriesFor(page, url))[0]!;
}

/** The four URLs one visit to the bodies page produces. */
function bodyUrls(run: string): { page: string; small: string; large: string; style: string } {
  return {
    page: `${site.origin}${BODIES_PATH}?run=${run}`,
    small: `${site.origin}${SMALL_BODY_PATH}?run=${run}`,
    large: `${site.origin}${LARGE_BODY_PATH}?run=${run}`,
    style: `${site.origin}${BODY_STYLE_PATH}?run=${run}`,
  };
}

/** Sends a tab to the bodies page and waits for every one of its four requests to be on disk. */
async function browseBodies(driver: Page, tabId: number, run: string): Promise<ReturnType<typeof bodyUrls>> {
  const urls = bodyUrls(run);
  await navigateTab(driver, tabId, urls.page);
  for (const url of [urls.page, urls.small, urls.large, urls.style]) {
    await expect.poll(async () => (await entriesFor(driver, url)).length, { timeout: 30_000 }).toBe(1);
  }
  return urls;
}

/**
 * Asks the worker for a report, the way a surface does.
 *
 * Driven from an extension page rather than from the popup, so the tab under report is named
 * explicitly. What a surface does with it is covered in `popup-export.spec.ts`.
 */
function requestExport(page: Page, tabId: number): Promise<ExportAnswer> {
  return page.evaluate(
    ([type, id]) =>
      new Promise<ExportAnswer>((resolve) => {
        const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
        chrome.runtime.sendMessage({ type, tabId: id, depthMinutes: 15 }, resolve);
      }),
    [EXPORT_MESSAGE, tabId] as const,
  ) as Promise<ExportAnswer>;
}

/** The one section of a report that is about this exact URL. */
function sectionFor(markdown: string, url: string): string {
  const section = markdown.split('\n### ').find((part) => part.includes(url));
  expect(section, `the report holds no section for ${url}`).toBeDefined();
  return section!;
}

test('a resource type outside the filter keeps its entry and says the body was never asked for', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const tabId = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [tabId]);

  const urls = await browseBodies(popup, tabId, 'filtered');
  const style = await entryFor(popup, urls.style);

  // That no read was even attempted is the unit test's half — `planBodyRead` answers before any
  // command goes out. What a browser adds is that the entry survives the refusal whole.
  expect(style).toMatchObject({
    provenance: 'cdp',
    resourceType: 'Stylesheet',
    outcome: 'completed',
    statusCode: 200,
    responseBody: 'filtered',
  });
  expect(style.responseBodyText).toBeUndefined();
});

test('a JSON fetch on an attached tab arrives with its body whole', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const tabId = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [tabId]);

  const urls = await browseBodies(popup, tabId, 'whole');

  const small = await entryFor(popup, urls.small);
  expect(small).toMatchObject({ provenance: 'cdp', resourceType: 'Fetch', responseBody: 'captured' });
  // Byte for byte, not a shape: a body a report claims to hold and reformats on the way in would be
  // a body a reader cannot compare against their own logs.
  expect(small.responseBodyText).toBe(SMALL_BODY);

  // The document too — `Document` is in the filter and `text/html` is text, so the page the tab
  // navigated to carries its own source. One assertion, because it is the same code path.
  const page = await entryFor(popup, urls.page);
  expect(page.responseBody).toBe('captured');
  expect(page.responseBodyText).toContain('<title>bodies</title>');
});

test('a response past the ceiling is cut, says so, and closes on a whole element', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const tabId = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [tabId]);

  const urls = await browseBodies(popup, tabId, 'cut');
  const large = await entryFor(popup, urls.large);

  expect(large.responseBody).toBe('truncated');
  const text = large.responseBodyText ?? '';
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(BODY_CEILING_BYTES);

  // The cut landed inside a row and came back out at the row before it: closing the array is all
  // that is needed to parse what was kept, and the last row is a whole one.
  const rows = JSON.parse(`${text}]`) as { id: number; label: string }[];
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.at(-1)).toMatchObject({ id: rows.length - 1, label: `row-${rows.length - 1}` });
});

/**
 * The boundary on the opening side.
 *
 * The document lands at once and the page holds one fetch open behind it; the layer is armed while
 * that fetch is still in flight. CDP never announced the request, so it never held a record for it
 * and no body was ever reachable — but the entry is `webRequest`'s and complete. What it must not
 * say is `unavailable`: on this tab every neighbouring request carries a body, and a bare "no
 * response body" would read as a rendering that dropped one.
 */
test('a request already in flight when the session opens keeps everything but its body', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const tabId = await openTab(popup, site.origin);
  const held = `${site.origin}${SLOW_PAGE_PATH}?ms=12000`;
  const slow = `${site.origin}${SLOW_ASSET_PATH}?ms=12000`;
  await navigateTab(popup, tabId, held);

  await armFromPopup(popup);
  await expectAttached(popup, [tabId]);

  const straddling = await entryFor(popup, slow);
  expect(straddling).toMatchObject({
    kind: 'network',
    provenance: 'webRequest',
    outcome: 'completed',
    statusCode: 200,
    responseBody: 'out-of-session',
  });
  expect(straddling.responseBodyText).toBeUndefined();
});

test('the missing-bodies gap is declared per tab, not per report version', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const refused = await openTab(popup, site.origin);
  const attached = await openTab(popup, site.origin);
  await holdDebugger(popup, refused);

  await armFromPopup(popup);
  await expectAttached(popup, [attached]);

  await browseBodies(popup, refused, 'gap-shallow');
  await browseBodies(popup, attached, 'gap-deep');

  const shallow = await requestExport(popup, refused);
  const deep = await requestExport(popup, attached);

  expect(shallow.bundle?.gaps.map((gap) => gap.kind)).toContain('response-bodies-unavailable');
  expect(deep.bundle?.gaps.map((gap) => gap.kind)).not.toContain('response-bodies-unavailable');
  // The one gap that holds whatever the capture observed stays on both.
  expect(deep.bundle?.gaps.map((gap) => gap.kind)).toContain('browser-messages-out-of-reach');
});

test('a section shows the body it holds folded, and states the cause of the one it does not', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const tabId = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [tabId]);

  const urls = await browseBodies(popup, tabId, 'render');
  const markdown = (await requestExport(popup, tabId)).markdown ?? '';

  const small = sectionFor(markdown, urls.small);
  expect(small).toContain('response body captured');
  expect(small).toContain('<summary>Response body</summary>');
  // Reindented, which is the one reformatting the renderer allows itself on a payload that parses.
  expect(small).toContain(JSON.stringify(JSON.parse(SMALL_BODY) as unknown, null, 2));

  const style = sectionFor(markdown, urls.style);
  expect(style).toContain('response body not requested');
  expect(style).not.toContain('<summary>Response body');

  const large = sectionFor(markdown, urls.large);
  expect(large).toContain('response body truncated');
  // Named as a cut, never as a malformation: the body does not parse because the capture cut it.
  expect(large).toContain('<summary>Response body — cut at the capture ceiling</summary>');
  expect(large).not.toContain('malformed JSON');
});
