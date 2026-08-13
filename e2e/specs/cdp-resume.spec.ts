import type { BrowserContext, Page } from '@playwright/test';

import { navigateTab, openTab } from '../fixtures/browser-tabs';
import { buildVariantPath, createBuildVariant, removeBuildVariant } from '../fixtures/build-variant';
import { flushCapture, readCapturedEntries, type StoredEntry } from '../fixtures/capture-store';
import { expect, test } from '../fixtures/extension';
import {
  BODIES_PATH,
  SMALL_BODY,
  SMALL_BODY_PATH,
  startTestSite,
  type TestSite,
} from '../fixtures/test-site';

/**
 * What the service worker does about the deep layer when it comes back from its own death, and what
 * the surfaces say about the one death nobody comes back from (phase 6 of the CDP capture plan).
 *
 * The worker is really killed here — `Target.closeTarget` on its own target, through a browser-level
 * CDP session — and Chrome is what brings it back, on the first event it holds a handler for.
 * Nothing in this file restarts it, and nothing is clicked between the death and the assertion:
 * that is the claim being made.
 *
 * `context.serviceWorkers()` states none of it. Playwright never prunes that list — measured in
 * phase 6: one worker before the kill, one immediately after `Target.closeTarget` answered, one
 * after the revival. The generation is read from `workerStarts` in `vigie:measurement` through an
 * extension page instead, as `optional-host-permission.spec.ts` reads it.
 *
 * ## The update is posed, not performed
 *
 * The interruption notice is triggered by writing its mark into `chrome.storage.session` directly,
 * never by updating the extension. Two measured reasons: `chrome.runtime.reload()` does not restart
 * the worker on a `--load-extension` build, so the `onInstalled` reason the mark waits for never
 * arrives; and a Web Store update has never been observed at all. Everything downstream of the mark
 * is asserted below — shown once, nothing to click, both surfaces wording it identically, neither
 * before the agreement. The one line left uncovered is `details.reason === 'update'` in
 * `entrypoints/background.ts`, which phase 11's manual recipe answers.
 *
 * ## How this suite touches the tabs
 *
 * Never through Playwright, for the reason `cdp-session.spec.ts:18` carries: a second CDP client on
 * a watched tab detaches the layer's frame. Every tab here is opened and navigated through
 * `chrome.tabs.*` from an extension page.
 */

const CDP_BUILD = buildVariantPath('cdp-resume');

const SESSION_KEY = 'vigie:cdp-session';
const INTERRUPTED_KEY = 'vigie:capture-interrupted';
const MEASUREMENT_KEY = 'vigie:measurement';

test.use({ extensionPath: CDP_BUILD });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let site: TestSite;

