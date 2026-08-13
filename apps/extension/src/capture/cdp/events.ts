import { RESPONSE_BODY_UNAVAILABLE } from '@vigie/contract';

import { registerOnce, unregister } from '@/capture/network/listener-lifecycle';
import type {
  NetworkDataReceivedParams,
  NetworkGetResponseBodyParams,
  NetworkGetResponseBodyResult,
  NetworkLoadingFailedParams,
  NetworkLoadingFinishedParams,
  NetworkRequestWillBeSentExtraInfoParams,
  NetworkRequestWillBeSentParams,
  NetworkResponseReceivedParams,
  TabDebuggee,
} from '@/shared/chrome-apis';
import { captureEntry } from '@/storage/write';

import { capturedBody, failedBodyRead, planBodyRead, type BodyContext, type BodyOutcome } from './body';
import { CdpRecordStore, type CdpRecordEntry } from './records';
import { updateCdpSessionState, withRequestAnnounced, withRequestConcluded } from './session-state';

/**
 * The `Network` domain, listened to on every attached tab at once.
 *
 * `chrome.debugger.onEvent` is one listener for the whole extension: every session of every tab
 * arrives through it, tagged with its debuggee. So there is nothing to register per tab — the
 * subscription follows the layer, not the session, and it is taken down when the last session goes.
 *
 * ## What is ignored, and why that is the rule rather than an error
 *
 * A request already in flight when a session attaches delivers `responseReceived`, `dataReceived`
 * and `loadingFinished` with no `requestWillBeSent` in front — sometimes with no URL anywhere in
 * the payload — and `getResponseBody` refuses every one of them with `No resource with given
 * identifier found`. Those are not failures to report; they are the other layer's requests passing
 * through this one's window. {@link CdpRecordStore} answers `null` for all of them and this module
 * writes nothing.
 *
 * ## The in-flight map
 *
 * Every announcement is written to the session state and struck from it at the conclusion. That map
 * is not what decides ownership — module memory does, and it is faster — it is what a worker that
 * comes back from its own death reads to know which requests it was in the middle of. Phase 6 is
 * its only reader. One `storage.session` write per request event is the price; the area is
 * memory-backed and its writes are serialised behind one chain, so the cost is a queue depth rather
 * than a disk.
 */

/** The requests the deep layer announced. Read by the write path, swept by the flush. */
export const cdpRecords = new CdpRecordStore();

/** Whether the protocol events are currently subscribed. Kept so the teardown is idempotent. */
let following = false;

/**
 * Subscribes to the protocol. Safe to call at every reconciliation: `registerOnce` replaces its own
 * registration rather than stacking a second one on a worker that woke up.
 */
export function followCdpNetworkEvents(): void {
  if (!browser.debugger) return;
  registerOnce(browser.debugger.onEvent, onCdpEvent);
  following = true;
}

/**
 * Unsubscribes. Called when the last session goes, whatever ended it — the events stop arriving on
 * their own at that point, and the registration is what would otherwise outlive the layer.
 */
export function unfollowCdpNetworkEvents(): void {
  if (!following || !browser.debugger) return;
  unregister(browser.debugger.onEvent, onCdpEvent);
  following = false;
}

/**
 * Writes and releases the records left open too long, then strikes them from the in-flight map.
 *
 * Called from the network flush, next to the `webRequest` sweep and on the same delay, so one
 * endless stream cannot hold two layers' worth of memory on two different schedules.
 */
export async function sweepCdpRecords(now: number): Promise<void> {
  await writeAll(cdpRecords.sweep(now));
}

/**
 * A tab lost its session. Its records go without being written: their requests return to
 * `webRequest`, which still holds them and will close them on its own terminal event.
 */
export function releaseCdpTab(tabId: number): Promise<unknown> {
  return forget(cdpRecords.releaseTab(tabId));
}

/** The layer stopped. Same handback, every tab at once, and the subscription goes with it. */
export function clearCdpRecords(): Promise<unknown> {
  const dropped = cdpRecords.clear();
  unfollowCdpNetworkEvents();
  return forget(dropped);
}

