import { RESPONSE_BODY_UNAVAILABLE, isNetworkEntry } from '@vigie/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { PENDING_TIMEOUT_MS, RequestAssembler, type BeforeRequestDetails } from './assemble';

/**
 * The reassembly is the one piece of the capture that touches no browser API, so it is tested
 * directly rather than through a running extension: every ordering Chrome can produce is stated
 * here, including the ones a real page rarely shows.
 */

const START = 1_000_000;

function opening(overrides: Partial<BeforeRequestDetails> = {}): BeforeRequestDetails {
  return {
    requestId: '1',
    url: 'https://example.com/api/users',
    method: 'GET',
    tabId: 7,
    type: 'xmlhttprequest',
    timeStamp: START,
    ...overrides,
  };
}

let assembler: RequestAssembler;

beforeEach(() => {
  assembler = new RequestAssembler();
});

describe('a request that completes', () => {
  it('becomes one entry carrying both halves of the exchange', () => {
    assembler.begin(opening());
    assembler.headers({ requestId: '1', requestHeaders: [{ name: 'Cookie', value: 'session=abc' }] });

    const entry = assembler.complete({
      requestId: '1',
      statusCode: 200,
      timeStamp: START + 120,
      responseHeaders: [{ name: 'Set-Cookie', value: 'session=def' }],
    });

    expect(entry).not.toBeNull();
    expect(entry?.url).toBe('https://example.com/api/users');

    const draft = entry?.draft;
    expect(draft && isNetworkEntry({ ...draft, domain: 'example.com' })).toBe(true);
    expect(draft).toMatchObject({
      kind: 'network',
      requestId: '1',
      method: 'GET',
      tabId: 7,
      outcome: 'completed',
      statusCode: 200,
      durationMs: 120,
      resourceType: 'xmlhttprequest',
      requestHeaders: [{ name: 'Cookie', value: 'session=abc' }],
      responseHeaders: [{ name: 'Set-Cookie', value: 'session=def' }],
    });
  });

  it('states the response body is unavailable rather than omitting it', () => {
    assembler.begin(opening());
    const entry = assembler.complete({ requestId: '1', statusCode: 204, timeStamp: START });

    expect(entry?.draft).toHaveProperty('responseBody', RESPONSE_BODY_UNAVAILABLE);
  });

  it('names the layer that produced the entry, on every way of closing one', () => {
    assembler.begin(opening({ requestId: 'closed' }));
    assembler.begin(opening({ requestId: 'broken' }));
    assembler.begin(opening({ requestId: 'stalled' }));

    const closed = assembler.complete({ requestId: 'closed', statusCode: 200, timeStamp: START });
    const broken = assembler.fail({ requestId: 'broken', error: 'net::ERR', timeStamp: START });
    const [stalled] = assembler.sweep(START + PENDING_TIMEOUT_MS);

    for (const entry of [closed, broken, stalled]) {
      expect(entry?.draft).toHaveProperty('provenance', 'webRequest');
    }
  });

  it('is forgotten once closed, so a duplicate closing event yields nothing', () => {
    assembler.begin(opening());
    assembler.complete({ requestId: '1', statusCode: 200, timeStamp: START + 10 });

    expect(assembler.complete({ requestId: '1', statusCode: 200, timeStamp: START + 20 })).toBeNull();
    expect(assembler.openCount).toBe(0);
  });

  it('never reports a negative duration when the clock goes backwards', () => {
    assembler.begin(opening({ timeStamp: START + 500 }));
    const entry = assembler.complete({ requestId: '1', statusCode: 200, timeStamp: START });

    expect(entry?.draft).toHaveProperty('durationMs', 0);
  });
});

describe('a request that fails', () => {
  it('keeps the browser error and carries no status code', () => {
    assembler.begin(opening({ url: 'https://example.com/gone' }));
    const entry = assembler.fail({ requestId: '1', error: 'net::ERR_NAME_NOT_RESOLVED', timeStamp: START + 40 });

    expect(entry?.draft).toMatchObject({
      outcome: 'failed',
      error: 'net::ERR_NAME_NOT_RESOLVED',
      durationMs: 40,
    });
    expect(entry?.draft).not.toHaveProperty('statusCode');
  });
});

