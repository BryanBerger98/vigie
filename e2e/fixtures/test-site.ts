import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

/**
 * A local site the suite can browse, so network events come from traffic the run controls end to
 * end. Anything reached over the public internet would make the assertions depend on a third
 * party's availability and caching.
 *
 * The page pulls a sub-resource on purpose: one visit then produces several `onCompleted` events,
 * which is what distinguishes "the listener fired" from "the listener fired once by accident".
 */
export interface TestSite {
  /** `http://127.0.0.1:<port>`, the origin to navigate to. */
  origin: string;
  /** The host alone — what the watched-domain list stores. */
  host: string;
  /** Navigates a throwaway tab to the site and waits for the sub-resource to have loaded. */
  visit(context: BrowserContext): Promise<void>;
  /**
   * Navigates to a route the server kills mid-answer, so the browser reports a transport failure
   * rather than a status code. That is the only way to reach `onErrorOccurred` from a run that
   * controls both ends: an HTTP 500 is a perfectly successful request as far as `webRequest` is
   * concerned, and a bad hostname would depend on the resolver of whoever runs the suite.
   */
  visitFailing(context: BrowserContext): Promise<void>;
  /**
   * Opens the page that logs and fails, and hands the tab back still open.
   *
   * Returned rather than closed, unlike `visit`: a spec has to be able to listen to Playwright's
   * own `console` events on it, which is the only way to state that the page's output is still
   * the page's output once the extension has replaced `console.*`.
   */
  openNoisy(context: BrowserContext): Promise<Page>;
  /**
   * Opens a page that fires `requests` fetches and as many console lines, and waits for it to be
   * done. What phase 6 needs and no other route provides: enough entries, on the real write path,
   * for the store's cost per entry to be a measurement rather than a rounding error.
   *
   * `weight` decides what each request carries. A capture entry is mostly its URL and its headers,
   * so the same count of requests can cost wildly different bytes: `light` is a bare JSON fetch,
   * `heavy` is what an authenticated application actually sends — a bearer token, a correlation
   * header, cookies coming back, a long query string. Measuring both brackets the real figure
   * instead of pinning it to whichever one the harness happened to emit.
   */
  openBurst(context: BrowserContext, requests: number, weight?: BurstWeight): Promise<Page>;
  /**
   * The same page, behind a strict `Content-Security-Policy`.
   *
   * Worth its own route because the capture stopped depending on a `<script>` tag it appends
   * itself: a main-world content script is injected by the browser and is not subject to the
   * page's policy. A site with `script-src 'self'` is common enough that "the capture is silent
   * there" would be a hole nobody would notice until a bug report came back empty.
   */
  openStrict(context: BrowserContext): Promise<Page>;
  close(): Promise<void>;
}

/** The route the server refuses to answer. Exported so a spec can assert on the URL it stored. */
export const FAILING_PATH = '/dropped';

/** The page that exercises every console path. */
export const NOISY_PATH = '/noisy';

/** The same page under `script-src 'self'`, which forces the script out of line. */
export const STRICT_PATH = '/strict';

/** The external form of the noisy script, since a strict policy forbids the inline one. */
const NOISY_SCRIPT_PATH = '/noisy.js';

/** The page that produces traffic in bulk, so a volume measurement has something to weigh. */
export const BURST_PATH = '/burst';

/** How much each burst request carries. See `openBurst`. */
export type BurstWeight = 'light' | 'heavy';

/** Marker the burst page sets once every request has come back. */
const BURST_DONE = '__vigieBurstDone';

/**
 * The burst page. Requests go out in small waves rather than all at once: a few hundred parallel
 * fetches against a single-threaded Node server measure the server's accept queue, not the
 * extension. Each response carries a payload of a realistic size, and each request is paired with
 * a console line, so the mix resembles what an application produces.
 *
 * The heavy variant sends what a logged-in single-page application sends on every call. The token
 * is a plausible length rather than a real one; nothing here authenticates anything.
 */
function burstPage(count: number, weight: BurstWeight): string {
  const heavy = weight === 'heavy';
  const headers = heavy
    ? `{
        authorization: 'Bearer ' + 'e30.' + 'A'.repeat(720) + '.sig',
        'x-correlation-id': '8f14e45f-ceea-467a-9b0c-' + String(n).padStart(12, '0'),
        'x-client-build': '2026.8.1+e2e.measurement.harness',
        'content-type': 'application/json',
      }`
    : '{}';
  const query = heavy
    ? `'/burst-asset?heavy=1&n=' + n + '&fields=id,name,status,owner,updatedAt&filter=' + encodeURIComponent('{"status":["open","pending"],"since":"2026-08-01"}')`
    : `'/burst-asset?n=' + n`;
  const line = heavy
    ? `console.log('vigie-e2e burst', n, { index: n, note: 'a line an application would write', payload: { id: n, owner: 'measurement-harness', tags: ['burst', 'heavy', 'phase-6'], trace: 'x'.repeat(200) } })`
    : `console.log('vigie-e2e burst', n, { index: n, note: 'a line an application would write' })`;

  return `<!doctype html><title>burst</title><p>burst</p><script>
(async () => {
  const WAVE = 20;
  for (let sent = 0; sent < ${count}; sent += WAVE) {
    const wave = [];
    for (let i = 0; i < WAVE && sent + i < ${count}; i += 1) {
      const n = sent + i;
      ${line};
      wave.push(fetch(${query}, { headers: ${headers} }).then((response) => response.text()));
    }
    await Promise.all(wave);
  }
  globalThis.${BURST_DONE} = true;
})();
</script>`;
}

