import { isExportDepth, type ExportDepthMinutes } from '@vigie/contract';

/**
 * The depth the last export was taken at.
 *
 * Stored in `chrome.storage.local`, deliberately not in `sync`: this is a habit of one machine, not
 * a setting of one person. A developer who exports five-minute windows on a laptop and hour-long
 * ones on a workstation would have the two overwrite each other for no benefit either of them
 * asked for.
 *
 * It is a preference, not a promise. Anything unreadable — absent, corrupt, or a tier this build no
 * longer offers — reads as no memory at all rather than throwing: the set of depths can change from
 * one version to the next, and an old value must never be able to break the surface that reads it.
 */

export const LAST_DEPTH_KEY = 'vigie:export-depth';

/** The remembered depth, or `null` when there is nothing usable on record. */
export async function readLastDepth(): Promise<ExportDepthMinutes | null> {
  const stored = await browser.storage.local.get(LAST_DEPTH_KEY);
  const value = stored[LAST_DEPTH_KEY];
  return isExportDepth(value) ? value : null;
}

/** Records the depth an export was just taken at. */
export async function writeLastDepth(depth: ExportDepthMinutes): Promise<void> {
  await browser.storage.local.set({ [LAST_DEPTH_KEY]: depth });
}
