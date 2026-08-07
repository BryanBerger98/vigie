import type { EntryKind } from '@vigie/contract';

import { db } from './db';

/**
 * What the capture store actually costs, measured rather than estimated.
 *
 * Phase 6 of the plan turns on one question: does an hour of real traffic fit, and does holding it
 * degrade the browsing it observes (`prd.md:95`). Neither is answerable from the code — only from
 * a store that has been running against a real application. This module is the instrument that
 * makes it readable, and it is written to be read by a human during navigation, not by the report.
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
 */

/** Where the empty-store reading lives, so a reading survives the worker being terminated. */
export const STORAGE_BASELINE_KEY = 'vigie:storage-baseline';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

export interface KindVolume {
  /** Entries of this kind currently held. */
  count: number;
  /** How many of them arrive per minute, over the window the store actually covers. */
  perMinute: number;
  /** Bytes attributable to this kind, at the store's mean cost per entry. `null` without a quota. */
  bytes: number | null;
}

export interface CaptureMetrics {
  /** When the reading was taken. A relevé is worthless without its timestamp. */
  takenAt: number;
  entryCount: number;
  /**
   * Split by kind because they do not shrink the same way: a network entry loses its headers, a
   * console entry loses its text, and the two decisions have nothing to do with each other.
   */
  byKind: Record<EntryKind, KindVolume>;
  /** Epoch ms of the oldest entry held, `null` when the store is empty. */
  oldestEntryAt: number | null;
  /** How much time the store covers. Under an hour it is the whole capture; at an hour, the cap. */
  coveredMs: number;
  /** Entries per minute, all kinds, over that same window. */
  entriesPerMinute: number;
  /** What the browser attributes to the whole origin, extension files included. */
  usageBytes: number | null;
  /** The origin's ceiling, as the browser reports it. */
  quotaBytes: number | null;
  /** Usage observed while the store was empty — the constant that is not capture. */
  baselineBytes: number | null;
  /** Bytes the entries themselves account for: `usageBytes` minus the baseline. */
  storeBytes: number | null;
  /** Mean cost of one entry, index overhead included. */
  bytesPerEntry: number | null;
  /** What a full hour at the observed rate would occupy. The gauge the ceiling is judged against. */
  projectedHourBytes: number | null;
  /** That projection as a fraction of the quota. Above 1, the hour does not fit. */
  projectedQuotaRatio: number | null;
}

const EMPTY_VOLUME: KindVolume = { count: 0, perMinute: 0, bytes: null };

export const EMPTY_CAPTURE_METRICS: CaptureMetrics = {
  takenAt: 0,
  entryCount: 0,
  byKind: { network: EMPTY_VOLUME, console: EMPTY_VOLUME, error: EMPTY_VOLUME },
  oldestEntryAt: null,
  coveredMs: 0,
  entriesPerMinute: 0,
  usageBytes: null,
  quotaBytes: null,
  baselineBytes: null,
  storeBytes: null,
  bytesPerEntry: null,
  projectedHourBytes: null,
  projectedQuotaRatio: null,
};

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

/** Counts the table by kind in one pass. There is no `kind` index, and deliberately so — see below. */
async function countByKind(): Promise<{ counts: Record<EntryKind, number>; total: number }> {
  const counts: Record<EntryKind, number> = { network: 0, console: 0, error: 0 };
  let total = 0;

  // A full walk rather than three indexed counts. An index earns its keep on the read path and
  // costs on the write path, and the write path is precisely what this phase measures: paying for
  // the instrument out of the thing under test would bias the result it produces (`db.ts:26`).
  await db().entries.each((entry) => {
    total += 1;
    const kind = entry.kind as EntryKind;
    if (kind in counts) counts[kind] += 1;
  });

  return { counts, total };
}

/**
 * Takes one reading. Nothing here is cached: two readings a minute apart are the measurement.
 *
 * `now` is injected so a test can state a window rather than wait for one.
 */
