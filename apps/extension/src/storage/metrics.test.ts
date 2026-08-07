import type { CaptureEntry, ConsoleEntry, ErrorEntry, NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { CaptureDatabase, setDatabase } from './db';
import {
  EMPTY_CAPTURE_METRICS,
  MAX_READINGS,
  STORAGE_BASELINE_KEY,
  captureMetrics,
  clearReadings,
  formatReadings,
  readReadings,
  recordReading,
  type CaptureMetrics,
} from './metrics';

/**
 * The measurement instrument, asserted against a real IndexedDB like the purge is.
 *
 * What matters here is not that the arithmetic runs but that it never invents a figure: an
 * unknown quota has to stay unknown all the way to the readout, and a window too short to carry a
 * rate has to report no rate rather than one extrapolated from a few seconds.
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
  it('reports an empty store as covering nothing', async () => {
    const metrics = await captureMetrics(NOW);

    expect(metrics).toMatchObject({
      entryCount: 0,
      oldestEntryAt: null,
      coveredMs: 0,
      entriesPerMinute: 0,
    });
  });

  it('splits the count by kind, because the two do not shrink the same way', async () => {
    await fill(network(1), network(2), log(3), log(4), log(5), failure(6));

    const metrics = await captureMetrics(NOW);

    expect(metrics.entryCount).toBe(6);
    expect(metrics.byKind.network.count).toBe(2);
    expect(metrics.byKind.console.count).toBe(3);
    expect(metrics.byKind.error.count).toBe(1);
  });

  it('reaches back to the oldest entry, whatever its kind', async () => {
    await fill(network(5), log(40), failure(12));

    const metrics = await captureMetrics(NOW);

    expect(metrics.oldestEntryAt).toBe(NOW - 40 * MINUTE);
    expect(metrics.coveredMs).toBe(40 * MINUTE);
  });

  it('does not go negative when an entry is stamped in the future', async () => {
    await fill(network(-5));

    expect((await captureMetrics(NOW)).coveredMs).toBe(0);
  });
});

describe('the rate', () => {
  it('is entries over the window actually covered, not over the promised hour', async () => {
    await fill(network(1), network(2), network(3), network(4), log(10));

    const metrics = await captureMetrics(NOW);

    // Five entries over ten minutes.
    expect(metrics.entriesPerMinute).toBeCloseTo(0.5, 5);
    expect(metrics.byKind.network.perMinute).toBeCloseTo(0.4, 5);
    expect(metrics.byKind.console.perMinute).toBeCloseTo(0.1, 5);
  });

  it('reports no rate at all under a minute, rather than one read off a few seconds', async () => {
    await fill(network(0), network(0, 'r-second'));

    const metrics = await captureMetrics(NOW + 10_000);

    expect(metrics.entryCount).toBe(2);
    expect(metrics.entriesPerMinute).toBe(0);
  });
});

describe('bytes', () => {
  it('subtracts what the origin held before anything was captured', async () => {
    quotaSays(1_000, 100_000);
    await captureMetrics(NOW); // empty store: this reading is the baseline

    quotaSays(3_000, 100_000);
    await fill(network(1), network(2));
    const metrics = await captureMetrics(NOW);

    expect(metrics.baselineBytes).toBe(1_000);
    expect(metrics.storeBytes).toBe(2_000);
    expect(metrics.bytesPerEntry).toBe(1_000);
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

    expect(await captureMetrics(NOW)).toMatchObject({
      usageBytes: null,
      storeBytes: null,
      bytesPerEntry: null,
      projectedHourBytes: null,
      projectedQuotaRatio: null,
    });
  });

  it('attributes bytes per kind at the store mean, which is what the readout claims', async () => {
    quotaSays(0, 100_000);
    await captureMetrics(NOW);

    quotaSays(4_000, 100_000);
    await fill(network(1), network(2), log(3), log(4));
    const metrics = await captureMetrics(NOW);

    expect(metrics.bytesPerEntry).toBe(1_000);
    expect(metrics.byKind.network.bytes).toBe(2_000);
    expect(metrics.byKind.console.bytes).toBe(2_000);
  });
});

describe('the hour projection', () => {
  it('scales the observed cost to sixty minutes', async () => {
    quotaSays(0, 1_000_000);
    await captureMetrics(NOW);

    // Ten entries over ten minutes, at 100 bytes each: 60 an hour, 6 000 bytes.
    quotaSays(1_000, 1_000_000);
    await fill(...Array.from({ length: 10 }, (_, index) => network(index + 1, `r${index}`)));
    const metrics = await captureMetrics(NOW);

    expect(metrics.entriesPerMinute).toBeCloseTo(1, 5);
    expect(metrics.projectedHourBytes).toBeCloseTo(6_000, 5);
    expect(metrics.projectedQuotaRatio).toBeCloseTo(0.006, 5);
  });

  it('projects nothing while the window is too short to carry a rate', async () => {
    quotaSays(0, 1_000_000);
    await captureMetrics(NOW);

    quotaSays(1_000, 1_000_000);
    await fill(network(0));

    expect((await captureMetrics(NOW)).projectedHourBytes).toBeNull();
  });

  it('leaves the quota fraction unknown when the browser gives no ceiling', async () => {
    quotaSays(0, null);
    await captureMetrics(NOW);

    quotaSays(1_000, null);
    await fill(network(5), network(10));

    expect((await captureMetrics(NOW)).projectedQuotaRatio).toBeNull();
  });
});

describe('the readings series', () => {
  it('starts empty', async () => {
    expect(await readReadings()).toEqual([]);
  });

  it('keeps each reading in the order it was taken', async () => {
    await fill(network(5));
    const first = await captureMetrics(NOW);
    await fill(log(2));
    const second = await captureMetrics(NOW + MINUTE);

    await recordReading(first);
    await recordReading(second);

    expect((await readReadings()).map((reading) => reading.takenAt)).toEqual([NOW, NOW + MINUTE]);
  });

  it('drops the oldest once the cap is reached, so a forgotten run stays bounded', async () => {
    const reading = (takenAt: number): CaptureMetrics => ({ ...EMPTY_CAPTURE_METRICS, takenAt });

    for (let index = 0; index < MAX_READINGS + 3; index += 1) {
      await recordReading(reading(NOW + index));
    }

    const series = await readReadings();

    expect(series).toHaveLength(MAX_READINGS);
    expect(series[0]?.takenAt).toBe(NOW + 3);
  });

  it('is forgotten on demand, so one run cannot contaminate the next', async () => {
    await recordReading(await captureMetrics(NOW));
    await clearReadings();

    expect(await readReadings()).toEqual([]);
  });

  it('lives outside the capture store, so measuring never adds to what is measured', async () => {
    await fill(network(5));
    await recordReading(await captureMetrics(NOW));

    expect(await database.entries.count()).toBe(1);
  });
});

describe('the readings table', () => {
  it('is a header alone when nothing has been recorded', () => {
    expect(formatReadings([]).split('\n')).toHaveLength(2);
  });

  it('carries one row per reading, stamped with the time it was taken', async () => {
    await fill(network(5), log(10));
    const first = await captureMetrics(NOW);
    const second = await captureMetrics(NOW + 5 * MINUTE);

    const rows = formatReadings([first, second]).split('\n').slice(2);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(new Date(NOW).toISOString().slice(11, 19));
    expect(rows[1]).toContain(new Date(NOW + 5 * MINUTE).toISOString().slice(11, 19));
  });

  it('writes an unknown byte figure as a dash rather than as a zero', async () => {
    await fill(network(5));

    const rows = formatReadings([await captureMetrics(NOW)]).split('\n').slice(2);

    expect(rows[0]).toContain('| — | — |');
  });

  it('carries the counts a report is rebuilt from', async () => {
    await fill(network(5), network(6), log(10), failure(12));

    const rows = formatReadings([await captureMetrics(NOW)]).split('\n').slice(2);

    expect(rows[0]).toContain('| 4 | 2 | 1 | 1 |');
  });
});
