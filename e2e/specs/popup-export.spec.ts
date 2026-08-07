import type { BrowserContext, Page } from '@playwright/test';

import {
  buildVariantPath,
  createBuildVariant,
  removeBuildVariant,
} from '../fixtures/build-variant';
import { readCapturedEntries, seedCapturedEntry } from '../fixtures/capture-store';
import { expect, test } from '../fixtures/extension';
import { startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The popup, driven by clicks — the whole gesture of the product in one surface.
 *
 * What the decisions are is asserted without a browser in `popup/state.test.ts`. What only a
 * browser can state is here: that the surface resolves the tab it is about, that the out-of-scope
 * state leads to a settings page that really watches the domain, that a single click puts a report
 * in the clipboard, and that a refused clipboard is shown rather than passed off as a copy.
 *
 * Under Playwright the popup is a tab of the extension's own origin, so the active tab is the popup
 * itself and the subject is resolved by the fallback in `popup/subject-tab.ts:50`. Every test here
 * therefore keeps exactly one web tab open, which is the only arrangement where that fallback has
 * one possible answer.
 *
 * The clipboard is never read back: CDP refuses to grant clipboard permissions to a
 * `chrome-extension://` origin. The displayed acknowledgement is the evidence, and the refusal test
 * is what proves it is not printed unconditionally.
 */

const POPUP_BUILD = buildVariantPath('popup-export');

test.use({ extensionPath: POPUP_BUILD });
test.setTimeout(90_000);

const MINUTE = 60_000;

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(POPUP_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(POPUP_BUILD);
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

/**
 * A watched site with traffic on disk, and the popup opened over it.
 *
 * The order matters: the site tab is opened before the popup and is the only web tab of the window,
 * so it is unambiguously the subject. The wait on the store is not politeness — the popup reads the
 * capture on mount, and opening it before the first write would describe an empty store truthfully
 * but not the one the test is about.
 */
async function capturingPopup(
  context: BrowserContext,
  extensionId: string,
): Promise<{ options: Page; noisy: Page; popup: Page }> {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  await expect
    .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  const popup = await openPopup(context, extensionId);
  await expect(popup.getByTestId('scope-status')).toHaveAttribute('data-state', 'capturing');

  return { options, noisy, popup };
}

test('names the tab out of scope and offers only the one action that resolves it', async ({
  context,
  extensionId,
}) => {
  // Nothing watched: the state a first-time user opens the popup in.
  const page = await context.newPage();
  await page.goto(`${site.origin}/`, { waitUntil: 'load' });

  const popup = await openPopup(context, extensionId);

  await expect(popup.getByTestId('scope-status')).toHaveAttribute('data-state', 'out-of-scope');
  await expect(popup.getByTestId('scope-detail')).toContainText(site.host);
  await expect(popup.getByTestId('scope-watch-domain')).toContainText(site.host);

  // "et rien d'autre": no depth can be clicked on a tab whose past was never captured.
  await expect(popup.getByTestId('export-5')).toHaveCount(0);
  await expect(popup.getByTestId('export-60')).toHaveCount(0);
});

test('hands the domain over to the settings, already filled in and one click from watched', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`${site.origin}/`, { waitUntil: 'load' });

  const popup = await openPopup(context, extensionId);

  const opening = context.waitForEvent('page');
  await popup.getByTestId('scope-watch-domain').click();
  const settings = await opening;
  await expect(settings.getByTestId('options-root')).toBeVisible();

  // The domain travels with the handover: the prompt is raised here because Chrome closes a popup
  // to show it, and retyping the site would be the second half of a request already made.
  await expect(settings.getByTestId('add-domain-input')).toHaveValue(site.host);

  await settings.getByTestId('add-domain-submit').click();
  await expect(settings.getByTestId('watched-domain-row')).toHaveCount(1);
});

test('says it is capturing, and reaches the clipboard on one click', async ({
  context,
  extensionId,
}) => {
  const { popup } = await capturingPopup(context, extensionId);

  await expect(popup.getByTestId('scope-detail')).toContainText(site.host);
  await expect(popup.getByTestId('tab-context')).toContainText('entries on this tab');

  await popup.getByTestId('export-5').click();

  await expect(popup.getByTestId('export-status')).toContainText('Copied', { timeout: 15_000 });
  await expect(popup.getByTestId('copy-retry')).toHaveCount(0);
});

