import type { BrowserContext, Page } from '@playwright/test';

import { closeTab, navigateTab, openTab } from '../fixtures/browser-tabs';
import { buildVariantPath, createBuildVariant, removeBuildVariant } from '../fixtures/build-variant';
import { expect, test } from '../fixtures/extension';
import { startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The deep layer's life on a real browser: armed from the popup, following the watched perimeter,
 * stopped by either side (phase 3 of the CDP capture plan).
 *
 * `chrome.debugger` has no faithful mock, so everything the API touches is asserted here rather
 * than in a unit test (`coding-assertions.md`). What is pure lives elsewhere and stays there: the
 * availability verdict in `capture/cdp/support.test.ts`, the transitions and the cancellation mark
 * in `capture/cdp/session-state.test.ts`, and the four sentences the popup renders in
 * `entrypoints/popup/state.test.ts`.
 *
 * ## How this suite touches the tabs
 *
 * Never through Playwright. Attaching `chrome.debugger` to a page a second CDP client already
 * drives detaches that client's frame — measured in phase 1, where a whole run had to be thrown
 * away for it (`cdp-terminal-event-gap.md:58`). The attach itself succeeds, which is the point:
 * three simultaneous clients coexist (`cdp-body-capture-calibration.md:47`). So every tab here is
 * opened, navigated and closed through `chrome.tabs.*` from an extension page, and no assertion
 * ever reaches into a watched tab.
 *
 * ## What no browser can state here
 *
 * Chrome's banner is a native surface: that an attached tab carries one, and that its Cancel button
 * exists, belong to phase 11's manual recipe. The refusal it produces does not — Chrome writes
 * nothing down, the extension does, and that mark is what the last test exercises. Same for a
 * Chrome older than 118: a run cannot downgrade its own browser, and the verdict is a pure function
 * asserted without one.
 */

const CDP_BUILD = buildVariantPath('cdp-session');

const SESSION_KEY = 'vigie:cdp-session';

/**
 * Where a tab goes to leave the perimeter: the same server under the name that is not watched.
 *
 * `127.0.0.1` is the watched domain and `localhost` is a different host as far as the scope is
 * concerned, so this is a tab that left the perimeter and nothing else. `about:blank` would have
 * been shorter and would have measured the wrong thing — the extension holds no access to that
 * scheme, so Chrome withholds the URL, and the tab would leave because it became unreadable rather
 * than because it stopped being watched.
 */
function outOfScope(): string {
  return site.origin.replace('127.0.0.1', 'localhost');
}

test.use({ extensionPath: CDP_BUILD });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let site: TestSite;

test.beforeAll(async () => {
  // `debugger` required rather than optional, for the same reason the host permission is: the
  // prompt is a native bubble no automation can answer. `fixtures/build-variant.ts` carries the
  // reasoning and what the swap costs. One consequence is worth having in mind while reading the
  // clicks below — `permissions.request` resolves `true` without a prompt, so the popup's own
  // start button is drivable end to end rather than being stood in for by a message.
  await createBuildVariant(CDP_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(CDP_BUILD);
});

/** What the worker persists about the layer. Mirrors `capture/cdp/session-state.ts`. */
interface DeepLayerState {
  armed: boolean;
  attachedTabs: number[];
  inFlight: Record<string, string>;
  canceledByUser: boolean;
}

const NO_SESSION: DeepLayerState = {
  armed: false,
  attachedTabs: [],
  inFlight: {},
  canceledByUser: false,
};

/**
 * The `chrome` surfaces this spec drives from inside the browser, beyond the tabs the shared
 * fixture covers. `@types/chrome` is not a dependency of this workspace, and the fixtures declare
 * what they use for the same reason.
 */
interface ChromeSurface {
  storage: {
    session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  debugger: {
    attach(target: { tabId: number }, version: string): Promise<void>;
    detach(target: { tabId: number }): Promise<void>;
  };
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

/**
 * Watches the test site, through the settings form rather than by writing the list.
 *
 * The variant's host permission is required, so the request the form makes resolves without a
 * prompt — the granted branch, which is the one every assertion below depends on.
 */
async function watchTestSite(context: BrowserContext, extensionId: string): Promise<void> {
  const options = await openExtensionPage(context, extensionId, 'options');
  await options.getByTestId('add-domain-input').fill(site.host);
  await options.getByTestId('add-domain-submit').click();
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);
  await options.close();
}

async function readSession(driver: Page): Promise<DeepLayerState> {
  const stored = await driver.evaluate(async (key) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    const held = await chrome.storage.session.get(key);
    return (held[key] ?? null) as DeepLayerState | null;
  }, SESSION_KEY);

  return stored ?? NO_SESSION;
}

function writeSession(driver: Page, state: DeepLayerState): Promise<void> {
  return driver.evaluate(
    ([key, written]) => {
      const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
      return chrome.storage.session.set({ [key as string]: written });
    },
    [SESSION_KEY, state] as const,
  );
}

/**
 * The attached tabs, sorted.
 *
 * Sorted because the list is filled in whatever order `tabs.query` answers, and a suite asserting
 * that order would be asserting the browser's enumeration rather than the layer's.
 */
async function attachedTabs(driver: Page): Promise<number[]> {
  const { attachedTabs: attached } = await readSession(driver);
  return [...attached].sort((left, right) => left - right);
}

function expectAttached(driver: Page, tabIds: number[]) {
  return expect
    .poll(() => attachedTabs(driver), { timeout: 20_000 })
    .toEqual([...tabIds].sort((left, right) => left - right));
}

/** Arms the layer the way a user does. The click carries the gesture `permissions.request` wants. */
async function armFromPopup(popup: Page): Promise<void> {
  const action = popup.getByTestId('deep-layer-action');
  await expect(action).toHaveAttribute('data-intent', 'start');
  await action.click();
  await expect(popup.getByTestId('deep-layer')).toHaveAttribute('data-state', 'active');
}

test('arming from the popup attaches the tabs already standing in the perimeter', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const first = await openTab(popup, site.origin);
  const second = await openTab(popup, site.origin);
  await expectAttached(popup, []);

  await armFromPopup(popup);

  await expectAttached(popup, [first, second]);
});

test('a tab entering the perimeter is attached without anyone asking', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  await armFromPopup(popup);
  await expectAttached(popup, []);

  const late = await openTab(popup, site.origin);

  await expectAttached(popup, [late]);
});