/** What the heavy route answers with, on top of the payload: what a real backend sets. */
const HEAVY_RESPONSE_HEADERS = {
  'set-cookie': `session=${'s'.repeat(180)}; Path=/; HttpOnly; SameSite=Lax`,
  'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'x-request-id': '8f14e45f-ceea-467a-9b0c-6a0f8f14e45fceea',
  'x-served-by': 'measurement-harness/edge-node-07.eu-west-3.internal',
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4993',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
};

/**
 * What the noisy page emits, verbatim. Exported so a spec asserts on the text rather than on a
 * substring it guessed, and so the page and its assertions cannot drift apart.
 */
export const NOISY = {
  /** Emitted by an inline script in `<head>`, before anything else on the page has parsed. */
  load: 'vigie-e2e: logged while loading',
  warn: 'vigie-e2e: a warning',
  /** Logged as a self-referencing object, which a naive serialiser would hang on. */
  circular: 'vigie-e2e: circular',
  uncaught: 'vigie-e2e: thrown and never caught',
  rejection: 'vigie-e2e: rejected with nobody listening',
} as const;

/**
 * The page's own script. The load-time log is an inline script in `<head>`: it runs during parsing,
 * which is the earliest a page can log and the hardest moment for a capture to be there already.
 *
 * The failures are deferred by a turn, so the document has finished loading before they fire —
 * a `throw` during parsing would abort the rest of the inline script and take the others with it.
 */
const NOISY_SCRIPT = `
console.log(${JSON.stringify(NOISY.load)});
console.warn(${JSON.stringify(NOISY.warn)});
const circular = { tag: ${JSON.stringify(NOISY.circular)} };
circular.self = circular;
console.log(circular);
setTimeout(() => {
  Promise.reject(new Error(${JSON.stringify(NOISY.rejection)}));
  throw new Error(${JSON.stringify(NOISY.uncaught)});
}, 0);
`;

export async function startTestSite(): Promise<TestSite> {
  const server: Server = createServer((request, response) => {
    if (request.url === FAILING_PATH) {
      request.socket.destroy();
      return;
    }
    if (request.url === NOISY_PATH) {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        `<!doctype html><title>noisy</title><script>${NOISY_SCRIPT}</script><p>noisy</p>`,
      );
      return;
    }
    if (request.url === STRICT_PATH) {
      response.writeHead(200, {
        'content-type': 'text/html',
        'content-security-policy': "script-src 'self'; object-src 'none'",
      });
      response.end(
        `<!doctype html><title>strict</title><script src="${NOISY_SCRIPT_PATH}"></script><p>noisy</p>`,
      );
      return;
    }
    if (request.url?.startsWith(`${BURST_PATH}?`)) {
      const parameters = new URL(request.url, 'http://localhost').searchParams;
      const count = Number(parameters.get('n') ?? 100);
      const weight: BurstWeight = parameters.get('weight') === 'heavy' ? 'heavy' : 'light';
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(burstPage(count, weight));
      return;
    }
    if (request.url?.startsWith('/burst-asset')) {
      const heavy = request.url.includes('heavy=1');
      response.writeHead(200, {
        'content-type': 'application/json',
        ...(heavy ? HEAVY_RESPONSE_HEADERS : {}),
      });
      response.end(JSON.stringify({ ok: true, payload: 'x'.repeat(512) }));
      return;
    }
    if (request.url === NOISY_SCRIPT_PATH) {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(NOISY_SCRIPT);
      return;
    }
    if (request.url?.endsWith('.js')) {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end('globalThis.__vigieAsset = true;');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>site</title><script src="/asset.js"></script><p>ok</p>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    host: '127.0.0.1',

    async visit(context) {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'load' });
      await page.close();
    },

    async visitFailing(context) {
      const page = await context.newPage();
      // The navigation is expected to throw: the point of the route is that it never answers.
      await page.goto(`http://127.0.0.1:${port}${FAILING_PATH}`).catch(() => undefined);
      await page.close();
    },

    async openNoisy(context) {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}${NOISY_PATH}`, { waitUntil: 'load' });
      return page;
    },

    async openBurst(context, requests, weight = 'light') {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}${BURST_PATH}?n=${requests}&weight=${weight}`, {
        waitUntil: 'load',
      });
      await page.waitForFunction(
        (marker) => (globalThis as Record<string, unknown>)[marker] === true,
        BURST_DONE,
        { timeout: 120_000 },
      );
      return page;
    },

    async openStrict(context) {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}${STRICT_PATH}`, { waitUntil: 'load' });
      return page;
    },

    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
