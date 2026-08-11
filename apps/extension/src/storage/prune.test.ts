import type { NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { CaptureDatabase, setDatabase } from './db';
import { EMPTY_STORAGE_STATE, RETENTION_MS, prune, readStorageState } from './prune';

/**
 * The rolling hour, asserted against a real IndexedDB (`fake-indexeddb`, wired in `vitest.setup`).
 * Faking the store instead would test the assertions and not the index the purge walks.
 *
 * Every test opens a database of its own: `fake-indexeddb` keeps one instance per test file, and a
 * purge that leaked entries into the next test would pass by accident.
 */

const NOW = 1_800_000_000_000;

let databases = 0;
let database: CaptureDatabase;

function entry(minutesAgo: number, overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    kind: 'network',
    timestamp: NOW - minutesAgo * 60_000,
    tabId: 7,
    domain: 'example.com',
    requestId: `r${minutesAgo}`,
    method: 'GET',
    url: 'https://example.com/api',
    outcome: 'completed',
    statusCode: 200,
    responseBody: RESPONSE_BODY_UNAVAILABLE,
    ...overrides,
  };
}

function fill(...entries: NetworkEntry[]): Promise<unknown> {
  return database.entries.bulkAdd(entries as never[]);
}

/** States what the browser answers about the quota. Absent by default in this environment. */
function quotaSays(usage: number | null, quota: number | null) {
  vi.stubGlobal('navigator', {
    storage: {
      estimate: () => Promise.resolve({ usage: usage ?? undefined, quota: quota ?? undefined }),
    },
  });
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.unstubAllGlobals();
  databases += 1;
  database = new CaptureDatabase(`vigie-prune-${databases}`);
  setDatabase(database);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await database.delete();
  setDatabase(null);
});

describe('the rolling hour', () => {
  it('keeps an entry that is still inside the window', async () => {
    await fill(entry(59));

    expect(await prune(NOW)).toBe(0);
    expect(await database.entries.count()).toBe(1);
  });

  it('deletes an entry that has fallen out of it', async () => {
    await fill(entry(61));

    expect(await prune(NOW)).toBe(1);
    expect(await database.entries.count()).toBe(0);
  });

  it('cuts exactly at the hour, keeping the entry that sits on the boundary', async () => {
    await fill(entry(0, { requestId: 'boundary', timestamp: NOW - RETENTION_MS }));

    expect(await prune(NOW)).toBe(0);
    expect(await database.entries.count()).toBe(1);
  });

  it('sorts the survivors from the expired in one pass', async () => {
    await fill(entry(5), entry(30), entry(59), entry(61), entry(180));

    expect(await prune(NOW)).toBe(2);
    expect(await database.entries.orderBy('timestamp').keys()).toEqual([
      NOW - 59 * 60_000,
      NOW - 30 * 60_000,
      NOW - 5 * 60_000,
    ]);
  });

  it('deletes nothing on an empty store, and does not fail', async () => {
    expect(await prune(NOW)).toBe(0);
    expect(await database.entries.count()).toBe(0);
  });

  it('is idempotent: a second pass on an unchanged store deletes nothing', async () => {
    await fill(entry(30), entry(90));

    expect(await prune(NOW)).toBe(1);
    expect(await prune(NOW)).toBe(0);
    expect(await database.entries.count()).toBe(1);
  });

  it('moves with the clock, so what survived one pass expires at the next', async () => {
    await fill(entry(59));

    expect(await prune(NOW)).toBe(0);
    expect(await prune(NOW + 2 * 60_000)).toBe(1);
  });
});

describe('the storage readout', () => {
  it('is empty until a purge has run', async () => {
    expect(await readStorageState()).toEqual(EMPTY_STORAGE_STATE);
  });

  it('reports what the store holds and how far back it reaches', async () => {
    await fill(entry(10), entry(45));
    await prune(NOW);

    expect(await readStorageState()).toMatchObject({
      entryCount: 2,
      oldestEntryAt: NOW - 45 * 60_000,
      coveredMs: 45 * 60_000,
      shrunkAt: null,
    });
  });

  it('reports no coverage at all once the store is emptied', async () => {
    await fill(entry(90));
    await prune(NOW);

    expect(await readStorageState()).toMatchObject({
      entryCount: 0,
      oldestEntryAt: null,
      coveredMs: 0,
    });
  });

  it('leaves both quota figures null when the browser declines to say', async () => {
    await fill(entry(10));
    await prune(NOW);

    expect(await readStorageState()).toMatchObject({ usageBytes: null, quotaBytes: null });
  });
});

describe('under quota pressure', () => {
  it('goes past the hour and says when it had to', async () => {
    quotaSays(95, 100);
    await fill(entry(5), entry(15), entry(25), entry(35));

    const deleted = await prune(NOW);

    expect(deleted).toBe(1);
    expect(await database.entries.count()).toBe(3);
    expect(await readStorageState()).toMatchObject({
      shrunkAt: NOW,
      usageBytes: 95,
      quotaBytes: 100,
    });
  });

  it('drops the oldest entries first, never the recent context', async () => {
    quotaSays(95, 100);
    await fill(entry(5), entry(15), entry(25), entry(35));

    await prune(NOW);

    expect(await database.entries.orderBy('timestamp').keys()).toEqual([
      NOW - 25 * 60_000,
      NOW - 15 * 60_000,
      NOW - 5 * 60_000,
    ]);
  });

  it('keeps the full hour while the quota is comfortable', async () => {
    quotaSays(10, 100);
    await fill(entry(5), entry(15), entry(25), entry(35));

    expect(await prune(NOW)).toBe(0);
    expect(await readStorageState()).toMatchObject({ shrunkAt: null, usageBytes: 10, quotaBytes: 100 });
  });

  it('never shrinks on an unknown quota: guessing costs the user their hour', async () => {
    quotaSays(95, null);
    await fill(entry(5), entry(15), entry(25), entry(35));

    expect(await prune(NOW)).toBe(0);
    expect(await readStorageState()).toMatchObject({ shrunkAt: null });
  });

  it('survives a browser that refuses to estimate', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.reject(new Error('not allowed')) },
    });
    await fill(entry(5));

    expect(await prune(NOW)).toBe(0);
    expect(await readStorageState()).toMatchObject({ entryCount: 1, usageBytes: null });
  });

  it('remembers a past shrink through later comfortable purges', async () => {
    quotaSays(95, 100);
    await fill(entry(5), entry(15), entry(25), entry(35));
    await prune(NOW);

    quotaSays(10, 100);
    await prune(NOW + 60_000);

    expect(await readStorageState()).toMatchObject({ shrunkAt: NOW });
  });
});
