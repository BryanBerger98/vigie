import { MAX_EXPORT_DEPTH_MINUTES, type CaptureEntry } from '@vigie/contract';

import { db } from '@/storage/db';

/**
 * What a report is cut from: one tab, one time window, everything that happened inside it.
 *
 * Three rules live here and are asserted here, because every one of them is a promise the product
 * makes rather than an implementation detail:
 *
 * - **One hour, whatever is asked.** The ceiling is the retention the store actually holds
 *   (`spec.md:12`); a request beyond it is clamped rather than refused, so no surface can produce
 *   a report claiming a depth the capture never had.
 * - **One tab.** An export answers "what happened on this page", and entries from a neighbouring
 *   tab are a different story that would read as the same one.
 * - **No sorting, no filtering inside the window** (`spec.md:14`). Whatever the capture wrote is
 *   what the report shows, in the order it happened. Deciding here what is worth reading would
 *   remove exactly the line the reader is looking for.
 *
 * The module is deliberately thin on the database side: the compound `[tabId+timestamp]` index
 * answers the whole query, so the slice is a range scan and never a table walk (`db.ts:29`).
 */

const MS_PER_MINUTE = 60_000;

export interface WindowBounds {
  /** Start of the window, epoch ms. Inclusive. */
  from: number;
  /** End of the window — the frozen instant. Inclusive. */
  to: number;
  /** Depth actually used, after the one-hour ceiling. Minutes. */
  depthMinutes: number;
}

/**
 * The window a depth means, once the ceiling has had its say.
 *
 * Both bounds are inclusive. An entry stamped exactly at the frozen instant happened before the
 * click and belongs in the report; one stamped a millisecond later does not.
 *
 * A negative or absurd depth is clamped rather than trusted: the value comes from a message a
 * surface sent, and the contract's guard is the only thing between it and this arithmetic.
 */
export function windowBounds(frozenAt: number, requestedDepthMinutes: number): WindowBounds {
  const depthMinutes = Math.min(Math.max(requestedDepthMinutes, 0), MAX_EXPORT_DEPTH_MINUTES);
  return { from: frozenAt - depthMinutes * MS_PER_MINUTE, to: frozenAt, depthMinutes };
}

/**
 * The entries of one tab inside the window, oldest first.
 *
 * The order is the index's, not a sort: `[tabId+timestamp]` stores them that way, so the single
 * chronological thread a report needs costs nothing to produce. Network, console and errors come
 * back interleaved for the same reason — one table, one ordering key.
 *
 * The stored key is dropped on the way out. It identifies a row in this profile's database and
 * means nothing to a reader of the report; leaving it in would put a number in the bundle that
 * looks like it identifies something and does not.
 */
export async function readWindow(
  tabId: number,
  bounds: WindowBounds,
): Promise<CaptureEntry[]> {
  const rows = await db()
    .entries.where('[tabId+timestamp]')
    .between([tabId, bounds.from], [tabId, bounds.to], true, true)
    .toArray();

  return rows.map(({ id: _id, ...entry }) => entry as CaptureEntry);
}

/** Epoch ms of the oldest entry the store still holds, all tabs. `null` when it is empty. */
export async function oldestCaptureAt(): Promise<number | null> {
  const oldest = await db().entries.orderBy('timestamp').first();
  return oldest?.timestamp ?? null;
}

/**
 * How much time the report really covers, which is what its header announces.
 *
 * The requested depth is a wish; the capture may reach back less far, because it started late or
 * because the purge shrank the window. The measure is taken on the *store*, not on the tab: a tab
 * that stayed silent for forty minutes is still covered for those forty minutes, and announcing
 * otherwise would turn silence into a hole the reader would go looking for.
 */
export function coveredDepthMinutes(
  bounds: WindowBounds,
  oldestCaptureAt: number | null,
): number {
  if (oldestCaptureAt === null) return 0;
  const reachesFrom = Math.max(bounds.from, oldestCaptureAt);
  return Math.max(0, bounds.to - reachesFrom) / MS_PER_MINUTE;
}
