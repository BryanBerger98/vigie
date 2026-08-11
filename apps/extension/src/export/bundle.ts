import {
  SCHEMA_VERSION,
  type ExportDepthMinutes,
  type ReportBundle,
  type ReportSubject,
} from '@vigie/contract';

import { readStorageState } from '@/storage/prune';

import { declareGaps } from './gaps';
import { coveredDepthMinutes, oldestCaptureAt, readWindow, windowBounds } from './slice';

/**
 * The bundle: one instant, frozen, and everything the store held before it.
 *
 * A report is a claim about a past, and a claim about a past has to have an edge. The edge is
 * `frozenAt`, taken as the very first statement of the assembly — before the queue is drained,
 * before the first read. Everything that happens afterwards has a later stamp and falls outside
 * the window by arithmetic rather than by care (`spec.md:14`).
 *
 * ## Why the queue is drained after the freeze and not before
 *
 * The capture batches its writes, so at any moment up to `BATCH_SIZE` entries exist only in the
 * worker's memory. Draining before the freeze would leave a window in which fresh entries land
 * with a stamp earlier than `frozenAt` and are never read — the report would silently miss the
 * last thing the user saw happen, which is exactly the thing they clicked to capture.
 *
 * Draining afterwards inverts the risk into a harmless one: entries queued during the drain that
 * are stamped after the freeze are simply out of the window, which is what they should be.
 *
 * One microscopic window remains: an entry stamped before the freeze that reaches the queue after
 * the drain has taken it. It is a fraction of a millisecond wide, it costs one entry, and closing
 * it would mean stopping the capture to take a report.
 */

export interface BundleRequest {
  tabId: number;
  requestedDepthMinutes: ExportDepthMinutes;
  /** Who the report is about. The tab is already carried by `tabId`. */
  subject: Omit<ReportSubject, 'tabId'>;
  /** As declared in the manifest, so a pasted report names the build that produced it. */
  extensionVersion: string;
  /**
   * Writes whatever the capture still holds. Called once, after the instant is frozen and before
   * any read. Optional so the assembly can be covered without the capture layer behind it.
   */
  settle?: () => Promise<void>;
}

export async function assembleBundle(
  request: BundleRequest,
  now: () => number = Date.now,
): Promise<ReportBundle> {
  const frozenAt = now();
  await request.settle?.();

  const bounds = windowBounds(frozenAt, request.requestedDepthMinutes);
  const [entries, oldest, storage] = await Promise.all([
    readWindow(request.tabId, bounds),
    oldestCaptureAt(),
    readStorageState(),
  ]);

  return {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion: request.extensionVersion,
    window: {
      requestedDepthMinutes: request.requestedDepthMinutes,
      frozenAt,
      from: bounds.from,
      to: bounds.to,
      coveredDepthMinutes: coveredDepthMinutes(bounds, oldest),
    },
    subject: { tabId: request.tabId, ...request.subject },
    gaps: declareGaps({ bounds, entries, storage }),
    entries,
  };
}
