import type { BrowserContext, Page } from '@playwright/test';

import {
  buildVariantPath,
  createBuildVariant,
  removeBuildVariant,
} from '../fixtures/build-variant';
import { readCapturedEntries } from '../fixtures/capture-store';
import { expect, test } from '../fixtures/extension';
import { startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The storage instrument of phase 6, in a real browser — and the volume measurement it exists for.
 *
 * Two different things live here. The first is ordinary coverage: the readout is reachable without
 * devtools, a reading is kept, several tabs of one domain stay one store. The second is a
 * measurement, `weighs the store`, whose numbers go into `measure-storage.md`: what an entry costs
 * cannot be read off the code, and a figure produced by anything other than the real write path
 * would be a figure about the wrong thing.
 *
 * Its assertions are deliberately loose. The point is the printed figures; the bounds only catch a
 * store that stopped costing anything at all, or one that started costing absurdly more.
 */

const METRICS_BUILD = buildVariantPath('storage-metrics');

test.use({ extensionPath: METRICS_BUILD });
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(METRICS_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(METRICS_BUILD);
});

async function openOptions(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByTestId('options-root')).toBeVisible();
  return page;
}

async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByTestId('popup-root')).toBeVisible();
  return page;
}

async function watch(options: Page, domain: string): Promise<void> {
  await options.getByTestId('add-domain-input').fill(domain);
  await options.getByTestId('add-domain-submit').click();
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);
}

/** The entry count the popup shows, as a number. */
async function shownEntries(popup: Page): Promise<number> {
  return Number(await popup.getByTestId('storage-entries').innerText());
}

/** What `navigator.storage.estimate()` answers for the extension's own origin. */
function originUsage(page: Page): Promise<number | null> {
  return page.evaluate(async () => (await navigator.storage.estimate()).usage ?? null);
}

test('the store is readable from the popup, without devtools', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);
  await site.visit(context);

  const popup = await openPopup(context, extensionId);

  await expect.poll(() => shownEntries(popup), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(popup.getByTestId('storage-covered')).toContainText('/ 60.0 min');
  // Network and console are counted apart: they are not reduced the same way if the hour overflows.
  await expect(popup.getByTestId('storage-by-kind')).toContainText('/');

  await popup.close();
});

test('a reading is kept, so an hour of navigation leaves a series behind', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);
  await site.visit(context);

  const popup = await openPopup(context, extensionId);
  await expect.poll(() => shownEntries(popup), { timeout: 15_000 }).toBeGreaterThan(0);

  await popup.getByTestId('storage-take-reading').click();
  await expect(popup.getByTestId('storage-take-reading')).toHaveText('Take reading (1)');

  await popup.getByTestId('storage-take-reading').click();
  await expect(popup.getByTestId('storage-take-reading')).toHaveText('Take reading (2)');

  await popup.getByTestId('storage-clear-readings').click();
  await expect(popup.getByTestId('storage-take-reading')).toHaveText('Take reading (0)');

  await popup.close();
});

test('the readings live outside the quota the capture is measured against', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);

  // The baseline arithmetic of `metrics.ts` assumes `chrome.storage.local` is not part of the
  // origin's Storage API usage. Assumed is not measured, and if it were false every byte figure
  // the phase produces would drift upwards as the run recorded itself.
  const before = await originUsage(popup);

  await popup.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const { chrome } = globalThis as unknown as {
          chrome: { storage: { local: { set(items: unknown, callback: () => void): void } } };
        };
        chrome.storage.local.set({ 'vigie:probe': 'x'.repeat(2_000_000) }, () => resolve());
      }),
  );

  const after = await originUsage(popup);

  expect(before).not.toBeNull();
  expect(after! - before!).toBeLessThan(1_000_000);

  await popup.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const { chrome } = globalThis as unknown as {
          chrome: { storage: { local: { remove(key: string, callback: () => void): void } } };
        };
        chrome.storage.local.remove('vigie:probe', () => resolve());
      }),
  );

  await popup.close();
});

test('several tabs of one domain keep their own threads inside one store', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const tabs = [await site.openNoisy(context), await site.openNoisy(context), await site.openNoisy(context)];

  const popup = await openPopup(context, extensionId);
  await expect.poll(() => shownEntries(popup), { timeout: 20_000 }).toBeGreaterThan(0);

  const entries = await readCapturedEntries(popup);
  const tabIds = new Set(entries.map((entry) => entry.tabId));
  const domains = new Set(entries.map((entry) => entry.domain));

  expect(tabIds.size).toBeGreaterThanOrEqual(3);
  expect([...domains]).toEqual([site.host]);

  await popup.close();
  for (const tab of tabs) await tab.close();
});

interface Weighed {
  entries: number;
  /** Bytes of JSON, and how many entries carry them, per kind. */
  raw: Record<string, { count: number; bytes: number }>;
  rawTotal: number;
  usage: number;
  quota: number;
}

/**
 * The store as it stands right now, read the way the popup reads it: flush first, then weigh.
 *
 * Two scales come back. The JSON length is exact and attributable per kind, which is what makes
 * the figures replayable on another application — an app that logs twice as much as it fetches
 * does not cost the same as one that does the reverse. The origin usage is the truth about disk,
 * indexes included, but it moves in blocks and cannot be split by kind.
 */
