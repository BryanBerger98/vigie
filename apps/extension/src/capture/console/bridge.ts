import type { ConsoleLevel, ErrorSource } from '@vigie/contract';

/**
 * The protocol between the page's main world and the extension, over two hops.
 *
 * ```txt
 * MAIN world  --window.postMessage-->  ISOLATED content script  --runtime.sendMessage-->  worker
 * ```
 *
 * Each hop needs its own guard, for opposite reasons.
 *
 * - **`postMessage` is shared with the page.** Every script on the page hears every message, and
 *   any of them can send one that looks like ours. So the listener checks the sender window and
 *   the marker, then validates the shape — a payload that reached the store unvalidated would be
 *   the page writing whatever it likes into the user's report.
 * - **`runtime.sendMessage` is trusted but unreliable.** Only our own content script can send on
 *   it, yet the service worker may be asleep, mid-restart, or gone after an extension reload. The
 *   sender has to survive a rejection rather than let it surface as a page error.
 *
 * The payload is text by the time it gets here: `serialize.ts` flattened the arguments in the
 * page, so neither hop ever carries a structured clone of a page object.
 */

/** Marks a `window.postMessage` as ours. Namespaced: the page's own messages are on the same bus. */
export const BRIDGE_MARKER = 'vigie:page-capture';

/** Marks a `runtime.sendMessage` as a relayed page event, next to `vigie:flush`. */
export const RELAY_MESSAGE = 'vigie:page-capture-entry';

export interface ConsolePayload {
  kind: 'console';
  level: ConsoleLevel;
  text: string;
  truncated: boolean;
  /** Stamped in the page, at the call. The worker would stamp it a round trip later. */
  at: number;
}

export interface ErrorPayload {
  kind: 'error';
  source: ErrorSource;
  message: string;
  stack?: string;
  truncated: boolean;
  at: number;
}

export type CapturePayload = ConsolePayload | ErrorPayload;

export interface BridgeMessage {
  marker: typeof BRIDGE_MARKER;
  payload: CapturePayload;
}

export interface RelayMessage {
  type: typeof RELAY_MESSAGE;
  payload: CapturePayload;
}

export function bridgeMessage(payload: CapturePayload): BridgeMessage {
  return { marker: BRIDGE_MARKER, payload };
}

export function relayMessage(payload: CapturePayload): RelayMessage {
  return { type: RELAY_MESSAGE, payload };
}

const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
const ERROR_SOURCES: readonly ErrorSource[] = ['uncaught', 'unhandledrejection'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether a value is a payload this extension produced.
 *
 * Every field is checked, not just the discriminant. The page can post `{marker, payload}` with
 * anything inside it, and the write path downstream trusts what it is handed.
 */
export function isCapturePayload(value: unknown): value is CapturePayload {
  if (!isRecord(value)) return false;
  if (typeof value.truncated !== 'boolean') return false;
  if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return false;

  if (value.kind === 'console') {
    return CONSOLE_LEVELS.includes(value.level as ConsoleLevel) && typeof value.text === 'string';
  }

  if (value.kind === 'error') {
    return (
      ERROR_SOURCES.includes(value.source as ErrorSource) &&
      typeof value.message === 'string' &&
      (value.stack === undefined || typeof value.stack === 'string')
    );
  }

  return false;
}

/** The payload of a `postMessage` that is ours, or `null` for everything else on the bus. */
export function readBridgeMessage(data: unknown): CapturePayload | null {
  if (!isRecord(data) || data.marker !== BRIDGE_MARKER) return null;
  return isCapturePayload(data.payload) ? data.payload : null;
}

export function isRelayMessage(value: unknown): value is RelayMessage {
  return isRecord(value) && value.type === RELAY_MESSAGE && isCapturePayload(value.payload);
}
