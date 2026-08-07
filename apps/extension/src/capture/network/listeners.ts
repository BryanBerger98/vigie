import { captureEntry, flush } from '@/storage/write';

import {
  RequestAssembler,
  type BeforeRequestDetails,
  type CompletedDetails,
  type ErrorDetails,
  type SendHeadersDetails,
} from './assemble';
import { registerOnce, unregister, type CaptureBinding } from './listener-lifecycle';

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

/** Hands a finished request to the write path, which decides whether it is in scope. */
function store(entry: { draft: Parameters<typeof captureEntry>[0]; url: string } | null): void {
  if (!entry) return;
  captureEntry(entry.draft, entry.url);
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
 * The sweep runs here rather than on its own schedule so a stalled request follows the same
 * cadence as a finished one — and so nothing depends on a timer the worker may not live to fire.
 */
export async function flushNetworkCapture(now = Date.now()): Promise<void> {
  for (const entry of assembler.sweep(now)) {
    store(entry);
  }
  await flush(now);
}
