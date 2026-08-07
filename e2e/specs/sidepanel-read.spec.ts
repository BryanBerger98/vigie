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
 * The side panel, read against a real capture.
 *
 * ## Why it is driven as an ordinary tab
 *
 * Chrome's side panel is browser chrome: `sidePanel.open` needs a real user gesture on the toolbar,
 * and what it opens is never exposed to Playwright as a page. So the panel is loaded here the way
 * the popup already is — `sidepanel.html` in a tab of the extension's own origin. Everything the
 * phase claims about the surface is a claim about that document: which tab it resolves, what it
 * renders, and what it does *not* write. That the popup offers the exit at all is asserted in
 * `popup-export.spec.ts`.
 *
 * The consequence is the same fallback the popup runs under: the active tab is the panel itself, so
 * the subject is the most recently accessed web tab of the window (`popup/subject-tab.ts:51`).
 * Bringing a site tab to the front is therefore a real subject switch, and it is how the tab-change
 * criterion is exercised.
 *
 * ## Nothing here asks the worker to flush
 *
 * A flush appends the pending batch and prunes, which is a write. The suite uses it only to set a
 * scene up — never between opening the panel and asserting on it, because the whole point of the
 * read-only test would then be measuring the fixture instead of the surface.
 */

const PANEL_BUILD = buildVariantPath('sidepanel-read');

test.use({ extensionPath: PANEL_BUILD });
test.setTimeout(90_000);

const HOUR = 60 * 60_000;

/** The export message, as `@vigie/contract` declares it. This workspace does not depend on it. */
const EXPORT_MESSAGE = 'vigie:export';

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(PANEL_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(PANEL_BUILD);
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

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByTestId('sidepanel-root')).toBeVisible();
  return page;
}

/** Every summary line of the thread, concatenated. What a reader sees without unfolding anything. */
async function threadText(panel: Page): Promise<string> {
  return (await panel.getByTestId('entry-summary').allTextContents()).join('\n');
}

/** The rendered thread as `timestamp:kind`, in the order the rows are laid out. */
function threadOrder(panel: Page): Promise<string[]> {
  return panel
    .getByTestId('entry-row')
    .evaluateAll((rows) =>
      rows.map((row) => `${row.getAttribute('data-at')}:${row.getAttribute('data-kind')}`),
    );
}

interface ExportAnswer {
  bundle?: { entries: { kind: string; timestamp: number }[] };
  error?: string;
}

/** Asks the worker for the report the panel is supposed to agree with. */
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

/**
 * A watched site with traffic on disk and the panel opened over it.
 *
 * The noisy page is used because it produces all three kinds — requests, console lines and an
 * uncaught error — which is what makes "one thread, every kind interleaved" an observation rather
 * than a hope.
 */
async function capturingPanel(
  context: BrowserContext,
  extensionId: string,
): Promise<{ options: Page; noisy: Page; panel: Page }> {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  await expect
    .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  const panel = await openPanel(context, extensionId);
  await expect(panel.getByTestId('scope-status')).toHaveAttribute('data-state', 'capturing');
  await expect.poll(() => panel.getByTestId('entry-row').count(), { timeout: 20_000 }).toBeGreaterThan(0);

  return { options, noisy, panel };
}

test('follows the active tab, and switching tab switches the thread', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  // Two tabs on the same watched host, at addresses that tell them apart. The sub-resource they
  // both pull is identical, so the document URL is the only honest discriminator.
  const first = await context.newPage();
  await first.goto(`${site.origin}/one`, { waitUntil: 'load' });
  const second = await context.newPage();
  await second.goto(`${site.origin}/two`, { waitUntil: 'load' });

  await expect
    .poll(
      async () => {
        const urls = (await readCapturedEntries(options)).map((entry) => entry.url ?? '');
        return urls.some((url) => url.endsWith('/one')) && urls.some((url) => url.endsWith('/two'));
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // Opened last, so the most recently accessed web tab is `/two` and that is the thread it lands on.
  const panel = await openPanel(context, extensionId);
  await expect.poll(() => threadText(panel), { timeout: 20_000 }).toContain(`${site.origin}/two`);
  expect(await threadText(panel)).not.toContain(`${site.origin}/one`);

  // The switch itself. No reload of the panel: `tabs.onActivated` is what re-resolves the subject.
  await first.bringToFront();

  await expect.poll(() => threadText(panel), { timeout: 20_000 }).toContain(`${site.origin}/one`);
  expect(await threadText(panel)).not.toContain(`${site.origin}/two`);
});

test('a tab outside the scope announces the absence of capture instead of an empty thread', async ({
  context,
  extensionId,
}) => {
  const { panel } = await capturingPanel(context, extensionId);

  // The same server under a hostname nobody watches. Whether it answers is irrelevant — what the
  // scope is read from is the tab's address, and a failed load leaves the tab on it either way.
  const stray = await context.newPage();
  await stray
    .goto(site.origin.replace('127.0.0.1', 'localhost'), { waitUntil: 'load' })
    .catch(() => undefined);
  await stray.bringToFront();

  await expect(panel.getByTestId('scope-status')).toHaveAttribute('data-state', 'out-of-scope', {
    timeout: 20_000,
  });
  await expect(panel.getByTestId('scope-detail')).toContainText('localhost');

  // "au lieu d'un fil vide": no thread, and no empty-thread wording either. An empty list here
  // would read as "this tab did nothing", when the truth is that nothing was ever recorded.
  await expect(panel.getByTestId('timeline')).toHaveCount(0);
  await expect(panel.getByTestId('timeline-empty')).toHaveCount(0);
  await expect(panel.getByTestId('scope-watch-domain')).toContainText('localhost');
});

test('a request emitted while the panel is open lands in the thread without a reload', async ({
  context,
  extensionId,
}) => {
  const { noisy, panel } = await capturingPanel(context, extensionId);

  // Emitted by the page, after the panel has rendered its thread. Nothing tells the panel about it:
  // Dexie's own cross-context signal is the only path between the worker's write and this document.
  await noisy.evaluate(() => fetch('/live-probe?x=1').then((response) => response.text()));

  await expect.poll(() => threadText(panel), { timeout: 20_000 }).toContain('/live-probe');
});

test('the surface reads, and never writes', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  // Left open on purpose and never referenced again: the panel resolves its subject from the tabs
  // of the window, so closing it would take the thread with it.
  await site.openNoisy(context);
  await expect
    .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  // The scene is set with the write path, and then the write path goes quiet: the page has finished
  // loading, so nothing else will reach the store unless the panel puts it there.
  await flushCapture(options);
  const tabId = await tabIdFor(options, `${site.origin}/noisy`);

  // Older than the rolling hour, which makes it the perfect witness: a purge would delete it, and a
  // purge only ever runs on the write path (`storage/write.ts:73`).
  await seedCapturedEntry(options, {
    kind: 'network',
    domain: site.host,
    tabId,
    timestamp: Date.now() - 2 * HOUR,
    requestId: 'seed-two-hours-ago',
    url: `${site.origin}/two-hours-ago`,
    method: 'GET',
    outcome: 'completed',
    statusCode: 200,
    resourceType: 'xmlhttprequest',
    responseBody: 'unavailable',
  });

  const panel = await openPanel(context, extensionId);
  await expect.poll(() => panel.getByTestId('entry-row').count(), { timeout: 20_000 }).toBeGreaterThan(0);

  // A fixed wait, because the claim is about something that must *not* happen: there is no event to
  // await for an absent write, and the panel's own reads all run well inside this window.
  await panel.waitForTimeout(2_000);

  const stored = await readCapturedEntries(options);
  expect(stored.some((entry) => entry.url?.endsWith('/two-hours-ago'))).toBe(true);

  // Left on disk, and left out of the thread: the hour is a bound on what is read, not a deletion
  // the surface performs.
  expect(await threadText(panel)).not.toContain('/two-hours-ago');
});

