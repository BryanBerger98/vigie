import type { CaptureEntry, ConsoleEntry, NetworkEntry, ReportBundle } from '@vigie/contract';
import { RESPONSE_BODY_UNAVAILABLE, SCHEMA_VERSION, reportGap } from '@vigie/contract';
import { describe, expect, it } from 'vitest';

import { renderReport } from './markdown';

/**
 * The shape of the report, locked on snapshots.
 *
 * The rendering has no logic worth asserting on — it is a decision about a format, and a format
 * drifts silently: a moved line or a lost blank line breaks the thing the report exists for without
 * breaking a single test of behaviour. The snapshots are inline on purpose, so a diff shows the
 * report as its reader sees it rather than a path to a file nobody opens.
 *
 * Two claims are asserted rather than snapshotted, because a snapshot proves them by accident and
 * would stop proving them the day someone accepts a diff without reading it: that the marker is on
 * the anomalous entries and on no others, and that the framing table agrees with the timeline.
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

const REQUEST: NetworkEntry = {
  kind: 'network',
  timestamp: NOW - 3 * MINUTE,
  tabId: TAB,
  domain: 'example.com',
  requestId: '1042',
  method: 'POST',
  url: 'https://example.com/api/cart?currency=EUR',
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

      | Field | Value |
      | --- | --- |
      | Subject | example.com, tab 42 |
      | URL | https://example.com/checkout |
      | Title | Checkout |
      | Window | 15 min requested, 15 min covered |
      | Period | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z |
      | Network | 1 |
      | Console | 1 |
      | JS errors | 1 |
      | Anomalies | 1 |
      | Produced by | Vigie 0.1.0, report schema 1 |

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      ### 2026-08-07T09:24:00.000Z · network · POST /api/cart?currency=EUR → 201

      https://example.com/api/cart?currency=EUR · completed 201 in 84 ms · xmlhttprequest

      <details><summary>Request headers (2)</summary>

      \`\`\`http
      accept: application/json
      authorization: Bearer e30.abc.sig
      \`\`\`

      </details>

      Request body:

      \`\`\`json
      {
        "sku": "A-1",
        "qty": 2
      }
      \`\`\`

      <details><summary>Response headers (1)</summary>

      \`\`\`http
      content-type: application/json
      \`\`\`

      </details>

      Response body: not available.

      ### 2026-08-07T09:25:00.000Z · console · warn · cart total mismatch

      \`\`\`text
      cart total mismatch
      expected 24.00, got 22.00
      \`\`\`

      ### [!] 2026-08-07T09:26:00.000Z · error · uncaught · TypeError: total.toFixed is not a function

      \`\`\`text
      TypeError: total.toFixed is not a function
      \`\`\`

      <details><summary>Stack</summary>

      \`\`\`js
      at renderTotal (cart.js:88:12)
      at onClick (cart.js:12:3)
      \`\`\`

      </details>"
    `);
  });
});

describe('a window with nothing in it', () => {
  it('says so rather than ending on an empty section', () => {
    expect(renderReport(bundle())).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      | Field | Value |
      | --- | --- |
      | Subject | example.com, tab 42 |
      | URL | https://example.com/checkout |
      | Title | Checkout |
      | Window | 15 min requested, 15 min covered |
      | Period | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z |
      | Network | 0 |
      | Console | 0 |
      | JS errors | 0 |
      | Anomalies | 0 |
      | Produced by | Vigie 0.1.0, report schema 1 |

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

      | Field | Value |
      | --- | --- |
      | Subject | example.com, tab 42 |
      | URL | https://example.com/checkout |
      | Title | Checkout |
      | Window | 60 min requested, 20.4 min covered |
      | Period | 2026-08-07T08:27:00.000Z → 2026-08-07T09:27:00.000Z |
      | Network | 0 |
      | Console | 1 |
      | JS errors | 0 |
      | Anomalies | 0 |
      | Produced by | Vigie 0.1.0, report schema 1 |

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - Capture began after this page had loaded, because its domain was added or the extension was installed while the tab was already open. Nothing emitted before that point exists; reload the page to cover a full load.
      - The window covered is shorter than the one requested: storage pressure forced the oldest entries out before the hour was up.

      ## Timeline

      ### 2026-08-07T09:25:00.000Z · console · warn · cart total mismatch

      \`\`\`text
      cart total mismatch
      expected 24.00, got 22.00
      \`\`\`"
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

      | Field | Value |
      | --- | --- |
      | Subject | example.com, tab 42 |
      | URL | https://example.com/checkout |
      | Title | Checkout |
      | Window | 15 min requested, 15 min covered |
      | Period | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z |
      | Network | 1 (1 failed) |
      | Console | 0 |
      | JS errors | 0 |
      | Anomalies | 1 |
      | Produced by | Vigie 0.1.0, report schema 1 |

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      ### [!] 2026-08-07T09:26:00.000Z · network · GET /api/prices → failed

      https://example.com/api/prices · failed in 12004 ms: net::ERR_CONNECTION_RESET

      Response body: not available."
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

      | Field | Value |
      | --- | --- |
      | Subject | example.com, tab 42 |
      | URL | https://example.com/checkout |
      | Title | Checkout |
      | Window | 15 min requested, 15 min covered |
      | Period | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z |
      | Network | 1 |
      | Console | 0 |
      | JS errors | 0 |
      | Anomalies | 0 |
      | Produced by | Vigie 0.1.0, report schema 1 |

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      ### 2026-08-07T09:26:00.000Z · network · GET /stream → pending

      https://example.com/stream · still open when the report was cut · xmlhttprequest

      Response body: not available."
    `);
  });
});

describe('a body the report cannot reformat', () => {
  it('hands back a malformed payload exactly as it arrived, and says that it is malformed', () => {
    // The truncated brace is the whole point: a body that fails to parse may be the very defect
    // being reported, so it is never repaired and never dropped.
    const malformed: CaptureEntry = {
      ...REQUEST,
      requestId: '1045',
      requestBody: '{"sku":"A-1","qty":',
      requestHeaders: undefined,
      responseHeaders: undefined,
    };

    expect(renderReport(bundle({ entries: [malformed] }))).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      | Field | Value |
      | --- | --- |
      | Subject | example.com, tab 42 |
      | URL | https://example.com/checkout |
      | Title | Checkout |
      | Window | 15 min requested, 15 min covered |
      | Period | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z |
      | Network | 1 |
      | Console | 0 |
      | JS errors | 0 |
      | Anomalies | 0 |
      | Produced by | Vigie 0.1.0, report schema 1 |

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      ### 2026-08-07T09:24:00.000Z · network · POST /api/cart?currency=EUR → 201

      https://example.com/api/cart?currency=EUR · completed 201 in 84 ms · xmlhttprequest

      Request body, malformed JSON left exactly as it was received:

      \`\`\`text
      {"sku":"A-1","qty":
      \`\`\`

      Response body: not available."
    `);
  });

  it('leaves a body that never claimed to be JSON without a malformation notice', () => {
    const form: CaptureEntry = {
      ...REQUEST,
      requestId: '1046',
      requestBody: 'sku=A-1&qty=2',
      requestHeaders: undefined,
      responseHeaders: undefined,
    };

    const markdown = renderReport(bundle({ entries: [form] }));

    expect(markdown).toContain('Request body:');
    expect(markdown).not.toContain('malformed');
    expect(markdown).toContain('```text\nsku=A-1&qty=2\n```');
  });
});

describe('what the capture had to cut', () => {
  it('marks a truncated console line rather than passing it off as complete', () => {
    const truncated: ConsoleEntry = { ...LOG, text: 'huge payload', truncated: true };

    expect(renderReport(bundle({ entries: [truncated] }))).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      | Field | Value |
      | --- | --- |
      | Subject | example.com, tab 42 |
      | URL | https://example.com/checkout |
      | Title | Checkout |
      | Window | 15 min requested, 15 min covered |
      | Period | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z |
      | Network | 0 |
      | Console | 1 |
      | JS errors | 0 |
      | Anomalies | 0 |
      | Produced by | Vigie 0.1.0, report schema 1 |

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      ### 2026-08-07T09:25:00.000Z · console · warn · huge payload

      \`\`\`text
      huge payload
      \`\`\`

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

      | Field | Value |
      | --- | --- |
      | Subject | (unknown), tab 42 |
      | URL | (unknown) |
      | Window | 15 min requested, 15 min covered |
      | Period | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z |
      | Network | 0 |
      | Console | 0 |
      | JS errors | 0 |
      | Anomalies | 0 |
      | Produced by | Vigie 0.1.0, report schema 1 |

      ## What this report does not contain

      - Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.
      - Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.

      ## Timeline

      No entry was captured in this window."
    `);
  });
});

describe('reaching the anomalies without reading the report', () => {
  const failed: NetworkEntry = {
    ...REQUEST,
    requestId: '2001',
    timestamp: NOW - 5 * MINUTE,
    outcome: 'failed',
    statusCode: undefined,
    error: 'net::ERR_CONNECTION_RESET',
  };
  const refused: NetworkEntry = {
    ...REQUEST,
    requestId: '2002',
    timestamp: NOW - 4 * MINUTE,
    statusCode: 503,
  };
  const shouted: ConsoleEntry = { ...LOG, timestamp: NOW - 90_000, level: 'error' };

  const mixed = bundle({ entries: [failed, refused, REQUEST, LOG, shouted, FAILURE] });

  /** The section titles of the timeline, in the order a reader meets them. */
  function titles(markdown: string): string[] {
    return markdown.split('\n').filter((line) => line.startsWith('### '));
  }

  it('marks the anomalous entries and only those', () => {
    const marked = titles(renderReport(mixed)).map((title) => title.startsWith('### [!] '));

    // failed, 503, the healthy 201, a warning, an error log, an uncaught failure.
    expect(marked).toEqual([true, true, false, false, true, true]);
  });

  it('counts in the framing table exactly what the timeline marks', () => {
    const markdown = renderReport(mixed);
    const marked = titles(markdown).filter((title) => title.startsWith('### [!] ')).length;

    expect(markdown).toContain('| Anomalies | 4 |');
    expect(markdown).toContain('| Network | 3 (1 failed, 1 with status ≥ 400) |');
    expect(markdown).toContain('| Console | 2 (1 error) |');
    expect(markdown).toContain('| JS errors | 1 |');
    expect(marked).toBe(4);
  });

  it('drops the parenthesis when a kind holds no anomaly at all', () => {
    const clean = renderReport(bundle({ entries: [REQUEST, LOG] }));

    expect(clean).toContain('| Network | 1 |');
    expect(clean).toContain('| Console | 1 |');
    expect(clean).toContain('| Anomalies | 0 |');
    expect(clean).not.toContain('[!]');
  });
});

describe('a value that would break the table it sits in', () => {
  it('escapes a pipe rather than splitting the row on it', () => {
    const piped = bundle({
      subject: {
        domain: 'example.com',
        tabId: TAB,
        url: 'https://example.com/search?q=a|b',
        title: 'a | b',
      },
    });

    const markdown = renderReport(piped);

    expect(markdown).toContain('| URL | https://example.com/search?q=a\\|b |');
    expect(markdown).toContain('| Title | a \\| b |');
  });
});

describe('a capture that carries a fence of its own', () => {
  it('grows the delimiter so the block closes where the report meant it to', () => {
    const fenced: ConsoleEntry = {
      ...LOG,
      text: 'the page printed\n```\nnot the end of the block\n```',
    };

    const markdown = renderReport(bundle({ entries: [fenced] }));

    expect(markdown).toContain('````text\n');
    expect(markdown).toContain('not the end of the block');
  });
});
