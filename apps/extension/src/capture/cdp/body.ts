import { type ResponseBodyState } from '@vigie/contract';

/**
 * What a response body costs, and what is done with the one that is kept.
 *
 * Nothing here calls the protocol. The two decisions that need measuring — whether to ask for a body
 * at all, and where to cut the one that came back — are pure functions, and they are the only two
 * parts of the body path a unit test can hold. The call itself lives in `events.ts`, inside the
 * `Network.loadingFinished` handler, because it is the one operation of this layer that cannot wait:
 * a body is gone the moment its page navigates.
 *
 * ## Why a filter at all
 *
 * Reading every body of a browsing hour decodes 6.9 GB. Filtered on resource type and truncated at
 * the ceiling below it decodes 224 MB, against a quota of 10.7 GB Chrome grants without
 * `unlimitedStorage`. The filter is what makes the rolling hour payable; it is not a judgement of
 * what matters.
 *
 * `Script` and `Stylesheet` are what the filter is really for: together they are 95 % of the body
 * volume — 425 MB of scripts over a 239 s tour, for 392 distinct URLs totalling 40.7 MB, the same
 * bundles re-read at every navigation — and a minified bundle already served from the origin says
 * nothing about an incident. `Preflight` and `Ping` are out for the opposite reason: they carry no
 * body at all, and every read attempted on them failed, 29 out of 29 and 6 out of 6.
 *
 * @see aidd_docs/backlog/spikes/cdp-body-capture-calibration.md
 * @see aidd_docs/backlog/spikes/cdp-response-body-storage-cost.md
 */

/**
 * The resource types whose body is asked for. CDP's own vocabulary, as the records keep it.
 *
 * `XHR` and `Fetch` are the application's own traffic — 3.1 % of the volume for a third of the
 * responses. `Document` is the page itself. `Manifest` is small and read once. `EventSource` and
 * `WebSocket` are in so that a stream that does conclude carries what it delivered; the one that
 * never concludes is written by the sweep and says `unfinished`, without a read ever being tried.
 */
export const CAPTURED_RESOURCE_TYPES: readonly string[] = [
  'XHR',
  'Fetch',
  'Document',
  'Manifest',
  'EventSource',
  'WebSocket',
];

/**
 * Where a kept body is cut, in bytes of UTF-8.
 *
 * 256 kB leaves 98.4 % of application bodies whole: the measured quantiles are 0.4 kB at p50, 51.5 kB
 * at p95, 185 kB at p99 and 320 kB at p99.9, with a single 541.5 kB maximum over 1 850 bodies.
 */
export const BODY_CEILING_BYTES = 256 * 1024;

/** What the read decision is made on. All of it is known before the body is asked for. */
export interface BodyContext {
  resourceType?: string;
  /** `Content-Type` as `Network.responseReceived` reports it, already split from its charset. */
  mimeType?: string;
  /** Decoded bytes announced by `Network.dataReceived`. Zero means the response carried no body. */
  receivedBytes: number;
}

/** A body and why it is there, or an absence and why it is not. Written onto the record as is. */
export interface BodyOutcome {
  state: ResponseBodyState;
  text?: string;
}

export type BodyPlan = { read: true } | { read: false; outcome: BodyOutcome };

const READ: BodyPlan = { read: true };

/** A body the report can render. Everything else is bytes a Markdown document cannot carry. */
const TEXT_MEDIA = /^text\/|^application\/(json|javascript|xml|graphql|x-ndjson|x-www-form-urlencoded)|\+json$|\+xml$/i;

/**
 * Whether this response's body is asked for.
 *
 * Two refusals, both reported as `filtered`, because both mean the same thing to a reader: nobody
 * ever asked. One is the resource type, which is the volume decision above. The other is the media
 * type — a body the report cannot set as text is bytes that would be stored base64 and read by
 * nobody, and knowing it before the call is what keeps the protocol from being asked for it at all.
 *
 * A response that announces no media type is read. Chrome answers `getResponseBody` with
 * `base64Encoded` in that case, and the caller refuses it there instead.
 */
export function planBodyRead(context: BodyContext): BodyPlan {
  const { resourceType, mimeType } = context;
  if (resourceType === undefined || !CAPTURED_RESOURCE_TYPES.includes(resourceType)) {
    return { read: false, outcome: { state: 'filtered' } };
  }
  if (mimeType !== undefined && mimeType.length > 0 && !TEXT_MEDIA.test(mimeType)) {
    return { read: false, outcome: { state: 'filtered' } };
  }
  return READ;
}

/**
 * The three messages `getResponseBody` refuses with, and the one thing they each mean.
 *
 * `No resource with given identifier found` is the orphan: the session never announced the request,
 * so its body was never this layer's to read. Measured 0 successes out of 12 against 81 out of 82
 * for announced requests, and an orphan carrying a URL is refused just the same.
 *
 * `Request content was evicted from inspector cache` is the buffer ceiling — 6 of the 14 responses
 * larger than `maxResourceBufferSize` on the run that provoked it.
 *
 * `No data found for resource with given identifier` separates nothing: it covers a request CDP will
 * never conclude, one concluded in failure, and the window before `loadingFinished`. Read here at
 * the conclusion, the remaining reading is a response that carried no body — which is why the byte
 * count decides, and why it is the only thing that does. Everything else is a plain absence.
 *
 * @see aidd_docs/backlog/spikes/cdp-body-read-timing.md
 */
export function failedBodyRead(message: string, receivedBytes: number): BodyOutcome {
  if (message.includes('No resource with given identifier found')) {
    return { state: 'out-of-session' };
  }
  if (message.includes('evicted from inspector cache')) return { state: 'evicted' };
  if (message.includes('No data found for resource with given identifier') && receivedBytes === 0) {
    return { state: 'captured', text: '' };
  }
  return { state: 'unavailable' };
}

/**
 * A body that came back, cut to the ceiling if it is over it.
 *
 * The cut is made on bytes rather than on characters: a code unit is one to three bytes in UTF-8, so
 * cutting on `length` would let a document of CJK text land at three times the budget. The decoder
 * is given the truncated bytes and drops a code point split by the cut.
 *
 * The original size is not kept. No consumer of the report asks for it, and the state already says
 * that something is missing.
 */
export function capturedBody(text: string): BodyOutcome {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= BODY_CEILING_BYTES) return { state: 'captured', text };

  const cut = new TextDecoder('utf-8').decode(bytes.subarray(0, BODY_CEILING_BYTES));
  return { state: 'truncated', text: closeOnElement(cut.replace(/�$/, '')) };
}

/**
 * Backs a cut up to the end of the last complete top-level element.
 *
 * A JSON array cut mid-object gives a reader a half-written record they cannot tell from a
 * half-written response, which is the one confusion a debugging report must not create. Backing up
 * to a boundary the structure defines makes the fragment read as a fragment. The ceiling makes the
 * loss negligible in practice — the largest body measured is 541.5 kB, so the backup is at worst one
 * element of a document twice the cut.
 *
 * Anything that is not a JSON container is left exactly where the cut landed: there is no structure
 * to back up to, and inventing one would change the bytes the reader came for.
 */
function closeOnElement(cut: string): string {
  if (!/^\s*[[{]/.test(cut)) return cut;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastComplete = 0;

  for (let index = 0; index < cut.length; index += 1) {
    const character = cut[index]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 1) lastComplete = index + 1;
    } else if (character === ',' && depth === 1) lastComplete = index;
  }

  return lastComplete > 0 ? cut.slice(0, lastComplete) : cut;
}
