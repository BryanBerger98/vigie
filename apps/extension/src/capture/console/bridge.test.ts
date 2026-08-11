import { describe, expect, it } from 'vitest';

import {
  BRIDGE_MARKER,
  bridgeMessage,
  isCapturePayload,
  isRelayMessage,
  readBridgeMessage,
  relayMessage,
  RELAY_MESSAGE,
  type CapturePayload,
} from './bridge';

/**
 * The guards are the only thing between a page's `postMessage` and the user's report. Every case
 * below is a message a hostile page can actually send.
 */

const consolePayload: CapturePayload = {
  kind: 'console',
  level: 'warn',
  text: 'careful',
  truncated: false,
  at: 1_700_000_000_000,
};

const errorPayload: CapturePayload = {
  kind: 'error',
  source: 'unhandledrejection',
  message: 'Error: boom',
  stack: 'Error: boom\n    at page.js:1:1',
  truncated: true,
  at: 1_700_000_000_001,
};

describe('envelopes', () => {
  it('round-trips a console payload across the page hop', () => {
    expect(readBridgeMessage(bridgeMessage(consolePayload))).toEqual(consolePayload);
  });

  it('round-trips an error payload across the worker hop', () => {
    const message = relayMessage(errorPayload);

    expect(isRelayMessage(message)).toBe(true);
    expect(message.payload).toEqual(errorPayload);
  });

  it('namespaces both markers, since both buses are shared', () => {
    expect(BRIDGE_MARKER).toBe('vigie:page-capture');
    expect(RELAY_MESSAGE).toBe('vigie:page-capture-entry');
  });
});

describe('readBridgeMessage ignores what is not ours', () => {
  it.each([
    ['a bare string', 'hello'],
    ['null', null],
    ['a message with no marker', { payload: consolePayload }],
    ['a message with someone else’s marker', { marker: 'other', payload: consolePayload }],
    ['WXT’s own script-started message', { type: 'wxt:content-script-started' }],
  ])('returns null for %s', (_label, data) => {
    expect(readBridgeMessage(data)).toBeNull();
  });

  it('returns null when the marker is right but the payload is junk', () => {
    expect(readBridgeMessage({ marker: BRIDGE_MARKER, payload: { kind: 'console' } })).toBeNull();
  });
});

describe('isCapturePayload rejects a forged payload field by field', () => {
  it('accepts the two real shapes', () => {
    expect(isCapturePayload(consolePayload)).toBe(true);
    expect(isCapturePayload(errorPayload)).toBe(true);
  });

  it('accepts an error payload with no stack', () => {
    const { stack: _stack, ...withoutStack } = errorPayload as Extract<
      CapturePayload,
      { kind: 'error' }
    >;

    expect(isCapturePayload(withoutStack)).toBe(true);
  });

  it.each([
    ['an unknown kind', { ...consolePayload, kind: 'network' }],
    ['a level that is not one of ours', { ...consolePayload, level: 'trace' }],
    ['a non-string text', { ...consolePayload, text: { toString: 'nope' } }],
    ['a non-boolean truncated', { ...consolePayload, truncated: 'yes' }],
    ['a non-numeric stamp', { ...consolePayload, at: '1700000000000' }],
    ['an infinite stamp', { ...consolePayload, at: Number.POSITIVE_INFINITY }],
    ['a NaN stamp', { ...consolePayload, at: Number.NaN }],
    ['an unknown error source', { ...errorPayload, source: 'console' }],
    ['a non-string message', { ...errorPayload, message: 42 }],
    ['a non-string stack', { ...errorPayload, stack: ['page.js'] }],
  ])('rejects %s', (_label, payload) => {
    expect(isCapturePayload(payload)).toBe(false);
  });
});

describe('isRelayMessage', () => {
  it('rejects the flush message, which shares the bus', () => {
    expect(isRelayMessage('vigie:flush')).toBe(false);
  });

  it('rejects the right type carrying a forged payload', () => {
    expect(isRelayMessage({ type: RELAY_MESSAGE, payload: { kind: 'console', text: 'x' } })).toBe(
      false,
    );
  });
});
