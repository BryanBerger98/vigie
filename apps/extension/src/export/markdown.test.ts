import type {
  CaptureEntry,
  ConsoleEntry,
  NetworkEntry,
  ReportBundle,
  ResponseBodyState,
} from '@vigie/contract';
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
    // The order `declareGaps` produces: the structural one, then what this window happened to miss.
    gaps: [reportGap('browser-messages-out-of-reach'), reportGap('response-bodies-unavailable')],
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
  provenance: 'webRequest',
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

      **1 anomaly** in 15 min of capture. Search \`🛑\` to reach them.

      | | |
      | --- | --- |
      | **Page** | Checkout · tab 42 |
      | **URL** | https://example.com/checkout |
      | **Window** | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z · 15 min covered of 15 requested |
      | **Network** | 1 |
      | **Console** | 1 |
      | **JS errors** | 1 |
      | **Produced by** | Vigie 0.1.0 · report schema 1 |

      ## What this report cannot show

      - **No browser-generated messages.** Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - **No response bodies without the deep layer.** Response bodies are not included: the deep capture layer was not running on this tab, and no other channel exposes a response body to an extension. Their absence here says nothing about the responses themselves. Arm the deep layer before reproducing to capture them.

      ## Timeline

      ### 🌐 \`POST /api/cart\` → ✅ \`201 Created\`

      > 🔗 [\`https://example.com/api/cart?currency=EUR\`](<https://example.com/api/cart?currency=EUR>)  
      > 🕑 \`2026-08-07T09:24:00.000Z\` · ⏱ \`84 ms\` · 📄 \`xmlhttprequest\` · no response body

      <details><summary>Request headers (2)</summary>

      \`\`\`http
      accept: application/json
      authorization: Bearer e30.abc.sig
      \`\`\`

      </details>

      <details><summary>Request body</summary>

      \`\`\`json
      {
        "sku": "A-1",
        "qty": 2
      }
      \`\`\`

      </details>

      <details><summary>Response headers (1)</summary>

      \`\`\`http
      content-type: application/json
      \`\`\`

      </details>

      ### ⚠️ \`console.warn\` — cart total mismatch

      > 🕑 \`2026-08-07T09:25:00.000Z\`

      \`\`\`text
      cart total mismatch
      expected 24.00, got 22.00
      \`\`\`

      ### 🛑 \`uncaught\` — TypeError: total.toFixed is not a function

      > 🕑 \`2026-08-07T09:26:00.000Z\`

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

      **Nothing failed** in 15 min of capture.

      | | |
      | --- | --- |
      | **Page** | Checkout · tab 42 |
      | **URL** | https://example.com/checkout |
      | **Window** | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z · 15 min covered of 15 requested |
      | **Network** | 0 |
      | **Console** | 0 |
      | **JS errors** | 0 |
      | **Produced by** | Vigie 0.1.0 · report schema 1 |

      ## What this report cannot show

      - **No browser-generated messages.** Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - **No response bodies without the deep layer.** Response bodies are not included: the deep capture layer was not running on this tab, and no other channel exposes a response body to an extension. Their absence here says nothing about the responses themselves. Arm the deep layer before reproducing to capture them.

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

      **Nothing failed** in 20.4 min of capture.

      | | |
      | --- | --- |
      | **Page** | Checkout · tab 42 |
      | **URL** | https://example.com/checkout |
      | **Window** | 2026-08-07T08:27:00.000Z → 2026-08-07T09:27:00.000Z · 20.4 min covered of 60 requested |
      | **Network** | 0 |
      | **Console** | 1 |
      | **JS errors** | 0 |
      | **Produced by** | Vigie 0.1.0 · report schema 1 |

      ## What this report cannot show

      - **No response bodies without the deep layer.** Response bodies are not included: the deep capture layer was not running on this tab, and no other channel exposes a response body to an extension. Their absence here says nothing about the responses themselves. Arm the deep layer before reproducing to capture them.
      - **No browser-generated messages.** Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - **Nothing before the page had loaded.** Capture began after this page had loaded, because its domain was added or the extension was installed while the tab was already open. Nothing emitted before that point exists; reload the page to cover a full load.
      - **Window shortened by storage pressure.** The window covered is shorter than the one requested: storage pressure forced the oldest entries out before the hour was up.

      ## Timeline

      ### ⚠️ \`console.warn\` — cart total mismatch

      > 🕑 \`2026-08-07T09:25:00.000Z\`

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
      provenance: 'webRequest',
      responseBody: RESPONSE_BODY_UNAVAILABLE,
    };

    expect(renderReport(bundle({ entries: [failed] }))).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      **1 anomaly** in 15 min of capture. Search \`🛑\` to reach them.

      | | |
      | --- | --- |
      | **Page** | Checkout · tab 42 |
      | **URL** | https://example.com/checkout |
      | **Window** | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z · 15 min covered of 15 requested |
      | **Network** | 1 — 1 failed |
      | **Console** | 0 |
      | **JS errors** | 0 |
      | **Produced by** | Vigie 0.1.0 · report schema 1 |

      ## What this report cannot show

      - **No browser-generated messages.** Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - **No response bodies without the deep layer.** Response bodies are not included: the deep capture layer was not running on this tab, and no other channel exposes a response body to an extension. Their absence here says nothing about the responses themselves. Arm the deep layer before reproducing to capture them.

      ## Timeline

      ### 🛑 \`GET /api/prices\` → 💥 \`net::ERR_CONNECTION_RESET\`

      > 🔗 [\`https://example.com/api/prices\`](<https://example.com/api/prices>)  
      > 🕑 \`2026-08-07T09:26:00.000Z\` · ⏱ \`12.0 s\` · no response body"
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
      provenance: 'webRequest',
      responseBody: RESPONSE_BODY_UNAVAILABLE,
    };

    expect(renderReport(bundle({ entries: [pending] }))).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      **Nothing failed** in 15 min of capture.

      | | |
      | --- | --- |
      | **Page** | Checkout · tab 42 |
      | **URL** | https://example.com/checkout |
      | **Window** | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z · 15 min covered of 15 requested |
      | **Network** | 1 |
      | **Console** | 0 |
      | **JS errors** | 0 |
      | **Produced by** | Vigie 0.1.0 · report schema 1 |

      ## What this report cannot show

      - **No browser-generated messages.** Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - **No response bodies without the deep layer.** Response bodies are not included: the deep capture layer was not running on this tab, and no other channel exposes a response body to an extension. Their absence here says nothing about the responses themselves. Arm the deep layer before reproducing to capture them.

      ## Timeline

      ### 🌐 \`GET /stream\` → ⏳ \`still open\`

      > 🔗 [\`https://example.com/stream\`](<https://example.com/stream>)  
      > 🕑 \`2026-08-07T09:26:00.000Z\` · 📄 \`xmlhttprequest\` · no response body"
    `);
  });
});

