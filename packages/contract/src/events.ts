/**
 * The three shapes a capture layer can produce. Every one of them crosses a boundary — page
 * to content script, content script to service worker, service worker to IndexedDB — so the
 * declarations live here and are never restated on either side.
 */

/** Discriminant of a stored entry. Doubles as the `kind` column of the Dexie table. */
export type EntryKind = 'network' | 'console' | 'error';

/** What every entry carries, whatever its kind. */
export interface EntryBase {
  kind: EntryKind;
  /** Epoch milliseconds. The single ordering key of a report: one timeline, all kinds mixed. */
  timestamp: number;
  /** Tab the entry belongs to. An entry with no attachable tab is never stored. */
  tabId: number;
  /** Hostname of the watched domain the entry was captured under. */
  domain: string;
}

export interface HttpHeader {
  name: string;
  value: string;
}

/**
 * Which capture layer produced an entry.
 *
 * Carried per entry and never per field: an entry comes from one layer and one only. That holds at
 * session boundaries too, where a request straddling the opening or the closing of the deep layer
 * falls back to `webRequest` whole — never a CDP beginning completed by `webRequest`.
 *
 * The signal an entry is written on does not decide its provenance. That signal is the request's
 * terminal event, observed by whichever layer saw it — in practice `webRequest`, which never misses
 * one. An entry triggered by `webRequest` and filled by CDP is a CDP entry: `webRequest` brings no
 * field to it, only the moment.
 */
export type EntryProvenance = 'webRequest' | 'cdp';

/**
 * Why an entry carries a response body, or why it does not. A single `unavailable` for every cause
 * would hide the one thing a reader needs: whether the body ever existed.
 *
 * - `captured` — the body is in `responseBodyText`, whole.
 * - `truncated` — the body is in `responseBodyText`, cut at the capture ceiling.
 * - `evicted` — CDP held the body and let it go before it was read. Its buffer is bounded, and a
 *   body disappears as soon as its page navigates.
 * - `unavailable` — no layer could reach it. This is what `webRequest` alone produces, in every
 *   Chrome version; it is neither an eviction nor a filter.
 * - `filtered` — the body was never meant to reach the report: the resource type sits outside the
 *   capture filter, or the media type is not one a reader can read, or the protocol answered with
 *   base64 bytes. Nothing was lost — a report holds text.
 * - `out-of-session` — the request was already in flight when the deep layer attached, or still in
 *   flight when it detached. CDP never announced it, so its body was never reachable.
 * - `unfinished` — CDP owns the request and never concluded it, so it never committed a body. What
 *   marks this state is the absence of `Network.loadingFinished` when the entry is written, never
 *   the message `getResponseBody` returns: `No data found for resource with given identifier`
 *   covers three states it does not separate.
 */
export type ResponseBodyState =
  | 'captured'
  | 'truncated'
  | 'evicted'
  | 'unavailable'
  | 'filtered'
  | 'out-of-session'
  | 'unfinished';

/** The state a layer with no access to bodies produces. Named because every such entry carries it. */
export const RESPONSE_BODY_UNAVAILABLE: ResponseBodyState = 'unavailable';

/** How a request ended, from the observer's point of view. */
export type NetworkOutcome = 'completed' | 'failed' | 'pending';

export interface NetworkEntry extends EntryBase {
  kind: 'network';
  /**
   * Request id of the layer that produced the entry, good for that layer alone: the two layers
   * number the same request with independent generators, so an id never carries across. The CDP
   * form `<renderer process id>.<counter>` is unique inside one renderer process, for the lifetime
   * of the session, and no further.
   */
  requestId: string;
  /** The layer that produced the entry. See {@link EntryProvenance}. */
  provenance: EntryProvenance;
  method: string;
  url: string;
  /** `chrome.webRequest.ResourceType` — kept as a string, the enum is not worth importing. */
  resourceType?: string;
  outcome: NetworkOutcome;
  statusCode?: number;
  /** Milliseconds between the first and the last observed event of the request. */
  durationMs?: number;
  requestHeaders?: HttpHeader[];
  responseHeaders?: HttpHeader[];
  /** Serialized request body when `requestBody` yielded one. Streams never do. */
  requestBody?: string;
  /** Why a body is here, or why it is not. See {@link ResponseBodyState}. */
  responseBody: ResponseBodyState;
  /** The body itself, on the two states that carry one. Absent on every other. */
  responseBodyText?: string;
  /** Failure cause of `onErrorOccurred`, present only when `outcome` is `failed`. */
  error?: string;
}

