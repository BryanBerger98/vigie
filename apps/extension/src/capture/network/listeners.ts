import { sweepCdpRecords } from '@/capture/cdp/events';
import { decideOwner, sessionWindows } from '@/capture/cdp/ownership';
import { captureEntry, flush } from '@/storage/write';

import {
  PENDING_TIMEOUT_MS,
  RequestAssembler,
  type AssembledEntry,
  type BeforeRequestDetails,
  type CompletedDetails,
  type ErrorDetails,
  type SendHeadersDetails,
} from './assemble';
import { registerOnce, unregister, type CaptureBinding } from './listener-lifecycle';
import { WriteQueue } from './queue';

/**
 * The network capture: four `webRequest` listeners feeding one assembler feeding the write path.
 *
 * ## Why these `extraInfoSpec` values
 *
 * `requestBody` on `onBeforeRequest` is the only way to see what was sent, and `extraHeaders` on
 * the header events is the only way to see `Cookie` and `Set-Cookie` — Chrome strips them from
 * the ordinary listener. Chrome's own documentation warns that `extraHeaders` costs performance;
 * a debugging capture without authentication headers is worth much less, so the cost is taken.
 *
 * ## Why registration stays top-level
 *
 * These `addListener` calls are what makes Chrome restart a terminated service worker on the next
 * matching request. Registering them inside a promise callback would mean the worker only
 * captures while it happens to be awake, which is the failure phase 2 measured against.
 */

/** Web traffic only. An extension always sees requests for its own `chrome-extension://` pages. */
const WEB_TRAFFIC = { urls: ['http://*/*', 'https://*/*'] };

export const assembler = new RequestAssembler();

/**
 * The hold an attached tab's requests go through. Everything else writes straight away — a tab with
 * no session has nothing to wait for, and the delay would be latency bought for nothing.
 */
const deferredWrites = new WriteQueue<AssembledEntry>(resolveWrite);

/**
 * Hands a finished request to the write path.
 *
 * The four listeners above are untouched by the deep layer: `webRequest` keeps observing every
 * request of every tab, attached or not, and keeps an in-memory record for each. What the deep
 * layer changes is downstream of here — which of the two records is written, decided per request at
 * this moment rather than per tab at the instant a session opened.
 */
function store(entry: AssembledEntry | null): void {
  if (!entry) return;
  if (!sessionWindows.isLive(entry.draft.tabId)) {
    resolveWrite(entry);
    return;
  }
  deferredWrites.defer(entry);
}

/**
 * Empties the hold, now, under the windows as they currently stand.
 *
 * Called by the flush, and — this is the load-bearing one — before any session window moves. A held
 * entry is decided at the instant it resolves, so a window that closed while it waited would hand
 * back a request the deep layer had already concluded and written. Measured on a stop clicked
 * inside the hold: one navigation, two entries, `cdp` and `out-of-session`. Draining first is what
 * makes every held entry answer for the session that was live when its request ended.
 *
 * The two layers share no request id, so the race between them cannot be resolved exactly and the
 * error has to be pointed somewhere. It is pointed here: a request that ended in the last ~50 ms
 * before a session closes is handed to a deep layer that may be detached before it announces its own
 * conclusion, and then nobody writes it. That loses at most the hold's own duration of traffic at
 * each stop, and never writes the same request twice — which is the asymmetry a report can live with.
 */
export function drainDeferredWrites(): void {
  deferredWrites.drain();
}

/**
 * Writes the `webRequest` entry, unless the deep layer owns the request.
 *
 * Nothing is merged and nothing is looked up: when CDP owns the request it has written, or will
 * write, its own entry from its own record. This side simply stands down.
 */
function resolveWrite(entry: AssembledEntry): void {
  const { draft, url } = entry;
  if (draft.kind !== 'network') {
    captureEntry(draft, url);
    return;
  }

  // The assembler does not carry the opening moment out, so it is read back from the entry. A
  // request written by the sweep has no duration and is exactly the timeout old, by construction.
  const startedAt = draft.timestamp - (draft.durationMs ?? PENDING_TIMEOUT_MS);
  const verdict = decideOwner({
    tabId: draft.tabId,
    startedAt,
    window: sessionWindows.of(draft.tabId),
  });
  if (verdict.owner === 'cdp') return;

  // A request that straddles a session boundary says so: its body was never reachable by either
  // layer, which is not the same absence as a tab the deep layer never covered.
  captureEntry(verdict.boundary ? { ...draft, responseBody: 'out-of-session' } : draft, url);
}

function onBeforeRequest(details: BeforeRequestDetails): void {
  assembler.begin(details);
}

function onSendHeaders(details: SendHeadersDetails): void {
  assembler.headers(details);
}

function onCompleted(details: CompletedDetails): void {
  store(assembler.complete(details));
}

function onErrorOccurred(details: ErrorDetails): void {
  store(assembler.fail(details));
}

/**
 * `webRequest` listeners are typed against Chrome's own detail shapes, which carry far more than
 * this module reads. The narrow interfaces in `assemble.ts` are structurally compatible with them;
 * this is where that is asserted, once, rather than at each of the four call sites.
 */
type ChromeListener = (details: never) => void;

const events = () => browser.webRequest;

export const networkCapture: CaptureBinding = {
  apply: () => {
    const { onBeforeRequest: before, onSendHeaders: sending, onCompleted: done, onErrorOccurred: failed } = events();

    registerOnce(before, onBeforeRequest as ChromeListener, WEB_TRAFFIC, ['requestBody']);
    registerOnce(sending, onSendHeaders as ChromeListener, WEB_TRAFFIC, ['requestHeaders', 'extraHeaders']);
    registerOnce(done, onCompleted as ChromeListener, WEB_TRAFFIC, ['responseHeaders', 'extraHeaders']);
    registerOnce(failed, onErrorOccurred as ChromeListener, WEB_TRAFFIC);
  },

  remove: () => {
    const { onBeforeRequest: before, onSendHeaders: sending, onCompleted: done, onErrorOccurred: failed } = events();

    unregister(before, onBeforeRequest as ChromeListener);
    unregister(sending, onSendHeaders as ChromeListener);
    unregister(done, onCompleted as ChromeListener);
    unregister(failed, onErrorOccurred as ChromeListener);
  },
};

/**
 * Writes what is queued, after handing over the requests that have been open too long.
 *
 * The sweeps run here rather than on their own schedule so a stalled request follows the same
 * cadence as a finished one — and so nothing depends on a timer the worker may not live to fire.
 *
 * The order is the whole point. The `webRequest` sweep feeds the hold, the hold is emptied, the
 * deep layer's own sweep writes what it still held, and only then is the batch sent. An export
 * fired the instant traffic stops goes through this same path, so it cannot come back missing the
 * last 50 ms of it.
 */
export async function flushNetworkCapture(now = Date.now()): Promise<void> {
  for (const entry of assembler.sweep(now)) {
    store(entry);
  }
  drainDeferredWrites();
  await sweepCdpRecords(now);
  sessionWindows.sweep(now, PENDING_TIMEOUT_MS);
  await flush(now);
}
