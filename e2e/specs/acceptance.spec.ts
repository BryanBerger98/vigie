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
 * The acceptance criteria of `spec.md:38-46`, run against the shipped build.
 *
 * Every other spec in this suite is about one phase's mechanism. This one is about the product
 * being finished: each test carries the criterion it answers, in the terms the specification uses,
 * so that reading the run tells you which promises hold rather than which modules work.
 *
 * Four of the seven criteria are not testable here and are not faked into passing:
 *
 * - "a report on a bug that already happened" and "no perceptible degradation after an hour" need
 *   a real application and an unanticipated bug — the manual recipe of `phase-11.md:96`.
 * - "an AI agent answers *what happened?* from the pasted report alone" is verified by doing it.
 * - "no outbound request" is verified by watching the traffic, not by reading the code.
 *
 * What is left is mechanical, and it is what this file covers. `acceptance-report.md` records all
 * seven, with what was observed for each.
 */

const ACCEPTANCE_BUILD = buildVariantPath('acceptance');

test.use({ extensionPath: ACCEPTANCE_BUILD });
test.setTimeout(90_000);

const MINUTE = 60_000;

/** The export message, as `@vigie/contract` declares it. This workspace does not depend on it. */
const EXPORT_MESSAGE = 'vigie:export';

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(ACCEPTANCE_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(ACCEPTANCE_BUILD);
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

async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByTestId('popup-root')).toBeVisible();
  return page;
}

/** Designates a domain through the form, the way a user does. */
async function watch(options: Page, domain: string): Promise<void> {
  await options.getByTestId('add-domain-input').fill(domain);
  await options.getByTestId('add-domain-submit').click();
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);
}

/** Asks the worker for a report, naming the tab explicitly rather than relying on a surface. */
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
 * A designated site with traffic on disk, and its tab left open.
 *
 * The tab stays open because a report is about a live tab and `tabs.get` refuses a closed one. It
 * is also the only web tab of the window, which is what makes the popup's subject unambiguous.
 */
async function capturing(
  context: BrowserContext,
  extensionId: string,
): Promise<{ options: Page; noisy: Page; tabId: number }> {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  await expect
    .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  return { options, noisy, tabId: await tabIdFor(options, `${site.origin}/noisy`) };
}

/**
 * `spec.md:44`, first half — "un domaine jamais désigné ne laisse aucune donnée stockée ni
 * exportable".
 *
 * The designation happens at the end rather than at the start, and that ordering is the test: it
 * proves the capture was live and healthy on this profile the whole time, so the empty store of
 * the first half is the scope refusing to write and not a capture that never started.
 */
test('a domain never designated leaves nothing stored and nothing to export', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);

  const noisy = await site.openNoisy(context);
  await flushCapture(options);
  expect(await readCapturedEntries(options)).toHaveLength(0);

  // Nothing to export either, and the popup says so by offering the one action that resolves it.
  const popup = await openPopup(context, extensionId);
  await expect(popup.getByTestId('scope-status')).toHaveAttribute('data-state', 'out-of-scope');
  await expect(popup.getByTestId('export-5')).toHaveCount(0);
  await expect(popup.getByTestId('export-60')).toHaveCount(0);

  const tabId = await tabIdFor(options, `${site.origin}/noisy`);
  const { bundle } = await requestExport(options, tabId, 60);
  expect(bundle!.entries).toHaveLength(0);

  // And now the same traffic, on the same profile, once the domain is designated.
  await watch(options, site.host);
  await noisy.reload({ waitUntil: 'load' });
  await expect
    .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);
});

/**
 * `spec.md:44`, second half — "retirer un domaine arrête sa capture et efface ce qui le
 * concernait".
 *
 * The build variant holds its host permission as required, so Chrome keeps delivering the events
 * after the removal and the browser is not what stops the capture. That is the point: what stops
 * it is the scope, which is the barrier the product claims.
 */
test('removing a domain stops its capture and erases what it held', async ({
  context,
  extensionId,
}) => {
  const { options, noisy } = await capturing(context, extensionId);

  await options.getByTestId('watched-domain-remove').click();
  await expect(options.getByTestId('remove-warning')).toContainText('cannot be undone');
  await options.getByTestId('remove-confirm').click();
  await expect(options.getByTestId('watched-domains-empty')).toBeVisible();

  expect(await readCapturedEntries(options)).toHaveLength(0);

  // Traffic after the removal, on the very tab that was being captured a moment ago.
  await noisy.evaluate(() => fetch('/after-the-removal?x=1').then((response) => response.text()));
  await flushCapture(options);
  expect(await readCapturedEntries(options)).toHaveLength(0);
});

/**
 * `spec.md:41` — "choisir une profondeur puis cliquer place le rapport dans le presse-papier ;
 * aucun champ n'est demandé, aucune étape ne s'intercale".
 *
 * The clipboard is never read back: CDP refuses to grant clipboard permissions to a
 * `chrome-extension://` origin. The rendered acknowledgement is the evidence, and
 * `popup-export.spec.ts` is what proves it is not printed unconditionally.
 */