describe('an event with no opening', () => {
  it('is ignored, because the request started before the listener existed', () => {
    expect(assembler.complete({ requestId: 'unknown', statusCode: 200, timeStamp: START })).toBeNull();
    expect(assembler.fail({ requestId: 'unknown', error: 'net::ERR_ABORTED', timeStamp: START })).toBeNull();
  });

  it('leaves headers nowhere rather than opening a request from them', () => {
    assembler.headers({ requestId: 'unknown', requestHeaders: [{ name: 'Accept', value: '*/*' }] });

    expect(assembler.openCount).toBe(0);
  });
});

describe('a request that never closes', () => {
  it('is held while it is still young enough to close', () => {
    assembler.begin(opening());

    expect(assembler.sweep(START + PENDING_TIMEOUT_MS - 1)).toEqual([]);
    expect(assembler.openCount).toBe(1);
  });

  it('is written as it stands once it has waited too long', () => {
    assembler.begin(opening({ url: 'https://example.com/stream' }));
    assembler.headers({ requestId: '1', requestHeaders: [{ name: 'Accept', value: 'text/event-stream' }] });

    const swept = assembler.sweep(START + PENDING_TIMEOUT_MS);

    expect(swept).toHaveLength(1);
    expect(swept[0]?.draft).toMatchObject({
      outcome: 'pending',
      timestamp: START + PENDING_TIMEOUT_MS,
      requestHeaders: [{ name: 'Accept', value: 'text/event-stream' }],
    });
    expect(swept[0]?.draft).not.toHaveProperty('statusCode');
  });

  it('is forgotten by the sweep, so it is never written twice', () => {
    assembler.begin(opening());

    expect(assembler.sweep(START + PENDING_TIMEOUT_MS)).toHaveLength(1);
    expect(assembler.sweep(START + PENDING_TIMEOUT_MS * 2)).toEqual([]);
    expect(assembler.openCount).toBe(0);
  });

  it('sweeps only what is stale, leaving younger requests open', () => {
    assembler.begin(opening({ requestId: 'old', timeStamp: START }));
    assembler.begin(opening({ requestId: 'young', timeStamp: START + PENDING_TIMEOUT_MS }));

    const swept = assembler.sweep(START + PENDING_TIMEOUT_MS);

    expect(swept.map((entry) => (entry.draft as { requestId: string }).requestId)).toEqual(['old']);
    expect(assembler.openCount).toBe(1);
  });
});

describe('the request body', () => {
  it('is kept as JSON when Chrome parsed it as form data', () => {
    assembler.begin(opening({ method: 'POST', requestBody: { formData: { email: ['a@b.c'] } } }));
    const entry = assembler.complete({ requestId: '1', statusCode: 200, timeStamp: START });

    expect(entry?.draft).toHaveProperty('requestBody', '{"email":["a@b.c"]}');
  });

  it('is decoded when Chrome handed over raw bytes', () => {
    const bytes = new TextEncoder().encode('{"q":"vigie"}');
    assembler.begin(
      opening({ method: 'POST', requestBody: { raw: [{ bytes: bytes.buffer as ArrayBuffer }] } }),
    );
    const entry = assembler.complete({ requestId: '1', statusCode: 200, timeStamp: START });

    expect(entry?.draft).toHaveProperty('requestBody', '{"q":"vigie"}');
  });

  it('says so when Chrome refused to read it, rather than looking absent', () => {
    assembler.begin(opening({ method: 'POST', requestBody: { error: 'Unknown error.' } }));
    const entry = assembler.complete({ requestId: '1', statusCode: 200, timeStamp: START });

    expect(entry?.draft).toHaveProperty('requestBody', '[unavailable: Unknown error.]');
  });

  it('is absent when the request carried none', () => {
    assembler.begin(opening());
    const entry = assembler.complete({ requestId: '1', statusCode: 200, timeStamp: START });

    expect(entry?.draft).not.toHaveProperty('requestBody');
  });
});

describe('clear', () => {
  it('drops everything in flight', () => {
    assembler.begin(opening({ requestId: 'a' }));
    assembler.begin(opening({ requestId: 'b' }));

    assembler.clear();

    expect(assembler.openCount).toBe(0);
    expect(assembler.sweep(START + PENDING_TIMEOUT_MS)).toEqual([]);
  });
});
