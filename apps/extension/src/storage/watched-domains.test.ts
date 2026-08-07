import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  WATCHED_DOMAINS_KEY,
  addWatchedDomain,
  onWatchedDomainsChanged,
  readWatchedDomains,
  readWatchedDomainsWithAccess,
  removeWatchedDomain,
  watchDomain,
} from './watched-domains';

/**
 * `permissions` is not implemented by the fake browser, so every test states what the browser is
 * supposed to answer. That is the point: the module must never infer the permission state from
 * the stored list, and these spies are what make the two disagree on purpose.
 *
 * The stubs it ships are typed as returning nothing, hence the narrow view of the surface the
 * module actually calls — the object is the same one, so the spies land where the code looks.
 */
const permissions = fakeBrowser.permissions as unknown as {
  contains(descriptor: { origins?: string[] }): Promise<boolean>;
  remove(descriptor: { origins?: string[] }): Promise<boolean>;
  request(descriptor: { origins?: string[] }): Promise<boolean>;
};

function grantEverything() {
  vi.spyOn(permissions, 'contains').mockResolvedValue(true);
  vi.spyOn(permissions, 'remove').mockResolvedValue(true);
  vi.spyOn(permissions, 'request').mockResolvedValue(true);
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  grantEverything();
});

describe('readWatchedDomains', () => {
  it('reads an empty list on a fresh profile', async () => {
    await expect(readWatchedDomains()).resolves.toEqual([]);
  });

  it('reads back what was stored, sorted and deduplicated', async () => {
    await fakeBrowser.storage.local.set({
      [WATCHED_DOMAINS_KEY]: ['other.test', 'example.com', 'other.test'],
    });

    await expect(readWatchedDomains()).resolves.toEqual(['example.com', 'other.test']);
  });

  it('reads as empty rather than throwing when the stored value is not a list', async () => {
    await fakeBrowser.storage.local.set({ [WATCHED_DOMAINS_KEY]: 'example.com' });

    await expect(readWatchedDomains()).resolves.toEqual([]);
  });
});

describe('addWatchedDomain', () => {
  it('stores the domain and returns it', async () => {
    await expect(addWatchedDomain('example.com')).resolves.toBe('example.com');
    await expect(readWatchedDomains()).resolves.toEqual(['example.com']);
  });

  it('stores the host of a pasted URL, not the URL', async () => {
    await expect(addWatchedDomain('https://App.Example.com/dashboard')).resolves.toBe(
      'app.example.com',
    );
    await expect(readWatchedDomains()).resolves.toEqual(['app.example.com']);
  });

  it('stores nothing when the input is not a domain', async () => {
    await expect(addWatchedDomain('not a domain')).resolves.toBeNull();
    await expect(readWatchedDomains()).resolves.toEqual([]);
  });

  it('adding twice leaves one entry', async () => {
    await addWatchedDomain('example.com');
    await addWatchedDomain('example.com');

    await expect(readWatchedDomains()).resolves.toEqual(['example.com']);
  });

  it('keeps both edits when two adds overlap', async () => {
    await Promise.all([addWatchedDomain('example.com'), addWatchedDomain('other.test')]);

    await expect(readWatchedDomains()).resolves.toEqual(['example.com', 'other.test']);
  });
});

describe('watchDomain', () => {
  it('asks the browser for the domain and its subdomains, then stores it', async () => {
    await expect(watchDomain('example.com')).resolves.toEqual({
      status: 'added',
      domain: 'example.com',
    });

    expect(permissions.request).toHaveBeenCalledWith({
      origins: ['*://example.com/*', '*://*.example.com/*'],
    });
    await expect(readWatchedDomains()).resolves.toEqual(['example.com']);
  });

  it('stores nothing when the permission is refused', async () => {
    vi.mocked(permissions.request).mockResolvedValue(false);

    await expect(watchDomain('example.com')).resolves.toEqual({
      status: 'refused',
      domain: 'example.com',
    });
    await expect(readWatchedDomains()).resolves.toEqual([]);
  });

  it('never reaches the prompt when the input is not a domain', async () => {
    await expect(watchDomain('not a domain')).resolves.toEqual({ status: 'invalid' });

    expect(permissions.request).not.toHaveBeenCalled();
    await expect(readWatchedDomains()).resolves.toEqual([]);
  });

  it('requests the permission before awaiting anything, so the user gesture survives', () => {
    // Called, not awaited: what the click handler does. If the module read storage first, the
    // request would land a microtask later and Chrome would drop it.
    void watchDomain('example.com');

    expect(permissions.request).toHaveBeenCalledTimes(1);
  });
});

