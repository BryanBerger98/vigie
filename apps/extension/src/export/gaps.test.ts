import type { CaptureEntry, GapKind, NetworkEntry } from '@vigie/contract';
import { GAP_STATEMENTS, RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';
import { describe, expect, it } from 'vitest';

import { EMPTY_STORAGE_STATE, type StorageState } from '@/storage/prune';

import { declareGaps } from './gaps';
import { windowBounds } from './slice';

/**
 * The four gaps, each asserted through the condition that raises it.
 *
 * What matters here is the pair — a condition and a sentence — never the sentence alone: the
 * wording is the contract's, and repeating it in an assertion would only test a copy of itself.
 */

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const BOUNDS = windowBounds(NOW, 15);

function request(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    kind: 'network',
    timestamp: NOW - MINUTE,
    tabId: 7,
    domain: 'example.com',
    requestId: 'r1',
    method: 'GET',
    url: 'https://example.com/api',
    outcome: 'completed',
    statusCode: 200,
    provenance: 'webRequest',
    responseBody: RESPONSE_BODY_UNAVAILABLE,
    ...overrides,
  };
}

function kinds(entries: CaptureEntry[], storage: StorageState = EMPTY_STORAGE_STATE): GapKind[] {
  return declareGaps({ bounds: BOUNDS, entries, storage }).map((gap) => gap.kind);
}

const PAGE_LOAD = request({ requestId: 'document', resourceType: 'main_frame' });
/** The deep layer's version of the same request: CDP's vocabulary, and a body it did reach. */
const DEEP_PAGE_LOAD = request({
  requestId: 'A1B2',
  resourceType: 'Document',
  provenance: 'cdp',
  responseBody: 'captured',
  responseBodyText: '<!doctype html>',
});

describe('the gaps every report declares', () => {
  it('states the structural one whatever the capture observed', () => {
    expect(kinds([DEEP_PAGE_LOAD])).toEqual(['browser-messages-out-of-reach']);
  });

  it('states it first, because it changes how the whole body reads', () => {
    expect(kinds([])[0]).toBe('browser-messages-out-of-reach');
  });

  it('carries the contract wording rather than a sentence of its own', () => {
    const gaps = declareGaps({ bounds: BOUNDS, entries: [], storage: EMPTY_STORAGE_STATE });

    for (const gap of gaps) {
      expect(gap.statement).toBe(GAP_STATEMENTS[gap.kind]);
    }
  });
});

describe('the response bodies the report does not hold', () => {
  it('is declared on a window the deep layer never covered', () => {
    expect(kinds([PAGE_LOAD, request({ requestId: 'api' })])).toContain(
      'response-bodies-unavailable',
    );
  });

  it('is declared on an empty window, where nothing says the layer was there', () => {
    expect(kinds([])).toContain('response-bodies-unavailable');
  });

  it('is not declared once one entry of the window came from the deep layer', () => {
    expect(kinds([PAGE_LOAD, DEEP_PAGE_LOAD])).not.toContain('response-bodies-unavailable');
  });

  it('is not declared for a deep entry that reached no body either', () => {
    const filtered = request({ requestId: 'font', provenance: 'cdp', responseBody: 'filtered' });

    expect(kinds([filtered])).not.toContain('response-bodies-unavailable');
  });
});

describe('the page load the capture missed', () => {
  it('is declared when the window holds no document request', () => {
    expect(kinds([request({ resourceType: 'xmlhttprequest' })])).toContain(
      'capture-started-after-page-load',
    );
  });

  it('is declared on an empty window, where nothing was observed at all', () => {
    expect(kinds([])).toContain('capture-started-after-page-load');
  });

  it('is not declared once the document request is there', () => {
    expect(kinds([PAGE_LOAD, request({ requestId: 'api' })])).not.toContain(
      'capture-started-after-page-load',
    );
  });

  it('recognises the deep layer naming that same request `Document`', () => {
    expect(kinds([DEEP_PAGE_LOAD])).not.toContain('capture-started-after-page-load');
  });
});

describe('the window the quota shrank', () => {
  it('is declared when the purge went past the hour inside this window', () => {
    const storage: StorageState = { ...EMPTY_STORAGE_STATE, shrunkAt: NOW - 2 * MINUTE };

    expect(kinds([PAGE_LOAD], storage)).toContain('window-shrunk-by-quota');
  });

  it('is declared on the exact bound, where the shrink still cost this report entries', () => {
    const storage: StorageState = { ...EMPTY_STORAGE_STATE, shrunkAt: BOUNDS.from };

    expect(kinds([PAGE_LOAD], storage)).toContain('window-shrunk-by-quota');
  });

  it('is not declared for a shrink older than the window, which cost it nothing', () => {
    const storage: StorageState = { ...EMPTY_STORAGE_STATE, shrunkAt: BOUNDS.from - 1 };

    expect(kinds([PAGE_LOAD], storage)).not.toContain('window-shrunk-by-quota');
  });

  it('is not declared when the purge never had to shrink anything', () => {
    expect(kinds([PAGE_LOAD])).not.toContain('window-shrunk-by-quota');
  });
});

describe('the four together', () => {
  it('are all declared when everything that can be missing is', () => {
    const storage: StorageState = { ...EMPTY_STORAGE_STATE, shrunkAt: NOW };

    expect(kinds([], storage)).toEqual([
      'browser-messages-out-of-reach',
      'response-bodies-unavailable',
      'capture-started-after-page-load',
      'window-shrunk-by-quota',
    ]);
  });
});
