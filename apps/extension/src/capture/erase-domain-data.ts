/**
 * Erases everything captured for one domain.
 *
 * Nothing is captured yet — the rolling store lands in phase 4 — so this does nothing today.
 * It exists named and called from the moment a domain can be removed, because the removal flow
 * promises the user their data is gone: a promise made now and wired later is how it ends up
 * never wired at all.
 *
 * Phase 4 fills this in against the IndexedDB and OPFS stores it creates.
 */
export async function eraseCapturedDataFor(domain: string): Promise<void> {
  console.info('[vigie] nothing captured yet for %s, nothing to erase', domain);
}
