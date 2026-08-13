import type { NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CaptureDatabase, setDatabase } from '@/storage/db';

import { eraseCapturedDataFor } from './erase-domain-data';

/**
 * The promise made to the user when they remove a domain: what was captured for it is gone, and
 * nothing else is. Asserted against a real IndexedDB, because what is under test is the range the
 * deletion walks on the `[domain+timestamp]` index.
 */

const NOW = 1_800_000_000_000;

let databases = 0;
let database: CaptureDatabase;

function entry(domain: string, minutesAgo: number): NetworkEntry {
  return {
    kind: 'network',
    timestamp: NOW - minutesAgo * 60_000,
    tabId: 7,
    domain,
    requestId: `${domain}-${minutesAgo}`,
    method: 'GET',
    url: `https://${domain}/api`,
    outcome: 'completed',
    statusCode: 200,
    provenance: 'webRequest',
    responseBody: RESPONSE_BODY_UNAVAILABLE,
  };
}

async function remainingDomains(): Promise<string[]> {
  const entries = await database.entries.orderBy('timestamp').toArray();
  return entries.map((item) => item.domain);
}

beforeEach(() => {
  databases += 1;
  database = new CaptureDatabase(`vigie-erase-${databases}`);
  setDatabase(database);
});

afterEach(async () => {
  await database.delete();
  setDatabase(null);
});

describe('eraseCapturedDataFor', () => {
  it('deletes every entry of the domain, whatever its age', async () => {
    await database.entries.bulkAdd([
      entry('example.com', 1),
      entry('example.com', 30),
      entry('example.com', 59),
    ] as never[]);

    await eraseCapturedDataFor('example.com');

    expect(await database.entries.count()).toBe(0);
  });

  it('leaves the other watched domains untouched', async () => {
    await database.entries.bulkAdd([
      entry('example.com', 10),
      entry('other.test', 20),
      entry('example.com', 30),
      entry('third.test', 40),
    ] as never[]);

    await eraseCapturedDataFor('example.com');

    expect(await remainingDomains()).toEqual(['third.test', 'other.test']);
  });

  it('does not touch a domain that merely starts with the same text', async () => {
    await database.entries.bulkAdd([
      entry('example.com', 10),
      entry('example.community', 20),
    ] as never[]);

    await eraseCapturedDataFor('example.com');

    expect(await remainingDomains()).toEqual(['example.community']);
  });

  it('erases the subdomains stamped under the domain, since the stamp is the watched one', async () => {
    await database.entries.bulkAdd([
      { ...entry('example.com', 10), url: 'https://api.example.com/users' },
      { ...entry('example.com', 20), url: 'https://cdn.example.com/app.js' },
    ] as never[]);

    await eraseCapturedDataFor('example.com');

    expect(await database.entries.count()).toBe(0);
  });

  it('succeeds on a domain that holds nothing', async () => {
    await database.entries.bulkAdd([entry('other.test', 10)] as never[]);

    await expect(eraseCapturedDataFor('example.com')).resolves.toBeUndefined();
    expect(await database.entries.count()).toBe(1);
  });

  it('is idempotent, so the removal flow and the worker may both call it', async () => {
    await database.entries.bulkAdd([entry('example.com', 10)] as never[]);

    await eraseCapturedDataFor('example.com');
    await eraseCapturedDataFor('example.com');

    expect(await database.entries.count()).toBe(0);
  });
});
