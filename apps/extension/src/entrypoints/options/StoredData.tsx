import { useI18n } from '@/i18n/I18nProvider';
import type { Translator } from '@/i18n/translate';
import { RETENTION_MS } from '@/storage/prune';
import { captureMetrics, type CaptureMetrics } from '@/storage/metrics';
import { requestPurge } from '@/storage/purge';
import { FLUSH_MESSAGE } from '@/storage/write';
import { Button } from '@/ui/components/button';

/**
 * What Vigie is holding right now, and the button that empties it.
 *
 * The disclosure claims three bounds: nothing leaves the machine, nothing outside the designated
 * domains, nothing older than an hour. Only the last two are checkable from inside the product, and
 * this is where they are checked — the per-domain split names every domain the store has an entry
 * for, and the age of the oldest entry is the retention promise held up against the clock. A claim
 * the user can audit is worth more than a claim they have to believe (`phase-9.md` task 3).
 *
 * The purge is asked of the service worker rather than run here. The batch queue is worker-local
 * module state, and a settings page clearing its own would leave the real one to land behind the
 * erasure (`storage/purge.ts:13`).
 */

const MS_PER_MINUTE = 60_000;

/**
 * Bytes at a glance. The unrounded figures belong to the measurement series, not to a settings row.
 *
 * No translator here on purpose: `B`, `kB` and `MB` are international symbols, and a language that
 * renamed them would be describing a different measurement.
 */
function bytes(value: number | null): string {
  if (value === null) return '—';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** How long ago the oldest entry was captured, in the words a person would use out loud. */
export function ageOfOldest(t: Translator, oldestEntryAt: number | null, now: number): string {
  if (oldestEntryAt === null) return t('store.oldest.none');
  const minutes = Math.max(0, now - oldestEntryAt) / MS_PER_MINUTE;
  if (minutes < 1) return t('store.oldest.recent');
  if (minutes < 60) return t('store.oldest.minutes', { count: Math.round(minutes) });
  return t('store.oldest.hours', { count: (minutes / 60).toFixed(1) });
}

export function StoredData() {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<CaptureMetrics | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * One reading, taken after the worker has written what it still holds.
   *
   * Without the flush the figures would sit up to a batch behind the capture, and a purge that
   * followed would be reported against a total that was never the truth.
   */
  const read = useCallback(async () => {
    await browser.runtime.sendMessage(FLUSH_MESSAGE).catch(() => {
      // The worker is starting back up. What is on disk is then what the page describes.
    });
    setMetrics(await captureMetrics());
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  async function purge(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const answer = await requestPurge();
    if ('error' in answer) setFailure(answer.error);
    await read();
    setBusy(false);
  }

  const empty = metrics !== null && metrics.entryCount === 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{t('store.title')}</h2>

      {metrics === null ? (
        <p data-testid="stored-loading" className="text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('store.count')}</dt>
            <dd data-testid="stored-entries" className="text-right font-mono tabular-nums">
              {metrics.entryCount}
            </dd>

            <dt className="text-muted-foreground">{t('store.bytes')}</dt>
            <dd data-testid="stored-bytes" className="text-right font-mono tabular-nums">
              {bytes(metrics.storeBytes)}
            </dd>

            <dt className="text-muted-foreground">{t('store.oldest')}</dt>
            <dd data-testid="stored-oldest" className="text-right font-mono tabular-nums">
              {ageOfOldest(t, metrics.oldestEntryAt, metrics.takenAt)}
            </dd>
          </dl>

          {empty ? (
            <p data-testid="stored-empty" className="text-sm text-muted-foreground">
              {t('store.empty')}
            </p>
          ) : (
            <ul data-testid="stored-by-domain" className="flex flex-col gap-1 text-sm">
              {metrics.byDomain.map((row) => (
                <li
                  key={row.domain}
                  data-testid="stored-domain-row"
                  data-domain={row.domain}
                  className="flex items-baseline justify-between gap-4 border-b py-1 last:border-b-0"
                >
                  <span className="truncate font-mono">{row.domain}</span>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                    {`${row.count} · ${bytes(row.bytes)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {t('store.retention', { minutes: Math.round(RETENTION_MS / MS_PER_MINUTE) })}
      </p>

      <div className="flex items-center gap-3">
        <Button
          data-testid="purge-store"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void purge()}
        >
          {t('store.purge')}
        </Button>
        <Button data-testid="stored-refresh" variant="ghost" size="sm" onClick={() => void read()}>
          {t('store.refresh')}
        </Button>
      </div>

      {failure ? (
        <p data-testid="purge-failed" className="text-sm text-destructive">
          {t('store.purge.failed', { reason: failure })}
        </p>
      ) : null}
    </section>
  );
}
