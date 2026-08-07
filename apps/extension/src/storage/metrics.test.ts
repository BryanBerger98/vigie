import type { CaptureEntry, ConsoleEntry, ErrorEntry, NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { CaptureDatabase, setDatabase } from './db';
import { STORAGE_BASELINE_KEY, captureMetrics } from './metrics';

/**
 * The measurement instrument, asserted against a real IndexedDB like the purge is.
 *
 * What matters here is not that the arithmetic runs but that it never invents a figure: an
 * unknown quota has to stay unknown all the way to the settings readout, and a store that has
 * shrunk below its own baseline has to report nothing rather than a negative size.
 */

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

let databases = 0;
let database: CaptureDatabase;

function network(minutesAgo: number, id = `r${minutesAgo}`): NetworkEntry {
  return {
    kind: 'network',
    timestamp: NOW - minutesAgo * MINUTE,
    tabId: 7,
    domain: 'example.com',
    requestId: id,
    method: 'GET',
    url: 'https://example.com/api',
    outcome: 'completed',
    statusCode: 200,
    responseBody: RESPONSE_BODY_UNAVAILABLE,
  };
}

function log(minutesAgo: number): ConsoleEntry {
  return {
    kind: 'console',
    timestamp: NOW - minutesAgo * MINUTE,
    tabId: 7,
    domain: 'example.com',
    level: 'log',
    text: 'hello',
    truncated: false,
  };
}

function failure(minutesAgo: number): ErrorEntry {
  return {
    kind: 'error',
    timestamp: NOW - minutesAgo * MINUTE,
    tabId: 7,
    domain: 'example.com',
    source: 'uncaught',
    message: 'boom',
    truncated: false,
  };
}

function fill(...entries: CaptureEntry[]): Promise<unknown> {
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
  database = new CaptureDatabase(`vigie-metrics-${databases}`);
  setDatabase(database);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await database.delete();
  setDatabase(null);
});

describe('counting', () => {
  it('reports an empty store as holding nothing', async () => {
    expect(await captureMetrics(NOW)).toMatchObject({
      entryCount: 0,
      oldestEntryAt: null,
      byDomain: [],
    });
  });

  it('counts every kind under one total', async () => {
    await fill(network(1), network(2), log(3), log(4), log(5), failure(6));

    expect((await captureMetrics(NOW)).entryCount).toBe(6);
  });

  it('reaches back to the oldest entry, whatever its kind', async () => {
    await fill(network(5), log(40), failure(12));

    expect((await captureMetrics(NOW)).oldestEntryAt).toBe(NOW - 40 * MINUTE);
  });
});

describe('the domain split', () => {
  /** The same entry, stamped with another watched domain. */
  const on = (domain: string, entry: CaptureEntry): CaptureEntry =>
    ({ ...entry, domain }) as CaptureEntry;

  it('has no row at all on an empty store', async () => {
    expect((await captureMetrics(NOW)).byDomain).toEqual([]);
  });

  it('counts every kind under the domain that admitted it', async () => {
    await fill(
      network(1),
      log(2),
      on('other.test', failure(3)),
      on('other.test', network(4, 'r-other')),
      on('other.test', log(5)),
    );

    expect((await captureMetrics(NOW)).byDomain).toEqual([
      { domain: 'other.test', count: 3, bytes: null },
      { domain: 'example.com', count: 2, bytes: null },
    ]);
  });

  // The readout is what makes the scope promise checkable rather than believed: a domain nobody
  // designated has no row, so a user can read the split against their own list.
  it('names only the domains that were actually captured', async () => {
    await fill(network(1), network(2, 'r-second'));

    expect((await captureMetrics(NOW)).byDomain.map((row) => row.domain)).toEqual(['example.com']);
  });

  it('breaks a tie alphabetically, so two readings of one store agree', async () => {
    await fill(on('zeta.test', network(1)), on('alpha.test', network(2, 'r-alpha')));

    expect((await captureMetrics(NOW)).byDomain.map((row) => row.domain)).toEqual([
      'alpha.test',
      'zeta.test',
    ]);
  });

  it('attributes bytes at the store mean, which is what the readout claims', async () => {
    quotaSays(0, 100_000);
    await captureMetrics(NOW);

    quotaSays(4_000, 100_000);
    await fill(network(1), network(2, 'r2'), on('other.test', log(3)), on('other.test', log(4)));

    expect((await captureMetrics(NOW)).byDomain).toEqual([
      { domain: 'example.com', count: 2, bytes: 2_000 },
      { domain: 'other.test', count: 2, bytes: 2_000 },
    ]);
  });
});

describe('bytes', () => {
  it('subtracts what the origin held before anything was captured', async () => {
    quotaSays(1_000, 100_000);
    await captureMetrics(NOW); // empty store: this reading is the baseline

    quotaSays(3_000, 100_000);
    await fill(network(1), network(2));

    expect((await captureMetrics(NOW)).storeBytes).toBe(2_000);
  });

  it('re-measures the baseline every time the store comes back empty', async () => {
    quotaSays(1_000, 100_000);
    await captureMetrics(NOW);

    quotaSays(4_000, 100_000);
    await captureMetrics(NOW);

    expect((await fakeBrowser.storage.local.get(STORAGE_BASELINE_KEY))[STORAGE_BASELINE_KEY]).toBe(
      4_000,
    );
  });

  it('never reports a negative store when usage falls below the baseline', async () => {
    quotaSays(5_000, 100_000);
    await captureMetrics(NOW);

    quotaSays(2_000, 100_000);
    await fill(network(1));

    expect((await captureMetrics(NOW)).storeBytes).toBe(0);
  });

  it('leaves every byte figure unknown when the browser declines to estimate', async () => {
    await fill(network(1));

    const metrics = await captureMetrics(NOW);

    expect(metrics.storeBytes).toBeNull();
    expect(metrics.byDomain.map((row) => row.bytes)).toEqual([null]);
  });
});
