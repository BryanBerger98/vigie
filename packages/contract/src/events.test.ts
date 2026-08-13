import { describe, expect, it } from 'vitest';

import {
  isCaptureEntry,
  isConsoleEntry,
  isErrorEntry,
  isNetworkEntry,
  RESPONSE_BODY_UNAVAILABLE,
  type ConsoleEntry,
  type EntryProvenance,
  type ErrorEntry,
  type NetworkEntry,
  type ResponseBodyState,
} from './events';

const network: NetworkEntry = {
  kind: 'network',
  timestamp: 1_754_500_000_000,
  tabId: 42,
  domain: 'app.example.com',
  requestId: '9231',
  method: 'POST',
  url: 'https://app.example.com/api/orders',
  resourceType: 'xmlhttprequest',
  outcome: 'completed',
  statusCode: 500,
  durationMs: 312,
  requestHeaders: [{ name: 'Cookie', value: 'session=abc' }],
  responseHeaders: [{ name: 'Set-Cookie', value: 'session=def' }],
  requestBody: '{"id":1}',
  provenance: 'webRequest',
  responseBody: RESPONSE_BODY_UNAVAILABLE,
};

const consoleEntry: ConsoleEntry = {
  kind: 'console',
  timestamp: 1_754_500_000_100,
  tabId: 42,
  domain: 'app.example.com',
  level: 'warn',
  text: 'checkout: retrying',
  truncated: false,
};

const errorEntry: ErrorEntry = {
  kind: 'error',
  timestamp: 1_754_500_000_200,
  tabId: 42,
  domain: 'app.example.com',
  source: 'unhandledrejection',
  message: 'TypeError: cannot read properties of undefined',
  stack: 'at checkout (app.js:12:3)',
  truncated: false,
};

describe('isNetworkEntry', () => {
  it('accepts a complete entry', () => {
    expect(isNetworkEntry(network)).toBe(true);
  });

  it('accepts an entry reduced to its required fields', () => {
    const minimal: NetworkEntry = {
      kind: 'network',
      timestamp: 0,
      tabId: 1,
      domain: 'app.example.com',
      requestId: '1',
      method: 'GET',
      url: 'https://app.example.com/',
      outcome: 'pending',
      provenance: 'webRequest',
      responseBody: RESPONSE_BODY_UNAVAILABLE,
    };
    expect(isNetworkEntry(minimal)).toBe(true);
  });

  it.each<EntryProvenance>(['webRequest', 'cdp'])('accepts an entry from the %s layer', (layer) => {
    expect(isNetworkEntry({ ...network, provenance: layer })).toBe(true);
  });

  it.each<ResponseBodyState>([
    'evicted',
    'unavailable',
    'filtered',
    'out-of-session',
    'unfinished',
  ])('accepts %s, which carries no body text', (state) => {
    expect(isNetworkEntry({ ...network, responseBody: state })).toBe(true);
  });

  it.each<ResponseBodyState>(['captured', 'truncated'])(
    'accepts %s, with or without the text it allows',
    (state) => {
      expect(isNetworkEntry({ ...network, responseBody: state })).toBe(true);
      expect(isNetworkEntry({ ...network, responseBody: state, responseBodyText: '{}' })).toBe(true);
    },
  );

  it.each([
    ['a missing required field', { ...network, url: undefined }],
    ['an empty domain', { ...network, domain: '' }],
    ['a non-finite timestamp', { ...network, timestamp: Number.NaN }],
    ['a string tab id', { ...network, tabId: '42' }],
    ['an unknown outcome', { ...network, outcome: 'aborted' }],
    ['a missing provenance', { ...network, provenance: undefined }],
    ['an unknown provenance', { ...network, provenance: 'devtools' }],
    ['a response body state the contract does not define', { ...network, responseBody: 'available' }],
    ['a missing response body state', { ...network, responseBody: undefined }],
    ['a body text on a state that denies one', { ...network, responseBodyText: '{"id":1}' }],
    ['a non-string body text', { ...network, responseBody: 'captured', responseBodyText: 42 }],
    ['a malformed header list', { ...network, requestHeaders: [{ name: 'Cookie' }] }],
    ['a wrongly typed optional field', { ...network, statusCode: '500' }],
    ['another kind', consoleEntry],
    ['a plain object', {}],
    ['null', null],
    ['an array', [network]],
  ])('rejects %s', (_label, candidate) => {
    expect(isNetworkEntry(candidate)).toBe(false);
  });
});

describe('isConsoleEntry', () => {
  it('accepts a complete entry', () => {
    expect(isConsoleEntry(consoleEntry)).toBe(true);
  });

  it('accepts an empty text, which console.log() produces', () => {
    expect(isConsoleEntry({ ...consoleEntry, text: '' })).toBe(true);
  });

  it.each([
    ['an unknown level', { ...consoleEntry, level: 'trace' }],
    ['a missing truncation marker', { ...consoleEntry, truncated: undefined }],
    ['a non-string text', { ...consoleEntry, text: { message: 'oops' } }],
    ['another kind', errorEntry],
    ['undefined', undefined],
  ])('rejects %s', (_label, candidate) => {
    expect(isConsoleEntry(candidate)).toBe(false);
  });
});

describe('isErrorEntry', () => {
  it('accepts a complete entry', () => {
    expect(isErrorEntry(errorEntry)).toBe(true);
  });

  it('accepts a missing stack, which a rejected promise often has', () => {
    const { stack: _stack, ...withoutStack } = errorEntry;
    expect(isErrorEntry(withoutStack)).toBe(true);
  });

  it.each([
    ['an unknown source', { ...errorEntry, source: 'reporting-observer' }],
    ['a non-string stack', { ...errorEntry, stack: 42 }],
    ['another kind', network],
  ])('rejects %s', (_label, candidate) => {
    expect(isErrorEntry(candidate)).toBe(false);
  });
});

describe('isCaptureEntry', () => {
  it('accepts each of the three kinds', () => {
    expect([network, consoleEntry, errorEntry].every(isCaptureEntry)).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(isCaptureEntry({ ...consoleEntry, kind: 'video' })).toBe(false);
  });
});