test('a tab leaving the perimeter loses its session and the others keep theirs', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const leaving = await openTab(popup, site.origin);
  const staying = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [leaving, staying]);

  await navigateTab(popup, leaving, outOfScope());

  await expectAttached(popup, [staying]);
});

test('closing an attached tab takes its session alone', async ({ context, extensionId }) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const closing = await openTab(popup, site.origin);
  const staying = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [closing, staying]);

  await closeTab(popup, closing);

  await expectAttached(popup, [staying]);
});

/**
 * A tab whose session Chrome refuses.
 *
 * Provoked by taking the session first, from the popup itself: an extension gets one session per
 * target, so the layer's own `attach` comes back refused on that tab and succeeds on the other.
 * The refusal is also said out loud, on the worker's console — which Playwright does not surface
 * for a service worker, so what is asserted here is the part that outlives the message: a tab the
 * browser refused is not carried in the state as though it were capturing.
 */
test('a tab whose session is refused never enters the attached list', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const taken = await openTab(popup, site.origin);
  const free = await openTab(popup, site.origin);
  await popup.evaluate((tabId) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    return chrome.debugger.attach({ tabId }, '1.3');
  }, taken);

  await armFromPopup(popup);

  await expectAttached(popup, [free]);
});

test('a voluntary stop leaves nothing behind, in the state or on the tabs', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const first = await openTab(popup, site.origin);
  const second = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [first, second]);

  await popup.getByTestId('deep-layer-action').click();

  await expect(popup.getByTestId('deep-layer')).toHaveAttribute('data-state', 'stopped');
  // Empty, not merely disarmed: a stop is not a refusal and remembers nothing of itself.
  await expect.poll(() => readSession(popup), { timeout: 20_000 }).toEqual(NO_SESSION);
});

/**
 * The cancellation, from the popup's point of view and from the layer's.
 *
 * Chrome's banner is native and no automation can click it, so its two effects are produced by
 * hand from a second extension page: every session dropped at once, then the mark written. That
 * seam is where the coverage splits and it is worth naming — that `onDetach('canceled_by_user')`
 * produces this exact state is asserted in `capture/cdp/session-state.test.ts`, and what a browser
 * adds here is everything downstream: a popup that flips without being reopened, and a perimeter
 * that stops attracting sessions.
 *
 * The last two steps matter as much as the first. Arming again attaches both the tab the mark had
 * left alone and the one that was already there, which is what makes "nothing re-attached" a
 * measurement rather than a coincidence.
 */
test('a cancellation flips the popup and stops the layer attaching on its own', async ({
  context,
  extensionId,
}) => {
  await watchTestSite(context, extensionId);
  const popup = await openExtensionPage(context, extensionId, 'popup');

  const first = await openTab(popup, site.origin);
  await armFromPopup(popup);
  await expectAttached(popup, [first]);

  const banner = await openExtensionPage(context, extensionId, 'popup');
  await banner.evaluate((tabId) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    return chrome.debugger.detach({ tabId });
  }, first);
  await writeSession(banner, { ...NO_SESSION, canceledByUser: true });
  await banner.close();

  await expect(popup.getByTestId('deep-layer')).toHaveAttribute('data-state', 'canceled');
  await expect(popup.getByTestId('deep-layer-label')).toContainText('banner');

  const late = await openTab(popup, site.origin);
  await expectAttached(popup, []);

  await armFromPopup(popup);
  await expectAttached(popup, [first, late]);
});
