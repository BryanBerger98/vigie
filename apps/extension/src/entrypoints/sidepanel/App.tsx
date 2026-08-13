import { takeCaptureInterrupted } from '@/capture/cdp/session-state';
import { ConsentRequired } from '@/consent/ConsentRequired';
import {
  isCapturePermitted,
  onConsentChanged,
  readConsent,
  type ConsentState,
} from '@/consent/state';
import { InterruptionNotice } from '@/entrypoints/popup/InterruptionNotice';
import { ScopeStatus } from '@/entrypoints/popup/ScopeStatus';
import { TabContextLine } from '@/entrypoints/popup/TabContextLine';
import {
  MS_PER_MINUTE,
  interruptionNotice,
  isShrunk,
  scopeStatus,
  tabContextLine,
  type PopupFacts,
  type SubjectTab,
} from '@/entrypoints/popup/state';
import { resolveSubjectTab } from '@/entrypoints/popup/subject-tab';
import { observeTabWindow, type TabWindow } from '@/storage/live-query';
import {
  EMPTY_STORAGE_STATE,
  RETENTION_MS,
  STORAGE_STATE_KEY,
  readStorageState,
  type StorageState,
} from '@/storage/prune';
import { watchedDomainFor } from '@/storage/scope';
import {
  hasHostAccess,
  onWatchedDomainsChanged,
  readWatchedDomains,
} from '@/storage/watched-domains';

import { Timeline } from './Timeline';

/**
 * The side panel: what the capture is holding, while it is being held.
 *
 * It is the answer to the one question no other surface answers before it is too late — is this
 * actually being recorded. The popup states the scope, the report states the past; only this
 * surface lets someone watch the thread fill as they reproduce the bug (`navigation.md:33`).
 *
 * ## Read-only, literally
 *
 * Nothing here writes. Not the store, not `chrome.storage`, not a read marker on an entry. That is
 * why the popup's flush is absent from this file even though it would make the thread a quarter of
 * a second fresher: a flush appends the pending batch and then prunes (`storage/write.ts:73`), so a
 * panel that flushed would be deleting the oldest entries of the very window it is displaying —
 * and would do it on a schedule set by how often someone happens to look at it.
 *
 * ## It follows the tab, it does not own one
 *
 * Chrome's side panel outlives navigations and tab switches, so the subject is re-resolved on every
 * signal that could have changed it rather than captured on mount. `subject-tab.ts` is the popup's
 * resolver, unchanged: the two surfaces must never disagree about which tab they are talking about.
 *
 * The three scope states are the popup's too, rendered by the popup's own component
 * (`phase-10.md:109`). Out of scope, the thread is not rendered at all — an empty thread and an
 * unwatched domain look identical, and the difference is the whole product.
 */

/** What the surface knows about the tab it is reading, before the store is consulted. */
interface Scope {
  subject: SubjectTab | null;
  watchedDomain: string | null;
  hostAccess: boolean;
  readAt: number;
}

async function readScope(): Promise<Scope> {
  const readAt = Date.now();
  const [subject, domains] = await Promise.all([resolveSubjectTab(), readWatchedDomains()]);
  const watchedDomain = subject ? watchedDomainFor(subject.url, domains) : null;
  const hostAccess = watchedDomain === null ? false : await hasHostAccess(watchedDomain);

  return { subject, watchedDomain, hostAccess, readAt };
}

/**
 * The out-of-scope exit, handed to the settings exactly as the popup hands it over.
 *
 * The panel would survive a permission prompt where the popup does not, so it could ask here. It
 * does not: the whole validate-ask-store sequence lives in one place, and a second copy of it is a
 * second thing to keep in step with what the browser granted (`popup/App.tsx:241`).
 */
function watchDomainFromPanel(domain: string): void {
  void browser.tabs.create({
    url: browser.runtime.getURL(`/options.html?domain=${encodeURIComponent(domain)}`),
  });
}

