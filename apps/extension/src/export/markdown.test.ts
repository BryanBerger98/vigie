import type { CaptureEntry, ConsoleEntry, ReportBundle } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE, SCHEMA_VERSION, reportGap } from '@vigie/contract';
import { describe, expect, it } from 'vitest';

import { renderReport } from './markdown';

/**
 * The shape of the report, locked on snapshots.
 *
 * The rendering has no logic worth asserting on — it is a decision about a format, and a format
 * drifts silently: a moved line or a lost indent breaks the thing the report exists for without
 * breaking a single test of behaviour. The snapshots are inline on purpose, so a diff shows the
 * report as its reader sees it rather than a path to a file nobody opens.
 */

const NOW = Date.parse('2026-08-07T09:27:00.000Z');
const MINUTE = 60_000;
const TAB = 42;

function bundle(overrides: Partial<ReportBundle> = {}): ReportBundle {
  return {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion: '0.1.0',
    window: {
      requestedDepthMinutes: 15,
      frozenAt: NOW,
      from: NOW - 15 * MINUTE,
      to: NOW,
      coveredDepthMinutes: 15,
    },
    subject: {
      domain: 'example.com',
      tabId: TAB,
      url: 'https://example.com/checkout',
      title: 'Checkout',
    },
    gaps: [reportGap('response-bodies-unavailable'), reportGap('browser-messages-out-of-reach')],
    entries: [],
    ...overrides,
  };
}

const REQUEST: CaptureEntry = {
  kind: 'network',
  timestamp: NOW - 3 * MINUTE,
  tabId: TAB,
  domain: 'example.com',
  requestId: '1042',
  method: 'POST',
  url: 'https://example.com/api/cart',
  resourceType: 'xmlhttprequest',
  outcome: 'completed',
  statusCode: 201,
  durationMs: 84,
  requestHeaders: [
    { name: 'accept', value: 'application/json' },
    { name: 'authorization', value: 'Bearer e30.abc.sig' },
  ],
  requestBody: '{"sku":"A-1","qty":2}',
  responseHeaders: [{ name: 'content-type', value: 'application/json' }],
  responseBody: RESPONSE_BODY_UNAVAILABLE,
};

const LOG: ConsoleEntry = {
  kind: 'console',
  timestamp: NOW - 2 * MINUTE,
  tabId: TAB,
  domain: 'example.com',
  level: 'warn',
  text: 'cart total mismatch\nexpected 24.00, got 22.00',
  truncated: false,
};

const FAILURE: CaptureEntry = {
  kind: 'error',
  timestamp: NOW - MINUTE,
  tabId: TAB,
  domain: 'example.com',
  source: 'uncaught',
  message: 'TypeError: total.toFixed is not a function',
  stack: 'at renderTotal (cart.js:88:12)\nat onClick (cart.js:12:3)',
  truncated: false,
};

describe('a report a reader can act on', () => {
  it('opens on what it covers and what it cannot show, then runs one thread', () => {
    expect(renderReport(bundle({ entries: [REQUEST, LOG, FAILURE] }))).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      Subject: example.com, tab 42
      URL: https://example.com/checkout
      Title: Checkout
      Window: 15 min requested, 15 min covered
      Covering: 2026-08-07T09:12:00.000Z to 2026-08-07T09:27:00.000Z
      Entries: 3 (1 network, 1 console, 1 error)
      Produced by Vigie 0.1.0, report schema 1

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      2026-08-07T09:24:00.000Z  network  POST https://example.com/api/cart
        completed 201 in 84 ms (xmlhttprequest)
        request headers:
          accept: application/json
          authorization: Bearer e30.abc.sig
        request body:
          {"sku":"A-1","qty":2}
        response headers:
          content-type: application/json
        response body: not available

      2026-08-07T09:25:00.000Z  console  warn
        cart total mismatch
        expected 24.00, got 22.00

      2026-08-07T09:26:00.000Z  error  uncaught
        TypeError: total.toFixed is not a function
        stack:
          at renderTotal (cart.js:88:12)
          at onClick (cart.js:12:3)"
    `);
  });
});

describe('a window with nothing in it', () => {
  it('says so rather than ending on an empty section', () => {
    expect(renderReport(bundle())).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      Subject: example.com, tab 42
      URL: https://example.com/checkout
      Title: Checkout
      Window: 15 min requested, 15 min covered
      Covering: 2026-08-07T09:12:00.000Z to 2026-08-07T09:27:00.000Z
      Entries: 0 (0 network, 0 console, 0 error)
      Produced by Vigie 0.1.0, report schema 1

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      No entry was captured in this window."
    `);
  });
});

