import type { BrowserContext, Page } from '@playwright/test';

import {
  buildVariantPath,
  createBuildVariant,
  removeBuildVariant,
} from '../fixtures/build-variant';
import { flushCapture, readCapturedEntries, seedCapturedEntry } from '../fixtures/capture-store';
import { expect, test } from '../fixtures/extension';
import { startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The report, cut in a real browser from what a real capture wrote.
 *
 * The rendering itself is locked on snapshots in `markdown.test.ts`; nothing here re-asserts a
 * format. What only a browser can state is upstream of it: that the window is cut on the tab the
 * user is looking at, that the freeze holds against traffic still arriving, and that the entries
 * reaching the report are the ones the capture actually put on disk — not the ones a fixture put
 * there. The two are different claims, and only the second one is the product.
 *
 * A past the run cannot live through is seeded straight into the store. Ninety minutes of real
 * navigation is not something a suite can wait for, and the depth ceiling is only observable
 * against entries older than it.
 */

const EXPORT_BUILD = buildVariantPath('export-report');

test.use({ extensionPath: EXPORT_BUILD });
test.setTimeout(90_000);

const MINUTE = 60_000;

/** The export message, as `@vigie/contract` declares it. This workspace does not depend on it. */
const EXPORT_MESSAGE = 'vigie:export';

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(EXPORT_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(EXPORT_BUILD);
});

interface ExportAnswer {
  bundle?: {
    window: { frozenAt: number; from: number; to: number; coveredDepthMinutes: number };
    subject: { domain: string; tabId: number; url: string };
    entries: { kind: string; timestamp: number }[];
  };
  markdown?: string;
  error?: string;
}

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

/**
 * Asks the worker for a report, the way a surface does.
 *
 * Driven from an extension page rather than from the popup: the popup exports whatever tab is
 * active, and under Playwright the popup *is* the active tab. The tab under report is therefore
 * named explicitly, which is also the only shape the side panel of phase 10 can use.
 */
function requestExport(page: Page, tabId: number, depthMinutes: number): Promise<ExportAnswer> {
  return page.evaluate(
    ([type, id, depth]) =>
      new Promise<ExportAnswer>((resolve) => {
        const { chrome } = globalThis as unknown as {
          chrome: {
            runtime: {
              sendMessage(message: unknown, callback: (answer: ExportAnswer) => void): void;
            };
          };
        };
        chrome.runtime.sendMessage({ type, tabId: id, depthMinutes: depth }, resolve);
      }),
    [EXPORT_MESSAGE, tabId, depthMinutes] as const,
  ) as Promise<ExportAnswer>;
}

/** The id Chrome gave the tab sitting on `url`. Read through `tabs`, never guessed. */
function tabIdFor(page: Page, url: string): Promise<number> {
  return page.evaluate(
    (target) =>
      new Promise<number>((resolve, reject) => {
        const { chrome } = globalThis as unknown as {
          chrome: { tabs: { query(query: object, callback: (tabs: Tab[]) => void): void } };
        };
        interface Tab {
          id?: number;
          url?: string;
        }
        chrome.tabs.query({}, (tabs) => {
          const match = tabs.find((tab) => tab.url?.startsWith(target));
          if (match?.id === undefined) reject(new Error(`no tab on ${target}`));
          else resolve(match.id);
        });
      }),
    url,
  );
}

async function capturedCount(page: Page): Promise<number> {
  return (await readCapturedEntries(page)).length;
}

/** A network entry as the capture writes them, placed at a chosen point in the past. */
function seedRequest(
  page: Page,
  entry: { tabId: number; timestamp: number; url: string },
): Promise<void> {
  return seedCapturedEntry(page, {
    kind: 'network',
    domain: site.host,
    requestId: `seed-${entry.timestamp}-${entry.tabId}`,
    method: 'GET',
    outcome: 'completed',
    statusCode: 200,
    resourceType: 'xmlhttprequest',
    responseBody: 'unavailable',
    ...entry,
  });
}

/**
 * A watched site, captured for real, with the tab left open — a report is about a live tab and
 * `tabs.get` refuses a closed one.
 */
