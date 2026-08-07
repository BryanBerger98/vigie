import {
  EXPORT_DEPTHS_MINUTES,
  exportRequest,
  isExportFailure,
  type ExportDepthMinutes,
  type ExportResult,
} from '@vigie/contract';

import {
  EMPTY_MEASUREMENT_STATE,
  MEASUREMENT_STATE_KEY,
  type MeasurementState,
} from '@/capture/network/listener-lifecycle';
import { copyToClipboard } from '@/export/clipboard';
import {
  captureMetrics,
  clearReadings,
  formatReadings,
  readReadings,
  recordReading,
  type CaptureMetrics,
} from '@/storage/metrics';
import { RETENTION_MS } from '@/storage/prune';
import { FLUSH_MESSAGE } from '@/storage/write';
import { Button } from '@/ui/components/button';

/**
 * Popup shell. The export surface — four depth buttons, capture status — lands here in phase 8.
 *
 * Two provisional readouts share it until then. The phase 2 probe counts what the browser
 * delivered against what the watched list accepted, and polls, because reading a session counter
 * costs nothing. The phase 6 storage readout does not poll: every reading walks the whole capture
 * table, and a poll would put the instrument inside what it measures (`storage/metrics.ts:16`).
 * It is taken on open, and again on demand — which is also what a relevé is.
 *
 * The `data-testid` attributes are the handles the end-to-end suite reads; `popup-root` proves
 * the popup mounted and predates this phase.
 */

const MS_PER_MINUTE = 60_000;

