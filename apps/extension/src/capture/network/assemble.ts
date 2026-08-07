import { RESPONSE_BODY_UNAVAILABLE, type HttpHeader, type NetworkEntry } from '@vigie/contract';

import type { EntryDraft } from '@/storage/write';

/**
 * Reassembles the several `webRequest` events of one request into the single entry a report shows.
 *
 * Chrome reports a request as a sequence — `onBeforeRequest`, `onSendHeaders`, then `onCompleted`
 * or `onErrorOccurred` — sharing nothing but a `requestId`. This module holds the open ones and
 * closes them; it touches no `chrome.*` API and no storage, so the reassembly is covered without
 * a browser.
 *
 * ## The request that never closes
 *
 * A long poll, a stream, a tab closed mid-flight: some requests get an opening event and no
 * closing one. Holding them forever would leak, and dropping them would lose exactly the request
 * a user is most likely to be debugging. So a request still open after {@link PENDING_TIMEOUT_MS}
 * is emitted with what is known and `outcome: 'pending'`, then forgotten. A closing event
 * arriving afterwards opens a fresh, headerless entry rather than being matched back — one entry
 * too many is recoverable by a reader, a silently dropped request is not.
 */

/** How long a request may stay open before it is written as it stands. */
export const PENDING_TIMEOUT_MS = 30_000;

/** A `webRequest` opening event, narrowed to what is used. */
export interface BeforeRequestDetails {
  requestId: string;
  url: string;
  method: string;
  tabId: number;
  type?: string;
  timeStamp: number;
  requestBody?: {
    formData?: Record<string, unknown[]>;
    raw?: { bytes?: ArrayBuffer }[];
    error?: string;
  };
}

export interface SendHeadersDetails {
  requestId: string;
  requestHeaders?: HttpHeader[];
}

export interface CompletedDetails {
  requestId: string;
  statusCode: number;
  timeStamp: number;
  responseHeaders?: HttpHeader[];
}

export interface ErrorDetails {
  requestId: string;
  error: string;
  timeStamp: number;
}

/** A finished entry and the URL its scope was decided on — the write path needs both. */
export interface AssembledEntry {
  draft: EntryDraft;
  url: string;
}

interface OpenRequest {
  requestId: string;
  url: string;
  method: string;
  tabId: number;
  resourceType?: string;
  startedAt: number;
  requestHeaders?: HttpHeader[];
  requestBody?: string;
}

export class RequestAssembler {
  private readonly open = new Map<string, OpenRequest>();

  begin(details: BeforeRequestDetails): void {
    this.open.set(details.requestId, {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      tabId: details.tabId,
      resourceType: details.type,
      startedAt: details.timeStamp,
      requestBody: serializeRequestBody(details.requestBody),
    });
  }

  headers(details: SendHeadersDetails): void {
    const request = this.open.get(details.requestId);
    if (!request || !details.requestHeaders) return;
    request.requestHeaders = details.requestHeaders;
  }

  /**
   * Closes a successful request. Returns `null` for a request that was never opened — Chrome does
   * emit closing events for requests that started before the listener was registered.
   */
  complete(details: CompletedDetails): AssembledEntry | null {
    const request = this.take(details.requestId);
    if (!request) return null;

    return finish(request, {
      outcome: 'completed',
      statusCode: details.statusCode,
      responseHeaders: details.responseHeaders,
      durationMs: Math.max(0, details.timeStamp - request.startedAt),
      timestamp: details.timeStamp,
    });
  }

  fail(details: ErrorDetails): AssembledEntry | null {
    const request = this.take(details.requestId);
    if (!request) return null;

    return finish(request, {
      outcome: 'failed',
      error: details.error,
      durationMs: Math.max(0, details.timeStamp - request.startedAt),
      timestamp: details.timeStamp,
    });
  }

  /**
   * Emits every request left open for longer than the timeout, as it stands. Called at each batch
   * flush, so a stalled request reaches the store on the same cadence as a finished one.
   */
  sweep(now: number): AssembledEntry[] {
    const stale: AssembledEntry[] = [];
    for (const request of this.open.values()) {
      if (now - request.startedAt < PENDING_TIMEOUT_MS) continue;
      this.open.delete(request.requestId);
      stale.push(finish(request, { outcome: 'pending', timestamp: now }));
    }
    return stale;
  }

  /** Requests currently awaiting a closing event. */
  get openCount(): number {
    return this.open.size;
  }

  /** Forgets everything in flight. Used when capture stops or the store is purged. */
  clear(): void {
    this.open.clear();
  }

  private take(requestId: string): OpenRequest | undefined {
    const request = this.open.get(requestId);
    if (request) this.open.delete(requestId);
    return request;
  }
}

interface Closing {
  outcome: NetworkEntry['outcome'];
  timestamp: number;
  statusCode?: number;
  responseHeaders?: HttpHeader[];
  durationMs?: number;
  error?: string;
}

function finish(request: OpenRequest, closing: Closing): AssembledEntry {
  const draft: EntryDraft = {
    kind: 'network',
    timestamp: closing.timestamp,
    tabId: request.tabId,
    requestId: request.requestId,
    method: request.method,
    url: request.url,
    outcome: closing.outcome,
    // Stated, never omitted: `webRequest` gives no access to a response body in any Chrome
    // version, and a reader has to be able to tell "not captured" from "the body was empty".
    responseBody: RESPONSE_BODY_UNAVAILABLE,
    ...(request.resourceType !== undefined && { resourceType: request.resourceType }),
    ...(request.requestHeaders !== undefined && { requestHeaders: request.requestHeaders }),
    ...(request.requestBody !== undefined && { requestBody: request.requestBody }),
    ...(closing.statusCode !== undefined && { statusCode: closing.statusCode }),
    ...(closing.responseHeaders !== undefined && { responseHeaders: closing.responseHeaders }),
    ...(closing.durationMs !== undefined && { durationMs: closing.durationMs }),
    ...(closing.error !== undefined && { error: closing.error }),
  };

  return { draft, url: request.url };
}

/**
 * Turns whatever `requestBody` yielded into text.
 *
 * Chrome hands form fields back parsed and everything else as raw bytes, and gives neither for a
 * streamed upload — it says so through `error`, which is kept rather than dropped so the report
 * can state that a body existed and was not readable.
 */
function serializeRequestBody(body: BeforeRequestDetails['requestBody']): string | undefined {
  if (!body) return undefined;
  if (body.error) return `[unavailable: ${body.error}]`;

  if (body.formData) {
    try {
      return JSON.stringify(body.formData);
    } catch {
      return '[unavailable: form data could not be serialized]';
    }
  }

  if (body.raw?.length) {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const text = body.raw
      .map((part) => (part.bytes ? decoder.decode(new Uint8Array(part.bytes)) : ''))
      .join('');
    return text.length > 0 ? text : undefined;
  }

  return undefined;
}
