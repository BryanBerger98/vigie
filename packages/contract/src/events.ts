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
 * `webRequest` never exposes a response body, whatever the observer does. The report states
 * the absence rather than omitting it, so a reader can tell "no body" from "body was empty".
 */
export type ResponseBodyState = 'unavailable';

export const RESPONSE_BODY_UNAVAILABLE: ResponseBodyState = 'unavailable';

/** How a request ended, from the observer's point of view. */
export type NetworkOutcome = 'completed' | 'failed' | 'pending';

export interface NetworkEntry extends EntryBase {
  kind: 'network';
  /** `chrome.webRequest` request id, the key the separate events are reassembled on. */
  requestId: string;
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
  /** Always `unavailable` in this version. See {@link ResponseBodyState}. */
  responseBody: ResponseBodyState;
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
    NETWORK_OUTCOMES.includes(value.outcome as NetworkOutcome) &&
    value.responseBody === RESPONSE_BODY_UNAVAILABLE &&
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
