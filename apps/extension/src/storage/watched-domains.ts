import { eraseCapturedDataFor } from '@/capture/erase-domain-data';

import { hostPermissionPatterns, parseWatchedDomain } from './scope';

/**
 * The watched domain list: the only configuration the product needs before it is useful.
 *
 * It lives in `chrome.storage.local`, not in Dexie — this is settings, not captured data, and it
 * has to be readable by the service worker on a cold start without opening a database.
 *
 * Two things must never drift apart: what the list says and what the browser actually granted.
 * The list is our record; the permission is the browser's, and the user can revoke it from
 * Chrome's own settings without the extension being told anything but an `onRemoved` event. So
 * the permission state is always read back from the browser, never inferred from the list.
 */

export const WATCHED_DOMAINS_KEY = 'vigie:watched-domains';

/** A watched domain together with the host access the browser currently holds for it. */
export interface WatchedDomain {
  domain: string;
  /**
   * `false` when the permission was revoked outside the extension. The domain stays in the list:
   * dropping it silently would erase the user's own configuration behind their back.
   */
  granted: boolean;
}

/**
 * Writes are serialised behind one chain. The options page can fire an add and a remove faster
 * than a read-modify-write round trip completes, and two concurrent reads of the same list would
 * both write their own version of it — losing one of the two edits.
 */
let writes: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = writes.then(work, work);
  writes = next.catch(() => undefined);
  return next;
}

/** The stored list, sorted and free of duplicates. Anything unreadable reads as empty. */
export async function readWatchedDomains(): Promise<string[]> {
  const stored = await browser.storage.local.get(WATCHED_DOMAINS_KEY);
  const value = stored[WATCHED_DOMAINS_KEY];
  if (!Array.isArray(value)) return [];
  return normalize(value.filter((entry): entry is string => typeof entry === 'string'));
}

function normalize(domains: string[]): string[] {
  return [...new Set(domains)].sort();
}

/**
 * Adds a domain to the list. Returns the domain as stored, or `null` when the input is not a
 * domain — the caller decides what to tell the user, this layer never stores a guess.
 *
 * The host permission is *not* requested here: `permissions.request()` needs the user gesture,
 * which is lost the moment anything is awaited. The options page requests it first and calls
 * this only once the browser has granted it.
 */
export function addWatchedDomain(input: string): Promise<string | null> {
  const domain = parseWatchedDomain(input);
  if (!domain) return Promise.resolve(null);

  return serialise(async () => {
    const domains = await readWatchedDomains();
    if (!domains.includes(domain)) {
      await browser.storage.local.set({ [WATCHED_DOMAINS_KEY]: normalize([...domains, domain]) });
    }
    return domain;
  });
}

/** What became of an attempt to watch a domain. */
export type WatchOutcome =
  | { status: 'added'; domain: string }
  | { status: 'refused'; domain: string }
  | { status: 'invalid' };

/**
 * The whole add sequence: validate, ask the browser, store only if it said yes.
 *
 * It lives here rather than in the form because the order is the guarantee, not a detail of the
 * screen. A typo never reaches Chrome's prompt, and a refused permission never leaves a list entry
 * the browser will not back — an entry like that would capture nothing while claiming otherwise.
 *
 * Not `async` on purpose: `permissions.request()` has to run inside the click handler's
 * synchronous stretch or Chrome drops it for lack of a user gesture. Everything before the call is
 * therefore synchronous, and the awaiting happens after.
 */
export function watchDomain(input: string): Promise<WatchOutcome> {
  const domain = parseWatchedDomain(input);
  if (!domain) return Promise.resolve({ status: 'invalid' });

  return requestHostAccess(domain).then(async (granted) => {
    if (!granted) return { status: 'refused', domain } as const;
    await addWatchedDomain(domain);
    return { status: 'added', domain } as const;
  });
}

/**
 * Removes a domain, revokes its host permission and erases what was captured for it.
 *
 * The order is deliberate: stop the capture first by dropping the permission, then take the
 * domain out of the list, then erase. A crash between two steps leaves the extension holding
 * less access than the list claims, never more.
 *
 * A revocation that fails does not abort the removal. The user asked to stop watching, and
 * leaving the domain listed *and* captured because Chrome would not give a permission back is the
 * worse of the two outcomes — the scope function is the second barrier and it rejects a domain
 * that is no longer in the list. Chrome refuses to revoke a permission declared as required,
 * which is exactly the case in the end-to-end build variant.
 */
export function removeWatchedDomain(domain: string): Promise<void> {
  return serialise(async () => {
    try {
      await revokeHostAccess(domain);
    } catch (cause) {
      console.error('[vigie] could not revoke host access for %s', domain, cause);
    }
    const domains = await readWatchedDomains();
    await browser.storage.local.set({
      [WATCHED_DOMAINS_KEY]: domains.filter((entry) => entry !== domain),
    });
    await eraseCapturedDataFor(domain);
  });
}

/**
 * Calls `listener` whenever the stored list changes, including changes made by another surface.
 * Returns the unsubscribe function.
 */
export function onWatchedDomainsChanged(listener: (domains: string[]) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
    if (!(WATCHED_DOMAINS_KEY in changes)) return;
    void readWatchedDomains().then(listener);
  };

  browser.storage.local.onChanged.addListener(onChanged);
  return () => browser.storage.local.onChanged.removeListener(onChanged);
}

/** Whether the browser currently grants every pattern this domain needs. */
export function hasHostAccess(domain: string): Promise<boolean> {
  return browser.permissions.contains({ origins: hostPermissionPatterns(domain) });
}

/**
 * Opens Chrome's permission prompt for `domain` and resolves to what the user answered.
 *
 * Not `async` on purpose: the call to `permissions.request` has to run inside the click handler's
 * synchronous stretch or Chrome drops the request for lack of a user gesture.
 */
export function requestHostAccess(domain: string): Promise<boolean> {
  return browser.permissions.request({ origins: hostPermissionPatterns(domain) });
}

/** Gives the host access back. Resolves `true` when the extension no longer holds it. */
export function revokeHostAccess(domain: string): Promise<boolean> {
  return browser.permissions.remove({ origins: hostPermissionPatterns(domain) });
}

/**
 * The list as the options page shows it: each domain crossed with the access the browser really
 * holds, so a permission revoked from Chrome's settings reads as missing without a restart.
 */
export async function readWatchedDomainsWithAccess(): Promise<WatchedDomain[]> {
  const domains = await readWatchedDomains();
  return Promise.all(
    domains.map(async (domain) => ({ domain, granted: await hasHostAccess(domain) })),
  );
}
