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
