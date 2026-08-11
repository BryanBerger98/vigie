import type { BrowserContext, Page } from '@playwright/test';

import {
  buildVariantPath,
  createBuildVariant,
  removeBuildVariant,
} from '../fixtures/build-variant';
import { readCapturedEntries, seedCapturedEntry } from '../fixtures/capture-store';
import { reportFilenamePattern, takeDownload } from '../fixtures/downloaded-report';
import { expect, test } from '../fixtures/extension';
import { startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The popup, driven by clicks — the whole gesture of the product in one surface.
 *
 * What the decisions are is asserted without a browser in `popup/state.test.ts`. What only a
 * browser can state is here: that the surface resolves the tab it is about, that the out-of-scope
 * state leads to a settings page that really watches the domain, that a single click writes the
 * report to a file, and that a refused write is shown rather than passed off as a saved report.
 *
 * Under Playwright the popup is a tab of the extension's own origin, so the active tab is the popup
 * itself and the subject is resolved by the fallback in `popup/subject-tab.ts:50`. Every test here
 * therefore keeps exactly one web tab open, which is the only arrangement where that fallback has
 * one possible answer.
 *
 * The file is read back, which is new. The clipboard this replaced never could be, so what a click
 * produced was taken on the popup's word (`fixtures/downloaded-report.ts:6`).
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
): Promise<{ options: Page; noisy: Page; popup: Page; tabId: number }> {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  await expect
    .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  const popup = await openPopup(context, extensionId);
  await expect(popup.getByTestId('scope-status')).toHaveAttribute('data-state', 'capturing');

  // The subject tab, read off the store rather than guessed: it is the only web tab of the window,
  // so everything the capture wrote came from it.
  const captured = await readCapturedEntries(options);

  return { options, noisy, popup, tabId: captured[0]!.tabId };
}

/**
 * A past the run cannot live through, written straight into the store.
 *
 * Which depths the popup offers is measured on the oldest entry the store holds, so a run that has
 * been capturing for four seconds can only ever reach the shallowest tier. Everything about a
 * remembered depth surviving, or failing to, needs a store deeper than the run itself.
 */
