import { Disclosure } from '@/consent/Disclosure';
import { acceptConsent, readConsent, type ConsentState } from '@/consent/state';
import { CONSENT_ACCEPT_LABEL, CONSENT_HEADING } from '@/consent/text';
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

function acceptedOn(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function App() {
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
        <h1 className="text-lg font-semibold">{CONSENT_HEADING}</h1>
        {consent?.status === 'stale' ? (
          <p data-testid="consent-updated" className="text-sm text-muted-foreground">
            What Vigie captures has changed since you last agreed. Capture is stopped until you have
            read the updated text below.
          </p>
        ) : null}
      </header>

      <Disclosure />

      {consent === null ? (
        <p data-testid="consent-loading" className="text-sm text-muted-foreground">
          Loading…
        </p>
      ) : consent.status === 'given' ? (
        <section className="flex flex-col items-start gap-3 border-t pt-5">
          <p data-testid="consent-accepted" className="text-sm">
            {`Agreed on ${acceptedOn(consent.record.acceptedAt)}. Vigie is capturing on the domains you designate.`}
          </p>
          <Button
            data-testid="consent-open-options"
            variant="outline"
            size="sm"
            onClick={() => void browser.runtime.openOptionsPage()}
          >
            Choose the domains to watch
          </Button>
        </section>
      ) : (
        <section className="flex flex-col items-start gap-3 border-t pt-5">
          <Button data-testid="consent-accept" disabled={busy} onClick={() => void accept()}>
            {CONSENT_ACCEPT_LABEL}
          </Button>
          <p className="text-xs text-muted-foreground">
            Until then Vigie captures nothing, on any site.
          </p>
        </section>
      )}
    </main>
  );
}
