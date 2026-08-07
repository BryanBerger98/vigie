import type { BrowserContext } from '@playwright/test';

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
 * Measures how a `webRequest` listener behaves across a host-permission grant and revocation
 * (phase 2 of the extension-scope plan).
 *
 * It runs on the shared build variant — a required host permission driven through Chrome's
 * site-access setting — because the optional-permission prompt is unreachable from automation.
 * `fixtures/build-variant.ts` carries the full reasoning and what the swap costs.
 */

const MEASUREMENT_BUILD = buildVariantPath('measurement');

const MEASUREMENT_STATE_KEY = 'vigie:measurement';

/** The slice of the background's measurement state this spec reads back. */
interface MeasurementState {
  workerStarts: number;
  networkEvents: number;
  permissionChanges: { change: 'added' | 'removed'; origins: string[] }[];
}

/** The `chrome` surfaces this spec drives from inside the browser, beyond the shared helpers'. */
interface ChromeSurface {
  storage: { session: { get(key: string): Promise<Record<string, unknown>> } };
  webRequest: { onCompleted: { addListener(listener: () => void, filter: { urls: string[] }): void } };
}

test.use({ extensionPath: MEASUREMENT_BUILD });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(MEASUREMENT_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(MEASUREMENT_BUILD);
});

/** Reads the background's state through an extension page — never through the worker target. */
async function readMeasurement(context: BrowserContext, extensionId: string): Promise<MeasurementState> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const state = await page.evaluate(async (key) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    const stored = await chrome.storage.session.get(key);
    return stored[key];
  }, MEASUREMENT_STATE_KEY);
  await page.close();
  return state as MeasurementState;
}

test('no network event is recorded while host access is withheld', async ({ context, extensionId }) => {
  const control = await openSiteAccessControl(context, extensionId);
  expect(await setHostAccess(control, extensionId, 'ON_CLICK')).toBe('ok');

  await site.visit(context);

  const state = await readMeasurement(context, extensionId);
  expect(state.networkEvents).toBe(0);
});

test('granting host access at runtime reaches the existing listener without re-registration', async ({
  context,
  extensionId,
}) => {
  const control = await openSiteAccessControl(context, extensionId);
  expect(await setHostAccess(control, extensionId, 'ON_CLICK')).toBe('ok');

  const worker = context.serviceWorkers()[0]!;

  // Registered while the permission is withheld and deliberately never touched again, so any
  // event it receives proves Chrome resolved host access at dispatch, not at registration.
  await worker.evaluate(() => {
    const scope = globalThis as unknown as { chrome: ChromeSurface; __frozenProbe: number };
    scope.__frozenProbe = 0;
    scope.chrome.webRequest.onCompleted.addListener(
      () => {
        scope.__frozenProbe += 1;
      },
      { urls: ['<all_urls>'] },
    );
  });
  const readFrozenProbe = () =>
    worker.evaluate(() => (globalThis as unknown as { __frozenProbe: number }).__frozenProbe);

  await site.visit(context);
  expect(await readFrozenProbe()).toBe(0);

  expect(await setHostAccess(control, extensionId, 'ON_ALL_SITES')).toBe('ok');
  await site.visit(context);

  expect(await readFrozenProbe()).toBeGreaterThan(0);
});

test('revoking host access stops delivery on that same listener', async ({ context, extensionId }) => {
  const control = await openSiteAccessControl(context, extensionId);

  await site.visit(context);
  const granted = await readMeasurement(context, extensionId);
  expect(granted.networkEvents).toBeGreaterThan(0);

  expect(await setHostAccess(control, extensionId, 'ON_CLICK')).toBe('ok');
  await site.visit(context);

  const revoked = await readMeasurement(context, extensionId);
  expect(revoked.networkEvents).toBe(granted.networkEvents);
  expect(revoked.permissionChanges.at(-1)?.change).toBe('removed');
});

test('re-registering on every permission change does not stack listeners', async ({
  context,
  extensionId,
}) => {
  const control = await openSiteAccessControl(context, extensionId);

  // The background re-applies its capture binding on `permissions.onAdded` and `onRemoved`.
  // Three changes therefore mean four `addListener` calls on the same event; a request counted
  // once per visit is what proves `registerOnce` deduplicates in the real browser.
  for (const access of ['ON_CLICK', 'ON_ALL_SITES', 'ON_CLICK'] as const) {
    expect(await setHostAccess(control, extensionId, access)).toBe('ok');
  }
  await expect
    .poll(async () => (await readMeasurement(context, extensionId)).permissionChanges.length)
    .toBe(3);

  expect(await setHostAccess(control, extensionId, 'ON_ALL_SITES')).toBe('ok');

  const before = await readMeasurement(context, extensionId);
  await site.visit(context);
  const afterFirst = await readMeasurement(context, extensionId);
  await site.visit(context);
  const afterSecond = await readMeasurement(context, extensionId);

  const firstVisit = afterFirst.networkEvents - before.networkEvents;
  const secondVisit = afterSecond.networkEvents - afterFirst.networkEvents;
  expect(firstVisit).toBeGreaterThan(0);
  expect(secondVisit).toBe(firstVisit);
});

/**
 * The third scenario of the plan — let the worker idle out, then wake it with a request — has no
 * test here on purpose. Chrome keeps an extension service worker alive for as long as a debugger
 * is attached, and Playwright attaches to every worker target it sees. Three ways of forcing the
 * stop were measured and none worked: 90 s of real idleness, `ServiceWorker.stopAllWorkers`, and
 * `Target.closeTarget` on the `service_worker` target. See `measure-permissions.md`, gap G2.
 */
test('the popup shows a network counter that advances while browsing a permitted domain', async ({
  context,
  extensionId,
}) => {
  const control = await openSiteAccessControl(context, extensionId);
  expect(await setHostAccess(control, extensionId, 'ON_ALL_SITES')).toBe('ok');

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const counter = popup.getByTestId('measure-network-events');
  const readCounter = async () => Number(await counter.innerText());

  await expect(counter).toBeVisible();
  const before = await readCounter();

  await site.visit(context);

  await expect.poll(readCounter).toBeGreaterThan(before);
});
