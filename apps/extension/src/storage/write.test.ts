import type { NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { CaptureDatabase, setDatabase } from './db';
import {
  BATCH_DELAY_MS,
  BATCH_SIZE,
  captureEntry,
  captureScope,
  discardPendingWrites,
  flush,
  pendingWrites,
  setCaptureScope,
  type EntryDraft,
} from './write';

/**
 * The single door into the store, asserted against a real IndexedDB.
 *
 * Two rules carry the whole product here and are tested as such: nothing unwatched is ever written
 * to disk, and every flush prunes. The rest — batching, chaining — is what keeps that affordable.
 */

const NOW = 1_800_000_000_000;

let databases = 0;
let database: CaptureDatabase;

function draft(overrides: Partial<NetworkEntry> = {}): EntryDraft {
  const { domain: _ignored, ...base } = {
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
  } satisfies NetworkEntry;

  return base;
}

function stored() {
  return database.entries.orderBy('timestamp').toArray();
}

beforeEach(() => {
  fakeBrowser.reset();
  discardPendingWrites();
  setCaptureScope([]);
  databases += 1;
  database = new CaptureDatabase(`vigie-write-${databases}`);
  setDatabase(database);
});

afterEach(async () => {
  discardPendingWrites();
  await database.delete();
  setDatabase(null);
});

describe('the scope filter', () => {
  it('refuses an entry whose URL is not watched, and writes nothing', async () => {
    setCaptureScope(['example.com']);

    expect(captureEntry(draft({ url: 'https://other.test/api' }), 'https://other.test/api')).toBe(
      'out-of-scope',
    );
    expect(pendingWrites()).toBe(0);

    await flush(NOW);
    expect(await database.entries.count()).toBe(0);
  });

  it('refuses everything while nothing is watched', () => {
    expect(captureEntry(draft(), 'https://example.com/api')).toBe('out-of-scope');
  });

  it('accepts an entry on a watched domain', async () => {
    setCaptureScope(['example.com']);

    expect(captureEntry(draft(), 'https://example.com/api')).toBe('queued');

    await flush(NOW);
    expect(await stored()).toHaveLength(1);
  });

  it('accepts a subdomain of a watched domain', async () => {
    setCaptureScope(['example.com']);

    expect(captureEntry(draft(), 'https://api.example.com/users')).toBe('queued');

    await flush(NOW);
    expect(await stored()).toHaveLength(1);
  });

  it('stamps the entry with the watched domain that admitted it, not with its host', async () => {
    setCaptureScope(['example.com']);
    captureEntry(draft(), 'https://api.example.com/users');

    await flush(NOW);
    expect((await stored())[0]).toMatchObject({ domain: 'example.com' });
  });

  it('stamps the most specific watched domain when several match', async () => {
    setCaptureScope(['example.com', 'api.example.com']);
    captureEntry(draft(), 'https://api.example.com/users');

    await flush(NOW);
    expect((await stored())[0]).toMatchObject({ domain: 'api.example.com' });
  });

  it('exposes the scope it is filtering on', () => {
    setCaptureScope(['example.com']);
    expect(captureScope()).toEqual(['example.com']);
  });
});

describe('an entry with no tab', () => {
  it('is refused: it could never be attached to an exportable session', async () => {
    setCaptureScope(['example.com']);

    expect(captureEntry(draft({ tabId: -1 }), 'https://example.com/api')).toBe('no-tab');
    expect(pendingWrites()).toBe(0);

    await flush(NOW);
    expect(await database.entries.count()).toBe(0);
  });
});

describe('batching', () => {
  it('holds an entry rather than opening a transaction for it', async () => {
    setCaptureScope(['example.com']);
    captureEntry(draft(), 'https://example.com/api');

    expect(pendingWrites()).toBe(1);
    expect(await database.entries.count()).toBe(0);
  });

  it('writes on its own once the batch is full', async () => {
    setCaptureScope(['example.com']);
    for (let index = 0; index < BATCH_SIZE; index += 1) {
      captureEntry(draft({ requestId: `r${index}`, timestamp: NOW + index }), 'https://example.com/api');
    }

    expect(pendingWrites()).toBe(0);

    await flush(NOW);
    expect(await database.entries.count()).toBe(BATCH_SIZE);
  });

  it('writes a partial batch once its delay has passed', async () => {
    setCaptureScope(['example.com']);
    captureEntry(draft(), 'https://example.com/api');

    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS + 100));

    expect(pendingWrites()).toBe(0);
    expect(await database.entries.count()).toBe(1);
  });

  it('drops what is queued when asked to, without writing it', async () => {
    setCaptureScope(['example.com']);
    captureEntry(draft(), 'https://example.com/api');

    discardPendingWrites();

    await flush(NOW);
    expect(await database.entries.count()).toBe(0);
  });
});

describe('concurrent writes', () => {
  it('chain rather than overlap, so nothing is written twice', async () => {
    setCaptureScope(['example.com']);
    for (let index = 0; index < 10; index += 1) {
      captureEntry(draft({ requestId: `r${index}`, timestamp: NOW + index }), 'https://example.com/api');
    }

    await Promise.all([flush(NOW), flush(NOW), flush(NOW)]);

    const entries = await stored();
    expect(entries).toHaveLength(10);
    expect(new Set(entries.map((item) => (item as NetworkEntry).requestId)).size).toBe(10);
  });

  it('keeps what arrives during a flush, rather than losing it with the batch', async () => {
    setCaptureScope(['example.com']);
    captureEntry(draft({ requestId: 'first' }), 'https://example.com/api');

    const inFlight = flush(NOW);
    captureEntry(draft({ requestId: 'second', timestamp: NOW + 1 }), 'https://example.com/api');
    await inFlight;
    await flush(NOW);

    expect((await stored()).map((item) => (item as NetworkEntry).requestId)).toEqual(['first', 'second']);
  });
});

describe('pruning on the write path', () => {
  it('drops what has fallen out of the hour at every flush', async () => {
    setCaptureScope(['example.com']);
    captureEntry(draft({ requestId: 'old', timestamp: NOW - 61 * 60_000 }), 'https://example.com/api');
    captureEntry(draft({ requestId: 'fresh' }), 'https://example.com/api');

    await flush(NOW);

    expect((await stored()).map((item) => (item as NetworkEntry).requestId)).toEqual(['fresh']);
  });

  it('runs even when the batch was empty, so an idle worker still cleans up', async () => {
    await database.entries.bulkAdd([
      { ...draft({ requestId: 'stale', timestamp: NOW - 90 * 60_000 }), domain: 'example.com' },
    ] as never[]);

    await flush(NOW);

    expect(await database.entries.count()).toBe(0);
  });
});

describe('narrowing the scope', () => {
  it('drops queued entries for a domain that just left it', async () => {
    setCaptureScope(['example.com', 'other.test']);
    captureEntry(draft(), 'https://example.com/api');
    captureEntry(draft({ requestId: 'r2', timestamp: NOW + 1 }), 'https://other.test/api');

    setCaptureScope(['other.test']);

    expect(pendingWrites()).toBe(1);

    await flush(NOW);
    expect((await stored()).map((item) => (item as NetworkEntry).domain)).toEqual(['other.test']);
  });
});
