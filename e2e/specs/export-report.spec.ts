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
 * Driven from an extension page rather than from the popup, so the tab under report is named
 * explicitly and nothing here depends on how a surface resolves it. That resolution and the click
 * path are covered in `popup-export.spec.ts`; this file is about what the worker cuts.
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
  entry: {
    tabId: number;
    timestamp: number;
    url: string;
    statusCode?: number;
    requestHeaders?: { name: string; value: string }[];
  },
): Promise<void> {
  return seedCapturedEntry(page, {
    kind: 'network',
    domain: site.host,
    requestId: `seed-${entry.timestamp}-${entry.tabId}`,
    method: 'GET',
    outcome: 'completed',
    statusCode: 200,
    resourceType: 'xmlhttprequest',
    provenance: 'webRequest',
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

/**
 * The instants of the timeline, in the order a reader meets them.
 *
 * One per entry, taken from the quoted meta block that opens each section rather than from any line
 * that happens to hold a date — a captured body carrying a timestamp of its own must not enter the
 * count. Anchoring on the heading above it is what makes that distinction: the block scanned is the
 * one that follows a `###` and stops at the first line that is no longer quoted.
 */
function timelineStamps(markdown: string): number[] {
  const lines = markdown.split('\n');
  const stamps: number[] = [];

  lines.forEach((line, index) => {
    if (!line.startsWith('### ')) return;

    const quoted = lines.slice(index + 1, index + 5).filter((below) => below.startsWith('> '));
    const match = /🕑 `(\d{4}-\d{2}-\d{2}T[\d:.]+Z)`/.exec(quoted.join('\n'));
    if (match) stamps.push(Date.parse(match[1]!));
  });

  return stamps;
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
  expect(markdown).toContain(`tab ${tabId} |`);
  expect(markdown).toContain(`| **URL** | ${site.origin}/noisy |`);
  expect(markdown).toContain('min covered of 15 requested');
  // Framing, then what is missing, then the body. A reader has to know the scope before reading a
  // line of it, and know what cannot be seen before concluding from an absence
  // (`spec-export-redesign.md:21`).
  expect(markdown!.indexOf('| **URL** |')).toBeLessThan(
    markdown!.indexOf('## What this report cannot show'),
  );
  expect(markdown!.indexOf('## What this report cannot show')).toBeLessThan(
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
  // from the entries is an absence a reader stops seeing (`prd.md:79`). It rides the meta line the
  // request already had rather than a paragraph of its own — stated is the requirement, repeated
  // as a sentence three hundred times is not.
  expect(markdown!.split('· no response body').length - 1).toBe(requests);
  // Declared, because this build never arms the deep layer. A report cut from a tab it covered
  // does not carry it — `cdp-response-body.spec.ts` states that side.
  expect(markdown).toContain('Response bodies are not included:');
});

test('marks what went wrong so a reader reaches it without reading the thread', async ({
  context,
  extensionId,
}) => {
  const { options, tabId } = await watchedTab(context, extensionId);

  await seedRequest(options, {
    tabId,
    timestamp: Date.now() - MINUTE,
    url: `${site.origin}/the-one-that-broke`,
    statusCode: 500,
  });

  const { markdown } = await requestExport(options, tabId, 15);

  const titles = markdown!.split('\n').filter((line) => line.startsWith('### '));
  const marked = titles.filter((line) => line.startsWith('### 🛑 '));

  expect(marked.some((title) => title.includes('/the-one-that-broke'))).toBe(true);
  // The framing and the timeline are two readings of one judgement. They have to agree, or the
  // count a reader trusts sends them looking for an entry that carries no marker.
  expect(markdown).toContain(`**${marked.length} anomalies** in `);
  expect(markdown).toContain('Search `🛑` to reach them.');
  // And not everything is marked: the page's own healthy traffic stays unmarked, without which the
  // marker would single out nothing.
  expect(marked.length).toBeLessThan(titles.length);
});

test('folds the headers for an eye, never for whatever parses the report', async ({
  context,
  extensionId,
}) => {
  const { options, tabId } = await watchedTab(context, extensionId);

  await seedRequest(options, {
    tabId,
    timestamp: Date.now() - MINUTE,
    url: `${site.origin}/with-headers`,
    requestHeaders: [{ name: 'x-vigie-probe', value: 'folded-but-present' }],
  });

  const { markdown } = await requestExport(options, tabId, 15);

  const probe = markdown!.indexOf('x-vigie-probe: folded-but-present');
  expect(probe).toBeGreaterThan(-1);

  // Read with nothing expanded: the header sits inside a `<details>`, and the whole block is in the
  // raw text of the report. Folding is a courtesy to a human reader and costs an automatic one
  // nothing (`spec-export-redesign.md:65`).
  const opening = markdown!.lastIndexOf('<details><summary>Request headers (', probe);
  expect(opening).toBeGreaterThan(-1);
  expect(markdown!.slice(opening, markdown!.indexOf('</details>', probe))).toContain('```http');
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

  expect(markdown).toMatch(/20(\.\d)? min covered of 60 requested/);
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