test.beforeAll(async () => {
  // `debugger` required rather than optional, and the host permission with it: both prompts are
  // native bubbles no automation answers. `fixtures/build-variant.ts` carries what the swap costs.
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

/** The probe the worker keeps. Only the generation counter matters here. */
interface Measurement {
  workerStarts: number;
}

/** The `chrome` surface these helpers reach for. `@types/chrome` is not a dependency. */
interface ChromeSurface {
  storage: {
    session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

async function openExtensionPage(
  context: BrowserContext,
  extensionId: string,
  name: 'popup' | 'options' | 'sidepanel',
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${name}.html`);
  await expect(page.getByTestId(`${name}-root`)).toBeVisible();
  return page;
}

/**
 * An extension page used to read or write one key and nothing else.
 *
 * The settings and the popup are both behind the gate, so neither can set a scenario up on a
 * pristine profile (`consent-flow.spec.ts:63`). The disclosure screen is the surface the gate
 * cannot close, which makes it the one page a seed can be written from in every state.
 */
async function openSeedPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/consent.html`);
  return page;
}

async function watchTestSite(context: BrowserContext, extensionId: string): Promise<void> {
  const options = await openExtensionPage(context, extensionId, 'options');
  await options.getByTestId('add-domain-input').fill(site.host);
  await options.getByTestId('add-domain-submit').click();
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);
  await options.close();
}

function readKey(driver: Page, key: string): Promise<unknown> {
  return driver.evaluate(async (target) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    const held = await chrome.storage.session.get(target);
    return held[target] ?? null;
  }, key);
}

function writeKey(driver: Page, key: string, value: unknown): Promise<void> {
  return driver.evaluate(
    ([target, written]) => {
      const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
      return chrome.storage.session.set({ [target as string]: written });
    },
    [key, value] as const,
  );
}

async function readSession(driver: Page): Promise<DeepLayerState> {
  return ((await readKey(driver, SESSION_KEY)) as DeepLayerState | null) ?? NO_SESSION;
}

async function workerGeneration(driver: Page): Promise<number> {
  return ((await readKey(driver, MEASUREMENT_KEY)) as Measurement | null)?.workerStarts ?? 0;
}

/** Poses the interruption mark from a page that survives the gate, and leaves nothing open. */
async function poseInterruptionMark(context: BrowserContext, extensionId: string): Promise<void> {
  const seed = await openSeedPage(context, extensionId);
  await writeKey(seed, INTERRUPTED_KEY, true);
  await seed.close();
}

/** Whether the mark is still there to be read. `false` is what a surface leaves behind. */
async function markStillPending(context: BrowserContext, extensionId: string): Promise<boolean> {
  const seed = await openSeedPage(context, extensionId);
  const held = await readKey(seed, INTERRUPTED_KEY);
  await seed.close();
  return held === true;
}

/**
 * Kills every service worker of the profile, from a browser-level CDP session.
 *
 * The death itself, not a stand-in for one: the target is closed, its globals go with it, and the
 * sessions `chrome.debugger` was holding are dropped by Chrome without a single `onDetach` — the
 * silence phase 1 measured six times over (`cdp-terminal-event-gap.md`).
 */
async function killWorker(context: BrowserContext): Promise<void> {
  const browser = context.browser();
  if (!browser) throw new Error('no browser instance to reach the worker target through');

  const session = await browser.newBrowserCDPSession();
  const { targetInfos } = (await session.send('Target.getTargets')) as {
    targetInfos: { targetId: string; type: string }[];
  };
  const workers = targetInfos.filter((info) => info.type === 'service_worker');
  expect(workers.length, 'no service worker target to kill').toBeGreaterThan(0);

  for (const worker of workers) {
    await session.send('Target.closeTarget', { targetId: worker.targetId });
  }
  await session.detach();
}

/** Arms the layer the way a user does. The click carries the gesture `permissions.request` wants. */
async function armFromPopup(popup: Page): Promise<void> {
  const action = popup.getByTestId('deep-layer-action');
  await expect(action).toHaveAttribute('data-intent', 'start');
  await action.click();
  await expect(popup.getByTestId('deep-layer')).toHaveAttribute('data-state', 'active');
}

function attachedTabs(driver: Page) {
  return expect.poll(async () => (await readSession(driver)).attachedTabs, { timeout: 30_000 });
}

/**
 * A request the layer will never hear the end of, written into the in-flight map before the death.
 *
 * This is what makes the wait deterministic. `attachedTabs` reads the same before the death and
 * after it — the list survives, which is the whole problem the resume exists for — so polling it
 * alone would be waiting on a value that never changed. The in-flight map empties in exactly one
 * place, `forgetLostSessions`, and the tab comes back into the list only once its session is open
 * again. The two together are the resume, finished.
 */
const GHOST_REQUEST = { 'ghost.1': 'https://never-concluded.test/in-flight' };

async function resumed(driver: Page, tabId: number): Promise<boolean> {
  const state = await readSession(driver);
  return Object.keys(state.inFlight).length === 0 && state.attachedTabs.join() === String(tabId);
}

/** The entries stored for one exact URL, after the worker has written what it still held. */
async function entriesFor(driver: Page, url: string): Promise<StoredEntry[]> {
  await flushCapture(driver);
  return (await readCapturedEntries(driver)).filter((entry) => entry.url === url);
}

async function entryFor(driver: Page, url: string): Promise<StoredEntry> {
  await expect.poll(async () => (await entriesFor(driver, url)).length, { timeout: 30_000 }).toBe(1);
  return (await entriesFor(driver, url))[0]!;
}

/**
 * Sends the watched tab to the bodies page and hands back the JSON fetch it triggers.
 *
 * The query travels onto the sub-resource, so each visit produces a URL no other visit of the run
 * shares — which is what lets a body be attributed to the navigation that followed the death rather
 * than to the one that preceded it.
 */
async function browse(driver: Page, tabId: number, run: string): Promise<string> {
  await navigateTab(driver, tabId, `${site.origin}${BODIES_PATH}?run=${run}`);
  return `${site.origin}${SMALL_BODY_PATH}?run=${run}`;
}

test.describe('the deep layer after a worker death', () => {
  test('re-attaches the tabs it was holding, with nobody clicking anything', async ({
    context,
    extensionId,
  }) => {
    await watchTestSite(context, extensionId);
    const popup = await openExtensionPage(context, extensionId, 'popup');
    const tabId = await openTab(popup, site.origin);

    await armFromPopup(popup);
    await attachedTabs(popup).toEqual([tabId]);

    // The layer captures before the death, so a body missing after it is a statement about the
    // resume and not about the harness.
    const before = await entryFor(popup, await browse(popup, tabId, 'before'));
    expect(before).toMatchObject({ provenance: 'cdp', responseBodyText: SMALL_BODY });

    const generation = await workerGeneration(popup);
    await writeKey(popup, SESSION_KEY, { ...(await readSession(popup)), inFlight: GHOST_REQUEST });

    await killWorker(context);

    // Traffic, and nothing else. No click, no re-arm, no message sent to the worker: browsing a
    // watched tab is what Chrome turns into a worker start, and the resume rides that start.
    const wakeUrl = await browse(popup, tabId, 'wake');

    await expect
      .poll(() => workerGeneration(popup), { timeout: 30_000 })
      .toBeGreaterThan(generation);
    await expect.poll(() => resumed(popup, tabId), { timeout: 30_000 }).toBe(true);

    // The session is open again, so the layer captures again — the only thing that tells a real
    // re-attachment apart from a tab list that merely survived in storage.
    const after = await entryFor(popup, await browse(popup, tabId, 'after'));
    expect(after).toMatchObject({ provenance: 'cdp', responseBodyText: SMALL_BODY });

    // What the death cost, said out loud: the navigation that woke the worker was captured by the
    // shallow layer alone. The resume brings the perimeter back, never the traffic it was carrying.
    expect((await entryFor(popup, wakeUrl)).provenance).toBe('webRequest');
  });

  test('honours a cancellation posed before the death, and attaches nothing at the next start', async ({
    context,
    extensionId,
  }) => {
    await watchTestSite(context, extensionId);
    const popup = await openExtensionPage(context, extensionId, 'popup');
    const tabId = await openTab(popup, site.origin);

    await armFromPopup(popup);
    await attachedTabs(popup).toEqual([tabId]);

    // Chrome's banner Cancel, written rather than clicked: the banner is a native surface and no
    // CDP client can press it. That the refusal produces this state is asserted on the real path in
    // `cdp-session.spec.ts`; what is under test here is that it outlives the worker.
    await writeKey(popup, SESSION_KEY, {
      armed: true,
      attachedTabs: [tabId],
      inFlight: GHOST_REQUEST,
      canceledByUser: true,
    });

    const generation = await workerGeneration(popup);
    await killWorker(context);
    const refusedUrl = await browse(popup, tabId, 'refused');

    await expect
      .poll(() => workerGeneration(popup), { timeout: 30_000 })
      .toBeGreaterThan(generation);

    // The list empties without a session ever being opened: the resume refuses outright, and the
    // reconciliation the same navigation triggers stands the layer down on a state that may not
    // attach. The refusal survives the start — nothing here re-arms anything.
    await attachedTabs(popup).toEqual([]);
    expect((await readSession(popup)).canceledByUser).toBe(true);

    // The refusal holds where it is felt. A re-attach that happened and was then undone would still
    // have captured one of these two.
    const stillRefusedUrl = await browse(popup, tabId, 'still-refused');
    for (const url of [refusedUrl, stillRefusedUrl]) {
      expect((await entryFor(popup, url)).provenance).toBe('webRequest');
    }
  });

  test('attaches nothing at all when the layer was never armed', async ({
    context,
    extensionId,
  }) => {
    await watchTestSite(context, extensionId);
    const popup = await openExtensionPage(context, extensionId, 'popup');
    const tabId = await openTab(popup, site.origin);

    const generation = await workerGeneration(popup);
    await killWorker(context);
    const url = await browse(popup, tabId, 'never-armed');

    await expect
      .poll(() => workerGeneration(popup), { timeout: 30_000 })
      .toBeGreaterThan(generation);

    // A start is not an arming. Watched tabs and a granted permission are not enough on their own,
    // and this is what says so: the depth stays where the user left it.
    expect(await readSession(popup)).toMatchObject({ armed: false, attachedTabs: [] });
    expect((await entryFor(popup, url)).provenance).toBe('webRequest');
  });
});

test.describe('the interruption notice', () => {
  test('is shown once, carries nothing to click, and is gone the next time', async ({
    context,
    extensionId,
  }) => {
    await poseInterruptionMark(context, extensionId);

    const popup = await openExtensionPage(context, extensionId, 'popup');
    const notice = popup.getByTestId('interruption-notice');
    await expect(notice).toBeVisible();
    await expect(popup.getByTestId('interruption-label')).toHaveText('Capture interrupted');
    await expect(popup.getByTestId('interruption-detail')).toContainText('updated');

    // A statement, not a control. Anything focusable in here would be offering an action for
    // something already over (`InterruptionNotice.tsx:9`).
    await expect(notice.locator('button, a, input, [role="button"]')).toHaveCount(0);

    // Spent by the reading, which is what makes the next opening silent. Asserted on the mark and
    // not only on the surface: a notice hidden by a render order would read the same from outside.
    await expect.poll(() => markStillPending(context, extensionId), { timeout: 10_000 }).toBe(false);
    await popup.close();

    const reopened = await openExtensionPage(context, extensionId, 'popup');
    await expect(reopened.getByTestId('scope-status')).toBeVisible();
    await expect(reopened.getByTestId('interruption-notice')).toHaveCount(0);
  });

  test('is the same notice in the side panel, and one surface spends it for both', async ({
    context,
    extensionId,
  }) => {
    await poseInterruptionMark(context, extensionId);

    const panel = await openExtensionPage(context, extensionId, 'sidepanel');
    await expect(panel.getByTestId('interruption-notice')).toBeVisible();
    await expect(panel.getByTestId('interruption-label')).toHaveText('Capture interrupted');
    await expect(panel.getByTestId('interruption-detail')).toContainText('updated');

    // One interruption, not one per surface: the panel took it, so a popup opened after it has
    // nothing left to say — and says nothing rather than repeating the panel.
    await expect.poll(() => markStillPending(context, extensionId), { timeout: 10_000 }).toBe(false);

    const popup = await openExtensionPage(context, extensionId, 'popup');
    await expect(popup.getByTestId('scope-status')).toBeVisible();
    await expect(popup.getByTestId('interruption-notice')).toHaveCount(0);
  });
});

test.describe('the interruption notice before the agreement', () => {
  test.use({ consent: 'pristine' });

  test('is rendered by neither surface, and is not spent behind the gate either', async ({
    context,
    extensionId,
  }) => {
    await poseInterruptionMark(context, extensionId);

    const popup = await openExtensionPage(context, extensionId, 'popup');
    await expect(popup.getByTestId('consent-required')).toBeVisible();
    await expect(popup.getByTestId('interruption-notice')).toHaveCount(0);
    await popup.close();

    const panel = await openExtensionPage(context, extensionId, 'sidepanel');
    await expect(panel.getByTestId('consent-required')).toBeVisible();
    await expect(panel.getByTestId('interruption-notice')).toHaveCount(0);
    await panel.close();

    // Neither surface consumed it, which is why the reading is gated and not only the rendering:
    // reading is what clears the mark, so a surface that read behind the gate would be eating a
    // notice the user is one click away from being entitled to.
    expect(await markStillPending(context, extensionId)).toBe(true);

    const consent = await context.newPage();
    await consent.goto(`chrome-extension://${extensionId}/consent.html`);
    await consent.getByTestId('consent-accept').click();
    await consent.getByTestId('consent-accepted').waitFor();
    await consent.close();

    const reopened = await openExtensionPage(context, extensionId, 'popup');
    await expect(reopened.getByTestId('interruption-notice')).toBeVisible();
  });
});