/** The `console.*` methods the capture layer replaces. Nothing else is intercepted. */
export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleEntry extends EntryBase {
  kind: 'console';
  level: ConsoleLevel;
  /** Arguments already serialized to text in the page, never structured clones. */
  text: string;
  /** Set when serialization dropped anything. A truncation is marked, never silent. */
  truncated: boolean;
}

/** Where an uncaught failure surfaced. */
export type ErrorSource = 'uncaught' | 'unhandledrejection';

export interface ErrorEntry extends EntryBase {
  kind: 'error';
  source: ErrorSource;
  message: string;
  stack?: string;
  truncated: boolean;
}

export type CaptureEntry = NetworkEntry | ConsoleEntry | ErrorEntry;

const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
const ERROR_SOURCES: readonly ErrorSource[] = ['uncaught', 'unhandledrejection'];
const NETWORK_OUTCOMES: readonly NetworkOutcome[] = ['completed', 'failed', 'pending'];
const ENTRY_PROVENANCES: readonly EntryProvenance[] = ['webRequest', 'cdp'];
const RESPONSE_BODY_STATES: readonly ResponseBodyState[] = [
  'captured',
  'truncated',
  'evicted',
  'unavailable',
  'filtered',
  'out-of-session',
  'unfinished',
];

/** The only two states a body text may sit next to. Every other one is an absence. */
const RESPONSE_BODY_STATES_WITH_TEXT: readonly ResponseBodyState[] = ['captured', 'truncated'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptional(value: unknown, check: (candidate: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isHeaderList(value: unknown): value is HttpHeader[] {
  return (
    Array.isArray(value) &&
    value.every(
      (header) =>
        isRecord(header) && typeof header.name === 'string' && typeof header.value === 'string',
    )
  );
}

/**
 * A body text is only valid where a body exists. Sitting next to a state that denies one, it would
 * contradict its own entry, and a reader would have no way to tell which of the two is lying.
 */
function isResponseBody(state: unknown, text: unknown): boolean {
  if (!RESPONSE_BODY_STATES.includes(state as ResponseBodyState)) return false;
  if (!isOptional(text, (candidate) => typeof candidate === 'string')) return false;
  return text === undefined || RESPONSE_BODY_STATES_WITH_TEXT.includes(state as ResponseBodyState);
}

function hasEntryBase(value: unknown): value is Record<string, unknown> & EntryBase {
  return (
    isRecord(value) &&
    isFiniteNumber(value.timestamp) &&
    isFiniteNumber(value.tabId) &&
    isNonEmptyString(value.domain)
  );
}

/**
 * Type guards validate the whole shape, not just the discriminant. They run on data that
 * crossed a `postMessage` boundary or came back out of IndexedDB written by an older
 * schema version — in both cases the compiler guarantees nothing.
 */
export function isNetworkEntry(value: unknown): value is NetworkEntry {
  if (!hasEntryBase(value) || value.kind !== 'network') return false;
  return (
    isNonEmptyString(value.requestId) &&
    isNonEmptyString(value.method) &&
    isNonEmptyString(value.url) &&
    ENTRY_PROVENANCES.includes(value.provenance as EntryProvenance) &&
    NETWORK_OUTCOMES.includes(value.outcome as NetworkOutcome) &&
    isResponseBody(value.responseBody, value.responseBodyText) &&
    isOptional(value.resourceType, (candidate) => typeof candidate === 'string') &&
    isOptional(value.statusCode, isFiniteNumber) &&
    isOptional(value.durationMs, isFiniteNumber) &&
    isOptional(value.requestHeaders, isHeaderList) &&
    isOptional(value.responseHeaders, isHeaderList) &&
    isOptional(value.requestBody, (candidate) => typeof candidate === 'string') &&
    isOptional(value.error, (candidate) => typeof candidate === 'string')
  );
}

export function isConsoleEntry(value: unknown): value is ConsoleEntry {
  if (!hasEntryBase(value) || value.kind !== 'console') return false;
  return (
    CONSOLE_LEVELS.includes(value.level as ConsoleLevel) &&
    typeof value.text === 'string' &&
    typeof value.truncated === 'boolean'
  );
}

export function isErrorEntry(value: unknown): value is ErrorEntry {
  if (!hasEntryBase(value) || value.kind !== 'error') return false;
  return (
    ERROR_SOURCES.includes(value.source as ErrorSource) &&
    typeof value.message === 'string' &&
    typeof value.truncated === 'boolean' &&
    isOptional(value.stack, (candidate) => typeof candidate === 'string')
  );
}

export function isCaptureEntry(value: unknown): value is CaptureEntry {
  return isNetworkEntry(value) || isConsoleEntry(value) || isErrorEntry(value);
}