export default function App() {
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [storage, setStorage] = useState<StorageState>(EMPTY_STORAGE_STATE);
  const [thread, setThread] = useState<TabWindow | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const noticeTaken = useRef(false);

  // Answered in another tab, so the panel follows it rather than reading it once.
  useEffect(() => {
    void readConsent().then(setConsent);
    return onConsentChanged(setConsent);
  }, []);

  // The interruption mark, read once and consumed by the reading. Same rule and same reasons as the
  // popup, which `popup/App.tsx:155` carries: gated on the agreement because reading clears it, and
  // guarded by a ref because `React.StrictMode` mounts every effect twice. Whichever of the two
  // surfaces opens first is the one that shows the notice; both word it with the same component.
  useEffect(() => {
    if (consent === null || !isCapturePermitted(consent)) return;
    if (noticeTaken.current) return;

    noticeTaken.current = true;
    void takeCaptureInterrupted().then(setInterrupted);
  }, [consent]);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      void readScope().then((next) => {
        if (!cancelled) setScope(next);
      });
    };

    refresh();

    // `onUpdated` fires for the favicon and for every step of a load. Only an address change and a
    // finished load can move the scope, and re-resolving on the rest would spend three API calls
    // per keystroke of a page that is merely noisy.
    const onTabUpdated = (_tabId: number, changed: { url?: string; status?: string }) => {
      if (changed.url !== undefined || changed.status === 'complete') refresh();
    };

    // The panel is not a tab and is never discarded, but a window it was opened over can be, and
    // coming back to it is the one signal that arrives without any of the events below.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    const unsubscribe = onWatchedDomainsChanged(refresh);
    browser.permissions.onAdded.addListener(refresh);
    browser.permissions.onRemoved.addListener(refresh);
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onRemoved.addListener(refresh);
    browser.tabs.onUpdated.addListener(onTabUpdated);
    browser.windows.onFocusChanged.addListener(refresh);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      unsubscribe();
      browser.permissions.onAdded.removeListener(refresh);
      browser.permissions.onRemoved.removeListener(refresh);
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onRemoved.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onTabUpdated);
      browser.windows.onFocusChanged.removeListener(refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // The readout the purge leaves behind, which is where a shortened window is declared. Read from
  // `chrome.storage` rather than measured here: measuring it would mean opening the store a second
  // time to answer a question the write path has already answered.
  useEffect(() => {
    let cancelled = false;

    const read = () => {
      void readStorageState().then((next) => {
        if (!cancelled) setStorage(next);
      });
    };

    read();

    const onChanged = (changes: Record<string, unknown>) => {
      if (STORAGE_STATE_KEY in changes) read();
    };
    browser.storage.local.onChanged.addListener(onChanged);

    return () => {
      cancelled = true;
      browser.storage.local.onChanged.removeListener(onChanged);
    };
  }, []);

  const tabId = scope?.subject?.tabId;

  // One subscription at a time, torn down and reopened when the subject changes. The thread is
  // cleared first: showing the previous tab's entries under the new tab's name is worse than a
  // blank, and it lasts exactly as long as one query.
  useEffect(() => {
    setThread(null);
    if (tabId === undefined) return;
    return observeTabWindow(tabId, setThread);
  }, [tabId]);

  const facts: PopupFacts | null =
    scope === null
      ? null
      : {
          subject: scope.subject,
          watchedDomain: scope.watchedDomain,
          hostAccess: scope.hostAccess,
          // Live, and exact: the thread is the tab's window, so its length is the count.
          tabEntryCount: thread?.entries.length ?? 0,
          coveredMinutes: Math.min(RETENTION_MS, storage.coveredMs) / MS_PER_MINUTE,
          shrunkAt: storage.shrunkAt,
          now: thread?.readAt ?? scope.readAt,
        };

  const status = facts ? scopeStatus(facts) : null;
  const notice = interruptionNotice(interrupted);
  // The two states in which something is being captured. In the other two the thread is absent
  // rather than empty, so the surface says why instead of showing nothing (`phase-10.md:132`).
  const readable = status !== null && (status.kind === 'capturing' || status.kind === 'degraded');

  if (consent !== null && !isCapturePermitted(consent)) {
    return (
      <main
        data-testid="sidepanel-root"
        className="flex h-screen flex-col gap-3 bg-background p-3 text-foreground"
      >
        <h1 className="text-sm font-semibold">Vigie</h1>
        <ConsentRequired state={consent} />
      </main>
    );
  }

  return (
    <main
      data-testid="sidepanel-root"
      className="flex h-screen flex-col gap-3 bg-background p-3 text-foreground"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-sm font-semibold">Vigie</h1>

        {/* Above the scope, as in the popup: it covers the whole capture window while everything
            under it covers this tab. */}
        {notice ? <InterruptionNotice notice={notice} /> : null}

        {status ? (
          <ScopeStatus status={status} onWatch={watchDomainFromPanel} />
        ) : (
          <p data-testid="scope-loading" className="text-xs text-muted-foreground">
            Reading the scope of this tab…
          </p>
        )}

        {readable && facts ? <TabContextLine text={tabContextLine(facts)} /> : null}
      </header>

      {readable && thread && facts ? (
        <Timeline key={thread.tabId} thread={thread} shrunk={isShrunk(facts)} />
      ) : null}
    </main>
  );
}
