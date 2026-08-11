import { db } from './db';
import { EMPTY_STORAGE_STATE, STORAGE_STATE_KEY } from './prune';
import { discardPendingWrites } from './write';

/**
 * Erasing everything the capture holds, on demand.
 *
 * Purging is not disabling. The store is emptied and the capture keeps running on the same watched
 * domains — a user who wants to stop being captured removes the domain (`watched-domains.ts:116`),
 * and conflating the two would take a decision they did not make.
 *
 * ## Why it goes through the service worker
 *
 * The write queue is module state of whichever context holds it, and the one that matters is the
 * worker's — that is where the `webRequest` listeners push. A settings page calling
 * `discardPendingWrites()` would clear its own empty queue and leave the worker's batch to land
 * seconds later, on a store the user was told was empty. So the surface sends `PURGE_MESSAGE` and
 * the worker does the work.
 */

/** What a surface sends the worker to have everything erased. */
export const PURGE_MESSAGE = 'vigie:purge';

/** What the worker answers. A failure is reported, never rounded down to "nothing to delete". */
export type PurgeAnswer = { deleted: number } | { error: string };

/**
 * Empties the store and resets the readout, in the worker. Returns how many entries went.
 *
 * The order is deliberate: drop the queue first, then clear the table. The other way round leaves
 * the window between the two open for a queued batch to be written into a table already cleared.
 *
 * The queue is discarded rather than flushed. The user asked for everything to be gone, and
 * writing one last batch on the way out is the opposite of that.
 */
export async function purgeCapturedData(): Promise<number> {
  discardPendingWrites();

  const table = db().entries;
  const held = await table.count();
  await table.clear();

  // The readout is what the surfaces show without opening the database, so an empty store that
  // still announces a volume reads as a purge that did not work.
  await browser.storage.local.set({ [STORAGE_STATE_KEY]: EMPTY_STORAGE_STATE });

  return held;
}

/** Asks the worker to purge. Any failure comes back as an answer rather than as a rejection. */
export async function requestPurge(): Promise<PurgeAnswer> {
  try {
    const answer: unknown = await browser.runtime.sendMessage(PURGE_MESSAGE);
    if (answer && typeof answer === 'object' && ('deleted' in answer || 'error' in answer)) {
      return answer as PurgeAnswer;
    }
    return { error: 'the service worker did not answer the purge' };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}
