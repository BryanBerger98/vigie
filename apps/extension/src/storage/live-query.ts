import { liveQuery } from 'dexie';

import { db, type StoredEntry } from './db';
import { RETENTION_MS } from './prune';

/**
 * The reading side of the store, and the only one a surface is allowed to use.
 *
 * Dexie re-runs a `liveQuery` whenever a write touches a key range that query read, and it carries
 * that signal between contexts over a `BroadcastChannel` (`dexie/dist/dexie.mjs:6490`). A panel
 * subscribed here therefore follows what the service worker writes without polling it, and above
 * all without asking it to flush: a flush appends the pending batch and then prunes
 * (`storage/write.ts:73`), which is a write, and this surface must not emit one (`database.md:42`).
 *
 * The batch delay is the price of that discipline — up to `BATCH_DELAY_MS` between a request and
 * its row. A quarter of a second on a thread that is read, not raced against.
 *
 * ## Why the upper bound is open
 *
 * Bounding the range at `now` would leave every entry written after this instant outside the range
 * Dexie is watching, so the very writes the panel exists to show would not wake it up. The window
 * is therefore observed as `[from, +∞)` and cut down to the hour by `from` alone, recomputed on
 * every run — which is also what makes the window roll forward as the subscription lives on.
 */

/** One tab's rolling hour, as of the moment it was read. */
export interface TabWindow {
  /** The tab this snapshot is about. */
  tabId: number;
  /**
   * Entries inside the window, oldest first. Dexie's own order on `[tabId+timestamp]`, never a
   * re-sort: it is the order a report is rendered in, and the two have to agree (`spec.md:14`).
   */
  entries: StoredEntry[];
  /** Low bound of the window, epoch ms — an hour before it was read. */
  from: number;
  /** When the snapshot was taken. */
  readAt: number;
}

/**
 * One tab's window, read once. Entries older than the hour are left where they are: they belong to
 * the purge, which runs on the write path, and dropping them here would be a write.
 */
export async function readTabWindow(tabId: number, now = Date.now()): Promise<TabWindow> {
  const from = now - RETENTION_MS;
  const entries = await db()
    .entries.where('[tabId+timestamp]')
    .between([tabId, from], [tabId, Infinity], true, true)
    .toArray();

  return { tabId, entries, from, readAt: now };
}

/**
 * The same window, delivered again on every change. Returns the unsubscribe function.
 *
 * The first delivery is the current content, so a caller has nothing to read separately.
 */
export function observeTabWindow(
  tabId: number,
  onNext: (window: TabWindow) => void,
  onError: (error: unknown) => void = (error) => {
    console.error('[vigie] the live read of tab %d stopped', tabId, error);
  },
): () => void {
  const subscription = liveQuery(() => readTabWindow(tabId)).subscribe({
    next: onNext,
    error: onError,
  });

  return () => subscription.unsubscribe();
}
