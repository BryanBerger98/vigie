import { RESPONSE_BODY_UNAVAILABLE, type HttpHeader } from '@vigie/contract';

import { PENDING_TIMEOUT_MS } from '@/capture/network/assemble';
import type { EntryDraft } from '@/storage/write';
import type {
  CdpHeaders,
  NetworkDataReceivedParams,
  NetworkLoadingFailedParams,
  NetworkLoadingFinishedParams,
  NetworkRequestWillBeSentExtraInfoParams,
  NetworkRequestWillBeSentParams,
  NetworkResponseReceivedParams,
} from '@/shared/chrome-apis';

import type { BodyContext, BodyOutcome } from './body';

/**
 * The requests CDP announced itself, held from the announcement to the conclusion.
 *
 * The `webRequest` side has {@link RequestAssembler} for the same job; this is its counterpart for
 * the deep layer, and the same rules apply — no `chrome.*`, no storage, so every ordering the
 * protocol can produce is stated as a unit test rather than reproduced in a browser.
 *
 * ## What a record is allowed to exist for
 *
 * Only `Network.requestWillBeSent` creates one. Every other event looks its record up and does
 * nothing when there is none: a request already in flight when the session attached delivers a
 * response, its bytes and its conclusion with no announcement in front, sometimes with no URL at
 * all, and `getResponseBody` refuses every one of them. Those belong to `webRequest`, whole.
 *
 * ## Why the retention is bounded
 *
 * A record lives until its request concludes, and some never do. An `EventSource` or a `WebSocket`
 * upgrade stays open for as long as the page wants it, and the body filter lets both through — a
 * stream that does conclude is worth its content. The sweep is what makes that safe: past
 * {@link PENDING_TIMEOUT_MS} the record is written as it stands and released, on the same delay and
 * the same cadence as the `webRequest` side, so one stream cannot hold two layers' worth of memory
 * on two different schedules. A stream that never concludes is never read for a body either.
 *
 * @see aidd_docs/backlog/spikes/cdp-endless-stream-termination.md
 */

/** A finished entry and the URL its scope is decided on. Same pair the `webRequest` side hands over. */
export interface CdpRecordEntry {
  draft: EntryDraft;
  url: string;
  /** The announced id, so the caller can strike it from the in-flight map without re-reading it. */
  requestId: string;
}

/** Schemes the capture keeps, matching the `webRequest` filter. CDP also announces `data:` and `blob:`. */
const CAPTURED_SCHEMES = /^https?:\/\//i;

interface OpenCdpRequest {
  tabId: number;
  requestId: string;
  url: string;
  method: string;
  resourceType?: string;
  /** `Content-Type` without its parameters. Half of what decides whether the body is asked for. */
  mimeType?: string;
  /** Epoch milliseconds, rebuilt from `wallTime`. What the sweep and the entry are dated on. */
  startedAt: number;
  /** The protocol's monotonic clock, in seconds. What a duration is measured on. */
  startedTicks: number;
  requestHeaders?: HttpHeader[];
  responseHeaders?: HttpHeader[];
  statusCode?: number;
  requestBody?: string;
  /** Decoded bytes seen so far. Zero means the response carries no body, not that none was read. */
  receivedBytes: number;
  /** The read, once it happened. Set between the conclusion arriving and the record closing. */
  body?: BodyOutcome;
}

/** How a request ended, as the two terminal events describe it. */
type CdpClosing =
  | { kind: 'finished'; timestamp: number }
  | { kind: 'failed'; timestamp: number; errorText: string; canceled?: boolean };

export class CdpRecordStore {
  private readonly open = new Map<string, OpenCdpRequest>();

  /**
   * Opens a record for a request CDP is about to send.
   *
   * A redirect chain reuses one `requestId` and announces every hop; the record follows the latest
   * hop, which is what the `webRequest` side does with the same chain.
   *
   * Returns the URL when the request is kept, `null` when it is not this product's traffic.
   */
  announce(tabId: number, params: NetworkRequestWillBeSentParams, now: number): string | null {
    const { url, method, headers, postData } = params.request;
    if (!CAPTURED_SCHEMES.test(url)) return null;

    this.open.set(key(tabId, params.requestId), {
      tabId,
      requestId: params.requestId,
      url,
      method,
      resourceType: params.type,
      startedAt: epochFrom(params.wallTime, now),
      startedTicks: params.timestamp,
      requestHeaders: toHeaderList(headers),
      receivedBytes: 0,
      ...(postData !== undefined && { requestBody: postData }),
    });
    return url;
  }