describe('a capture shorter than the window asked for', () => {
  it('announces the depth it really has, and the two gaps that explain it', () => {
    const short = bundle({
      window: {
        requestedDepthMinutes: 60,
        frozenAt: NOW,
        from: NOW - 60 * MINUTE,
        to: NOW,
        coveredDepthMinutes: 20.4,
      },
      gaps: [
        reportGap('response-bodies-unavailable'),
        reportGap('browser-messages-out-of-reach'),
        reportGap('capture-started-after-page-load'),
        reportGap('window-shrunk-by-quota'),
      ],
      entries: [LOG],
    });

    expect(renderReport(short)).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      Subject: example.com, tab 42
      URL: https://example.com/checkout
      Title: Checkout
      Window: 60 min requested, 20.4 min covered
      Covering: 2026-08-07T08:27:00.000Z to 2026-08-07T09:27:00.000Z
      Entries: 1 (0 network, 1 console, 0 error)
      Produced by Vigie 0.1.0, report schema 1

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - Capture began after this page had loaded, because its domain was added or the extension was installed while the tab was already open. Nothing emitted before that point exists; reload the page to cover a full load.
      - The window covered is shorter than the one requested: storage pressure forced the oldest entries out before the hour was up.

      ## Timeline

      2026-08-07T09:25:00.000Z  console  warn
        cart total mismatch
        expected 24.00, got 22.00"
    `);
  });
});

describe('a request that did not complete', () => {
  it('reads as a transport failure and not as a status nobody can find', () => {
    const failed: CaptureEntry = {
      kind: 'network',
      timestamp: NOW - MINUTE,
      tabId: TAB,
      domain: 'example.com',
      requestId: '1043',
      method: 'GET',
      url: 'https://example.com/api/prices',
      outcome: 'failed',
      durationMs: 12_004,
      error: 'net::ERR_CONNECTION_RESET',
      responseBody: RESPONSE_BODY_UNAVAILABLE,
    };

    expect(renderReport(bundle({ entries: [failed] }))).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      Subject: example.com, tab 42
      URL: https://example.com/checkout
      Title: Checkout
      Window: 15 min requested, 15 min covered
      Covering: 2026-08-07T09:12:00.000Z to 2026-08-07T09:27:00.000Z
      Entries: 1 (1 network, 0 console, 0 error)
      Produced by Vigie 0.1.0, report schema 1

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      2026-08-07T09:26:00.000Z  network  GET https://example.com/api/prices
        failed in 12004 ms: net::ERR_CONNECTION_RESET
        response body: not available"
    `);
  });

  it('says a long poll was still open rather than inventing an end for it', () => {
    const pending: CaptureEntry = {
      kind: 'network',
      timestamp: NOW - MINUTE,
      tabId: TAB,
      domain: 'example.com',
      requestId: '1044',
      method: 'GET',
      url: 'https://example.com/stream',
      resourceType: 'xmlhttprequest',
      outcome: 'pending',
      responseBody: RESPONSE_BODY_UNAVAILABLE,
    };

    expect(renderReport(bundle({ entries: [pending] }))).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      Subject: example.com, tab 42
      URL: https://example.com/checkout
      Title: Checkout
      Window: 15 min requested, 15 min covered
      Covering: 2026-08-07T09:12:00.000Z to 2026-08-07T09:27:00.000Z
      Entries: 1 (1 network, 0 console, 0 error)
      Produced by Vigie 0.1.0, report schema 1

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      2026-08-07T09:26:00.000Z  network  GET https://example.com/stream
        still open when the report was cut (xmlhttprequest)
        response body: not available"
    `);
  });
});

describe('what the capture had to cut', () => {
  it('marks a truncated console line rather than passing it off as complete', () => {
    const truncated: ConsoleEntry = { ...LOG, text: 'huge payload', truncated: true };

    expect(renderReport(bundle({ entries: [truncated] }))).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      Subject: example.com, tab 42
      URL: https://example.com/checkout
      Title: Checkout
      Window: 15 min requested, 15 min covered
      Covering: 2026-08-07T09:12:00.000Z to 2026-08-07T09:27:00.000Z
      Entries: 1 (0 network, 1 console, 0 error)
      Produced by Vigie 0.1.0, report schema 1

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      2026-08-07T09:25:00.000Z  console  warn
        huge payload
        (text truncated by the capture)"
    `);
  });
});

describe('a subject the tab could not name', () => {
  it('renders the unknowns as unknown, never as a blank line', () => {
    const unnamed = bundle({
      subject: { domain: '', tabId: TAB, url: '' },
      entries: [],
    });

    expect(renderReport(unnamed)).toMatchInlineSnapshot(`
      "# Vigie report — (unknown)

      Subject: (unknown), tab 42
      URL: (unknown)
      Window: 15 min requested, 15 min covered
      Covering: 2026-08-07T09:12:00.000Z to 2026-08-07T09:27:00.000Z
      Entries: 0 (0 network, 0 console, 0 error)
      Produced by Vigie 0.1.0, report schema 1

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      No entry was captured in this window."
    `);
  });
});
