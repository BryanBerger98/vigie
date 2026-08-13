import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * The build variant every spec that needs host access loads, and the controls that drive it.
 *
 * ## Why a variant at all
 *
 * The shipped manifest declares `optional_host_permissions` only, and `permissions.request()`
 * opens a native Views bubble no automation surface can answer: under Playwright the promise
 * stays pending forever. Chrome's internal `developerPrivate` API does not help either — optional
 * host permissions are absent from its runtime host-access model, so its grant calls report
 * success and change nothing. Measured in phase 2; see `measure-permissions.md`, gap G1.
 *
 * The measurable equivalent is a *withheld required host permission*: the same runtime state — a
 * listener registered while the extension holds no host access — and it is scriptable through
 * `developerPrivate.updateExtensionConfiguration`.
 *
 * ## What the swap costs
 *
 * The grant path differs: Chrome's site-access setting rather than the optional-permission
 * prompt. The extension code, the listeners and the dispatch rules are identical, so anything a
 * spec concludes about *what the extension does with access* holds. What no spec here can cover
 * is the prompt itself — that lives in phase 11's manual recipe.
 */

const SHIPPED_BUILD = fileURLToPath(
  new URL('../../apps/extension/.output/chrome-mv3', import.meta.url),
);

/**
 * Where a variant is written. The path is derived from a name the spec chooses so `test.use` can
 * declare it before `beforeAll` fills it in, and so two spec files never share one directory.
 */
export function buildVariantPath(name: string): string {
  return join(tmpdir(), `vigie-build-${name}`);
}

/**
 * Copies the shipped build to `path` and makes its host permission required rather than optional.
 * Call it from `beforeAll`; call `removeBuildVariant` from `afterAll`.
 *
 * The deep layer needs no swap of its own. `debugger` is a required permission in the shipped
 * manifest, because Chrome refuses it as an optional one — measured on Chromium 151.0.7922.34,
 * `permissions.request` answers "Only permissions specified in the manifest may be requested" and
 * `permissions.getAll()` never lists it (`apps/extension/wxt.config.ts:37`). The variants that used
 * to force it here now run on the same permission set as the users.
 */
export async function createBuildVariant(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  await cp(SHIPPED_BUILD, path, { recursive: true });

  const manifestPath = join(path, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.host_permissions = ['*://*/*'];

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

export function removeBuildVariant(path: string): Promise<void> {
  return rm(path, { recursive: true, force: true });
}

/** How much of a site the extension may see. Chrome's own three settings. */
export type HostAccess = 'ON_CLICK' | 'ON_SPECIFIC_SITES' | 'ON_ALL_SITES';

/**
 * The `chrome` surfaces these helpers drive from inside the browser. `@types/chrome` is not a
 * dependency of this workspace, and pulling it in for a handful of call sites would weigh more
 * than declaring them.
 */
interface ChromeSurface {
  developerPrivate: {
    updateExtensionConfiguration(
      options: { extensionId: string; hostAccess: string },
      callback: () => void,
    ): void;
  };
  runtime: { lastError?: { message: string } };
}

/**
 * Opens the page the site-access control lives on. `developerPrivate` is exposed to the
 * extensions WebUI only — never to the service worker, never to an extension page of ours.
 */
export async function openSiteAccessControl(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${extensionId}`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((globalThis as unknown as { chrome?: ChromeSurface }).chrome?.developerPrivate),
      ),
    )
    .toBe(true);
  return page;
}

/** Sets the extension's site access. Resolves to `'ok'`, or to the error Chrome reported. */
export function setHostAccess(
  control: Page,
  extensionId: string,
  hostAccess: HostAccess,
): Promise<string> {
  return control.evaluate(
    ([id, access]) =>
      new Promise<string>((resolve) => {
        const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
        chrome.developerPrivate.updateExtensionConfiguration(
          { extensionId: id, hostAccess: access },
          () => resolve(chrome.runtime.lastError ? `error: ${chrome.runtime.lastError.message}` : 'ok'),
        );
      }),
    [extensionId, hostAccess] as const,
  );
}
