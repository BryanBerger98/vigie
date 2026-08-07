import { db } from './db';

/**
 * What the capture store actually costs, measured rather than estimated.
 *
 * Two callers, and only two. The settings page reads it to show what is held right now
 * (`options/StoredData.tsx`), which is how the scope and retention promises are made auditable
 * instead of believed. The purge reads `estimateQuota` alone, to decide whether the promised hour
 * still fits the origin's ceiling (`storage/prune.ts:85`).
 *
 * ## Two rules the instrument obeys
 *
 * - **It never runs unless asked.** Every reading walks the whole table, so a poll would put the
 *   measuring apparatus inside the thing being measured. Phase 2 already lost a run that way: the
 *   popup's own requests were counted as captured traffic (`measure-permissions.md:178`).
 * - **It isolates the entries from everything else the origin holds.** `navigator.storage.estimate()`
 *   answers for the whole `chrome-extension://` origin, extension files included, so a raw usage
 *   figure carries an unknown constant. The constant is measured once, while the store is empty,
 *   and subtracted from every reading afterwards.
 *
 * The readings series this module used to keep, and the projection figures it fed, are gone: the
 * popup was their only reader and the popup now carries the export and nothing else. The protocol
 * of `measure-storage.md` loses its instrument with them — a later campaign has to rebuild one.
 */

/** Where the empty-store reading lives, so a reading survives the worker being terminated. */
export const STORAGE_BASELINE_KEY = 'vigie:storage-baseline';

export interface DomainVolume {
  /** The watched domain the entries were stamped with, never the host they came from. */
  domain: string;
  count: number;
  /** Bytes attributable to this domain, at the store's mean cost per entry. `null` without a quota. */
  bytes: number | null;
}

export interface CaptureMetrics {
  /** When the reading was taken. A relevé is worthless without its timestamp. */
  takenAt: number;
  entryCount: number;
  /**
   * Split by watched domain, heaviest first. This is the readout that makes the scope promise
   * auditable rather than believed: a domain nobody designated has no row here, and the settings
   * screen shows the list as it stands (`phase-9.md` task 3).
   */
  byDomain: DomainVolume[];
  /** Epoch ms of the oldest entry held, `null` when the store is empty. */
  oldestEntryAt: number | null;
  /** Bytes the entries themselves account for: origin usage minus the baseline. */
  storeBytes: number | null;
}

export interface QuotaEstimate {
  usage: number | null;
  quota: number | null;
}

/**
 * What the browser says the origin holds.
 *
 * `navigator.storage` exists in a service worker and in every extension page, but not in a unit
 * test environment, and a browser is free to answer with neither figure. An unknown quota is
 * reported as unknown and never as a saturated one — the purge shrinks the promised window on
 * that signal, and doing it on a guess is worse than keeping the hour.
 */
export async function estimateQuota(): Promise<QuotaEstimate> {
  const storage = globalThis.navigator?.storage;
  if (!storage?.estimate) return { usage: null, quota: null };
  try {
    const { usage, quota } = await storage.estimate();
    return { usage: usage ?? null, quota: quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

/**
 * The usage the origin shows with nothing captured — extension files, and whatever else the
 * browser attributes to the origin without any capture having happened.
 *
 * Refreshed on its own, every time a reading finds the store empty: a fresh profile, a consent
 * purge and a domain removal all land there, and each one is a chance to re-measure a constant
 * that changes whenever the build does. Held in `chrome.storage.local` rather than in the store
 * itself, so recording it cannot move the figure it records.
 */
async function baseline(entryCount: number, usage: number | null): Promise<number | null> {
  if (entryCount === 0 && usage !== null) {
    await browser.storage.local.set({ [STORAGE_BASELINE_KEY]: usage });
    return usage;
  }

  const stored = await browser.storage.local.get(STORAGE_BASELINE_KEY);
  const value = stored[STORAGE_BASELINE_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface EntryTally {
  domains: Map<string, number>;
  total: number;
}

/** Counts the table and its domain split in one pass. */
async function countEntries(): Promise<EntryTally> {
  const domains = new Map<string, number>();
  let total = 0;

  // A full walk rather than indexed counts. An index earns its keep on the read path and costs on
  // the write path, and the write path is what has to stay cheap: paying for the instrument out of
  // the thing under test would bias the result it produces (`db.ts:26`). The domain split is the
  // same argument twice over — `[domain+timestamp]` exists for the erase path and counting through
  // it once per domain would be several cursors where this is one.
  await db().entries.each((entry) => {
    total += 1;
    domains.set(entry.domain, (domains.get(entry.domain) ?? 0) + 1);
  });

  return { domains, total };
}

/**
 * Takes one reading. Nothing here is cached: two readings a minute apart are the measurement.
 *
 * `now` is injected so a test can state a window rather than wait for one.
 */
export async function captureMetrics(now = Date.now()): Promise<CaptureMetrics> {
  const [{ domains, total }, oldest, estimate] = await Promise.all([
    countEntries(),
    db().entries.orderBy('timestamp').first(),
    estimateQuota(),
  ]);

  const baselineBytes = await baseline(total, estimate.usage);
  const storeBytes =
    estimate.usage === null || baselineBytes === null
      ? null
      : Math.max(0, estimate.usage - baselineBytes);
  // Bytes per domain are the mean entry cost times the count, not a measurement of their own: the
  // browser attributes storage to an origin, never to a row. Stated here rather than in the readout
  // so the approximation lives next to the arithmetic that makes it.
  const bytesPerEntry = storeBytes === null || total === 0 ? null : storeBytes / total;

  return {
    takenAt: now,
    entryCount: total,
    byDomain: [...domains]
      .map(([domain, count]) => ({
        domain,
        count,
        bytes: bytesPerEntry === null ? null : bytesPerEntry * count,
      }))
      // Heaviest first, ties broken alphabetically so two readings of the same store agree.
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)),
    oldestEntryAt: oldest?.timestamp ?? null,
    storeBytes,
  };
}