async function weighStore(context: BrowserContext, extensionId: string): Promise<Weighed> {
  const popup = await openPopup(context, extensionId);

  const estimate = await popup.evaluate(async () => {
    const { chrome } = globalThis as unknown as {
      chrome: { runtime: { sendMessage(message: unknown, callback: () => void): void } };
    };
    await new Promise<void>((resolve) => chrome.runtime.sendMessage('vigie:flush', () => resolve()));
    const { usage, quota } = await navigator.storage.estimate();
    return { usage: usage ?? 0, quota: quota ?? 0 };
  });

  const entries = await readCapturedEntries(popup);
  await popup.close();

  const raw: Weighed['raw'] = {};
  for (const entry of entries) {
    const bucket = (raw[entry.kind] ??= { count: 0, bytes: 0 });
    bucket.count += 1;
    bucket.bytes += JSON.stringify(entry).length;
  }

  return {
    entries: entries.length,
    raw,
    rawTotal: Object.values(raw).reduce((total, bucket) => total + bucket.bytes, 0),
    ...estimate,
  };
}

/** Mean JSON bytes of the entries of one kind added between two weighings. */
function meanAdded(before: Weighed, after: Weighed, kind: string): number {
  const start = before.raw[kind] ?? { count: 0, bytes: 0 };
  const end = after.raw[kind] ?? { count: 0, bytes: 0 };
  const count = end.count - start.count;
  return count === 0 ? 0 : (end.bytes - start.bytes) / count;
}

test('weighs the store, so the hour is judged on measured bytes', async ({
  context,
  extensionId,
}) => {
  const REQUESTS = 1_500;

  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  // The origin holds the extension's own files whatever happens. Weighed here, with the store
  // still empty, so what is attributed to the capture afterwards is the capture and nothing else.
  const empty = await originUsage(options);
  expect(empty).not.toBeNull();

  // Two bursts, back to back, in one store. The second is weighed by difference against the first,
  // which is the only way to get two figures without a second profile — and the shape of an entry
  // is what the difference is about, so the two must be measured under the same browser and quota.
  const lightBurst = await site.openBurst(context, REQUESTS, 'light');
  const light = await weighStore(context, extensionId);
  await lightBurst.close();

  const heavyBurst = await site.openBurst(context, REQUESTS, 'heavy');
  const heavy = await weighStore(context, extensionId);
  await heavyBurst.close();

  const empty0: Weighed = { entries: 0, raw: {}, rawTotal: 0, usage: empty!, quota: light.quota };

  const heavyEntries = heavy.entries - light.entries;
  // On-disk cost, indexes and IndexedDB overhead included, which is what the quota actually sees.
  const lightOnDisk = (light.usage - empty!) / light.entries;
  const heavyOnDisk = (heavy.usage - light.usage) / heavyEntries;
  // JSON cost, exact and splittable by kind, which is what makes the figure transferable.
  const lightNetwork = meanAdded(empty0, light, 'network');
  const lightConsole = meanAdded(empty0, light, 'console');
  const heavyNetwork = meanAdded(light, heavy, 'network');
  const heavyConsole = meanAdded(light, heavy, 'console');
  // The ratio between the two scales: what a byte of JSON ends up costing once stored.
  const overhead = (light.usage - empty!) / light.rawTotal;

  // What an hour costs is a per-entry cost times a rate. The rate is the user's to observe on a
  // real application; these are the two costs it gets multiplied by.
  const hourAt = (bytesPerEntry: number, perMinute: number) => bytesPerEntry * perMinute * 60;

  console.info(
    [
      '[measure] quota %d B · origin %d B with an empty store',
      '[measure] light %d entries · network %d B/entry · console %d B/entry (JSON)',
      '[measure] heavy %d entries · network %d B/entry · console %d B/entry (JSON)',
      '[measure] on disk: light %d B/entry · heavy %d B/entry · ×%s the JSON it holds',
      '[measure] one hour at 100 entries/min: light %d B · heavy %d B (%s %% of quota)',
      '[measure] one hour at 1000 entries/min: light %d B · heavy %d B (%s %% of quota)',
    ].join('\n'),
    heavy.quota,
    empty,
    light.entries,
    Math.round(lightNetwork),
    Math.round(lightConsole),
    heavyEntries,
    Math.round(heavyNetwork),
    Math.round(heavyConsole),
    Math.round(lightOnDisk),
    Math.round(heavyOnDisk),
    overhead.toFixed(2),
    Math.round(hourAt(lightOnDisk, 100)),
    Math.round(hourAt(heavyOnDisk, 100)),
    ((hourAt(heavyOnDisk, 100) / heavy.quota) * 100).toFixed(3),
    Math.round(hourAt(lightOnDisk, 1_000)),
    Math.round(hourAt(heavyOnDisk, 1_000)),
    ((hourAt(heavyOnDisk, 1_000) / heavy.quota) * 100).toFixed(3),
  );

  // The store costs something per entry, a heavy request costs more than a bare one, and neither is
  // an order of magnitude away from the payload it holds. Outside that, the shape being written
  // stopped resembling what was designed and the figures above describe something else.
  expect(light.entries).toBeGreaterThan(REQUESTS);
  expect(heavyEntries).toBeGreaterThan(REQUESTS);
  expect(lightOnDisk).toBeGreaterThan(50);
  expect(lightOnDisk).toBeLessThan(20_000);
  expect(heavyNetwork).toBeGreaterThan(lightNetwork);
  expect(heavy.quota).toBeGreaterThan(0);
});

