import Dexie from 'dexie';

import { db } from '@/storage/db';

/**
 * Erases everything captured for one domain.
 *
 * Called the moment a domain leaves the watched list, because the removal flow promises the user
 * their data is gone. It runs on the `[domain+timestamp]` index rather than scanning: the store
 * holds an hour of a busy tab, and a scan under a click is a freeze.
 *
 * ## Why the range and not an equality
 *
 * The stored key is the pair, so matching a domain alone means every timestamp it could carry —
 * `Dexie.minKey` to `Dexie.maxKey`. Indexing `domain` on its own would read better and cost a
 * second index write on every captured request, which is the one path under pressure here.
 *
 * Idempotent: erasing a domain that holds nothing deletes nothing and does not fail. The removal
 * flow calls it unconditionally, and the service worker calls it again when it sees the list
 * shrink, so a straggler queued before the removal cannot outlive it.
 */
export async function eraseCapturedDataFor(domain: string): Promise<void> {
  const deleted = await db()
    .entries.where('[domain+timestamp]')
    .between([domain, Dexie.minKey], [domain, Dexie.maxKey])
    .delete();

  if (deleted > 0) {
    console.info('[vigie] erased %d captured entries for %s', deleted, domain);
  }
}