test('the thread runs in the order the exported report does', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  await site.openNoisy(context);

  // All three kinds, or the ordering claim would only be about requests. The console ones travel
  // through the relay rather than through `webRequest`, which is what makes them worth waiting for.
  await expect
    .poll(
      async () => new Set((await readCapturedEntries(options)).map((entry) => entry.kind)).size,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(1);
  await flushCapture(options);

  const tabId = await tabIdFor(options, `${site.origin}/noisy`);
  const panel = await openPanel(context, extensionId);
  await expect.poll(() => panel.getByTestId('entry-row').count(), { timeout: 20_000 }).toBeGreaterThan(0);

  const rendered = await threadOrder(panel);
  const { bundle } = await requestExport(panel, tabId, 60);
  const exported = bundle!.entries.map((entry) => `${entry.timestamp}:${entry.kind}`);

  // The same rows, in the same order, over the same window — which is the whole reason a reading
  // here is allowed to predict what the paste will contain (`phase-10.md:121`).
  expect(rendered).toEqual(exported);
  expect(rendered.length).toBeGreaterThan(1);
  const stamps = rendered.map((row) => Number(row.split(':')[0]));
  expect([...stamps]).toEqual([...stamps].sort((a, b) => a - b));
});

/**
 * `phase-4.md:165`, last third — the panel and the popup never tell two stories about one tab.
 *
 * The panel renders the popup's own alert rather than restating the four states
 * (`sidepanel/App.tsx:8`), and this is what holds that import to its promise. Out of scope is the
 * state worth testing it on: it is the one where a disagreement would be worst, since whichever
 * surface got it wrong would be claiming a capture that is not happening.
 */
test('the panel and the popup announce the same state for the same tab', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  // The same server under a hostname nobody watches, exactly as above: the scope is read from the
  // tab's address, so whether it answers is beside the point.
  const stray = await context.newPage();
  await stray
    .goto(site.origin.replace('127.0.0.1', 'localhost'), { waitUntil: 'load' })
    .catch(() => undefined);

  // Both surfaces are extension tabs, so both resolve the most recently accessed web tab of the
  // window (`popup/subject-tab.ts:51`) — and that is `stray` for either of them.
  const panel = await openPanel(context, extensionId);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByTestId('popup-root')).toBeVisible();

  const announced = async (surface: Page) => ({
    state: await surface.getByTestId('scope-status').getAttribute('data-state'),
    label: (await surface.getByTestId('scope-label').innerText()).trim(),
  });

  for (const surface of [panel, popup]) {
    await expect(surface.getByTestId('scope-status')).toHaveAttribute('data-state', 'out-of-scope', {
      timeout: 20_000,
    });
  }

  expect(await announced(panel)).toEqual(await announced(popup));
});

test('marks the low edge of the thread as a purge, not as an absence', async ({
  context,
  extensionId,
}) => {
  const { panel } = await capturingPanel(context, extensionId);

  const edge = panel.getByTestId('window-edge');
  await expect(edge).toBeVisible();
  // The store is minutes old here, so the edge is the retention promise rather than a quota cut.
  // Both wordings exist; what must never happen is the edge being left silent.
  await expect(edge).toHaveAttribute('data-reason', 'retention');
  await expect(panel.getByTestId('window-edge-detail')).toContainText('purged');
});
