import type { CaptureEntry, ConsoleEntry, NetworkEntry, ReportBundle } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE, SCHEMA_VERSION, reportGap } from '@vigie/contract';
import { describe, expect, it } from 'vitest';

import { countEntries, isAnomalous } from './anomalies';

/**
 * The boundaries of the judgement, and nothing else.
 *
 * What is asserted here is where the line falls — 399 against 400, a warning against an error, a
 * request still open against one that was dropped. Those are the four places a reader would find
 * the report lying to them, and the only four this file has to defend.
 */

const NOW = Date.parse('2026-08-07T09:27:00.000Z');
const TAB = 42;

function request(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    kind: 'network',
    timestamp: NOW,
    tabId: TAB,
    domain: 'example.com',
    requestId: '1',
    method: 'GET',
    url: 'https://example.com/api',
    outcome: 'completed',
    statusCode: 200,
    responseBody: RESPONSE_BODY_UNAVAILABLE,
    ...overrides,
  };
}

function log(level: ConsoleEntry['level']): ConsoleEntry {
  return {
    kind: 'console',
    timestamp: NOW,
    tabId: TAB,
    domain: 'example.com',
    level,
    text: 'something happened',
    truncated: false,
  };
}

const FAILURE: CaptureEntry = {
  kind: 'error',
  timestamp: NOW,
  tabId: TAB,
  domain: 'example.com',
  source: 'uncaught',
  message: 'TypeError: total.toFixed is not a function',
  truncated: false,
};

function bundle(entries: CaptureEntry[]): ReportBundle {
  return {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion: '0.1.0',
    window: {
      requestedDepthMinutes: 15,
      frozenAt: NOW,
      from: NOW - 900_000,
      to: NOW,
      coveredDepthMinutes: 15,
    },
    subject: { domain: 'example.com', tabId: TAB, url: 'https://example.com/checkout' },
    gaps: [reportGap('response-bodies-unavailable')],
    entries,
  };
}

describe('where the line falls on a request', () => {
  it('reads 400 as an anomaly and 399 as an answer', () => {
    expect(isAnomalous(request({ statusCode: 400 }))).toBe(true);
    expect(isAnomalous(request({ statusCode: 399 }))).toBe(false);
  });

  it('reads a dropped request as an anomaly whatever its status', () => {
    expect(isAnomalous(request({ outcome: 'failed', statusCode: undefined }))).toBe(true);
  });

  it('leaves a request still open out of it', () => {
    // No status yet is not a bad status. A long poll open when the report was cut is the normal
    // state of a long poll, and marking it would put a marker on every streaming page.
    expect(isAnomalous(request({ outcome: 'pending', statusCode: undefined }))).toBe(false);
  });

  it('reads a redirect and a success alike as answers', () => {
    expect(isAnomalous(request({ statusCode: 200 }))).toBe(false);
    expect(isAnomalous(request({ statusCode: 302 }))).toBe(false);
  });
});

describe('where the line falls on what the page said', () => {
  it('marks an error and leaves a warning alone', () => {
    expect(isAnomalous(log('error'))).toBe(true);
    expect(isAnomalous(log('warn'))).toBe(false);
    expect(isAnomalous(log('log'))).toBe(false);
    expect(isAnomalous(log('info'))).toBe(false);
    expect(isAnomalous(log('debug'))).toBe(false);
  });

  it('marks every uncaught failure, there being no benign one', () => {
    expect(isAnomalous(FAILURE)).toBe(true);
  });
});

describe('the volume a framing table announces', () => {
  it('counts nothing on an empty window', () => {
    expect(countEntries(bundle([]))).toEqual({
      network: { total: 0, failed: 0, badStatus: 0 },
      console: { total: 0, errors: 0 },
      error: { total: 0 },
      anomalies: 0,
    });
  });

  it('splits each kind from its anomalies', () => {
    const counts = countEntries(
      bundle([
        request({ requestId: '1', statusCode: 200 }),
        request({ requestId: '2', statusCode: 500 }),
        request({ requestId: '3', outcome: 'failed', statusCode: undefined }),
        log('log'),
        log('error'),
        FAILURE,
      ]),
    );

    expect(counts).toEqual({
      network: { total: 3, failed: 1, badStatus: 1 },
      console: { total: 2, errors: 1 },
      error: { total: 1 },
      anomalies: 4,
    });
  });

  it('charges a dropped request to one column only', () => {
    // Both counts on the same request would make the parenthesis of the table announce more
    // anomalies than the timeline carries markers.
    const counts = countEntries(
      bundle([request({ outcome: 'failed', statusCode: 503 })]),
    );

    expect(counts.network).toEqual({ total: 1, failed: 1, badStatus: 0 });
    expect(counts.anomalies).toBe(1);
  });

  it('agrees with the marker the timeline puts on each entry', () => {
    const entries = [
      request({ requestId: '1', statusCode: 404 }),
      request({ requestId: '2', statusCode: 200 }),
      log('warn'),
      log('error'),
      FAILURE,
    ];

    expect(countEntries(bundle(entries)).anomalies).toBe(entries.filter(isAnomalous).length);
  });
});
