import type { CaptureEntry, ConsoleEntry, NetworkEntry } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE, SCHEMA_VERSION } from '@vigie/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { CaptureDatabase, setDatabase } from '@/storage/db';
import { STORAGE_STATE_KEY, type StorageState } from '@/storage/prune';

import { assembleBundle, type BundleRequest } from './bundle';

/**
 * The assembly, asserted on the one thing it exists to guarantee: the edge.
 *
 * `frozenAt` is injected as a clock rather than stubbed globally, so a test can state that the
 * instant was taken before the queue was drained — which is the ordering the whole module is
 * about, and the only part of it that cannot be seen from the outside.
 */

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const TAB = 7;

let databases = 0;
let database: CaptureDatabase;

function request(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    kind: 'network',
    timestamp: NOW - MINUTE,
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
    timestamp: NOW - MINUTE,
    tabId: TAB,
    domain: 'example.com',
    level: 'log',
    text: 'hello',
    truncated: false,
    ...overrides,
  };
}

function fill(entries: CaptureEntry[]): Promise<unknown> {
  return database.entries.bulkAdd(entries as never[]);
}

function bundleRequest(overrides: Partial<BundleRequest> = {}): BundleRequest {
  return {
    tabId: TAB,
    requestedDepthMinutes: 15,
    subject: { domain: 'example.com', url: 'https://example.com/checkout' },
    extensionVersion: '0.1.0',
    ...overrides,
  };
}

beforeEach(() => {
  databases += 1;
  database = new CaptureDatabase(`vigie-bundle-${databases}`);
  setDatabase(database);
  fakeBrowser.reset();
});

afterEach(async () => {
  await database.delete();
  setDatabase(null);
});

describe('the frozen instant', () => {
  it('is taken before the queue is drained', async () => {
    const order: string[] = [];
    const clock = () => {
      order.push('froze');
      return NOW;
    };
    const settle = async () => {
      order.push('settled');
    };

    await assembleBundle(bundleRequest({ settle }), clock);

    expect(order).toEqual(['froze', 'settled']);
  });

  it('is the end of the window, and the window is the depth asked for', async () => {
    const bundle = await assembleBundle(bundleRequest({ requestedDepthMinutes: 30 }), () => NOW);

    expect(bundle.window).toMatchObject({
      requestedDepthMinutes: 30,
      frozenAt: NOW,
      to: NOW,
      from: NOW - 30 * MINUTE,
    });
  });

  it('leaves out what the capture wrote after it', async () => {
    // Written between the freeze and the read: the drain is where a late entry can slip in.
    const settle = () => fill([request({ requestId: 'after', timestamp: NOW + 1 })]) as Promise<void>;
    await fill([request({ requestId: 'before' })]);

    const bundle = await assembleBundle(bundleRequest({ settle }), () => NOW);

    expect(bundle.entries.map((entry) => (entry as NetworkEntry).requestId)).toEqual(['before']);
  });

  it('takes what the drain wrote with an earlier stamp', async () => {
    const settle = () =>
      fill([request({ requestId: 'queued', timestamp: NOW - 1 })]) as Promise<void>;

    const bundle = await assembleBundle(bundleRequest({ settle }), () => NOW);

    expect(bundle.entries.map((entry) => (entry as NetworkEntry).requestId)).toEqual(['queued']);
  });

  it('assembles without a drain at all, which is how it is covered here', async () => {
    await fill([request({ requestId: 'only' })]);

    const bundle = await assembleBundle(bundleRequest(), () => NOW);

    expect(bundle.entries).toHaveLength(1);
  });
});

describe('the metadata a report carries', () => {
  it('names the schema, the build, the subject and the tab', async () => {
    const bundle = await assembleBundle(
      bundleRequest({
        subject: { domain: 'example.com', url: 'https://example.com/cart', title: 'Cart' },
      }),
      () => NOW,
    );

    expect(bundle.schemaVersion).toBe(SCHEMA_VERSION);
    expect(bundle.extensionVersion).toBe('0.1.0');
    expect(bundle.subject).toEqual({
      tabId: TAB,
      domain: 'example.com',
      url: 'https://example.com/cart',
      title: 'Cart',
    });
  });

  it('announces the depth the capture reaches, not the one that was asked for', async () => {
    await fill([request({ requestId: 'oldest', timestamp: NOW - 20 * MINUTE })]);

    const bundle = await assembleBundle(bundleRequest({ requestedDepthMinutes: 60 }), () => NOW);

    expect(bundle.window.requestedDepthMinutes).toBe(60);
    expect(bundle.window.coveredDepthMinutes).toBe(20);
  });
});

describe('the body of the bundle', () => {
  it('is one ascending thread, all kinds mixed', async () => {
    await fill([
      request({ requestId: 'second', timestamp: NOW - 2 * MINUTE }),
      log({ timestamp: NOW - 5 * MINUTE }),
      request({ requestId: 'first', timestamp: NOW - 9 * MINUTE }),
    ]);

    const bundle = await assembleBundle(bundleRequest(), () => NOW);

    expect(bundle.entries.map((entry) => entry.kind)).toEqual(['network', 'console', 'network']);
    expect(bundle.entries.map((entry) => entry.timestamp)).toEqual([
      NOW - 9 * MINUTE,
      NOW - 5 * MINUTE,
      NOW - 2 * MINUTE,
    ]);
  });

  it('holds nothing from another tab', async () => {
    await fill([
      request({ requestId: 'ours' }),
      request({ requestId: 'theirs', tabId: TAB + 1 }),
    ]);

    const bundle = await assembleBundle(bundleRequest(), () => NOW);

    expect(bundle.entries.map((entry) => (entry as NetworkEntry).requestId)).toEqual(['ours']);
  });
});

describe('the gaps the bundle declares', () => {
  it('always carries the two structural ones', async () => {
    await fill([request({ resourceType: 'main_frame' })]);

    const bundle = await assembleBundle(bundleRequest(), () => NOW);

    expect(bundle.gaps.map((gap) => gap.kind)).toEqual([
      'response-bodies-unavailable',
      'browser-messages-out-of-reach',
    ]);
    expect(bundle.gaps.every((gap) => gap.statement.length > 0)).toBe(true);
  });

  it('reads the quota shrink off the readout the purge left behind', async () => {
    const state: Partial<StorageState> = { shrunkAt: NOW - MINUTE };
    await fakeBrowser.storage.local.set({ [STORAGE_STATE_KEY]: state });
    await fill([request({ resourceType: 'main_frame' })]);

    const bundle = await assembleBundle(bundleRequest(), () => NOW);

    expect(bundle.gaps.map((gap) => gap.kind)).toContain('window-shrunk-by-quota');
  });
});

describe('the clock', () => {
  it('is the wall clock when none is given', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    const bundle = await assembleBundle(bundleRequest());

    expect(bundle.window.frozenAt).toBe(NOW);

    vi.restoreAllMocks();
  });
});
