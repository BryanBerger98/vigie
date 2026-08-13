import { ConsentRequired } from '@/consent/ConsentRequired';
import { Disclosure } from '@/consent/Disclosure';
import {
  isCapturePermitted,
  onConsentChanged,
  openConsentScreen,
  readConsent,
  type ConsentState,
} from '@/consent/state';
import { useI18n } from '@/i18n/I18nProvider';
import { onWatchedDomainsChanged, readWatchedDomainsWithAccess, type WatchedDomain } from '@/storage/watched-domains';
import { Button } from '@/ui/components/button';

import { AddDomainForm } from './AddDomainForm';
import { LanguageSetting } from './LanguageSetting';
import { StoredData } from './StoredData';
import { WatchedDomainList } from './WatchedDomainList';

/**
 * Settings. Three things in one page: the domains Vigie is allowed to watch, what it is holding on
 * them right now, and the disclosure kept readable after it was agreed to.
 *
 * The three belong together because they answer the same question from three angles — what is this
 * extension doing with my browsing. Splitting them across screens would let a user configure the
 * scope without ever meeting the volume it produces.
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
  const { t } = useI18n();
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [domains, setDomains] = useState<WatchedDomain[] | null>(null);

  const refresh = useCallback(async () => {
    setDomains(await readWatchedDomainsWithAccess());
  }, []);

  // The agreement is answered in another tab, so this page follows it rather than reading it once.
  useEffect(() => {
    void readConsent().then(setConsent);
    return onConsentChanged(setConsent);
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

  // The gate, in place of the settings and not above them: designating a domain nothing is captured
  // on would read as a product that silently does nothing (`consent/ConsentRequired.tsx:8`).
  const locked = consent !== null && !isCapturePermitted(consent);

  return (
    <main data-testid="options-root" className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Vigie</h1>
        <p className="text-sm text-muted-foreground">{t('options.intro')}</p>
      </header>

      {/*
        Above the gate, not inside it: the disclosure has to be readable in the user's own language
        before they are asked to agree to it, so the language cannot be locked behind that answer.
      */}
      <LanguageSetting />

      {locked && consent ? (
        <ConsentRequired state={consent} />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">{t('domains.title')}</h2>

            {domains === null ? (
              <p data-testid="watched-domains-loading" className="text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            ) : (
              <WatchedDomainList domains={domains} onRemoved={() => void refresh()} />
            )}

            <AddDomainForm onAdded={() => void refresh()} initialDomain={requestedDomain()} />
          </section>

          <StoredData />

          {/*
            The disclosure again, word for word. It is the same component the first-run screen
            renders, so the two cannot drift: a disclosure that vanishes once accepted is a
            disclosure nobody can go back and check (`consent/Disclosure.tsx:9`).
          */}
          <section className="flex flex-col gap-3 border-t pt-5">
            <h2 className="text-sm font-medium">{t('consent.heading')}</h2>
            <Disclosure />
            <div>
              <Button
                data-testid="reopen-consent"
                variant="ghost"
                size="sm"
                onClick={() => void openConsentScreen()}
              >
                {t('options.disclosure.open')}
              </Button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
