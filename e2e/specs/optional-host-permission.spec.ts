import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from '../fixtures/extension';

/**
 * Measures how a `webRequest` listener behaves across a host-permission grant and revocation
 * (phase 2 of the extension-scope plan).
 *
 * ## Why this spec loads a patched build
 *
 * The shipped manifest declares `optional_host_permissions` only, and `permissions.request()`
 * opens a native Views bubble that no automation surface can answer: the promise stays pending
 * forever under Playwright. Chrome's own `developerPrivate` API cannot help either — optional
 * host permissions are absent from its runtime host-access model, so its grant calls report
 * success and change nothing.
 *
 * The measurable equivalent is the *withheld required host permission*: same runtime state
 * (a listener registered before the extension holds host access), reachable from script. So the
 * build under test here is the shipped one plus a required `host_permissions` entry matching every
 * URL, and the grant is driven with `developerPrivate.updateExtensionConfiguration`.
 *
 * What that swap costs in fidelity: the grant path differs (Chrome's site-access setting rather
 * than an optional-permission prompt); the extension code, the listener and the dispatch rules
 * do not. The conclusion — when Chrome evaluates host access for `webRequest` — is a property of
 * dispatch, not of how the origin was granted.
 */

const SHIPPED_BUILD = fileURLToPath(
  new URL('../../apps/extension/.output/chrome-mv3', import.meta.url),
);

/** Deterministic so `test.use` can name it before `beforeAll` fills it in. */
const MEASUREMENT_BUILD = join(tmpdir(), 'vigie-measurement-build');

const MEASUREMENT_STATE_KEY = 'vigie:measurement';

/** The slice of the background's measurement state this spec reads back. */
interface MeasurementState {
  workerStarts: number;
  networkEvents: number;
  permissionChanges: { change: 'added' | 'removed'; origins: string[] }[];
}

/**
 * The `chrome` surfaces driven from inside the browser. `@types/chrome` is not a dependency of
 * this workspace, and pulling it in for four call sites would be heavier than declaring them.
 */
interface ChromeSurface {
  storage: { session: { get(key: string): Promise<Record<string, unknown>> } };
  webRequest: { onCompleted: { addListener(listener: () => void, filter: { urls: string[] }): void } };
  developerPrivate: {
    updateExtensionConfiguration(
      options: { extensionId: string; hostAccess: string },
      callback: () => void,
    ): void;
  };
  runtime: { lastError?: { message: string }; reload(): void };
}

test.use({ extensionPath: MEASUREMENT_BUILD });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let server: Server;
let origin: string;

test.beforeAll(async () => {
  await rm(MEASUREMENT_BUILD, { recursive: true, force: true });
  await mkdir(MEASUREMENT_BUILD, { recursive: true });
  await cp(SHIPPED_BUILD, MEASUREMENT_BUILD, { recursive: true });

  const manifestPath = join(MEASUREMENT_BUILD, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.host_permissions = ['*://*/*'];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // A page that pulls a sub-resource, so one visit produces several `onCompleted` events.
  server = createServer((request, response) => {
    if (request.url?.endsWith('.js')) {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end('globalThis.__vigieAsset = true;');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>site</title><script src="/asset.js"></script><p>ok</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(MEASUREMENT_BUILD, { recursive: true, force: true });
});

/** `developerPrivate` is only reachable from the extensions WebUI, never from the worker. */
async function openSiteAccessControl(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${extensionId}`);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((globalThis as unknown as { chrome?: ChromeSurface }).chrome?.developerPrivate)),
    )
    .toBe(true);
  return page;
}

function setHostAccess(page: Page, extensionId: string, hostAccess: 'ON_CLICK' | 'ON_ALL_SITES') {
  return page.evaluate(
    ([id, access]) =>
      new Promise<string>((resolve) => {
        const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
        chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, hostAccess: access }, () =>
          resolve(chrome.runtime.lastError ? `error: ${chrome.runtime.lastError.message}` : 'ok'),
        );
      }),
    [extensionId, hostAccess] as const,
  );
}

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

async function visit(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'load' });
  await page.close();
}

test('no network event is recorded while host access is withheld', async ({ context, extensionId }) => {
  const control = await openSiteAccessControl(context, extensionId);
  expect(await setHostAccess(control, extensionId, 'ON_CLICK')).toBe('ok');

  await visit(context);

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

  await visit(context);
  expect(await readFrozenProbe()).toBe(0);

  expect(await setHostAccess(control, extensionId, 'ON_ALL_SITES')).toBe('ok');
  await visit(context);

  expect(await readFrozenProbe()).toBeGreaterThan(0);
});

test('revoking host access stops delivery on that same listener', async ({ context, extensionId }) => {
  const control = await openSiteAccessControl(context, extensionId);

  await visit(context);
  const granted = await readMeasurement(context, extensionId);
  expect(granted.networkEvents).toBeGreaterThan(0);

  expect(await setHostAccess(control, extensionId, 'ON_CLICK')).toBe('ok');
  await visit(context);

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
  await visit(context);
  const afterFirst = await readMeasurement(context, extensionId);
  await visit(context);
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

  await visit(context);

  await expect.poll(readCounter).toBeGreaterThan(before);
});
