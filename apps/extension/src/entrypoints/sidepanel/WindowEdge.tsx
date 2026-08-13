import { MS_PER_MINUTE, minutes } from '@/entrypoints/popup/state';
import { useI18n } from '@/i18n/I18nProvider';
import type { TabWindow } from '@/storage/live-query';
import { RETENTION_MS } from '@/storage/prune';

/**
 * The low edge of the thread, said out loud.
 *
 * The top of the thread is the one place the surface can lie by staying silent: a reader who
 * scrolls up and finds nothing concludes the capture was not running, when what actually happened
 * is that Vigie deleted it. So the edge is marked as a deletion, never left as a blank
 * (`phase-10.md:99`).
 *
 * Two edges exist, and they mean different things. The hour is the promise being kept. A window
 * shortened by storage pressure is the promise being broken, and the quantity by which — which is
 * the same distinction the scope line makes between capturing and degraded (`popup/state.ts:111`).
 */

interface WindowEdgeProps {
  thread: TabWindow;
  /** Whether the last prune had to go past the hour to make room, from its own readout. */
  shrunk: boolean;
}

export function WindowEdge({ thread, shrunk }: WindowEdgeProps) {
  const { t } = useI18n();
  const oldest = thread.entries[0]?.timestamp;
  const held = oldest === undefined ? 0 : Math.max(0, thread.readAt - oldest) / MS_PER_MINUTE;

  return (
    <section
      data-testid="window-edge"
      data-reason={shrunk ? 'quota' : 'retention'}
      className="flex flex-col gap-0.5 border-b border-dashed pb-2 text-xs text-muted-foreground"
    >
      <p className="font-medium text-foreground">
        <span aria-hidden="true" className="mr-1.5 font-normal">
          ┌
        </span>
        {shrunk ? t('thread.edge.shortened') : t('thread.edge.kept')}
      </p>

      <p data-testid="window-edge-detail">
        {shrunk
          ? t('thread.edge.shortened.detail', {
              minutes: minutes(Number(held.toFixed(1))),
              // The promise the shortened window fell short of, taken from the promise itself
              // rather than written as 60 in a sentence that would then have to be re-translated.
              floor: RETENTION_MS / MS_PER_MINUTE,
            })
          : t('thread.edge.kept.detail')}
      </p>
    </section>
  );
}
