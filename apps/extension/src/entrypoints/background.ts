import { SCHEMA_VERSION } from '@vigie/contract';

import {
  EMPTY_MEASUREMENT_STATE,
  MEASUREMENT_STATE_KEY,
  followHostPermissions,
  registerOnce,
  unregister,
  type CaptureBinding,
  type MeasurementState,
} from '@/capture/network/listener-lifecycle';
import { isRelayMessage } from '@/capture/console/bridge';
import { applyConsoleCaptureScope } from '@/capture/console/registration';
import { storeRelayedCapture } from '@/capture/console/store';
import { eraseCapturedDataFor } from '@/capture/erase-domain-data';
import { flushNetworkCapture, networkCapture } from '@/capture/network/listeners';
import { isWatchedUrl } from '@/storage/scope';
import { onWatchedDomainsChanged, readWatchedDomains } from '@/storage/watched-domains';
import { FLUSH_MESSAGE, setCaptureScope } from '@/storage/write';

/**
 * Service worker. Orchestration only: it owns the scope and hands every capture layer its turn.
 *
 * MV3 terminates it after roughly 30 seconds idle and drops every global, so nothing durable
 * may live in this module scope. Listener registration has to stay top-level: it is what makes
 * the browser wake the worker back up.
 *
 * Two things run side by side here. The capture — `webRequest` into the store, and the page
 * events the content script relays — and the phase 2 measurement probe, which counts events and
 * permission changes into `storage.session`. The probe is not capture; it is what the popup reads
 * today and what the end-to-end suite asserts on, and phase 8 retires it with the popup.
 *
 * The phase 6 storage figures are not a third counter: they are read straight off the store by
 * whoever asks (`storage/metrics.ts`). The worker's only part in them is `FLUSH_MESSAGE`, which
 * hands over what is still queued so a reading is taken on the whole capture and not on the
 * capture minus one batch.
 */

// Web traffic only: an extension always sees requests for its own `chrome-extension://` resources,
// with or without host access, and counting those would drown the signal being measured.
const WEB_TRAFFIC = { urls: ['http://*/*', 'https://*/*'] };

/**
 * Storage writes are serialised behind one chain. `webRequest` events arrive faster than a
 * read-modify-write round trip completes, and two concurrent reads of the same counter would
 * both write the same value — undercounting exactly the thing being measured.
 */
let writes: Promise<void> = Promise.resolve();

function record(change: (state: MeasurementState) => MeasurementState): void {
  writes = writes
    .then(async () => {
      const stored = await browser.storage.session.get(MEASUREMENT_STATE_KEY);
      const current = (stored[MEASUREMENT_STATE_KEY] as MeasurementState | undefined) ?? EMPTY_MEASUREMENT_STATE;
      await browser.storage.session.set({ [MEASUREMENT_STATE_KEY]: change(current) });
    })
    .catch((error: unknown) => {
      console.error('[vigie] could not record the measurement state', error);
    });
}

/**
 * The watched domains, held in module scope because `webRequest.onCompleted` is synchronous and
 * cannot await a storage read. MV3 wipes this on every worker stop, so it is reloaded at each
 * start and kept current by the subscription below.
 *
 * The window between a worker start and that first read landing is real: requests arriving in it
 * are counted as delivered but not as watched. It costs nothing here — this is a counter — and
 * phase 4 has to answer it properly, since the same window would silently drop captured data.
 */
let watchedDomains: string[] = [];

function countCompletedRequest(details: { url: string }): void {
  const watched = isWatchedUrl(details.url, watchedDomains);
  record((state) => ({
    ...state,
    networkEvents: state.networkEvents + 1,
    watchedEvents: state.watchedEvents + (watched ? 1 : 0),
    lastEvent: { url: details.url, at: Date.now() },
  }));
}

/**
 * The registration under measurement. `apply` is called at every worker start and again at every
 * permission change; `registerOnce` is what keeps that from stacking listeners.
 */
const networkProbe: CaptureBinding = {
  apply: () => {
    registerOnce(browser.webRequest.onCompleted, countCompletedRequest, WEB_TRAFFIC);
  },
  remove: () => {
    unregister(browser.webRequest.onCompleted, countCompletedRequest);
  },
};

export default defineBackground(() => {
  console.info('[vigie] service worker started, contract schema v%d', SCHEMA_VERSION);

  record((state) => ({
    ...state,
    workerStarts: state.workerStarts + 1,
    workerStartedAt: Date.now(),
  }));

  networkProbe.apply();
  networkCapture.apply();

  // Both halves of the scope, followed independently. The list decides what the extension writes
  // down; the permission decides what the browser hands it in the first place. A domain added
  // has to start capturing without a restart, so neither may be read once and cached for good.
  const applyScope = (domains: string[]) => {
    watchedDomains = domains;
    setCaptureScope(domains);
    // The console capture is a registration rather than a filter, so it has to be pushed to the
    // browser every time the list moves — including at a cold start, where nothing else would.
    void applyConsoleCaptureScope(domains);
    console.info('[vigie] watching %s', domains.join(', ') || '(nothing)');
  };

  void readWatchedDomains().then(applyScope);
  onWatchedDomainsChanged((domains) => {
    // The removal flow already erased what it dropped, from the page the user clicked in. This
    // erases it again, from the worker that owns the write queue, so an entry queued microseconds
    // before the removal cannot land behind it.
    const dropped = watchedDomains.filter((domain) => !domains.includes(domain));
    applyScope(domains);
    for (const domain of dropped) {
      void eraseCapturedDataFor(domain);
    }
    networkProbe.apply();
    networkCapture.apply();
  });

  followHostPermissions(browser.permissions, networkProbe, (change, permissions) => {
    const origins = (permissions as { origins?: string[] }).origins ?? [];
    console.info('[vigie] host permissions %s: %s', change, origins.join(', ') || '(none)');
    record((state) => ({
      ...state,
      permissionChanges: [...state.permissionChanges, { change, origins, at: Date.now() }],
    }));
    networkCapture.apply();
  });

  // A tab closing is the last chance to write what its requests produced; anything still batched
  // would otherwise wait for traffic that will never come. The surfaces that read the store ask
  // for the same flush through `vigie:flush`, so a report never omits the last few requests.
  browser.tabs.onRemoved.addListener(() => void flushNetworkCapture());
  // `sendResponse` and `return true`, not a returned promise: Chrome only supports the callback
  // form, and a promise here would answer `undefined` before the batch had been written.
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message === FLUSH_MESSAGE) {
      void flushNetworkCapture().then(() => sendResponse(true));
      return true;
    }

    // A page event relayed by the content script. Answered synchronously — the content script
    // only awaits the acknowledgement to know the worker was awake, never the write itself.
    if (isRelayMessage(message)) {
      storeRelayedCapture(message.payload, sender);
      sendResponse(true);
      return false;
    }

    return false;
  });
});
