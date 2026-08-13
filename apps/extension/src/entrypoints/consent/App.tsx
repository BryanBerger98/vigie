import { Disclosure } from '@/consent/Disclosure';
import { acceptConsent, readConsent, type ConsentState } from '@/consent/state';
import { CONSENT_ACCEPT_LABEL, CONSENT_HEADING } from '@/consent/text';
import { useI18n } from '@/i18n/I18nProvider';
import type { LocaleCode } from '@/i18n/registry';
import { Button } from '@/ui/components/button';

/**
 * The first-run screen. Blocking by construction: nothing is captured before it has been answered,
 * and it carries no dismissal (`design.md:23`).
 *
 * It stays reachable afterwards and simply renders as answered — the same words, plus the date they
 * were agreed on. A disclosure that disappears once accepted is a disclosure nobody can re-read,
 * and the settings link back here for exactly that.
 *
 * There is no refuse button. Refusing is not answering: the extension captures nothing until it is
 * accepted, so closing the tab *is* the refusal, and a button that only closed a tab would suggest
 * a stored decision the product does not keep.
 */

/**
 * The date the agreement was given, written the way the language on screen writes dates.
 *
 * The locale is passed rather than left `undefined`. `undefined` means "the browser's language",
 * which is the one thing this screen is not necessarily speaking: someone who chose French on an
 * English browser would read a French sentence ending in an English date.
 */
function acceptedOn(at: number, locale: LocaleCode): string {
  return new Date(at).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function App() {
  const { t, locale } = useI18n();
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readConsent().then((state) => {
      if (!cancelled) setConsent(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function accept(): Promise<void> {
    setBusy(true);
    await acceptConsent();
    setConsent(await readConsent());
    setBusy(false);
  }

  return (
    <main
      data-testid="consent-root"
      className="mx-auto flex max-w-2xl flex-col gap-6 bg-background p-8 text-foreground"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t(CONSENT_HEADING)}</h1>
        {consent?.status === 'stale' ? (
          <p data-testid="consent-updated" className="text-sm text-muted-foreground">
            {t('consent.stale')}
          </p>
        ) : null}
      </header>

      <Disclosure />

      {consent === null ? (
        <p data-testid="consent-loading" className="text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      ) : consent.status === 'given' ? (
        <section className="flex flex-col items-start gap-3 border-t pt-5">
          <p data-testid="consent-accepted" className="text-sm">
            {t('consent.accepted', { date: acceptedOn(consent.record.acceptedAt, locale) })}
          </p>
          <Button
            data-testid="consent-open-options"
            variant="outline"
            size="sm"
            onClick={() => void browser.runtime.openOptionsPage()}
          >
            {t('consent.accepted.options')}
          </Button>
        </section>
      ) : (
        <section className="flex flex-col items-start gap-3 border-t pt-5">
          <Button data-testid="consent-accept" disabled={busy} onClick={() => void accept()}>
            {t(CONSENT_ACCEPT_LABEL)}
          </Button>
          <p className="text-xs text-muted-foreground">{t('consent.accept.until')}</p>
        </section>
      )}
    </main>
  );
}