describe('removeWatchedDomain', () => {
  it('takes the domain out of the list', async () => {
    await addWatchedDomain('example.com');
    await addWatchedDomain('other.test');

    await removeWatchedDomain('example.com');

    await expect(readWatchedDomains()).resolves.toEqual(['other.test']);
  });

  it('revokes the host permission for that domain and its subdomains', async () => {
    await addWatchedDomain('example.com');

    await removeWatchedDomain('example.com');

    expect(permissions.remove).toHaveBeenCalledWith({
      origins: ['*://example.com/*', '*://*.example.com/*'],
    });
  });

  it('drops the access before the list, so the browser never grants more than the list claims', async () => {
    await addWatchedDomain('example.com');
    const order: string[] = [];
    vi.mocked(permissions.remove).mockImplementation(async () => {
      order.push('revoke');
      return true;
    });
    fakeBrowser.storage.local.onChanged.addListener(() => order.push('list'));

    await removeWatchedDomain('example.com');

    expect(order).toEqual(['revoke', 'list']);
  });

  it('still delists and erases when the browser refuses to give the permission back', async () => {
    await addWatchedDomain('example.com');
    // What Chrome answers for a permission declared as required rather than optional.
    vi.mocked(permissions.remove).mockRejectedValue(new Error('cannot remove required permissions'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(removeWatchedDomain('example.com')).resolves.toBeUndefined();

    await expect(readWatchedDomains()).resolves.toEqual([]);
  });
});

describe('onWatchedDomainsChanged', () => {
  it('reports the new list when a domain is added', async () => {
    const listener = vi.fn();
    onWatchedDomainsChanged(listener);

    await addWatchedDomain('example.com');

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(['example.com']));
  });

  it('stops reporting once unsubscribed', async () => {
    const listener = vi.fn();
    const unsubscribe = onWatchedDomainsChanged(listener);
    unsubscribe();

    await addWatchedDomain('example.com');

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores changes to unrelated storage keys', async () => {
    const listener = vi.fn();
    onWatchedDomainsChanged(listener);

    await fakeBrowser.storage.local.set({ 'vigie:something-else': 1 });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('readWatchedDomainsWithAccess', () => {
  it('reports a domain whose permission the browser holds as granted', async () => {
    await addWatchedDomain('example.com');

    await expect(readWatchedDomainsWithAccess()).resolves.toEqual([
      { domain: 'example.com', granted: true },
    ]);
  });

  it('reports a permission revoked outside the extension as missing, list untouched', async () => {
    await addWatchedDomain('example.com');
    // What Chrome answers once the user revoked site access from its own settings.
    vi.mocked(permissions.contains).mockResolvedValue(false);

    await expect(readWatchedDomainsWithAccess()).resolves.toEqual([
      { domain: 'example.com', granted: false },
    ]);
    await expect(readWatchedDomains()).resolves.toEqual(['example.com']);
  });

  it('asks the browser about each domain, never about the list as a whole', async () => {
    await addWatchedDomain('example.com');
    await addWatchedDomain('other.test');
    vi.mocked(permissions.contains).mockImplementation(async ({ origins }) =>
      Boolean(origins?.[0]?.includes('example.com')),
    );

    await expect(readWatchedDomainsWithAccess()).resolves.toEqual([
      { domain: 'example.com', granted: true },
      { domain: 'other.test', granted: false },
    ]);
  });
});