/** Module scope so `registerOnce` has the same function to recognise at every re-application. */
function onCdpEvent(source: { tabId?: number }, method: string, params?: object): void {
  const tabId = source.tabId;
  if (tabId === undefined || params === undefined) return;

  switch (method) {
    case 'Network.requestWillBeSent': {
      const announced = cdpRecords.announce(
        tabId,
        params as NetworkRequestWillBeSentParams,
        Date.now(),
      );
      if (announced === null) return;
      void updateCdpSessionState((state) =>
        withRequestAnnounced(state, (params as NetworkRequestWillBeSentParams).requestId, announced),
      );
      return;
    }

    case 'Network.requestWillBeSentExtraInfo':
      cdpRecords.requestHeaders(tabId, params as NetworkRequestWillBeSentExtraInfoParams);
      return;

    case 'Network.responseReceived':
      cdpRecords.response(tabId, params as NetworkResponseReceivedParams);
      return;

    case 'Network.dataReceived':
      cdpRecords.data(tabId, params as NetworkDataReceivedParams);
      return;

    case 'Network.loadingFinished':
      void concludeLoaded(tabId, params as NetworkLoadingFinishedParams);
      return;

    case 'Network.loadingFailed':
      void writeOne(cdpRecords.fail(tabId, params as NetworkLoadingFailedParams));
      return;

    default:
      return;
  }
}

/**
 * Reads the body, then closes the record — in that order, and with nothing between them.
 *
 * The read is made here, inside the handler, rather than queued anywhere. A body only exists in the
 * renderer's inspector buffer, and that buffer belongs to the page: a navigation drops it, and the
 * request comes back `No resource with given identifier found`. Deferring the call by even one turn
 * of an event loop would trade a body for nothing — there is no delay that improves the answer,
 * since a request that never concludes never delivers one at any delay, measured to ten seconds
 * across 3 053 requests.
 *
 * The `await` opens the only window in which a record can disappear under its own conclusion: a
 * detach, a stop, or the 30 s sweep landing mid-read. All three end with `finish` answering `null`
 * and nothing being written, which is the handback rule — `webRequest` still holds that request and
 * closes it itself.
 *
 * @see aidd_docs/backlog/spikes/cdp-body-read-timing.md
 */
async function concludeLoaded(tabId: number, params: NetworkLoadingFinishedParams): Promise<unknown> {
  const context = cdpRecords.bodyContext(tabId, params.requestId);
  if (context) {
    cdpRecords.body(tabId, params.requestId, await readResponseBody(tabId, params.requestId, context));
  }
  return writeOne(cdpRecords.finish(tabId, params));
}

/**
 * Asks the protocol for one body, or decides not to ask.
 *
 * Every path answers with a state, and no path throws: a body that could not be read is a field of
 * the entry, never a reason to lose the entry. The three refusals the protocol has are read in
 * `body.ts`, next to the measurements that say what each one means.
 *
 * `base64Encoded` is the browser's own verdict on a body it will not hand over as text, and it is
 * the last of the filter rather than an error — a response with no declared media type passes the
 * check upstream precisely so that this one can settle it.
 */
async function readResponseBody(
  tabId: number,
  requestId: string,
  context: BodyContext,
): Promise<BodyOutcome> {
  const plan = planBodyRead(context);
  if (!plan.read) return plan.outcome;

  const target: TabDebuggee = { tabId };
  const command: NetworkGetResponseBodyParams = { requestId };
  try {
    const result = (await browser.debugger.sendCommand(target, 'Network.getResponseBody', command)) as
      | NetworkGetResponseBodyResult
      | undefined;
    if (!result) return { state: RESPONSE_BODY_UNAVAILABLE };
    if (result.base64Encoded) return { state: 'filtered' };
    return capturedBody(result.body);
  } catch (error) {
    return failedBodyRead(error instanceof Error ? error.message : String(error), context.receivedBytes);
  }
}

/**
 * Hands one concluded record to the write path.
 *
 * The entry is written here, at the request's own conclusion, rather than on the `webRequest`
 * trigger that suppressed the other layer's version: the two layers name the same request
 * differently and nothing pairs them, so each writes what it owns and the ownership rule is what
 * guarantees the count.
 */
function writeOne(entry: CdpRecordEntry | null): Promise<unknown> {
  if (!entry) return Promise.resolve();
  return writeAll([entry]);
}

function writeAll(entries: CdpRecordEntry[]): Promise<unknown> {
  for (const entry of entries) captureEntry(entry.draft, entry.url);
  return forget(entries.map((entry) => entry.requestId));
}

function forget(requestIds: string[]): Promise<unknown> {
  if (requestIds.length === 0) return Promise.resolve();
  return updateCdpSessionState((state) =>
    requestIds.reduce((next, requestId) => withRequestConcluded(next, requestId), state),
  );
}