test('says why a depth cannot be clicked instead of greying it out in silence', async ({
  context,
  extensionId,
}) => {
  // A store seconds old: the shallowest depth still answers, the deeper ones have nothing to add.
  const { popup } = await capturingPopup(context, extensionId);

  await expect(popup.getByTestId('export-5')).toBeEnabled();
  await expect(popup.getByTestId('export-60')).toBeDisabled();
  await expect(popup.getByTestId('export-60')).toHaveAttribute('data-reason', /needs 30 min/);
  await expect(popup.getByTestId('depth-notice')).toContainText('does not reach back that far yet');
});

test('announces the depth it delivered when the capture is shorter than the one asked for', async ({
  context,
  extensionId,
}) => {
  const { options } = await capturingPopup(context, extensionId);

  // The subject tab, read off the store rather than guessed: it is the only web tab of the window,
  // so everything the capture wrote came from it.
  const captured = await readCapturedEntries(options);
  const subjectTabId = captured[0]!.tabId;

  // Forty minutes of past, seeded: a run cannot browse for forty minutes, and the depth the report
  // announces is only observable against entries older than the click.
  await seedCapturedEntry(options, {
    kind: 'network',
    domain: site.host,
    tabId: subjectTabId,
    timestamp: Date.now() - 40 * MINUTE,
    requestId: 'seed-forty-minutes-ago',
    url: `${site.origin}/forty-minutes-ago`,
    method: 'GET',
    outcome: 'completed',
    statusCode: 200,
    resourceType: 'xmlhttprequest',
    responseBody: 'unavailable',
  });

  // Reopened rather than reloaded: the popup reads the store on mount, and the seeding happened
  // behind the back of the one already open.
  const popup = await openPopup(context, extensionId);

  await expect(popup.getByTestId('export-60')).toBeEnabled();
  await popup.getByTestId('export-60').click();

  await expect(popup.getByTestId('export-status')).toContainText(/not the 60 min asked/, {
    timeout: 15_000,
  });
});

test('warns that the window is empty before anything is copied', async ({
  context,
  extensionId,
}) => {
  // The tab is visited first and watched afterwards, so the domain is in scope while this tab's
  // past is not. A user reaches that state every time they designate a site they were already on.
  const page = await context.newPage();
  await page.goto(`${site.origin}/`, { waitUntil: 'load' });

  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const popup = await openPopup(context, extensionId);

  await expect(popup.getByTestId('scope-status')).toHaveAttribute('data-state', 'capturing');
  await expect(popup.getByTestId('tab-context')).toContainText(
    'nothing captured on this tab yet, so a report would come out empty',
  );
});

test('shows a refused clipboard rather than letting it pass for a copy', async ({
  context,
  extensionId,
}) => {
  const { popup } = await capturingPopup(context, extensionId);

  // The refusal a locked-down policy or a lost user activation produces, stated to the page.
  await popup.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('clipboard blocked by policy'));
  });

  await popup.getByTestId('export-5').click();

  await expect(popup.getByTestId('export-status')).toContainText(
    'Report ready but not copied: clipboard blocked by policy',
    { timeout: 15_000 },
  );
  // A retry is a new click and therefore a new transient activation — the thing the write lacked.
  await expect(popup.getByTestId('copy-retry')).toBeVisible();
});

test('offers both exits, and the settings one reaches a real surface', async ({
  context,
  extensionId,
}) => {
  const { options, popup } = await capturingPopup(context, extensionId);

  // The side panel exit exists, and that is all this can state about it: `sidePanel.open` only
  // works inside a real user gesture on a real toolbar popup, and the panel it opens is browser
  // chrome that Playwright never exposes as a page. What the panel does once open is asserted in
  // `sidepanel-read.spec.ts`, against `sidepanel.html` loaded as an ordinary tab.
  await expect(popup.getByTestId('open-sidepanel')).toBeVisible();

  // The settings tab the setup left open would be focused rather than opened again, and a focus is
  // not evidence that the button reaches a surface.
  await options.close();

  const opening = context.waitForEvent('page');
  await popup.getByTestId('open-options').click();
  const settings = await opening;
  await expect(settings.getByTestId('options-root')).toBeVisible();
});