  /** Whether this event belongs to a request CDP announced. Everything else is discarded whole. */
  has(tabId: number, requestId: string): boolean {
    return this.open.has(key(tabId, requestId));
  }

  /**
   * Replaces the request headers with the wire-level set.
   *
   * The announcement carries the headers the renderer asked for; this one carries what actually
   * went out, `Cookie` and the HTTP/2 pseudo-headers included. It is strictly the larger set, so it
   * replaces rather than merges.
   */
  requestHeaders(tabId: number, params: NetworkRequestWillBeSentExtraInfoParams): void {
    const request = this.open.get(key(tabId, params.requestId));
    if (!request) return;
    request.requestHeaders = toHeaderList(params.headers);
  }

  response(tabId: number, params: NetworkResponseReceivedParams): void {
    const request = this.open.get(key(tabId, params.requestId));
    if (!request) return;
    request.statusCode = params.response.status;
    request.responseHeaders = toHeaderList(params.response.headers);
    if (params.type !== undefined) request.resourceType = params.type;
    // Already parsed by the protocol: `mimeType` is the essence, with the charset split off into
    // its own field. So the body filter matches on it directly, without re-parsing a header.
    if (params.response.mimeType !== undefined) request.mimeType = params.response.mimeType;
  }

  /**
   * Bytes arrived. The payload is not kept — the body is read once, at the conclusion — but the
   * count is, and it is the only signal that a response has a body at all. It does not decide
   * whether to read: a response served from the memory cache streams nothing and still has a body
   * to hand over. It decides how to read a refusal — `No data found for resource with given
   * identifier` means "empty" on zero bytes and "gone" on anything else, and the message itself
   * never says which.
   */
  data(tabId: number, params: NetworkDataReceivedParams): void {
    const request = this.open.get(key(tabId, params.requestId));
    if (!request) return;
    request.receivedBytes += params.dataLength;
  }

  /**
   * What the body read needs to know, or `null` when there is no record to read for.
   *
   * Split out so the decision itself stays in `body.ts`, where a unit test can reach it, and this
   * store stays what it is: the memory of a request, with no opinion about the protocol.
   */
  bodyContext(tabId: number, requestId: string): BodyContext | null {
    const request = this.open.get(key(tabId, requestId));
    if (!request) return null;
    return {
      receivedBytes: request.receivedBytes,
      ...(request.resourceType !== undefined && { resourceType: request.resourceType }),
      ...(request.mimeType !== undefined && { mimeType: request.mimeType }),
    };
  }

  /**
   * Records the read's outcome against the still-open request.
   *
   * Between the conclusion arriving and the record closing there is one `await` — the protocol call
   * — and this is what carries its result across. A record released in that window is gone, and the
   * write that follows finds nothing to close: the request went back to `webRequest` mid-read, which
   * is the detach rule doing exactly what it is for.
   */
  body(tabId: number, requestId: string, outcome: BodyOutcome): void {
    const request = this.open.get(key(tabId, requestId));
    if (!request) return;
    request.body = outcome;
  }

  /** Closes a request that loaded. Returns `null` for an id that was never announced. */
  finish(tabId: number, params: NetworkLoadingFinishedParams): CdpRecordEntry | null {
    return this.conclude(tabId, params.requestId, { kind: 'finished', timestamp: params.timestamp });
  }

  /**
   * Closes a request that failed. A cancellation is a failure here, as it is on the `webRequest`
   * side, and the reason is kept rather than flattened — `net::ERR_ABORTED` on a navigation the
   * user interrupted reads very differently from a blocked mixed-content request.
   */
  fail(tabId: number, params: NetworkLoadingFailedParams): CdpRecordEntry | null {
    return this.conclude(tabId, params.requestId, {
      kind: 'failed',
      timestamp: params.timestamp,
      errorText: params.errorText,
      ...(params.canceled !== undefined && { canceled: params.canceled }),
    });
  }

  /**
   * Writes and releases every record left open longer than the timeout.
   *
   * The entry says `pending` and `unfinished`: CDP owned the request and never concluded it, so it
   * never committed a body. Written rather than dropped, because the `webRequest` entry for the
   * same request is suppressed while the session is live — dropping both would lose exactly the
   * long-lived request a user is most likely to be watching.
   */
  sweep(now: number): CdpRecordEntry[] {
    const stale: CdpRecordEntry[] = [];
    for (const request of this.open.values()) {
      if (now - request.startedAt < PENDING_TIMEOUT_MS) continue;
      this.open.delete(key(request.tabId, request.requestId));
      stale.push(finish(request, { outcome: 'pending', timestamp: now, unfinished: true }));
    }
    return stale;
  }

