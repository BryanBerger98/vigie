import type { CaptureEntry } from '@vigie/contract';

import { db, type NewEntry } from './db';
import { prune } from './prune';
import { watchedDomainFor } from './scope';

/**
 * The only door into the capture store.
 *
 * Every layer — network here, console and errors in phase 5 — hands its entries to this module
 * and to nothing else. Two rules live on this path and nowhere downstream (`database.md:38-39`):
 *
 * - **Scope first.** Filtering at export time would mean unwatched traffic reaching the disk,
 *   which contradicts the one promise the product makes. Nothing unwatched is ever written.
 * - **Prune on write.** The rolling hour is enforced at each flush, because an MV3 timer does not
 *   survive the worker being terminated.
 *
 * A draft carries no `domain`: the write path resolves it from the URL that decides the scope, so
 * the stamp an entry is later erased by comes from the same decision that let it in.
 */

/**
 * An entry as a capture layer produces it, before the write path stamps its watched domain.
 *
 * The omission distributes over the union on purpose: a plain `Omit` of a union keeps only the
 * keys every member shares, which would erase `url`, `level` and `stack` in one go.
 */
export type EntryDraft = CaptureEntry extends infer T
  ? T extends CaptureEntry
    ? Omit<T, 'domain'>
    : never
  : never;

/** Why an entry was or was not queued. Returned rather than thrown: rejection is the normal case. */
export type WriteOutcome = 'queued' | 'out-of-scope' | 'no-tab';

/**
 * Entries buffered per flush. A busy page produces hundreds of `webRequest` events a minute and
 * one IndexedDB transaction each would make the write path the bottleneck of the capture.
 *
 * The threshold is deliberately low. Whatever sits in this array dies with the service worker,
 * so the batch is a latency optimisation, never a buffer the capture depends on. Phase 6 measures
 * an hour of real traffic and settles the number.
 */
export const BATCH_SIZE = 50;

/** How long a partial batch may wait. Short: the worker can be terminated at any moment. */
export const BATCH_DELAY_MS = 250;

let scope: readonly string[] = [];
let queue: NewEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();

/**
 * The watched domains the write path filters on. Held here rather than passed at every call: the
 * `webRequest` listeners are synchronous and cannot await a storage read, and the write path is
 * the one place where the list has to be right.
 *
 * Narrowing the scope also drops whatever the queue still holds for a domain that just left it.
 * Without that, a removal would erase the store and then have one last batch land behind it — the
 * user was told the data was gone.
 */
export function setCaptureScope(domains: readonly string[]): void {
  scope = domains;
  queue = queue.filter((entry) => domains.includes(entry.domain));
}

export function captureScope(): readonly string[] {
  return scope;
}

/**
 * Queues an entry for the store, or says why it will not be.
 *
 * `tabId` of `-1` means the request belongs to no tab — a prefetch, a page's own service worker,
 * a browser-internal fetch. Those cannot be attached to a session and would never be exportable,
 * so they are dead data and are refused rather than stored (`prd.md` scopes an export to a tab).
 */
export function captureEntry(draft: EntryDraft, url: string): WriteOutcome {
  const domain = watchedDomainFor(url, scope);
  if (domain === null) return 'out-of-scope';
  if (draft.tabId < 0) return 'no-tab';

  queue.push({ ...draft, domain } as NewEntry);

  if (queue.length >= BATCH_SIZE) {
    void flush();
  } else if (timer === null) {
    timer = setTimeout(() => void flush(), BATCH_DELAY_MS);
  }

  return 'queued';
}

/**
 * Writes what is queued and prunes. Concurrent calls chain rather than overlap: two `bulkAdd`
 * transactions racing on the same table is how a batch ends up written twice.
 *
 * The queue is taken synchronously and the write chained after. Taking it inside the chain would
 * leave the batch growing until the previous write finished — under load, exactly the unbounded
 * buffer the size threshold exists to prevent.
 */
export function flush(now = Date.now()): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  const batch = queue;
  queue = [];

  inFlight = inFlight.then(async () => {
    if (batch.length > 0) {
      await db().entries.bulkAdd(batch as never[]);
    }
    await prune(now);
  }, () => undefined);

  return inFlight;
}

/** Entries queued but not yet written. Anything here is lost if the worker is terminated. */
export function pendingWrites(): number {
  return queue.length;
}

/** Drops the queue without writing it. Tests and the consent purge of phase 9 use it. */
export function discardPendingWrites(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  queue = [];
}