describe('why a request carries no body', () => {
  /**
   * The state is what a reader acts on: an eviction is a buffer to raise, a filter a setting to
   * widen, and a structural absence neither. So each one is worded apart, and the report never
   * repeats one sentence over entries that have nothing in common.
   */
  it('states a different cause per entry rather than one sentence for all of them', () => {
    const states: ResponseBodyState[] = [
      'captured',
      'truncated',
      'evicted',
      'unavailable',
      'filtered',
      'out-of-session',
      'unfinished',
    ];
    const entries: CaptureEntry[] = states.map((responseBody, index) => ({
      ...REQUEST,
      timestamp: NOW - (states.length - index) * MINUTE,
      requestId: `body-${responseBody}`,
      url: `https://example.com/api/${responseBody}`,
      responseBody,
    }));

    const metaLines = renderReport(bundle({ entries }))
      .split('\n')
      .filter((line) => line.includes('🕑'))
      .map((line) => line.slice(line.lastIndexOf('·') + 2).trim());

    expect(metaLines).toEqual([
      'response body captured',
      'response body truncated',
      'response body evicted from the capture buffer',
      'no response body',
      'response body not requested',
      'response body out of session reach',
      'response body never delivered',
    ]);
    expect(new Set(metaLines).size).toBe(states.length);
  });
});

