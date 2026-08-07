import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { BrowserContext } from '@playwright/test';

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
  close(): Promise<void>;
}

/** The route the server refuses to answer. Exported so a spec can assert on the URL it stored. */
export const FAILING_PATH = '/dropped';

export async function startTestSite(): Promise<TestSite> {
  const server: Server = createServer((request, response) => {
    if (request.url === FAILING_PATH) {
      request.socket.destroy();
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

    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
