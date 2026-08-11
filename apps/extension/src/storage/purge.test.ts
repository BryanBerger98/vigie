import type { NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { CaptureDatabase, setDatabase } from './db';
import { STORAGE_STATE_KEY, readStorageState } from './prune';
import { purgeCapturedData } from './purge';
import {
  captureEntry,
  discardPendingWrites,
  flush,
  pendingWrites,
  setCaptureConsent,
  setCaptureScope,
} from './write';

/**
 * "Everything is gone" asserted as the whole of everything: the table, the batch still in the
 * worker's memory, and the readout the surfaces show without opening the database. A purge that
 * cleared only the first of the three would be observably incomplete from the settings screen.
 *
 * And the counterpart the phase insists on: purging is not disabling. The capture is expected to
 * write again the moment it is asked to.
 */

const NOW = 1_800_000_000_000;

let databases = 0;
let database: CaptureDatabase;

function entry(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    kind: 'network',
    timestamp: NOW,
    tabId: 7,
    domain: 'example.com',
    requestId: 'r1',
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

beforeEach(() => {
  fakeBrowser.reset();
  discardPendingWrites();
  setCaptureConsent(true);
  setCaptureScope(['example.com']);
  databases += 1;
  database = new CaptureDatabase(`vigie-purge-${databases}`);
  setDatabase(database);
});

afterEach(async () => {
  discardPendingWrites();
  await database.delete();
  setDatabase(null);
});

describe('purgeCapturedData', () => {
  it('empties the table and says how much it dropped', async () => {
    await fill(entry({ requestId: 'a' }), entry({ requestId: 'b', timestamp: NOW + 1 }));

    await expect(purgeCapturedData()).resolves.toBe(2);
    expect(await database.entries.count()).toBe(0);
  });

  // The batch lives in the worker's memory, not on disk. Left alone it would be written seconds
  // after the user was told the store was empty.
  it('drops the batch still waiting to be written', async () => {
    captureEntry(entry(), 'https://example.com/api');
    expect(pendingWrites()).toBe(1);

    await purgeCapturedData();

    expect(pendingWrites()).toBe(0);
    await flush(NOW);
    expect(await database.entries.count()).toBe(0);
  });

  it('resets the readout, so no surface keeps announcing a volume that is gone', async () => {
    await fakeBrowser.storage.local.set({
      [STORAGE_STATE_KEY]: {
        entryCount: 412,
        oldestEntryAt: NOW - 60_000,
        coveredMs: 60_000,
        usageBytes: 900_000,
        quotaBytes: 1_000_000,
        shrunkAt: NOW - 1_000,
      },
    });

    await purgeCapturedData();

    expect(await readStorageState()).toEqual({
      entryCount: 0,
      oldestEntryAt: null,
      coveredMs: 0,
      usageBytes: null,
      quotaBytes: null,
      shrunkAt: null,
    });
  });

  // Purger n'est pas désactiver: the watched domains and the consent are untouched, so the very
  // next request on a watched domain is captured.
  it('leaves the capture running', async () => {
    await fill(entry());
    await purgeCapturedData();

    expect(captureEntry(entry({ requestId: 'after' }), 'https://example.com/api')).toBe('queued');

    await flush(NOW);
    const stored = await database.entries.toArray();
    expect(stored).toHaveLength(1);
    expect((stored[0] as NetworkEntry).requestId).toBe('after');
  });

  it('answers zero on an already empty store rather than failing', async () => {
    await expect(purgeCapturedData()).resolves.toBe(0);
  });
});