/** Bytes at a glance. Rounded on purpose: the unrounded figures go to the readings series. */
function bytes(value: number | null): string {
  if (value === null) return '—';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function minutes(ms: number): string {
  return `${(ms / MS_PER_MINUTE).toFixed(1)} min`;
}

function percent(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)} %`;
}

export default function App() {
  const [state, setState] = useState<MeasurementState>(EMPTY_MEASUREMENT_STATE);
  const [metrics, setMetrics] = useState<CaptureMetrics | null>(null);
  const [readings, setReadings] = useState<number>(0);
  const [exportStatus, setExportStatus] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      const stored = await browser.storage.session.get(MEASUREMENT_STATE_KEY);
      const next = stored[MEASUREMENT_STATE_KEY] as MeasurementState | undefined;
      if (cancelled) return;
      setState(next ?? EMPTY_MEASUREMENT_STATE);
    };

    // `onChanged` alone would do, but the popup is also the thing that wakes a terminated worker
    // and the first read can land before it has written. Polling keeps the readout honest.
    const timer = setInterval(() => void read(), 500);
    browser.storage.session.onChanged.addListener(read);

    void read();
    void reading().then((next) => {
      if (!cancelled) setMetrics(next);
    });
    void readReadings().then((series) => {
      if (!cancelled) setReadings(series.length);
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      browser.storage.session.onChanged.removeListener(read);
    };
  }, []);

  /**
   * One reading, taken after the worker has written what it still holds.
   *
   * Without the flush a reading would miss whatever sits in the batch queue, and would report a
   * store that is behind the capture by up to `BATCH_SIZE` entries — small, but systematically in
   * the same direction, which is how a measurement ends up wrong rather than noisy.
   */
  async function reading(): Promise<CaptureMetrics> {
    await browser.runtime.sendMessage(FLUSH_MESSAGE).catch(() => {
      // The worker is starting back up. The reading is then simply taken from what is on disk.
    });
    return captureMetrics();
  }

  /** Takes a reading and keeps it in the series, which is what a relevé is. */
  async function take(): Promise<void> {
    const next = await reading();
    setMetrics(next);
    setReadings((await recordReading(next)).length);
  }

  async function copyReadings(): Promise<void> {
    await navigator.clipboard.writeText(formatReadings(await readReadings()));
  }

  async function forgetReadings(): Promise<void> {
    await clearReadings();
    setReadings(0);
  }

  /**
   * One export, from the click to the clipboard.
   *
   * The write is the last statement of the handler, and nothing is awaited between it and the
   * report coming back: `writeText` runs on the transient activation the click granted, and that
   * activation expires. A slow worker can therefore cost the copy — which is precisely why the
   * outcome is rendered instead of assumed (`export/clipboard.ts:10`).
   */
  async function exportReport(depthMinutes: ExportDepthMinutes): Promise<void> {
    setExportStatus(`Exporting the last ${depthMinutes} min…`);

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      setExportStatus('No active tab to report on.');
      return;
    }

    const answer: unknown = await browser.runtime
      .sendMessage(exportRequest(tab.id, depthMinutes))
      .catch((error: unknown) => ({ error: String(error) }));

    if (isExportFailure(answer)) {
      setExportStatus(`Export failed: ${answer.error}`);
      return;
    }

    const { bundle, markdown } = answer as ExportResult;
    const outcome = await copyToClipboard(markdown);
    setExportStatus(
      outcome.ok
        ? `Copied ${bundle.entries.length} entries, ${minutes(bundle.window.coveredDepthMinutes * MS_PER_MINUTE)} covered.`
        : `Report ready but not copied: ${outcome.reason}`,
    );
  }

  const lastChange = state.permissionChanges.at(-1);
  const covered = metrics?.coveredMs ?? 0;

  return (
    <main
      data-testid="popup-root"
      className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground"
    >
      <h1 className="text-sm font-semibold">Vigie</h1>

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Watched events</dt>
        <dd data-testid="measure-watched-events" className="text-right font-mono tabular-nums">
          {state.watchedEvents}
        </dd>

        <dt className="text-muted-foreground">Network events</dt>
        <dd data-testid="measure-network-events" className="text-right font-mono tabular-nums">
          {state.networkEvents}
        </dd>

        <dt className="text-muted-foreground">Worker starts</dt>
        <dd data-testid="measure-worker-starts" className="text-right font-mono tabular-nums">
          {state.workerStarts}
        </dd>

        <dt className="text-muted-foreground">Permission changes</dt>
        <dd data-testid="measure-permission-changes" className="text-right font-mono tabular-nums">
          {state.permissionChanges.length}
        </dd>
      </dl>

      <p data-testid="measure-last-permission" className="truncate text-xs text-muted-foreground">
        {lastChange
          ? `${lastChange.change}: ${lastChange.origins.join(', ') || '(none)'}`
          : 'No host permission granted yet.'}
      </p>

      <section className="flex flex-col gap-2 border-t pt-2">
        <h2 className="text-xs font-semibold">Export the active tab</h2>

        <div className="flex gap-2">
          {EXPORT_DEPTHS_MINUTES.map((depth) => (
            <Button
              key={depth}
              data-testid={`export-${depth}`}
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => void exportReport(depth)}
            >
              {`${depth} min`}
            </Button>
          ))}
        </div>

        <p data-testid="export-status" className="text-xs text-muted-foreground">
          {exportStatus || 'Pick a depth. The report goes to the clipboard.'}
        </p>
      </section>

      <section className="flex flex-col gap-2 border-t pt-2">
        <h2 className="text-xs font-semibold">Capture store</h2>

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Entries</dt>
          <dd data-testid="storage-entries" className="text-right font-mono tabular-nums">
            {metrics?.entryCount ?? 0}
          </dd>

          <dt className="text-muted-foreground">Network / console / error</dt>
          <dd data-testid="storage-by-kind" className="text-right font-mono tabular-nums">
            {metrics
              ? `${metrics.byKind.network.count} / ${metrics.byKind.console.count} / ${metrics.byKind.error.count}`
              : '0 / 0 / 0'}
          </dd>

          <dt className="text-muted-foreground">Window covered</dt>
          <dd data-testid="storage-covered" className="text-right font-mono tabular-nums">
            {`${minutes(covered)} / ${minutes(RETENTION_MS)}`}
          </dd>

          <dt className="text-muted-foreground">Entries per minute</dt>
          <dd data-testid="storage-rate" className="text-right font-mono tabular-nums">
            {(metrics?.entriesPerMinute ?? 0).toFixed(1)}
          </dd>

          <dt className="text-muted-foreground">Stored</dt>
          <dd data-testid="storage-bytes" className="text-right font-mono tabular-nums">
            {bytes(metrics?.storeBytes ?? null)}
          </dd>

          <dt className="text-muted-foreground">Per entry</dt>
          <dd data-testid="storage-per-entry" className="text-right font-mono tabular-nums">
            {bytes(metrics?.bytesPerEntry ?? null)}
          </dd>

          <dt className="text-muted-foreground">Projected hour</dt>
          <dd data-testid="storage-projected" className="text-right font-mono tabular-nums">
            {`${bytes(metrics?.projectedHourBytes ?? null)} · ${percent(metrics?.projectedQuotaRatio ?? null)}`}
          </dd>

          <dt className="text-muted-foreground">Quota</dt>
          <dd data-testid="storage-quota" className="text-right font-mono tabular-nums">
            {bytes(metrics?.quotaBytes ?? null)}
          </dd>
        </dl>

        <div className="flex gap-2">
          <Button
            data-testid="storage-take-reading"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void take()}
          >
            {`Take reading (${readings})`}
          </Button>
          <Button
            data-testid="storage-copy-readings"
            variant="outline"
            size="sm"
            onClick={() => void copyReadings()}
          >
            Copy
          </Button>
          <Button
            data-testid="storage-clear-readings"
            variant="outline"
            size="sm"
            onClick={() => void forgetReadings()}
          >
            Clear
          </Button>
        </div>
      </section>

      <Button
        data-testid="open-options"
        variant="outline"
        size="sm"
        onClick={() => void browser.runtime.openOptionsPage()}
      >
        Watched domains
      </Button>
    </main>
  );
}
