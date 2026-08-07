import type { CaptureEntry, ReportBundle } from '@vigie/contract';

/**
 * What counts as an anomaly, decided once.
 *
 * The renderer marks anomalous entries in the timeline and counts them in the framing table. Those
 * are two readings of the same judgement, and a judgement written twice drifts: a table announcing
 * three failures above a timeline carrying four is worse than no table at all.
 *
 * It is a reading of the report, not a property of an entry, which is why it lives here and not in
 * `@vigie/contract`. Storing it would mean a Dexie migration (`database.md:44`) for something
 * derivable from fields already on disk — and it would freeze today's definition into every entry
 * ever captured, so widening it later would leave the old ones lying.
 */

/** The status from which a response reads as a failure rather than as an answer. */
export const BAD_STATUS_FROM = 400;

/**
 * Whether an entry is one of the things a reader opened the report to find.
 *
 * Deliberately narrow. A `console.warn` is not an anomaly: pages emit them by the dozen, and a
 * marker on every one of them marks nothing. What is here is what fails outright — a request the
 * transport dropped, a response the server refused, a message the page itself logged as an error,
 * and every uncaught failure.
 */
export function isAnomalous(entry: CaptureEntry): boolean {
  if (entry.kind === 'network') {
    return entry.outcome === 'failed' || (entry.statusCode ?? 0) >= BAD_STATUS_FROM;
  }
  if (entry.kind === 'console') return entry.level === 'error';
  return true;
}

export interface NetworkCounts {
  total: number;
  /** Requests the transport never completed. */
  failed: number;
  /** Requests that completed on a status of {@link BAD_STATUS_FROM} or above. */
  badStatus: number;
}

export interface ConsoleCounts {
  total: number;
  errors: number;
}

export interface ErrorCounts {
  total: number;
}

export interface EntryCounts {
  network: NetworkCounts;
  console: ConsoleCounts;
  error: ErrorCounts;
  /** Every anomalous entry, all kinds together. The one figure the framing table opens on. */
  anomalies: number;
}

/**
 * The volume of a bundle, by kind, with the anomalies each kind holds.
 *
 * `failed` and `badStatus` partition the network anomalies rather than overlapping: a request that
 * the transport dropped is counted as failed and nothing else, even in the rare case where a status
 * was observed before the drop. They therefore add up to the network share of `anomalies`, which is
 * what makes the framing table checkable against the timeline by hand.
 */
export function countEntries(bundle: ReportBundle): EntryCounts {
  const counts: EntryCounts = {
    network: { total: 0, failed: 0, badStatus: 0 },
    console: { total: 0, errors: 0 },
    error: { total: 0 },
    anomalies: 0,
  };

  for (const entry of bundle.entries) {
    if (isAnomalous(entry)) counts.anomalies += 1;

    if (entry.kind === 'network') {
      counts.network.total += 1;
      if (entry.outcome === 'failed') counts.network.failed += 1;
      else if ((entry.statusCode ?? 0) >= BAD_STATUS_FROM) counts.network.badStatus += 1;
      continue;
    }

    if (entry.kind === 'console') {
      counts.console.total += 1;
      if (entry.level === 'error') counts.console.errors += 1;
      continue;
    }

    counts.error.total += 1;
  }

  return counts;
}
