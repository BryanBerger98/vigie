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

/**
 * The same reading, once it has stopped moving.
 *
 * A visit does not end when `load` fires: the favicon request, and whatever the page started late,
 * are delivered afterwards. Reading straight after the navigation charges them to the *next* visit,
 * which is enough to make an exact count of events per visit disagree with itself. Any test that
 * compares two counts rather than a threshold has to wait for the traffic to have drained.
 */
async function settledMeasurement(
  context: BrowserContext,
  extensionId: string,
): Promise<MeasurementState> {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const current = (await readMeasurement(context, extensionId)).networkEvents;
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { intervals: [250, 250, 250, 500, 500, 1000] },
    )
    .toBe(true);

  return readMeasurement(context, extensionId);
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
  const granted = await settledMeasurement(context, extensionId);
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

  /** Events the background counted for one visit, once the traffic has drained. */
  const visitCost = async (): Promise<number> => {
    const before = await settledMeasurement(context, extensionId);
    await site.visit(context);
    const after = await settledMeasurement(context, extensionId);
    return after.networkEvents - before.networkEvents;
  };

  // The profile starts on the variant's required permission, so this first visit is delivered and
  // measures what one visit costs with the binding applied exactly once.
  const baseline = await visitCost();
  expect(baseline).toBeGreaterThan(0);

  // The background re-applies its capture binding on `permissions.onAdded` and `onRemoved`.
  // Four changes therefore mean five `addListener` calls on the same event.
  //
  // Each change is waited for before the next is asked. Driving them back to back leaves Chrome
  // free to collapse two settings into one notification, and the test would then measure a binding
  // applied fewer times than it believes — which is exactly the thing under test.
  let changes = 0;
  for (const access of ['ON_CLICK', 'ON_ALL_SITES', 'ON_CLICK', 'ON_ALL_SITES'] as const) {
    expect(await setHostAccess(control, extensionId, access)).toBe('ok');
    changes += 1;
    await expect
      .poll(async () => (await readMeasurement(context, extensionId)).permissionChanges.length)
      .toBe(changes);
  }

  // A bound rather than an equality. Two visits of the same page do not cost the same number of
  // requests — the favicon is fetched on one and served from cache on the next — so an exact match
  // fails for a reason that has nothing to do with listeners. Stacking is not a ±1 effect: five
  // registrations would count every request five times, which this bound cannot survive.
  const afterChurn = await visitCost();
  expect(afterChurn).toBeGreaterThan(0);
  expect(afterChurn).toBeLessThan(baseline * 2);
});

/**
 * The third scenario of the plan — let the worker idle out, then wake it with a request — has no
 * test here on purpose. Chrome keeps an extension service worker alive for as long as a debugger
 * is attached, and Playwright attaches to every worker target it sees. Three ways of forcing the
 * stop were measured and none worked: 90 s of real idleness, `ServiceWorker.stopAllWorkers`, and
 * `Target.closeTarget` on the `service_worker` target. See `measure-permissions.md`, gap G2.
 */
test('the network counter advances while browsing a permitted domain', async ({
  context,
  extensionId,
}) => {
  const control = await openSiteAccessControl(context, extensionId);
  expect(await setHostAccess(control, extensionId, 'ON_ALL_SITES')).toBe('ok');

  const readCounter = async () => (await readMeasurement(context, extensionId)).networkEvents;
  const before = await readCounter();

  await site.visit(context);

  await expect.poll(readCounter).toBeGreaterThan(before);
});
