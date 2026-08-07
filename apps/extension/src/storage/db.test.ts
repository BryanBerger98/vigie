import type { NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CAPTURE_DATABASE_NAME, CaptureDatabase, db, setDatabase } from './db';

/**
 * The schema, asserted through the queries it exists for.
 *
 * Dexie refuses a `where` on an index it was not given, so a query that returns the right slice is
 * also the proof that it ran on the index rather than walking the table. That is the only check
 * worth making here: the cost of a missing index is invisible until the store holds an hour of a
 * busy tab, which no unit test will ever reproduce.
 */

const NOW = 1_800_000_000_000;

let databases = 0;
let database: CaptureDatabase;

function entry(overrides: Partial<NetworkEntry>): NetworkEntry {
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

beforeEach(() => {
  databases += 1;
  database = new CaptureDatabase(`vigie-db-${databases}`);
  setDatabase(database);
});

afterEach(async () => {
  await database.delete();
  setDatabase(null);
});

describe('the capture database', () => {
  it('opens at version 1', async () => {
    await database.open();

    expect(database.verno).toBe(1);
  });

  it('hands the same instance back rather than opening a second connection', () => {
    expect(db()).toBe(database);
    expect(db()).toBe(db());
  });

  it('is named for the product, so a profile shows one store and not several', () => {
    expect(new CaptureDatabase().name).toBe(CAPTURE_DATABASE_NAME);
  });

  it('assigns the key itself, so a write hands over everything but the id', async () => {
    const id = await database.entries.add(entry({}) as never);

    expect(typeof id).toBe('number');
    expect((await database.entries.get(id as never))?.id).toBe(id);
  });
});

describe('the export slice', () => {
  it('answers a tab over a time window on the index, not by walking the table', async () => {
    await database.entries.bulkAdd([
      entry({ requestId: 'other-tab', tabId: 9, timestamp: NOW - 5 * 60_000 }),
      entry({ requestId: 'too-old', timestamp: NOW - 90 * 60_000 }),
      entry({ requestId: 'inside-a', timestamp: NOW - 30 * 60_000 }),
      entry({ requestId: 'inside-b', timestamp: NOW - 10 * 60_000 }),
      entry({ requestId: 'too-recent', timestamp: NOW + 60_000 }),
    ] as never[]);

    const slice = await database.entries
      .where('[tabId+timestamp]')
      .between([7, NOW - 60 * 60_000], [7, NOW])
      .toArray();

    expect(slice.map((item) => (item as NetworkEntry).requestId)).toEqual(['inside-a', 'inside-b']);
  });
});
