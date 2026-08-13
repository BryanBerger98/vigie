import { RESPONSE_BODY_UNAVAILABLE, isNetworkEntry } from '@vigie/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { PENDING_TIMEOUT_MS } from '@/capture/network/assemble';
import type { NetworkRequestWillBeSentParams } from '@/shared/chrome-apis';

import { CdpRecordStore } from './records';

/**
 * The deep layer's reassembly. Same contract as the `webRequest` side's: no browser API, so every
 * ordering the protocol can produce is stated here — including the ones that only happen at a
 * session boundary and would take a running browser to reproduce.
 */

const TAB = 7;
/** Epoch milliseconds, and the same instant in `wallTime` seconds and protocol ticks. */
const START = 1_700_000_000_000;
const WALL_TIME = START / 1000;
const TICKS = 4_812.5;

function announcement(
  overrides: Partial<NetworkRequestWillBeSentParams> = {},
): NetworkRequestWillBeSentParams {
  return {
    requestId: '31337.4',
    request: {
      url: 'https://example.com/api/users',
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
    timestamp: TICKS,
    wallTime: WALL_TIME,
    type: 'XHR',
    ...overrides,
  };
}

let records: CdpRecordStore;

beforeEach(() => {
  records = new CdpRecordStore();
});

describe('a request the layer announced itself', () => {
  it('becomes one entry carrying both halves of the exchange', () => {
    records.announce(TAB, announcement(), START);
    records.requestHeaders(TAB, {
      requestId: '31337.4',
      headers: { ':method': 'GET', cookie: 'session=abc' },
    });
    records.response(TAB, {
      requestId: '31337.4',
      timestamp: TICKS + 0.1,
      type: 'XHR',
      response: {
        url: 'https://example.com/api/users',
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    });

    const entry = records.finish(TAB, {
      requestId: '31337.4',
      timestamp: TICKS + 0.12,
      encodedDataLength: 512,
    });

    expect(entry?.url).toBe('https://example.com/api/users');
    expect(entry?.requestId).toBe('31337.4');

    const draft = entry?.draft;
    expect(draft && isNetworkEntry({ ...draft, domain: 'example.com' })).toBe(true);
    expect(draft).toMatchObject({
      kind: 'network',
      tabId: TAB,
      requestId: '31337.4',
      method: 'GET',
      outcome: 'completed',
      provenance: 'cdp',
      statusCode: 200,
      durationMs: 120,
      timestamp: START + 120,
      resourceType: 'XHR',
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
    });
  });

  it('keeps the wire-level request headers over the ones the renderer asked for', () => {
    records.announce(TAB, announcement(), START);
    records.requestHeaders(TAB, {
      requestId: '31337.4',
      headers: { Accept: 'application/json', cookie: 'session=abc' },
    });

    const entry = records.finish(TAB, {
      requestId: '31337.4',
      timestamp: TICKS,
      encodedDataLength: 0,
    });

    expect(entry?.draft).toHaveProperty('requestHeaders', [
      { name: 'Accept', value: 'application/json' },
      { name: 'cookie', value: 'session=abc' },
    ]);
  });

  it('carries the request body the protocol reported', () => {
    records.announce(
      TAB,
      announcement({
        request: {
          url: 'https://example.com/api/users',
          method: 'POST',
          headers: {},
          postData: '{"name":"Ada"}',
        },
      }),
      START,
    );

    const entry = records.finish(TAB, {
      requestId: '31337.4',
      timestamp: TICKS,
      encodedDataLength: 0,
    });

    expect(entry?.draft).toMatchObject({ method: 'POST', requestBody: '{"name":"Ada"}' });
  });

  it('states the response body is unavailable rather than omitting it', () => {
    // Phase 5 replaces this branch with the read. Until then the field is stated, never absent.
    records.announce(TAB, announcement(), START);
    const entry = records.finish(TAB, {
      requestId: '31337.4',
      timestamp: TICKS,
      encodedDataLength: 0,
    });

    expect(entry?.draft).toHaveProperty('responseBody', RESPONSE_BODY_UNAVAILABLE);
  });

  it('reports the failure reason, and says when it was a cancellation', () => {
    records.announce(TAB, announcement(), START);
    const entry = records.fail(TAB, {
      requestId: '31337.4',
      timestamp: TICKS + 0.05,
      errorText: 'net::ERR_ABORTED',
      canceled: true,
    });

    expect(entry?.draft).toMatchObject({
      outcome: 'failed',
      error: 'net::ERR_ABORTED (canceled)',
      durationMs: 50,
    });
  });

  it('never reports a negative duration, whatever the two clocks say', () => {
    records.announce(TAB, announcement(), START);
    const entry = records.finish(TAB, {
      requestId: '31337.4',
      timestamp: TICKS - 1,
      encodedDataLength: 0,
    });

    expect(entry?.draft).toMatchObject({ durationMs: 0, timestamp: START });
  });

  it('dates the entry on the caller clock when the protocol reports no wall time', () => {
    records.announce(TAB, announcement({ wallTime: 0 }), START);
    const entry = records.finish(TAB, {
      requestId: '31337.4',
      timestamp: TICKS + 0.2,
      encodedDataLength: 0,
    });

    expect(entry?.draft).toHaveProperty('timestamp', START + 200);
  });

  it('follows the latest hop of a redirect chain, which reuses one id', () => {
    records.announce(TAB, announcement(), START);
    records.announce(
      TAB,
      announcement({
        request: { url: 'https://example.com/api/v2/users', method: 'GET', headers: {} },
        timestamp: TICKS + 0.03,
      }),
      START + 30,
    );

    const entry = records.finish(TAB, {
      requestId: '31337.4',
      timestamp: TICKS + 0.09,
      encodedDataLength: 0,
    });

    expect(entry?.url).toBe('https://example.com/api/v2/users');
    expect(records.openCount).toBe(0);
  });
});

describe('what never becomes a record', () => {
  it('refuses a scheme the capture does not follow', () => {
    const kept = records.announce(
      TAB,
      announcement({ request: { url: 'data:text/plain,hello', method: 'GET', headers: {} } }),
      START,
    );

    expect(kept).toBeNull();
    expect(records.openCount).toBe(0);
  });

  it('leaves no trace of an event whose id was never announced', () => {
    // A request already in flight when the session attached: response, bytes and conclusion arrive
    // with no announcement in front. All of it belongs to `webRequest`.
    records.response(TAB, {
      requestId: 'orphan',
      timestamp: TICKS,
      response: { url: '', status: 200, headers: {} },
    });
    records.data(TAB, {
      requestId: 'orphan',
      timestamp: TICKS,
      dataLength: 128,
      encodedDataLength: 128,
    });

    expect(records.has(TAB, 'orphan')).toBe(false);
    expect(records.openCount).toBe(0);
    expect(records.finish(TAB, { requestId: 'orphan', timestamp: TICKS, encodedDataLength: 0 })).toBeNull();
    expect(
      records.fail(TAB, { requestId: 'orphan', timestamp: TICKS, errorText: 'net::ERR_FAILED' }),
    ).toBeNull();
  });

  it('does not let one tab conclude another tab request of the same id', () => {
    // The protocol counter restarts on a renderer process swap, so two tabs share ids routinely.
    records.announce(TAB, announcement(), START);

    expect(records.finish(9, { requestId: '31337.4', timestamp: TICKS, encodedDataLength: 0 })).toBeNull();
    expect(records.has(TAB, '31337.4')).toBe(true);
  });
});

describe('the bounded retention', () => {
  it('releases a stream that never concludes, said to be unfinished', () => {
    records.announce(TAB, announcement({ type: 'EventSource' }), START);

    expect(records.sweep(START + PENDING_TIMEOUT_MS - 1)).toEqual([]);

    const [stale] = records.sweep(START + PENDING_TIMEOUT_MS);
    expect(stale?.draft).toMatchObject({
      outcome: 'pending',
      provenance: 'cdp',
      responseBody: 'unfinished',
      resourceType: 'EventSource',
    });
    expect(stale?.draft).not.toHaveProperty('durationMs');
    expect(records.openCount).toBe(0);
  });

  it('hands one tab records back without writing any of them', () => {
    records.announce(TAB, announcement(), START);
    records.announce(9, announcement({ requestId: '52.1' }), START);

    expect(records.releaseTab(TAB)).toEqual(['31337.4']);
    expect(records.openCount).toBe(1);
    expect(records.has(9, '52.1')).toBe(true);
  });

  it('hands every record back when the layer stops', () => {
    records.announce(TAB, announcement(), START);
    records.announce(9, announcement({ requestId: '52.1' }), START);

    expect(records.clear().sort()).toEqual(['31337.4', '52.1']);
    expect(records.openCount).toBe(0);
  });
});