export async function captureMetrics(now = Date.now()): Promise<CaptureMetrics> {
  const [{ counts, total }, oldest, estimate] = await Promise.all([
    countByKind(),
    db().entries.orderBy('timestamp').first(),
    estimateQuota(),
  ]);

  const oldestEntryAt = oldest?.timestamp ?? null;
  const coveredMs = oldestEntryAt === null ? 0 : Math.max(0, now - oldestEntryAt);
  const coveredMinutes = coveredMs / MS_PER_MINUTE;

  const baselineBytes = await baseline(total, estimate.usage);
  const storeBytes =
    estimate.usage === null || baselineBytes === null
      ? null
      : Math.max(0, estimate.usage - baselineBytes);
  const bytesPerEntry = storeBytes === null || total === 0 ? null : storeBytes / total;

  // A rate needs a window to be a rate. Below one it would divide by a fraction of a minute and
  // announce a throughput nobody observed, so the first seconds of a capture report zero.
  const rate = (count: number) => (coveredMinutes >= 1 ? count / coveredMinutes : 0);
  const entriesPerMinute = rate(total);

  const projectedHourBytes =
    bytesPerEntry === null || entriesPerMinute === 0
      ? null
      : bytesPerEntry * entriesPerMinute * MINUTES_PER_HOUR;

  return {
    takenAt: now,
    entryCount: total,
    byKind: {
      network: volume(counts.network, rate(counts.network), bytesPerEntry),
      console: volume(counts.console, rate(counts.console), bytesPerEntry),
      error: volume(counts.error, rate(counts.error), bytesPerEntry),
    },
    oldestEntryAt,
    coveredMs,
    entriesPerMinute,
    usageBytes: estimate.usage,
    quotaBytes: estimate.quota,
    baselineBytes,
    storeBytes,
    bytesPerEntry,
    projectedHourBytes,
    projectedQuotaRatio:
      projectedHourBytes === null || estimate.quota === null || estimate.quota === 0
        ? null
        : projectedHourBytes / estimate.quota,
  };
}

/**
 * Bytes per kind are the mean entry cost times the count, not a measurement of their own: the
 * browser attributes storage to an origin, never to a row. Stated here rather than in the readout
 * so the approximation lives next to the arithmetic that makes it.
 */
function volume(count: number, perMinute: number, bytesPerEntry: number | null): KindVolume {
  return {
    count,
    perMinute,
    bytes: bytesPerEntry === null ? null : bytesPerEntry * count,
  };
}

/** Where the series of readings accumulates while a measurement run is in progress. */
export const STORAGE_READINGS_KEY = 'vigie:storage-readings';

/**
 * Readings kept. An hour sampled every five minutes is twelve; the cap is there so a forgotten
 * run cannot grow without bound, not because more would be useless.
 */
export const MAX_READINGS = 240;

/**
 * Appends a reading to the run's series and hands the whole series back.
 *
 * The series exists because task 2.3 of the phase asks for readings at regular intervals over a
 * full hour, and a figure a human retyped from a popup is a figure nobody can audit afterwards.
 * `chrome.storage.local`, not the capture store: a measurement must not be written into the thing
 * it measures.
 */
export async function recordReading(metrics: CaptureMetrics): Promise<CaptureMetrics[]> {
  const series = [...(await readReadings()), metrics].slice(-MAX_READINGS);
  await browser.storage.local.set({ [STORAGE_READINGS_KEY]: series });
  return series;
}

export async function readReadings(): Promise<CaptureMetrics[]> {
  const stored = await browser.storage.local.get(STORAGE_READINGS_KEY);
  const value = stored[STORAGE_READINGS_KEY];
  return Array.isArray(value) ? (value as CaptureMetrics[]) : [];
}

export async function clearReadings(): Promise<void> {
  await browser.storage.local.remove(STORAGE_READINGS_KEY);
}

/**
 * The series as a Markdown table, ready to be pasted into the measurement report.
 *
 * Bytes stay raw here on purpose. A readout rounds so a human can read it at a glance; a record
 * that will be re-derived from must not, or the arithmetic done later inherits the rounding.
 */
export function formatReadings(readings: readonly CaptureMetrics[]): string {
  const header =
    '| Relevé | Entrées | Réseau | Console | Erreur | Fenêtre (min) | Entrées/min | Octets stockés | Heure projetée |';
  const rule = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const cell = (value: number | null) => (value === null ? '—' : String(Math.round(value)));

  const rows = readings.map((reading) => {
    const at = new Date(reading.takenAt).toISOString().slice(11, 19);
    return [
      at,
      reading.entryCount,
      reading.byKind.network.count,
      reading.byKind.console.count,
      reading.byKind.error.count,
      (reading.coveredMs / MS_PER_MINUTE).toFixed(1),
      reading.entriesPerMinute.toFixed(1),
      cell(reading.storeBytes),
      cell(reading.projectedHourBytes),
    ].join(' | ');
  });

  return [header, rule, ...rows.map((row) => `| ${row} |`)].join('\n');
}