  /**
   * Forgets every record of one tab, without writing any of them.
   *
   * This is the detach, whatever caused it. A request CDP had started goes back to `webRequest`
   * entire: its terminal event arrives after the session is gone, and the fallback entry is written
   * there. Writing here too would be the one duplicate the boundary rule exists to prevent.
   */
  releaseTab(tabId: number): string[] {
    return this.forget((request) => request.tabId === tabId);
  }

  /** Same handback, for every tab at once. Used when the layer stops. */
  clear(): string[] {
    return this.forget(() => true);
  }

  /** Requests announced and not yet concluded. */
  get openCount(): number {
    return this.open.size;
  }

  private conclude(tabId: number, requestId: string, closing: CdpClosing): CdpRecordEntry | null {
    const recordKey = key(tabId, requestId);
    const request = this.open.get(recordKey);
    if (!request) return null;
    this.open.delete(recordKey);

    const durationMs = Math.max(0, Math.round((closing.timestamp - request.startedTicks) * 1000));
    if (closing.kind === 'finished') {
      return finish(request, {
        outcome: 'completed',
        timestamp: request.startedAt + durationMs,
        durationMs,
      });
    }

    return finish(request, {
      outcome: 'failed',
      timestamp: request.startedAt + durationMs,
      durationMs,
      error: closing.canceled ? `${closing.errorText} (canceled)` : closing.errorText,
    });
  }

  private forget(matches: (request: OpenCdpRequest) => boolean): string[] {
    const dropped: string[] = [];
    for (const [recordKey, request] of this.open) {
      if (!matches(request)) continue;
      this.open.delete(recordKey);
      dropped.push(request.requestId);
    }
    return dropped;
  }
}

/**
 * A CDP request id is unique inside one renderer process and no further — the counter restarts on
 * every process swap, and a document's id is its `loaderId`. The tab is what makes it a store key,
 * and the separator is a character no id can hold.
 */
function key(tabId: number, requestId: string): string {
  return `${tabId} ${requestId}`;
}

/** `wallTime` is epoch seconds. A protocol that reports zero or nothing leaves the caller's clock. */
function epochFrom(wallTime: number | undefined, now: number): number {
  return wallTime !== undefined && wallTime > 0 ? Math.round(wallTime * 1000) : now;
}

function toHeaderList(headers: CdpHeaders | undefined): HttpHeader[] | undefined {
  if (!headers) return undefined;
  const list = Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
  return list.length > 0 ? list : undefined;
}

interface CdpFinish {
  outcome: 'completed' | 'failed' | 'pending';
  timestamp: number;
  durationMs?: number;
  error?: string;
  /** The request was still running when the entry was written, so no body was ever committed. */
  unfinished?: boolean;
}

function finish(request: OpenCdpRequest, closing: CdpFinish): CdpRecordEntry {
  const draft: EntryDraft = {
    kind: 'network',
    timestamp: closing.timestamp,
    tabId: request.tabId,
    requestId: request.requestId,
    method: request.method,
    url: request.url,
    outcome: closing.outcome,
    // The deep layer's own entry. `webRequest` may have supplied the moment it was written on; it
    // supplies no field, which is what makes this a CDP entry rather than a merged one.
    provenance: 'cdp',
    // The read happened just before this, in `events.ts`, and left its outcome on the record. The
    // two paths that reach here without one say so rather than inheriting a default: a request the
    // sweep wrote never concluded, and a request that failed never had a body to read.
    responseBody: closing.unfinished ? 'unfinished' : (request.body?.state ?? RESPONSE_BODY_UNAVAILABLE),
    ...(request.body?.text !== undefined && { responseBodyText: request.body.text }),
    // CDP's own vocabulary — `Document`, `XHR`, `Fetch` — not `webRequest`'s `main_frame` and
    // `xmlhttprequest`. Kept verbatim rather than mapped onto an enum the protocol does not use:
    // the entry states its provenance, and inventing a correspondence would be a guess in the data.
    ...(request.resourceType !== undefined && { resourceType: request.resourceType }),
    ...(request.requestHeaders !== undefined && { requestHeaders: request.requestHeaders }),
    ...(request.responseHeaders !== undefined && { responseHeaders: request.responseHeaders }),
    ...(request.requestBody !== undefined && { requestBody: request.requestBody }),
    ...(request.statusCode !== undefined && { statusCode: request.statusCode }),
    ...(closing.durationMs !== undefined && { durationMs: closing.durationMs }),
    ...(closing.error !== undefined && { error: closing.error }),
  };

  return { draft, url: request.url, requestId: request.requestId };
}
