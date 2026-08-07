import { onWatchedDomainsChanged, readWatchedDomainsWithAccess, type WatchedDomain } from '@/storage/watched-domains';

import { AddDomainForm } from './AddDomainForm';
import { WatchedDomainList } from './WatchedDomainList';

/**
 * Settings. The watched domain list is the only configuration the product requires before it is
 * useful, and it is the whole of this screen for now — storage and a reminder of what gets
 * captured join it in phase 9.
 *
 * The list is read back from the browser rather than kept in sync locally. Three things change it
 * behind this page's back: the other surfaces, Chrome's own site-access settings, and a
 * permission prompt answered in another window. Re-reading on every signal costs two API calls
 * and removes a whole class of stale display.
 *
 * The page also answers `?domain=`, which is how the popup hands over the site it just offered to
 * watch. The permission prompt is raised here rather than there because Chrome closes a popup to
 * show it, taking the code that would store the domain with it (`popup/App.tsx:203`).
 */

/** The domain the popup asked to watch, when the page was opened for that. */
function requestedDomain(): string {
  return new URLSearchParams(globalThis.location.search).get('domain') ?? '';
}

export default function App() {
  const [domains, setDomains] = useState<WatchedDomain[] | null>(null);

  const refresh = useCallback(async () => {
    setDomains(await readWatchedDomainsWithAccess());
  }, []);

  useEffect(() => {
    void refresh();

    const unsubscribe = onWatchedDomainsChanged(() => void refresh());
    const onPermissionChange = () => void refresh();
    browser.permissions.onAdded.addListener(onPermissionChange);
    browser.permissions.onRemoved.addListener(onPermissionChange);

    // Coming back from `chrome://extensions` after revoking access there: the event fires, but
    // this page may have been discarded and remounted in between, so the return is its own signal.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      unsubscribe();
      browser.permissions.onAdded.removeListener(onPermissionChange);
      browser.permissions.onRemoved.removeListener(onPermissionChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return (
    <main data-testid="options-root" className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Vigie</h1>
        <p className="text-sm text-muted-foreground">
          Vigie only captures on the domains listed below, and only while the browser grants it
          access to them.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Watched domains</h2>

        {domains === null ? (
          <p data-testid="watched-domains-loading" className="text-sm text-muted-foreground">
            Loading…
          </p>
        ) : (
          <WatchedDomainList domains={domains} onRemoved={() => void refresh()} />
        )}

        <AddDomainForm onAdded={() => void refresh()} initialDomain={requestedDomain()} />
      </section>
    </main>
  );
}
