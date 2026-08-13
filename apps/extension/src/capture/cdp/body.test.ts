import { describe, expect, it } from 'vitest';

import { BODY_CEILING_BYTES, capturedBody, failedBodyRead, planBodyRead } from './body';

/**
 * The two decisions of the body path that never touch the protocol: what gets asked for, and what
 * comes back. The call itself is in `events.ts` and needs a browser; everything measurable is here.
 */

const BYTES = 4_096;

function utf8(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('deciding whether to ask for a body at all', () => {
  it('reads the application traffic the filter exists to keep', () => {
    for (const resourceType of ['XHR', 'Fetch', 'Document', 'Manifest', 'EventSource', 'WebSocket']) {
      expect(planBodyRead({ resourceType, mimeType: 'application/json', receivedBytes: BYTES })).toEqual({
        read: true,
      });
    }
  });

  it('never asks for the two types that are 95 % of the volume', () => {
    for (const resourceType of ['Script', 'Stylesheet']) {
      expect(planBodyRead({ resourceType, mimeType: 'text/css', receivedBytes: BYTES })).toEqual({
        read: false,
        outcome: { state: 'filtered' },
      });
    }
  });

  it('never asks the two types that carry no body, whatever they announce', () => {
    for (const resourceType of ['Preflight', 'Ping']) {
      expect(planBodyRead({ resourceType, receivedBytes: 0 })).toEqual({
        read: false,
        outcome: { state: 'filtered' },
      });
    }
  });

  it('treats an unknown resource type as out of the filter rather than guessing', () => {
    expect(planBodyRead({ resourceType: 'Image', mimeType: 'image/png', receivedBytes: BYTES })).toEqual({
      read: false,
      outcome: { state: 'filtered' },
    });
    expect(planBodyRead({ receivedBytes: BYTES })).toEqual({ read: false, outcome: { state: 'filtered' } });
  });

  it('refuses a media type the report could not carry as text, even on a kept type', () => {
    expect(planBodyRead({ resourceType: 'Fetch', mimeType: 'application/octet-stream', receivedBytes: BYTES }))
      .toEqual({ read: false, outcome: { state: 'filtered' } });
    expect(planBodyRead({ resourceType: 'XHR', mimeType: 'image/webp', receivedBytes: BYTES })).toEqual({
      read: false,
      outcome: { state: 'filtered' },
    });
  });

  it('keeps the text-shaped media types a debugging report is read for', () => {
    for (const mimeType of [
      'text/html',
      'text/plain',
      'application/json',
      'application/ld+json',
      'application/xml',
      'image/svg+xml',
      'application/x-ndjson',
      'application/graphql',
    ]) {
      expect(planBodyRead({ resourceType: 'Document', mimeType, receivedBytes: BYTES })).toEqual({ read: true });
    }
  });

  it('asks when the response declared no media type, and lets the protocol settle it', () => {
    expect(planBodyRead({ resourceType: 'Fetch', receivedBytes: BYTES })).toEqual({ read: true });
    expect(planBodyRead({ resourceType: 'Fetch', mimeType: '', receivedBytes: BYTES })).toEqual({ read: true });
  });

  it('asks for a response that streamed nothing, because a cached one streams nothing either', () => {
    expect(planBodyRead({ resourceType: 'XHR', mimeType: 'application/json', receivedBytes: 0 })).toEqual({
      read: true,
    });
  });
});

describe('reading what the protocol refused with', () => {
  it('calls the orphan out of session, since its body was never this layer to read', () => {
    expect(failedBodyRead('No resource with given identifier found', 0)).toEqual({ state: 'out-of-session' });
  });

  it('names the buffer ceiling for what it is', () => {
    expect(failedBodyRead('Request content was evicted from inspector cache', BYTES)).toEqual({
      state: 'evicted',
    });
  });

  it('reads a no-data refusal on a response that streamed nothing as an empty body', () => {
    expect(failedBodyRead('No data found for resource with given identifier', 0)).toEqual({
      state: 'captured',
      text: '',
    });
  });

  it('reads the same refusal on a response that did stream as a plain absence', () => {
    expect(failedBodyRead('No data found for resource with given identifier', BYTES)).toEqual({
      state: 'unavailable',
    });
  });

  it('does not invent a meaning for a message it does not know', () => {
    expect(failedBodyRead('Target closed.', BYTES)).toEqual({ state: 'unavailable' });
    expect(failedBodyRead('', 0)).toEqual({ state: 'unavailable' });
  });
});

describe('keeping a body that came back', () => {
  it('keeps a body under the ceiling exactly as it was received', () => {
    const text = JSON.stringify({ users: [{ id: 1, name: 'Ada' }] });
    expect(capturedBody(text)).toEqual({ state: 'captured', text });
  });

  it('keeps an empty body rather than reporting it missing', () => {
    expect(capturedBody('')).toEqual({ state: 'captured', text: '' });
  });

  it('cuts at the ceiling in bytes, not in characters', () => {
    const wide = 'é'.repeat(BODY_CEILING_BYTES); // two bytes each, so half the count fits.
    const kept = capturedBody(wide);

    expect(kept.state).toBe('truncated');
    expect(utf8(kept.text ?? '')).toBeLessThanOrEqual(BODY_CEILING_BYTES);
    expect(kept.text?.length).toBeCloseTo(BODY_CEILING_BYTES / 2, -2);
  });

  it('never leaves a code point split across the cut', () => {
    // 65 535 two-byte characters puts the ceiling in the middle of the next one.
    const straddling = `${'é'.repeat(BODY_CEILING_BYTES / 2 - 1)}€`;
    const kept = capturedBody(`${straddling}${'x'.repeat(BODY_CEILING_BYTES)}`);

    expect(kept.text).not.toContain('�');
  });

  it('backs a cut array up to the end of a complete element', () => {
    const rows = Array.from({ length: 4_000 }, (_, index) => ({ id: index, note: 'x'.repeat(80) }));
    const kept = capturedBody(JSON.stringify(rows));

    expect(kept.state).toBe('truncated');
    expect(utf8(kept.text ?? '')).toBeLessThanOrEqual(BODY_CEILING_BYTES);
    expect(kept.text?.endsWith('}')).toBe(true);
    expect(() => JSON.parse(`${kept.text}]`)).not.toThrow();
  });

  it('backs a cut object up to the end of a complete member', () => {
    const record = Object.fromEntries(
      Array.from({ length: 4_000 }, (_, index) => [`field-${index}`, { note: 'y'.repeat(80) }]),
    );
    const kept = capturedBody(JSON.stringify(record));

    expect(kept.state).toBe('truncated');
    expect(kept.text?.endsWith('}')).toBe(true);
    expect(() => JSON.parse(`${kept.text}}`)).not.toThrow();
  });

  it('cuts on the separator when the elements are scalars', () => {
    const kept = capturedBody(JSON.stringify(Array.from({ length: 200_000 }, (_, index) => index)));

    expect(kept.state).toBe('truncated');
    expect(kept.text?.endsWith(',')).toBe(false);
    expect(() => JSON.parse(`${kept.text}]`)).not.toThrow();
  });

  it('is not fooled by a brace inside a string', () => {
    const rows = Array.from({ length: 4_000 }, () => ({ note: '}]"{[' + 'z'.repeat(80) }));
    const kept = capturedBody(JSON.stringify(rows));

    expect(() => JSON.parse(`${kept.text}]`)).not.toThrow();
  });

  it('leaves a body with no structure exactly where the cut landed', () => {
    const kept = capturedBody('x'.repeat(BODY_CEILING_BYTES + 1_000));

    expect(kept).toEqual({ state: 'truncated', text: 'x'.repeat(BODY_CEILING_BYTES) });
  });
});
