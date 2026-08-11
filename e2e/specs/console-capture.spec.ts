import type { BrowserContext, Page } from '@playwright/test';

import {
  buildVariantPath,
  createBuildVariant,
  removeBuildVariant,
} from '../fixtures/build-variant';
import { flushCapture, readCapturedEntries, type StoredEntry } from '../fixtures/capture-store';
import { expect, test } from '../fixtures/extension';
import { NOISY, startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The console and error capture, end to end, in a real page of a real browser.
 *
 * Everything here is asserted from IndexedDB, for the same reason as the network suite: the report
 * is cut from what landed on disk. The one exception is the "the page keeps its own console" test,
 * which reads Playwright's console events — the page's output is precisely what the store cannot
 * tell us about.
 *
 * Same shared build variant as the other suites: the host permission is required rather than
 * optional, so adding a domain grants access without a prompt no automation can answer.
 */

const CAPTURE_BUILD = buildVariantPath('console-capture');

test.use({ extensionPath: CAPTURE_BUILD });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let site: TestSite;

test.beforeAll(async () => {
  await createBuildVariant(CAPTURE_BUILD);
  site = await startTestSite();
});

test.afterAll(async () => {
  await site.close();
  await removeBuildVariant(CAPTURE_BUILD);
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

async function captured(page: Page): Promise<StoredEntry[]> {
  await flushCapture(page);
  return readCapturedEntries(page);
}

/** The text of every stored console entry. */
async function consoleTexts(page: Page): Promise<string[]> {
  const entries = (await captured(page)) as (StoredEntry & { text?: string })[];
  return entries.filter((entry) => entry.kind === 'console').map((entry) => entry.text ?? '');
}

/** Waits until a console entry whose text contains `needle` has landed, then returns every entry. */
async function untilLogged(page: Page, needle: string): Promise<StoredEntry[]> {
  await expect
    .poll(async () => (await consoleTexts(page)).some((text) => text.includes(needle)), {
      timeout: 15_000,
    })
    .toBe(true);
  return captured(page);
}

test('a log emitted while the page is still loading is captured', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);

  // The load-time line is the hard one: it is emitted by an inline script in `<head>`, so the
  // capture has to be installed before the page's own parsing reaches it.
  const entries = await untilLogged(options, NOISY.load);
  const log = entries.find((entry) => (entry as { text?: string }).text?.includes(NOISY.load));

  expect(log).toMatchObject({ kind: 'console', level: 'log', domain: site.host });
  expect(log?.tabId).toBeGreaterThanOrEqual(0);

  await noisy.close();
});

test('the level of each call is kept', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  const entries = await untilLogged(options, NOISY.warn);

  const warning = entries.find((entry) => (entry as { text?: string }).text?.includes(NOISY.warn));

  expect(warning).toMatchObject({ kind: 'console', level: 'warn' });

  await noisy.close();
});

test('a circular object is stored as readable text rather than blocking the page', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  await untilLogged(options, NOISY.circular);

  const text = (await consoleTexts(options)).find((candidate) => candidate.includes(NOISY.circular));

  expect(text).toContain('[Circular]');
  // The page went on living after logging it, which is the part a hang would break.
  await expect(noisy.getByText('noisy')).toBeVisible();

  await noisy.close();
});

test('an uncaught error is captured with its stack', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);

  await expect
    .poll(
      async () =>
        (await captured(options)).some(
          (entry) =>
            entry.kind === 'error' &&
            (entry as { source?: string }).source === 'uncaught' &&
            (entry as { message?: string }).message?.includes(NOISY.uncaught),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  const failure = (await captured(options)).find(
    (entry) => (entry as { source?: string }).source === 'uncaught',
  ) as (StoredEntry & { stack?: string; message?: string }) | undefined;

  expect(failure).toMatchObject({ kind: 'error', domain: site.host });
  expect(failure?.stack).toContain(NOISY.uncaught);

  await noisy.close();
});

test('a promise rejected with nobody listening is captured', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);

  await expect
    .poll(
      async () =>
        (await captured(options)).some(
          (entry) => (entry as { source?: string }).source === 'unhandledrejection',
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  const rejection = (await captured(options)).find(
    (entry) => (entry as { source?: string }).source === 'unhandledrejection',
  ) as (StoredEntry & { message?: string }) | undefined;

  expect(rejection?.message).toContain(NOISY.rejection);

  await noisy.close();
});

test('the page still prints its own console output', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await context.newPage();
  const printed: { type: string; text: string }[] = [];
  noisy.on('console', (message) => printed.push({ type: message.type(), text: message.text() }));

  await noisy.goto(`${site.origin}/noisy`, { waitUntil: 'load' });
  await untilLogged(options, NOISY.load);

  // What devtools shows has to be unchanged: the page's three calls, at their own levels, in the
  // order it made them — each once, not twice.
  const ours = printed.filter((line) => line.text.includes('vigie-e2e'));

  expect(ours).toHaveLength(3);
  expect(ours[0]).toEqual({ type: 'log', text: NOISY.load });
  expect(ours[1]).toEqual({ type: 'warning', text: NOISY.warn });
  expect(ours[2]?.type).toBe('log');
  expect(ours[2]?.text).toContain(NOISY.circular);

  // And nothing of ours added to them: the capture never writes to the page it observes.
  expect(printed.map((line) => line.text).join('\n')).not.toContain('[vigie]');

  await noisy.close();
});

test('a console entry and a network entry of the same tab share one timeline', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  await untilLogged(options, NOISY.load);

  const entries = await captured(options);
  const log = entries.find((entry) => entry.kind === 'console');
  const request = entries.find((entry) => entry.kind === 'network');

  expect(log).toBeDefined();
  expect(request).toBeDefined();

  // The same base, which is what makes one report out of two capture paths.
  expect(log?.domain).toBe(request?.domain);
  expect(log?.tabId).toBe(request?.tabId);

  // And one chronological order across kinds, not two interleaved sequences.
  const timestamps = entries.map((entry) => entry.timestamp);
  expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));

  await noisy.close();
});

test('a page with a strict content security policy is captured all the same', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const strict = await site.openStrict(context);

  // `script-src 'self'` forbids anything the extension could append to the document. The capture
  // does not append anything: Chrome injects the main-world half itself, outside the policy.
  await untilLogged(options, NOISY.load);

  expect(await strict.evaluate(() => '__vigieConsolePatch' in console.log)).toBe(true);

  await strict.close();
});

test('a domain nobody watches is never injected into and writes nothing', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);

  const noisy = await site.openNoisy(context);
  await expect(options.getByTestId('watched-domains-empty')).toBeVisible();

  // Nothing of ours ran in the page: the capture patch is registered per watched domain, so an
  // unwatched one has no script at all rather than a script that filters itself out.
  const patched = await noisy.evaluate(
    () => String(console.log).includes('patchedConsoleMethod') || '__vigieConsolePatch' in console.log,
  );
  expect(patched).toBe(false);

  expect(await captured(options)).toEqual([]);

  await noisy.close();
});
