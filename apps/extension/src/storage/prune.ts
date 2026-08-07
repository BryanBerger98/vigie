import { db } from './db';

/**
 * The rolling window: everything older than an hour goes, and it goes on the write path.
 *
 * Not on a timer. An MV3 service worker is terminated after roughly thirty seconds idle and every
 * `setInterval` dies with it, so a timer-based purge would run exactly while the browser is busy
 * and never while it is not (`database.md:38`). Pruning at each batch flush ties the cleanup to
 * the only moment the store is known to be growing.
 */

/** The window the product promises. One hour of context, no more. */
export const RETENTION_MS = 60 * 60 * 1000;

/**
 * Fraction of the origin's quota above which the hour is no longer affordable.
 *
 * Below this, the window is exactly an hour. Above it, entries are dropped oldest-first until the
 * store is back under the mark — the window shrinks, and that has to be visible rather than
 * inferred from a report that turns out shorter than announced (`spec.md:23`).
 */
export const QUOTA_PRESSURE_RATIO = 0.9;

/** How much of the store is dropped in one pass when the quota is saturated. */
const RELIEF_RATIO = 0.25;

/** Where the readout lives, so a surface can show it without opening the database. */
export const STORAGE_STATE_KEY = 'vigie:storage-state';

export interface StorageState {
  /** Entries currently held, after the last prune. */
  entryCount: number;
  /** Epoch ms of the oldest entry, `null` when the store is empty. */
  oldestEntryAt: number | null;
  /**
   * How much time the store actually covers. Phase 7 announces this rather than the hour, so an
   * export never claims a depth it does not have.
   */
  coveredMs: number;
  /** Bytes the browser attributes to this origin, `null` when it declines to say. */
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Epoch ms of the last prune that had to go past the hour to make room. `null` if never. */
  shrunkAt: number | null;
}

export const EMPTY_STORAGE_STATE: StorageState = {
  entryCount: 0,
  oldestEntryAt: null,
  coveredMs: 0,
  usageBytes: null,
  quotaBytes: null,
  shrunkAt: null,
};

interface QuotaEstimate {
  usage: number | null;
  quota: number | null;
}

/**
 * `navigator.storage` is present in a service worker but not in a unit-test environment, and a
 * browser may answer with neither figure. An unknown quota is never treated as a saturated one:
 * silently shrinking the window on a guess is worse than keeping the promised hour.
 */
async function estimateQuota(): Promise<QuotaEstimate> {
  const storage = globalThis.navigator?.storage;
  if (!storage?.estimate) return { usage: null, quota: null };
  try {
    const { usage, quota } = await storage.estimate();
    return { usage: usage ?? null, quota: quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

function isSaturated({ usage, quota }: QuotaEstimate): boolean {
  if (usage === null || quota === null || quota === 0) return false;
  return usage / quota > QUOTA_PRESSURE_RATIO;
}

/**
 * Drops everything older than the rolling hour, then makes room if the quota says the hour is
 * too much. Returns the number of entries deleted, and leaves the readout in `chrome.storage`.
 *
 * Idempotent by construction: a second call on an unchanged store deletes nothing.
 */
export async function prune(now: number): Promise<number> {
  const table = db().entries;
  const cutoff = now - RETENTION_MS;

  let deleted = await table.where('timestamp').below(cutoff).delete();

  const estimate = await estimateQuota();
  let shrunk = false;
  if (isSaturated(estimate)) {
    const remaining = await table.count();
    const relief = Math.ceil(remaining * RELIEF_RATIO);
    if (relief > 0) {
      const oldest = await table.orderBy('timestamp').limit(relief).primaryKeys();
      await table.bulkDelete(oldest);
      deleted += oldest.length;
      shrunk = oldest.length > 0;
    }
  }

  await writeStorageState(now, estimate, shrunk);
  return deleted;
}

async function writeStorageState(
  now: number,
  estimate: QuotaEstimate,
  shrunk: boolean,
): Promise<void> {
  const table = db().entries;
  const [entryCount, oldest] = await Promise.all([
    table.count(),
    table.orderBy('timestamp').first(),
  ]);
  const previous = await readStorageState();

  const state: StorageState = {
    entryCount,
    oldestEntryAt: oldest?.timestamp ?? null,
    coveredMs: oldest ? Math.max(0, now - oldest.timestamp) : 0,
    usageBytes: estimate.usage,
    quotaBytes: estimate.quota,
    shrunkAt: shrunk ? now : previous.shrunkAt,
  };

  await browser.storage.local.set({ [STORAGE_STATE_KEY]: state });
}

/** The last readout the purge left behind. Empty until the first write happens. */
export async function readStorageState(): Promise<StorageState> {
  const stored = await browser.storage.local.get(STORAGE_STATE_KEY);
  const value = stored[STORAGE_STATE_KEY];
  if (!value || typeof value !== 'object') return EMPTY_STORAGE_STATE;
  return { ...EMPTY_STORAGE_STATE, ...(value as Partial<StorageState>) };
}