test('times the same traffic with and without the capture', async ({ context, extensionId }) => {
  const REQUESTS = 1_000;
  const ROUNDS = 3;

  const options = await openOptions(context, extensionId);

  /** One burst, timed from navigation to the page's own done marker. */
  async function timeBurst(): Promise<number> {
    const started = Date.now();
    const page = await site.openBurst(context, REQUESTS, 'heavy');
    const elapsed = Date.now() - started;
    await page.close();
    return elapsed;
  }

  // Thrown away: the first burst pays for the server's cold start and the browser's connection
  // setup, and would land entirely in whichever series ran first.
  await timeBurst();

  // Unwatched first, then watched, and the store is never emptied in between. The watched rounds
  // therefore run against a store that keeps growing — which is the state the product is actually
  // in after an hour, and the one an ordering picked for convenience would have avoided.
  const off: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) off.push(await timeBurst());

  await watch(options, site.host);

  const on: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) on.push(await timeBurst());

  const mean = (series: number[]) => series.reduce((sum, value) => sum + value, 0) / series.length;
  const withoutMs = mean(off);
  const withMs = mean(on);

  console.info(
    [
      '[measure] %d heavy requests per round, %d rounds each way',
      '[measure] capture off: %s ms (mean %d)',
      '[measure] capture on:  %s ms (mean %d)',
      '[measure] cost of the capture: %d ms per round, %s ms per request, ×%s',
    ].join('\n'),
    REQUESTS,
    ROUNDS,
    off.join(', '),
    Math.round(withoutMs),
    on.join(', '),
    Math.round(withMs),
    Math.round(withMs - withoutMs),
    ((withMs - withoutMs) / REQUESTS).toFixed(3),
    (withMs / withoutMs).toFixed(2),
  );

  // Deliberately loose, and one-sided. The figure printed above is the deliverable; this only
  // catches the capture turning the page into something a user would abandon.
  expect(withMs).toBeLessThan(withoutMs * 3 + 1_000);
});

interface StorageState {
  entryCount: number;
  coveredMs: number;
  shrunkAt: number | null;
}

/** Forces the batch out — which is what runs the purge — and reads the readout it left behind. */
function pruneAndRead(page: Page): Promise<StorageState> {
  return page.evaluate(
    () =>
      new Promise<StorageState>((resolve) => {
        const { chrome } = globalThis as unknown as {
          chrome: {
            runtime: { sendMessage(message: unknown, callback: () => void): void };
            storage: {
              local: { get(key: string, callback: (stored: Record<string, unknown>) => void): void };
            };
          };
        };
        chrome.runtime.sendMessage('vigie:flush', () => {
          chrome.storage.local.get('vigie:storage-state', (stored) => {
            resolve(stored['vigie:storage-state'] as StorageState);
          });
        });
      }),
  );
}

test('shrinks the window when the quota says the hour is unaffordable', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const burst = await site.openBurst(context, 400, 'light');
  await burst.close();

  const before = await pruneAndRead(options);
  expect(before.entryCount).toBeGreaterThan(100);
  expect(before.shrunkAt).toBeNull();

  // The quota is answered by the browser and cannot be shrunk from the outside — but the purge
  // reads it through `navigator.storage.estimate()` inside the worker, and the worker is a target
  // Playwright can evaluate in. Saturation is therefore stated to the code that decides on it,
  // which is the part under test; the browser's real ceiling never had to move.
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() => {
    const storage = navigator.storage as StorageManager & { __vigieRealEstimate?: unknown };
    storage.__vigieRealEstimate = storage.estimate.bind(storage);
    storage.estimate = () => Promise.resolve({ usage: 99, quota: 100 });
  });

  const after = await pruneAndRead(options);

  // Over the pressure ratio the purge goes past the hour, oldest first, and says so. Without the
  // stamp a report would simply come back shorter than announced, with nothing to explain it.
  expect(after.entryCount).toBeLessThan(before.entryCount);
  expect(after.shrunkAt).not.toBeNull();
  expect(after.coveredMs).toBeLessThanOrEqual(before.coveredMs);

  console.info(
    '[measure] quota saturated: %d entries left of %d, window %d ms of %d ms, shrink reported',
    after.entryCount,
    before.entryCount,
    after.coveredMs,
    before.coveredMs,
  );

  await worker.evaluate(() => {
    const storage = navigator.storage as StorageManager & { __vigieRealEstimate?: () => unknown };
    if (storage.__vigieRealEstimate) storage.estimate = storage.__vigieRealEstimate as never;
  });
});
