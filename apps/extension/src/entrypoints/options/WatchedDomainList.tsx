import { useI18n } from '@/i18n/I18nProvider';
import { removeWatchedDomain, type WatchedDomain } from '@/storage/watched-domains';
import { Button } from '@/ui/components/button';

interface WatchedDomainListProps {
  domains: WatchedDomain[];
  /** Called once a domain left the list, so the page can read it back. */
  onRemoved: () => void;
}

/**
 * The watched domains, one row each, carrying the access the browser really holds rather than
 * the mere fact that the domain is stored. A permission revoked from Chrome's own settings shows
 * up here as missing, which is the only way the user can tell why a capture came back empty.
 */
export function WatchedDomainList({ domains, onRemoved }: WatchedDomainListProps) {
  const { t } = useI18n();

  if (domains.length === 0) {
    return (
      <p data-testid="watched-domains-empty" className="text-sm text-muted-foreground">
        {t('domains.empty')}
      </p>
    );
  }

  return (
    <ul data-testid="watched-domain-list" className="flex flex-col rounded-md border border-border">
      {domains.map((entry) => (
        <WatchedDomainRow key={entry.domain} entry={entry} onRemoved={onRemoved} />
      ))}
    </ul>
  );
}

/**
 * One row, and the removal it guards.
 *
 * Removing a domain erases what was captured for it, which no undo can bring back, so the row
 * says so and waits for a second click. The warning is a DOM node rather than `window.confirm`
 * for a reason beyond styling: a native dialog blocks the extension page, and its text cannot be
 * asserted the way the rest of this screen is.
 */
function WatchedDomainRow({ entry, onRemoved }: { entry: WatchedDomain; onRemoved: () => void }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const remove = async () => {
    setPending(true);
    try {
      await removeWatchedDomain(entry.domain);
      onRemoved();
    } catch (cause: unknown) {
      console.error('[vigie] could not remove %s', entry.domain, cause);
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  return (
    <li
      data-testid="watched-domain-row"
      data-domain={entry.domain}
      className="flex flex-col gap-2 border-b border-border p-3 last:border-b-0"
    >
      <div className="flex items-center gap-3">
        <span data-testid="watched-domain-name" className="flex-1 truncate font-mono text-sm">
          {entry.domain}
        </span>

        <span
          data-testid="watched-domain-permission"
          data-granted={entry.granted}
          className="text-xs text-muted-foreground"
        >
          {entry.granted ? t('domains.access.granted') : t('domains.access.missing')}
        </span>

        <Button
          data-testid="watched-domain-remove"
          variant="ghost"
          size="icon"
          aria-label={t('domains.remove', { domain: entry.domain })}
          onClick={() => setConfirming(true)}
          disabled={confirming || pending}
        >
          ×
        </Button>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-2">
          <p data-testid="remove-warning" role="alert" className="text-xs">
            {t('domains.remove.warning', { domain: entry.domain })}
          </p>
          <div className="flex gap-2">
            <Button
              data-testid="remove-confirm"
              variant="destructive"
              size="sm"
              onClick={() => void remove()}
              disabled={pending}
            >
              {t('domains.remove.confirm')}
            </Button>
            <Button
              data-testid="remove-cancel"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              {t('domains.remove.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