async function watchedTab(
  context: BrowserContext,
  extensionId: string,
): Promise<{ options: Page; noisy: Page; tabId: number }> {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  await expect.poll(() => capturedCount(options), { timeout: 20_000 }).toBeGreaterThan(0);

  return { options, noisy, tabId: await tabIdFor(options, `${site.origin}/noisy`) };
}

/** The entry lines of the timeline: everything that opens on a timestamp. */
function timelineStamps(markdown: string): number[] {
  return markdown
    .split('\n')
    .filter((line) => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z {2}/.test(line))
    .map((line) => Date.parse(line.slice(0, line.indexOf('Z') + 1)));
}

test('cuts the window on the depth asked for, and never past the hour', async ({
  context,
  extensionId,
}) => {
  const { options, tabId } = await watchedTab(context, extensionId);
  const now = Date.now();

  await seedRequest(options, {
    tabId,
    timestamp: now - 90 * MINUTE,
    url: `${site.origin}/ninety-minutes-ago`,
  });
  await seedRequest(options, {
    tabId,
    timestamp: now - 30 * MINUTE,
    url: `${site.origin}/thirty-minutes-ago`,
  });

  const fifteen = await requestExport(options, tabId, 15);
  expect(fifteen.markdown).not.toContain('/thirty-minutes-ago');
  expect(fifteen.markdown).not.toContain('/ninety-minutes-ago');

  // The ceiling is the whole point of the second request: sixty minutes is the deepest window
  // the product offers, and ninety minutes of store must not widen it (`spec.md:12`).
  const sixty = await requestExport(options, tabId, 60);
  expect(sixty.markdown).toContain('/thirty-minutes-ago');
  expect(sixty.markdown).not.toContain('/ninety-minutes-ago');
  expect(sixty.bundle!.window.to - sixty.bundle!.window.from).toBe(60 * MINUTE);
});

test('opens on the window, the domain and the tab it reports', async ({ context, extensionId }) => {
  const { options, tabId } = await watchedTab(context, extensionId);

  const { markdown } = await requestExport(options, tabId, 15);

  expect(markdown).toContain(`# Vigie report — ${site.host}`);
  expect(markdown).toContain(`Subject: ${site.host}, tab ${tabId}`);
  expect(markdown).toContain(`URL: ${site.origin}/noisy`);
  expect(markdown).toContain('Window: 15 min requested,');
  // The gaps come before the body, so a reader knows what is missing before concluding from it.
  expect(markdown!.indexOf('## What this report does not contain')).toBeLessThan(
    markdown!.indexOf('## Timeline'),
  );
});

