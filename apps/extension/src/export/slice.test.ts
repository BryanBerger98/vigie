import type { CaptureEntry, ConsoleEntry, NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CaptureDatabase, setDatabase } from '@/storage/db';

import { coveredDepthMinutes, oldestCaptureAt, readWindow, windowBounds } from './slice';

/**
 * The window, asserted on its edges rather than in its middle.
 *
 * Every bug this module can have is a boundary bug: one millisecond of inclusiveness, one tab of
 * leakage, one minute past the ceiling. So the entries here are placed exactly on the bounds and
 * exactly one millisecond either side of them.
 */

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const TAB = 7;

let databases = 0;
let database: CaptureDatabase;

function request(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    kind: 'network',
    timestamp: NOW,
    tabId: TAB,
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

function log(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    kind: 'console',
    timestamp: NOW,
    tabId: TAB,
    domain: 'example.com',
    level: 'log',
    text: 'hello',
    truncated: false,
    ...overrides,
  };
}

async function fill(entries: CaptureEntry[]): Promise<void> {
  await database.entries.bulkAdd(entries as never[]);
}

/** What a slice holds, in a form an assertion can read at a glance. */
function marks(entries: CaptureEntry[]): string[] {
  return entries.map((entry) =>
    entry.kind === 'network' ? entry.requestId : `${entry.kind}:${entry.timestamp - NOW}`,
  );
}

beforeEach(() => {
  databases += 1;
  database = new CaptureDatabase(`vigie-slice-${databases}`);
  setDatabase(database);
});

afterEach(async () => {
  await database.delete();
  setDatabase(null);
});

describe('the window a depth means', () => {
  it('spans exactly the minutes asked for', () => {
    expect(windowBounds(NOW, 15)).toEqual({ from: NOW - 15 * MINUTE, to: NOW, depthMinutes: 15 });
  });

  it('stops at one hour whatever is asked, because that is all the store holds', () => {
    expect(windowBounds(NOW, 90)).toEqual({ from: NOW - 60 * MINUTE, to: NOW, depthMinutes: 60 });
  });

  it('refuses a negative depth rather than reaching into the future', () => {
    expect(windowBounds(NOW, -10)).toEqual({ from: NOW, to: NOW, depthMinutes: 0 });
  });
});

describe('the entries a window holds', () => {
  it('takes both bounds and nothing beyond either', async () => {
    await fill([
      request({ requestId: 'before', timestamp: NOW - 15 * MINUTE - 1 }),
      request({ requestId: 'on-from', timestamp: NOW - 15 * MINUTE }),
      request({ requestId: 'inside', timestamp: NOW - 5 * MINUTE }),
      request({ requestId: 'on-to', timestamp: NOW }),
      request({ requestId: 'after', timestamp: NOW + 1 }),
    ]);

    const entries = await readWindow(TAB, windowBounds(NOW, 15));

    expect(marks(entries)).toEqual(['on-from', 'inside', 'on-to']);
  });

  it('never lets another tab in, however close in time', async () => {
    await fill([
      request({ requestId: 'ours', timestamp: NOW - MINUTE }),
      request({ requestId: 'theirs', tabId: TAB + 1, timestamp: NOW - MINUTE }),
    ]);

    expect(marks(await readWindow(TAB, windowBounds(NOW, 15)))).toEqual(['ours']);
  });

  it('hands back an empty window rather than failing on it', async () => {
    await fill([request({ requestId: 'old', timestamp: NOW - 40 * MINUTE })]);

    expect(await readWindow(TAB, windowBounds(NOW, 15))).toEqual([]);
  });

  it('keeps a ninety-minute request to the last hour', async () => {
    await fill([
      request({ requestId: 'ninety', timestamp: NOW - 90 * MINUTE }),
      request({ requestId: 'sixty-one', timestamp: NOW - 61 * MINUTE }),
      request({ requestId: 'fifty-nine', timestamp: NOW - 59 * MINUTE }),
    ]);

    expect(marks(await readWindow(TAB, windowBounds(NOW, 90)))).toEqual(['fifty-nine']);
  });

  it('mixes the kinds into one ascending thread, and sorts nothing else', async () => {
    await fill([
      request({ requestId: 'r-late', timestamp: NOW - MINUTE }),
      log({ timestamp: NOW - 3 * MINUTE }),
      request({ requestId: 'r-early', timestamp: NOW - 4 * MINUTE }),
      log({ timestamp: NOW - 2 * MINUTE }),
    ]);

    expect(marks(await readWindow(TAB, windowBounds(NOW, 15)))).toEqual([
      'r-early',
      'console:-180000',
      'console:-120000',
      'r-late',
    ]);
  });

  it('drops the stored key, which identifies a row and not anything a reader can use', async () => {
    await fill([request({ requestId: 'only' })]);

    const [entry] = await readWindow(TAB, windowBounds(NOW, 15));

    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty('id');
  });
});

describe('the depth actually covered', () => {
  it('is the full depth when the capture reaches past the window', () => {
    const bounds = windowBounds(NOW, 15);

    expect(coveredDepthMinutes(bounds, NOW - 40 * MINUTE)).toBe(15);
  });

  it('is what the capture reaches when it started inside the window', () => {
    const bounds = windowBounds(NOW, 60);

    expect(coveredDepthMinutes(bounds, NOW - 20 * MINUTE)).toBe(20);
  });

  it('is zero on an empty store, rather than the hour nobody captured', () => {
    expect(coveredDepthMinutes(windowBounds(NOW, 60), null)).toBe(0);
  });

  it('is measured on the store and not on the tab, so a silent tab is still covered', async () => {
    await fill([
      request({ requestId: 'other-tab', tabId: TAB + 1, timestamp: NOW - 45 * MINUTE }),
      request({ requestId: 'ours', timestamp: NOW - MINUTE }),
    ]);

    expect(coveredDepthMinutes(windowBounds(NOW, 60), await oldestCaptureAt())).toBe(45);
  });

  it('reports no oldest entry when nothing has been captured', async () => {
    expect(await oldestCaptureAt()).toBeNull();
  });
});