test('a depth and a click, and the report is on the clipboard', async ({ context, extensionId }) => {
  await capturing(context, extensionId);
  const popup = await openPopup(context, extensionId);

  await expect(popup.getByTestId('scope-status')).toHaveAttribute('data-state', 'capturing');

  // "aucun champ n'est demandé": there is nothing on this surface to type into.
  await expect(popup.locator('input, textarea, select')).toHaveCount(0);

  // All four depths, reachable from the same surface with no screen in between (`spec.md:11`).
  for (const depth of [5, 15, 30, 60]) {
    await expect(popup.getByTestId(`export-${depth}`)).toBeVisible();
  }

  // "aucune étape ne s'intercale": one click, and the next thing that happens is the copy.
  await popup.getByTestId('export-5').click();
  await expect(popup.getByTestId('export-status')).toContainText('Copied', { timeout: 15_000 });
});

/**
 * `spec.md:42` — the report carries the three kinds, ordered and stamped, names the window, the
 * domain and the tab, and states every missing response body instead of omitting it.
 *
 * Read from the worker's answer rather than from the clipboard, for the reason above. What the
 * click puts on the clipboard is this same string: the popup passes `markdown` straight to
 * `copyToClipboard` (`popup/App.tsx:277`).
 */
test('the report names the window, the domain and the tab, and declares its gaps', async ({
  context,
  extensionId,
}) => {
  const { options, tabId } = await capturing(context, extensionId);

  // The noisy page logs while loading and throws a turn later, so the tab produces all three
  // kinds. Waiting on them matters: console entries travel through the relay, not `webRequest`.
  await expect
    .poll(
      async () => new Set((await readCapturedEntries(options)).map((entry) => entry.kind)).size,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(1);

  const { bundle, markdown } = await requestExport(options, tabId, 15);

  expect(markdown).toContain(`# Vigie report — ${site.host}`);
  expect(markdown).toContain(`Subject: ${site.host}, tab ${tabId}`);
  expect(markdown).toContain(`URL: ${site.origin}/noisy`);
  expect(markdown).toContain('Window: 15 min requested,');

  const kinds = new Set(bundle!.entries.map((entry) => entry.kind));
  expect(kinds.has('network')).toBe(true);
  expect(kinds.size).toBeGreaterThan(1);

  const stamps = bundle!.entries.map((entry) => entry.timestamp);
  expect([...stamps]).toEqual([...stamps].sort((a, b) => a - b));

  // The gaps are declared, and once per request rather than once per report: an absence stated in
  // the header and then omitted from the entries is an absence a reader stops seeing.
  const requests = bundle!.entries.filter((entry) => entry.kind === 'network').length;
  expect(markdown).toContain('## What this report does not contain');
  expect(markdown).toContain('Response bodies are not included.');
  expect(markdown!.split('response body: not available').length - 1).toBe(requests);
});

/**
 * `spec.md:46`, the part a suite can reach — "aucune donnée antérieure à une heure encore
 * présente".
 *
 * The hour is simulated by seeding a past the run cannot live through, then letting the write path
 * do what it does on every flush. Nothing here calls the purge directly: what is under test is
 * that an ordinary write is enough, since an MV3 worker offers no timer that survives it.
 */
test('nothing older than an hour survives a simulated hour', async ({ context, extensionId }) => {
  const { options, noisy, tabId } = await capturing(context, extensionId);
  const now = Date.now();

  const seed = (timestamp: number, path: string) =>
    seedCapturedEntry(options, {
      kind: 'network',
      domain: site.host,
      tabId,
      timestamp,
      requestId: `seed-${path}`,
      url: `${site.origin}${path}`,
      method: 'GET',
      outcome: 'completed',
      statusCode: 200,
      resourceType: 'xmlhttprequest',
      responseBody: 'unavailable',
    });

  await seed(now - 61 * MINUTE, '/an-hour-and-one-minute-ago');
  await seed(now - 30 * MINUTE, '/thirty-minutes-ago');

  // One ordinary request, and the flush that follows any capture. This is the whole mechanism.
  await noisy.evaluate(() => fetch('/still-browsing?x=1').then((response) => response.text()));
  await flushCapture(options);

  const stored = await readCapturedEntries(options);
  expect(stored.some((entry) => entry.url?.includes('/an-hour-and-one-minute-ago'))).toBe(false);
  expect(stored.some((entry) => entry.url?.includes('/thirty-minutes-ago'))).toBe(true);
  expect(stored.every((entry) => entry.timestamp > Date.now() - 60 * MINUTE)).toBe(true);

  // Not exportable either, at the deepest window the product offers (`spec.md:12`).
  const { markdown } = await requestExport(options, tabId, 60);
  expect(markdown).not.toContain('/an-hour-and-one-minute-ago');
  expect(markdown).toContain('/thirty-minutes-ago');
});