test('runs network and console in one ascending thread', async ({ context, extensionId }) => {
  const { options, tabId } = await watchedTab(context, extensionId);

  // The noisy page logs while loading and throws a turn later, so the tab produces all three
  // kinds. Waiting on the console ones matters: they travel through the relay, not `webRequest`.
  await expect
    .poll(
      async () => new Set((await readCapturedEntries(options)).map((entry) => entry.kind)).size,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(1);

  const { bundle, markdown } = await requestExport(options, tabId, 15);

  const kinds = new Set(bundle!.entries.map((entry) => entry.kind));
  expect(kinds.has('network')).toBe(true);
  expect(kinds.size).toBeGreaterThan(1);

  const stamps = timelineStamps(markdown!);
  expect(stamps.length).toBe(bundle!.entries.length);
  expect([...stamps]).toEqual([...stamps].sort((a, b) => a - b));
});

test('holds nothing from another tab', async ({ context, extensionId }) => {
  const { options, tabId } = await watchedTab(context, extensionId);

  // A neighbouring tab, seeded rather than browsed: two tabs on the same site request the same
  // URLs, and an assertion on a URL both of them fetched would prove nothing.
  await seedRequest(options, {
    tabId: tabId + 1_000,
    timestamp: Date.now() - MINUTE,
    url: `${site.origin}/the-other-tab`,
  });

  const { bundle, markdown } = await requestExport(options, tabId, 15);

  expect(markdown).not.toContain('/the-other-tab');
  expect(bundle!.entries.length).toBeGreaterThan(0);
});

test('says outright when the window holds nothing', async ({ context, extensionId }) => {
  // Nothing is watched here, so the visit is not captured at all: an empty window is exactly the
  // state a user reaches by exporting before designating the domain.
  const options = await openOptions(context, extensionId);
  const page = await context.newPage();
  await page.goto(`${site.origin}/noisy`, { waitUntil: 'load' });

  const tabId = await tabIdFor(options, `${site.origin}/noisy`);
  const { bundle, markdown } = await requestExport(options, tabId, 15);

  expect(bundle!.entries).toHaveLength(0);
  expect(markdown).toContain('No entry was captured in this window.');
  // The subject still has to be named, or the report reads as a failure rather than as an answer.
  expect(markdown).toContain(`# Vigie report — ${site.host}`);
});

test('writes the unavailability of every response body', async ({ context, extensionId }) => {
  const { options, tabId } = await watchedTab(context, extensionId);

  const { bundle, markdown } = await requestExport(options, tabId, 15);

  const requests = bundle!.entries.filter((entry) => entry.kind === 'network').length;
  expect(requests).toBeGreaterThan(0);
  // Once per request, never once per report: an absence stated in the header and then omitted
  // from the entries is an absence a reader stops seeing (`prd.md:79`).
  expect(markdown!.split('response body: not available').length - 1).toBe(requests);
  expect(markdown).toContain('Response bodies are not included.');
});

test('announces the depth the capture reaches, not the one asked for', async ({
  context,
  extensionId,
}) => {
  const { options, tabId } = await watchedTab(context, extensionId);

  await seedRequest(options, {
    tabId,
    timestamp: Date.now() - 20 * MINUTE,
    url: `${site.origin}/twenty-minutes-ago`,
  });

  const { markdown } = await requestExport(options, tabId, 60);

  expect(markdown).toMatch(/Window: 60 min requested, 20(\.\d)? min covered/);
  expect(markdown).toContain('/twenty-minutes-ago');
});

test('leaves out the traffic that followed the click', async ({ context, extensionId }) => {
  const { options, noisy, tabId } = await watchedTab(context, extensionId);

  const { bundle, markdown } = await requestExport(options, tabId, 15);

  // Emitted strictly after the report came back, so its stamp is necessarily past the freeze.
  await noisy.evaluate(() => fetch('/after-the-click?x=1').then((response) => response.text()));
  await flushCapture(options);

  const later = (await readCapturedEntries(options)).filter((entry) =>
    entry.url?.includes('after-the-click'),
  );

  expect(later.length).toBeGreaterThan(0);
  expect(later.every((entry) => entry.timestamp > bundle!.window.frozenAt)).toBe(true);
  expect(markdown).not.toContain('after-the-click');
});

/**
 * The copy, from the popup, on a real click.
 *
 * Asserted through what the popup displays rather than by reading the clipboard back: CDP refuses
 * to grant clipboard permissions to a `chrome-extension://` origin ("Permission can't be granted
 * to opaque origins"), so no page of the suite can read what was written. The displayed outcome is
 * still evidence — the popup only shows a success once `writeText` has resolved, and the failure
 * branch below proves it is not printing that unconditionally.
 *
 * The report itself is about whichever tab is active, and under Playwright that is the popup's own
 * tab. Its contents are therefore not the point here; the copy path is.
 */
async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByTestId('popup-root')).toBeVisible();
  return page;
}

test('reaches the clipboard from a click in the popup', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);

  await popup.getByTestId('export-15').click();

  await expect(popup.getByTestId('export-status')).toContainText('Copied', { timeout: 15_000 });
});

test('shows a refused clipboard rather than letting it pass for a copy', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);

  // The refusal a locked-down policy or a lost user activation produces, stated to the page.
  await popup.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('clipboard blocked by policy'));
  });

  await popup.getByTestId('export-15').click();

  await expect(popup.getByTestId('export-status')).toContainText(
    'Report ready but not copied: clipboard blocked by policy',
    { timeout: 15_000 },
  );
});