function seedPast(options: Page, tabId: number, ageMs: number, path: string): Promise<void> {
  return seedCapturedEntry(options, {
    kind: 'network',
    domain: site.host,
    tabId,
    timestamp: Date.now() - ageMs,
    requestId: `seed${path.replaceAll('/', '-')}`,
    url: `${site.origin}${path}`,
    method: 'GET',
    outcome: 'completed',
    statusCode: 200,
    resourceType: 'xmlhttprequest',
    responseBody: 'unavailable',
  });
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

  // "et rien d'autre": nothing exports on a tab whose past was never captured — neither the
  // button that would run it nor the caret that would pick another depth for it.
  await expect(popup.getByTestId('export-run')).toHaveCount(0);
  await expect(popup.getByTestId('export-menu')).toHaveCount(0);
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

test('says it is capturing, and writes the report to a file on one click', async ({
  context,
  extensionId,
}) => {
  const { popup } = await capturingPopup(context, extensionId);

  await expect(popup.getByTestId('scope-detail')).toContainText(site.host);
  await expect(popup.getByTestId('tab-context')).toContainText('entries on this tab');

  // Nothing to pick first: the button already says what it exports, and clicking it is the export.
  await expect(popup.getByTestId('export-run')).toContainText('Export 5 min');

  const report = await takeDownload(popup, () => popup.getByTestId('export-run').click());

  expect(report.filename).toMatch(reportFilenamePattern(site.host));
  // The file, not the acknowledgement: what the click produced is the report itself, opening on the
  // domain it is about and carrying the tab it was cut from.
  expect(report.text).toContain(`# Vigie report — ${site.host}`);
  expect(report.text).toContain(`| **URL** | ${site.origin}/noisy |`);

  // The name is repeated on the surface, because a download list holds everything the browser ever
  // wrote and "it worked" is not enough to find one file in it.
  await expect(popup.getByTestId('export-status')).toHaveAttribute('data-state', 'downloaded');
  await expect(popup.getByTestId('export-status-headline')).toContainText(report.filename);
});

test('says why a depth cannot be picked instead of greying it out in silence', async ({
  context,
  extensionId,
}) => {
  // A store seconds old: the shallowest depth still answers, the deeper ones have nothing to add.
  const { popup } = await capturingPopup(context, extensionId);

  await popup.getByTestId('export-menu').click();

  await expect(popup.getByTestId('export-5')).toHaveAttribute('data-enabled', 'true');
  await expect(popup.getByTestId('export-60')).toHaveAttribute('data-enabled', 'false');
  // Written under the tier, not hung off a tooltip: a disabled item takes no hover.
  await expect(popup.getByTestId('export-60')).toHaveAttribute('data-reason', /needs 30 min/);
  await expect(popup.getByTestId('export-60')).toContainText('needs 30 min of capture');
});

test('opens on the depth of the last export rather than asking again', async ({
  context,
  extensionId,
}) => {
  const { options, tabId } = await capturingPopup(context, extensionId);
  await seedPast(options, tabId, 20 * MINUTE, '/twenty-minutes-ago');

  // Reopened rather than reloaded: the popup reads the store and the remembered depth on mount.
  const first = await openPopup(context, extensionId);
  await expect(first.getByTestId('export-run')).toContainText('Export 5 min');

  await first.getByTestId('export-menu').click();
  await first.getByTestId('export-15').click();
  await expect(first.getByTestId('export-status')).toHaveAttribute('data-state', 'downloaded', {
    timeout: 15_000,
  });

  // The label follows the export that just happened, without waiting for a reopen.
  await expect(first.getByTestId('export-run')).toContainText('Export 15 min');

  const second = await openPopup(context, extensionId);
  await expect(second.getByTestId('export-run')).toContainText('Export 15 min');
});

test('falls back to the deepest depth still reachable when the remembered one is not', async ({
  context,
  extensionId,
}) => {
  const { options, tabId } = await capturingPopup(context, extensionId);
  await seedPast(options, tabId, 40 * MINUTE, '/forty-minutes-back');

  const deep = await openPopup(context, extensionId);
  await deep.getByTestId('export-menu').click();
  await deep.getByTestId('export-60').click();
  await expect(deep.getByTestId('export-status')).toHaveAttribute('data-state', 'downloaded', {
    timeout: 15_000,
  });

  // The store loses its depth under the popup: the user erases what was captured, then browses a
  // little. Sixty minutes is now a tier nothing can honour, and it was the remembered one.
  await options.getByTestId('purge-store').click();
  await expect(options.getByTestId('stored-empty')).toBeVisible();
  await seedPast(options, tabId, 20 * MINUTE, '/twenty-minutes-back');

  const shallow = await openPopup(context, extensionId);
  await expect(shallow.getByTestId('export-run')).toContainText('Export 30 min');
});

test('exports the depth the arrow keys reached, with no pointer anywhere', async ({
  context,
  extensionId,
}) => {
  const { options, tabId } = await capturingPopup(context, extensionId);
  await seedPast(options, tabId, 20 * MINUTE, '/twenty-minutes-by-keyboard');

  const popup = await openPopup(context, extensionId);

  await popup.getByTestId('export-menu').focus();
  await popup.keyboard.press('Enter');

  // Enter on the caret opens the menu on its first tier; each arrow moves one down, and the tiers
  // nothing can honour are skipped rather than focused into a dead end.
  //
  // Every step is asserted rather than only the last one, and not for the sake of detail: the menu
  // moves focus on a task of its own rather than inside the key handler, so two presses sent within
  // the same millisecond are both measured against the tier the first one started from and land
  // together on the second tier. A hand cannot press that fast; a driver can. Waiting on each move
  // states the walk and makes it deterministic at the same time.
  await expect(popup.getByTestId('export-5')).toBeFocused();
  await popup.keyboard.press('ArrowDown');
  await expect(popup.getByTestId('export-15')).toBeFocused();
  await popup.keyboard.press('ArrowDown');
  await expect(popup.getByTestId('export-30')).toBeFocused();

  await popup.keyboard.press('Enter');

  await expect(popup.getByTestId('export-status')).toHaveAttribute('data-state', 'downloaded', {
    timeout: 15_000,
  });
  await expect(popup.getByTestId('export-run')).toContainText('Export 30 min');
});

test('announces the depth it delivered when the capture is shorter than the one asked for', async ({
  context,
  extensionId,
}) => {
  const { options, tabId } = await capturingPopup(context, extensionId);

  // Forty minutes of past, seeded: a run cannot browse for forty minutes, and the depth the report
  // announces is only observable against entries older than the click.
  await seedPast(options, tabId, 40 * MINUTE, '/forty-minutes-ago');

  // Reopened rather than reloaded: the popup reads the store on mount, and the seeding happened
  // behind the back of the one already open.
  const popup = await openPopup(context, extensionId);

  await popup.getByTestId('export-menu').click();
  await expect(popup.getByTestId('export-60')).toHaveAttribute('data-enabled', 'true');
  await popup.getByTestId('export-60').click();

  await expect(popup.getByTestId('export-status')).toContainText(/not the 60 min asked/, {
    timeout: 15_000,
  });
});

test('warns that the window is empty before anything is exported', async ({
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

test('shows a refused write rather than letting it pass for a saved report', async ({
  context,
  extensionId,
}) => {
  const { popup } = await capturingPopup(context, extensionId);

  // The refusal an enterprise policy or a blocked download produces, stated to the page. Patched on
  // `createObjectURL` because that is the first browser call `downloadReport` makes, so the failure
  // enters exactly where a real one would (`export/download.ts:44`).
  await popup.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error('blob blocked by policy');
    };
  });

  await popup.getByTestId('export-run').click();

  const status = popup.getByTestId('export-status');
  await expect(status).toHaveAttribute('data-state', 'failed', { timeout: 15_000 });
  await expect(popup.getByTestId('export-status-headline')).toContainText('Not saved');
  await expect(popup.getByTestId('export-status-detail')).toContainText('blob blocked by policy');

  // The one thing a refusal must never do is name a file. A reader who takes a filename away goes
  // looking for it in their downloads, finds nothing, and blames the folder rather than the export.
  await expect(status).not.toContainText('vigie-');
  await expect(status).not.toContainText('Saved ');
});

test('offers both exits, and the settings one reaches a real surface', async ({
  context,
  extensionId,
}) => {
  const { options, popup } = await capturingPopup(context, extensionId);

  // The side panel exit exists, and that is all this can state about what it opens: `sidePanel.open`
  // only works inside a real user gesture on a real toolbar popup, and the panel it opens is browser
  // chrome that Playwright never exposes as a page. What the panel does once open is asserted in
  // `sidepanel-read.spec.ts`, against `sidepanel.html` loaded as an ordinary tab.
  const exit = popup.getByTestId('open-sidepanel');
  await expect(exit).toBeVisible();
  await expect(exit.locator('svg')).toHaveCount(1);

  // Alone on its line since the settings moved to the header, and measured rather than assumed: a
  // `w-full` dropped in a refactor leaves a button that still works and no longer reads as the one
  // step of the gesture it is. The padding is read off the element instead of restated here.
  const available = await popup.getByTestId('popup-root').evaluate((node) => {
    const style = getComputedStyle(node);
    return (
      node.getBoundingClientRect().width -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight)
    );
  });
  const box = await exit.boundingBox();
  expect(Math.abs(box!.width - available)).toBeLessThan(1);

  // The settings tab the setup left open would be focused rather than opened again, and a focus is
  // not evidence that the button reaches a surface.
  await options.close();

  const opening = context.waitForEvent('page');
  await popup.getByTestId('open-options').click();
  const settings = await opening;
  await expect(settings.getByTestId('options-root')).toBeVisible();
});
