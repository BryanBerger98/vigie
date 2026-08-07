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
import { isWatchedUrl } from '@/storage/scope';
import { onWatchedDomainsChanged, readWatchedDomains } from '@/storage/watched-domains';

/**
 * Service worker. Orchestration only — capture layers register here from phase 4 onward.
 *
 * MV3 terminates it after roughly 30 seconds idle and drops every global, so nothing durable
 * may live in this module scope. Listener registration has to stay top-level: it is what makes
 * the browser wake the worker back up.
 *
 * What runs here now is phase 2 measurement, not capture. It counts `webRequest` events on every
 * URL and records every host-permission change, so the answer to "does a runtime grant start
 * delivering events" comes from a reading rather than an inference. Phase 4 replaces it.
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

  // Both halves of the scope, followed independently. The list decides what the extension writes
  // down; the permission decides what the browser hands it in the first place. A domain added
  // has to start capturing without a restart, so neither may be read once and cached for good.
  const reloadWatchedDomains = async () => {
    watchedDomains = await readWatchedDomains();
    console.info('[vigie] watching %s', watchedDomains.join(', ') || '(nothing)');
  };

  void reloadWatchedDomains();
  onWatchedDomainsChanged((domains) => {
    watchedDomains = domains;
    console.info('[vigie] watching %s', domains.join(', ') || '(nothing)');
    networkProbe.apply();
  });

  followHostPermissions(browser.permissions, networkProbe, (change, permissions) => {
    const origins = (permissions as { origins?: string[] }).origins ?? [];
    console.info('[vigie] host permissions %s: %s', change, origins.join(', ') || '(none)');
    record((state) => ({
      ...state,
      permissionChanges: [...state.permissionChanges, { change, origins, at: Date.now() }],
    }));
  });
});
