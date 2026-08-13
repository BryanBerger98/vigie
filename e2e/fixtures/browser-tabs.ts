import { expect, type Page } from '@playwright/test';

/**
 * Drives browser tabs through `chrome.tabs.*`, from a page of the extension's own origin.
 *
 * Playwright is deliberately not the way tabs are opened in the CDP suites. Attaching
 * `chrome.debugger` to a page a second CDP client already drives detaches that client's frame —
 * measured in phase 1, where a whole run had to be thrown away for it
 * (`cdp-terminal-event-gap.md:58`). So a spec about the deep layer opens, navigates and closes its
 * tabs from an extension page, and never reaches into a watched tab.
 */

/**
 * The `chrome.tabs` surface these helpers reach for. `@types/chrome` is not a dependency of this
 * workspace, and the fixtures declare what they use rather than pulling the whole surface in.
 */
export interface ChromeTabsSurface {
  tabs: {
    create(properties: { url: string; active: boolean }): Promise<{ id?: number }>;
    update(tabId: number, properties: { url: string }): Promise<unknown>;
    remove(tabId: number): Promise<void>;
    get(tabId: number): Promise<{ url?: string; status?: string }>;
  };
}

/**
 * Waits for a tab to have finished loading the URL it was sent to.
 *
 * The deep layer reconciles on `tabs.onUpdated`, which Chrome raises the moment the URL changes —
 * long before `complete`. Waiting for the later of the two is what makes "nothing attached" a
 * statement about the layer rather than about a page that had not arrived yet.
 */
export async function settled(driver: Page, tabId: number, url: string): Promise<void> {
  await expect
    .poll(
      () =>
        driver.evaluate(
          async ([target, expected]) => {
            const { chrome } = globalThis as unknown as { chrome: ChromeTabsSurface };
            const tab = await chrome.tabs.get(target as number);
            // `startsWith` rather than an equality: Chrome hands an origin back with the root path
            // appended, and a spec pinning the exact string would be pinning that detail.
            return tab.status === 'complete' && (tab.url ?? '').startsWith(expected as string);
          },
          [tabId, url] as const,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** Opens a background tab and hands back its id once the browser has settled it on `url`. */
export async function openTab(driver: Page, url: string): Promise<number> {
  const tabId = await driver.evaluate(async (target) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeTabsSurface };
    const tab = await chrome.tabs.create({ url: target, active: false });
    if (tab.id === undefined) throw new Error(`no tab id for ${target}`);
    return tab.id;
  }, url);

  await settled(driver, tabId, url);
  return tabId;
}

export async function navigateTab(driver: Page, tabId: number, url: string): Promise<void> {
  await driver.evaluate(
    ([target, destination]) => {
      const { chrome } = globalThis as unknown as { chrome: ChromeTabsSurface };
      return chrome.tabs.update(target as number, { url: destination as string });
    },
    [tabId, url] as const,
  );
  await settled(driver, tabId, url);
}

export function closeTab(driver: Page, tabId: number): Promise<void> {
  return driver.evaluate((target) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeTabsSurface };
    return chrome.tabs.remove(target);
  }, tabId);
}
