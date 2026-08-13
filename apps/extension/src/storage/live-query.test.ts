import type { ConsoleEntry, NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { CaptureDatabase, setDatabase } from './db';
import { observeTabWindow, readTabWindow, type TabWindow } from './live-query';
import { RETENTION_MS } from './prune';

/**
 * What the reading surface is allowed to see, and what reaches it once it is subscribed.
 *
 * Three rules are asserted here rather than in a browser, because all three are properties of the
 * query and not of the panel: the window is one tab wide, one hour deep, and it leaves the store
 * exactly as it found it. The fourth — a row written after the subscription started still arrives —
 * is the whole reason the range has no upper bound, and it is cheap enough to state without Chrome.
 */

const NOW = 1_800_000_000_000;

let databases = 0;
let database: CaptureDatabase;

function network(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
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
    provenance: 'webRequest',
    responseBody: RESPONSE_BODY_UNAVAILABLE,
    ...overrides,
  };
}

function log(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    kind: 'console',
    timestamp: NOW,
    tabId: 7,
    domain: 'example.com',
    level: 'log',
    text: 'hello',
    truncated: false,
    ...overrides,
  };
}

function fill(...entries: (NetworkEntry | ConsoleEntry)[]): Promise<unknown> {
  return database.entries.bulkAdd(entries as never[]);
}

beforeEach(() => {
  fakeBrowser.reset();
  databases += 1;
  database = new CaptureDatabase(`vigie-live-query-${databases}`);
  setDatabase(database);
});

afterEach(async () => {
  await database.delete();
  setDatabase(null);
});

describe('readTabWindow', () => {
  it('holds one tab and no other', async () => {
    await fill(
      network({ requestId: 'mine', tabId: 7 }),
      network({ requestId: 'theirs', tabId: 8 }),
      log({ tabId: 8, text: 'not mine' }),
    );

    const { entries } = await readTabWindow(7, NOW);

    expect(entries).toHaveLength(1);
    expect((entries[0] as NetworkEntry).requestId).toBe('mine');
  });

  it('mixes the kinds into one thread, ordered by ascending timestamp', async () => {
    await fill(
      network({ requestId: 'third', timestamp: NOW - 1_000 }),
      log({ timestamp: NOW - 5_000, text: 'first' }),
      network({ requestId: 'second', timestamp: NOW - 3_000 }),
    );

    const { entries } = await readTabWindow(7, NOW);

    expect(entries.map((entry) => entry.timestamp)).toEqual([
      NOW - 5_000,
      NOW - 3_000,
      NOW - 1_000,
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['console', 'network', 'network']);
  });

  // The purge runs on the write path and nowhere else, so a store read between two writes still
  // holds rows older than the hour. Cutting them out is the reader's job; deleting them is not.
  it('cuts the hour without erasing what falls outside it', async () => {
    await fill(
      network({ requestId: 'stale', timestamp: NOW - RETENTION_MS - 1 }),
      network({ requestId: 'fresh', timestamp: NOW - 1_000 }),
    );

    const { entries, from } = await readTabWindow(7, NOW);

    expect(entries).toHaveLength(1);
    expect((entries[0] as NetworkEntry).requestId).toBe('fresh');
    expect(from).toBe(NOW - RETENTION_MS);
    expect(await database.entries.count()).toBe(2);
  });

  it('answers an empty window on a tab nothing was captured on', async () => {
    await fill(network({ tabId: 8 }));

    await expect(readTabWindow(7, NOW)).resolves.toMatchObject({ tabId: 7, entries: [] });
  });
});

describe('observeTabWindow', () => {
  it('delivers the window again once a row lands after the subscription', async () => {
    // Real clock, because the subscription reads its own `Date.now()` on every run: an entry
    // stamped with the fixture's constant would sit an unbounded distance from the rolling window.
    const started = Date.now();
    await fill(network({ requestId: 'before', timestamp: started - 5_000 }));

    let latest: TabWindow | null = null;
    let arrived!: () => void;
    const secondDelivery = new Promise<void>((resolve) => {
      arrived = resolve;
    });

    const unsubscribe = observeTabWindow(7, (window) => {
      latest = window;
      if (window.entries.some((entry) => (entry as NetworkEntry).requestId === 'after')) arrived();
    });

    // Written the way the worker writes it: through the store, with no signal of our own. The
    // second delivery is Dexie noticing on its own, which is the entire contract of this module.
    await fill(network({ requestId: 'after', timestamp: started }));
    await secondDelivery;
    unsubscribe();

    const delivered = latest as TabWindow | null;
    expect(delivered?.entries.map((entry) => (entry as NetworkEntry).requestId)).toEqual([
      'before',
      'after',
    ]);
  });
});