describe('a response body the deep layer reached', () => {
  function withBody(responseBody: ResponseBodyState, responseBodyText: string): CaptureEntry {
    return { ...REQUEST, provenance: 'cdp', resourceType: 'XHR', responseBody, responseBodyText };
  }

  it('folds it under the response headers, at the end of the section', () => {
    const rendered = renderReport(
      bundle({ entries: [withBody('captured', '{"cart":{"total":22},"currency":"EUR"}')] }),
    );

    expect(rendered).toContain('<summary>Response body</summary>');
    expect(rendered.indexOf('Response headers')).toBeLessThan(rendered.indexOf('Response body'));
    // Reindented, because a minified payload is unreadable and reindenting changes nothing.
    expect(rendered).toContain('"total": 22');
  });

  it('names the cut rather than calling a truncated payload malformed', () => {
    const rendered = renderReport(bundle({ entries: [withBody('truncated', '[{"id":1},{"id":2}')] }));

    expect(rendered).toContain('Response body — cut at the capture ceiling');
    expect(rendered).not.toContain('malformed JSON');
    expect(rendered).toContain('[{"id":1},{"id":2}');
  });

  it('passes a body that is not JSON through exactly as it arrived', () => {
    const rendered = renderReport(bundle({ entries: [withBody('captured', '<!doctype html>\n<p>hi')] }));

    expect(rendered).toContain('<!doctype html>\n<p>hi');
    expect(rendered).not.toContain('malformed JSON');
  });

  it('says an empty body was empty instead of folding a block over nothing', () => {
    const rendered = renderReport(bundle({ entries: [withBody('captured', '')] }));

    expect(rendered).toContain('response body empty');
    expect(rendered).not.toContain('Response body');
  });

  it('names no layer, because the state is what the reader can act on', () => {
    const rendered = renderReport(
      bundle({ entries: [withBody('captured', '{}'), { ...REQUEST, requestId: 'shallow' }] }),
    );

    expect(rendered).not.toContain('cdp');
    expect(rendered).not.toContain('webRequest');
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

      **Nothing failed** in 15 min of capture.

      | | |
      | --- | --- |
      | **Page** | Checkout · tab 42 |
      | **URL** | https://example.com/checkout |
      | **Window** | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z · 15 min covered of 15 requested |
      | **Network** | 1 |
      | **Console** | 0 |
      | **JS errors** | 0 |
      | **Produced by** | Vigie 0.1.0 · report schema 1 |

      ## What this report cannot show

      - **No browser-generated messages.** Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - **No response bodies without the deep layer.** Response bodies are not included: the deep capture layer was not running on this tab, and no other channel exposes a response body to an extension. Their absence here says nothing about the responses themselves. Arm the deep layer before reproducing to capture them.

      ## Timeline

      ### 🌐 \`POST /api/cart\` → ✅ \`201 Created\`

      > 🔗 [\`https://example.com/api/cart?currency=EUR\`](<https://example.com/api/cart?currency=EUR>)  
      > 🕑 \`2026-08-07T09:24:00.000Z\` · ⏱ \`84 ms\` · 📄 \`xmlhttprequest\` · no response body

      <details><summary>Request body — malformed JSON, left exactly as it was received</summary>

      \`\`\`text
      {"sku":"A-1","qty":
      \`\`\`

      </details>"
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

    expect(markdown).toContain('<summary>Request body</summary>');
    expect(markdown).not.toContain('malformed');
    expect(markdown).toContain('```text\nsku=A-1&qty=2\n```');
  });
});

describe('what the capture had to cut', () => {
  it('marks a truncated console line rather than passing it off as complete', () => {
    const truncated: ConsoleEntry = { ...LOG, text: 'huge payload', truncated: true };

    expect(renderReport(bundle({ entries: [truncated] }))).toMatchInlineSnapshot(`
      "# Vigie report — example.com

      **Nothing failed** in 15 min of capture.

      | | |
      | --- | --- |
      | **Page** | Checkout · tab 42 |
      | **URL** | https://example.com/checkout |
      | **Window** | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z · 15 min covered of 15 requested |
      | **Network** | 0 |
      | **Console** | 1 |
      | **JS errors** | 0 |
      | **Produced by** | Vigie 0.1.0 · report schema 1 |

      ## What this report cannot show

      - **No browser-generated messages.** Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - **No response bodies without the deep layer.** Response bodies are not included: the deep capture layer was not running on this tab, and no other channel exposes a response body to an extension. Their absence here says nothing about the responses themselves. Arm the deep layer before reproducing to capture them.

      ## Timeline

      ### ⚠️ \`console.warn\` — huge payload

      > 🕑 \`2026-08-07T09:25:00.000Z\` · truncated by the capture

      \`\`\`text
      huge payload
      \`\`\`"
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

      **Nothing failed** in 15 min of capture.

      | | |
      | --- | --- |
      | **Page** | tab 42 |
      | **URL** | (unknown) |
      | **Window** | 2026-08-07T09:12:00.000Z → 2026-08-07T09:27:00.000Z · 15 min covered of 15 requested |
      | **Network** | 0 |
      | **Console** | 0 |
      | **JS errors** | 0 |
      | **Produced by** | Vigie 0.1.0 · report schema 1 |

      ## What this report cannot show

      - **No browser-generated messages.** Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.
      - **No response bodies without the deep layer.** Response bodies are not included: the deep capture layer was not running on this tab, and no other channel exposes a response body to an extension. Their absence here says nothing about the responses themselves. Arm the deep layer before reproducing to capture them.

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
    const marked = titles(renderReport(mixed)).map((title) => title.startsWith('### 🛑 '));

    // failed, 503, the healthy 201, a warning, an error log, an uncaught failure.
    expect(marked).toEqual([true, true, false, false, true, true]);
  });

  it('counts in the framing exactly what the timeline marks', () => {
    const markdown = renderReport(mixed);
    const marked = titles(markdown).filter((title) => title.startsWith('### 🛑 ')).length;

    expect(markdown).toContain('**4 anomalies** in 15 min of capture. Search `🛑` to reach them.');
    expect(markdown).toContain('| **Network** | 3 — 1 failed, 1 with status ≥ 400 |');
    expect(markdown).toContain('| **Console** | 2 — 1 error |');
    expect(markdown).toContain('| **JS errors** | 1 |');
    expect(marked).toBe(4);
  });

  it('says nothing failed rather than leaving a zero to be noticed', () => {
    const clean = renderReport(bundle({ entries: [REQUEST, LOG] }));

    expect(clean).toContain('**Nothing failed** in 15 min of capture.');
    expect(clean).toContain('| **Network** | 1 |');
    expect(clean).toContain('| **Console** | 1 |');
    expect(clean).not.toContain('🛑');
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

    expect(markdown).toContain('| **URL** | https://example.com/search?q=a\\|b |');
    expect(markdown).toContain('| **Page** | a \\| b · tab 42 |');
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
