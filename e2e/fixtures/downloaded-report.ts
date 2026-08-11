import { readFile } from 'node:fs/promises';

import { expect, type Page } from '@playwright/test';

/**
 * The file an export leaves behind, taken from the browser rather than from what the popup says.
 *
 * This is what the clipboard could never give. `navigator.clipboard.writeText` was unreadable from
 * a spec — CDP refuses clipboard permissions to a `chrome-extension://` origin — so every assertion
 * about an export stopped at the acknowledgement rendered beside it, and the one thing the product
 * actually produces was never looked at. A download is observable end to end: the event carries the
 * name Chrome was offered, and the path of the file it wrote.
 */

export interface DownloadedReport {
  /** The name the extension asked Chrome to save the file under. */
  filename: string;
  /** The bytes on disk, decoded. What a reader would open. */
  text: string;
}

/**
 * The window between the click and the file, expressed in the only order that cannot race.
 *
 * The listener is registered before `trigger` runs, never after: a download can complete inside the
 * click that started it, and a `waitForEvent` awaited afterwards would be listening for something
 * that already happened.
 */
export async function takeDownload(
  page: Page,
  trigger: () => Promise<void>,
): Promise<DownloadedReport> {
  const downloading = page.waitForEvent('download', { timeout: 15_000 });
  await trigger();
  const download = await downloading;

  const path = await download.path();
  expect(path, 'the download event fired but Chrome wrote no file').not.toBeNull();

  return { filename: download.suggestedFilename(), text: await readFile(path!, 'utf8') };
}

/**
 * The name shape `export/filename.ts` promises: the domain first, then the instant, in UTC.
 *
 * Asserted as a shape rather than as a string, because the instant comes from the click and no
 * spec can know it. What matters is that the two parts a download list is sorted and searched by
 * are both there, and that the name carries no character a filesystem would refuse.
 */
export function reportFilenamePattern(domain: string): RegExp {
  const literal = domain.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`^vigie-${literal}-\d{4}-\d{2}-\d{2}-\d{6}\.md$`);
}
