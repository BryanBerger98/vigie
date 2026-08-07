import {
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
import { ConsentRequired } from '@/consent/ConsentRequired';
import {
  isCapturePermitted,
  onConsentChanged,
  readConsent,
  type ConsentState,
} from '@/consent/state';
import { copyToClipboard } from '@/export/clipboard';
import { countForTab, oldestCaptureAt } from '@/export/slice';
import {
  captureMetrics,
  clearReadings,
  formatReadings,
  readReadings,
  recordReading,
  type CaptureMetrics,
} from '@/storage/metrics';
import { RETENTION_MS, readStorageState } from '@/storage/prune';
import { watchedDomainFor } from '@/storage/scope';
import { hasHostAccess, onWatchedDomainsChanged, readWatchedDomains } from '@/storage/watched-domains';
import { FLUSH_MESSAGE } from '@/storage/write';
import { Button } from '@/ui/components/button';

import { CopyFeedback } from './CopyFeedback';
import { DepthButtons } from './DepthButtons';
import { ScopeStatus } from './ScopeStatus';
import { TabContextLine } from './TabContextLine';
import { resolveSubjectTab } from './subject-tab';
import {
  MS_PER_MINUTE,
  copyAcknowledgement,
  depthAvailability,
  scopeStatus,
  tabContextLine,
  type PopupFacts,
} from './state';

/**
 * The popup: the whole gesture of the product, from seeing that a domain is watched to holding
 * its report. Nothing between the two but one click (`spec.md:13`).
 *
 * What could be wrong lives in `state.ts` and is asserted without a browser. What is left here is
 * what only a surface can do: read the browser, keep the clipboard write inside the click, and
 * re-read when something behind the popup's back moves the scope.
 *
 * Before any of that, the disclosure. While the agreement is missing or outdated the popup shows
 * the gate and nothing else: every control below it acts on a store the write path is refusing to
 * fill, and a depth button there would export a window that was never captured.
 *
 * ## The instrumentation below the fold
 *
 * Two provisional readouts still share this surface: the phase 2 probe, and the phase 6 storage
 * figures with the readings series `measure-storage.md` records its measurements through. Phase 6
 * is deliberately still open — the full hour on a named application is the user's to play — and
 * removing its instrument now would take the documented protocol with it. They sit under an
 * explicit heading, below every export control, and phase 11 retires them.
 *
 * The `data-testid` attributes are the handles the end-to-end suite reads; `popup-root` proves the
 * popup mounted and predates this phase.
 */

/** Bytes at a glance. Rounded on purpose: the unrounded figures go to the readings series. */
function bytes(value: number | null): string {
  if (value === null) return '—';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** A duration held in milliseconds, as the storage readout prints it. */
function span(ms: number): string {
  return `${(ms / MS_PER_MINUTE).toFixed(1)} min`;
}

function percent(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)} %`;
}

/** What the acknowledgement shows before anything has been clicked. */
const IDLE_FEEDBACK = 'Pick a depth. The report goes straight to the clipboard.';

export default function App() {
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [facts, setFacts] = useState<PopupFacts | null>(null);
  const [feedback, setFeedback] = useState<string>(IDLE_FEEDBACK);
  const [retryDepth, setRetryDepth] = useState<ExportDepthMinutes | null>(null);
  const [busy, setBusy] = useState(false);

  const [state, setState] = useState<MeasurementState>(EMPTY_MEASUREMENT_STATE);
  const [metrics, setMetrics] = useState<CaptureMetrics | null>(null);
  const [readings, setReadings] = useState<number>(0);

  /**
   * Everything the surface renders, read in one pass.
   *
   * The flush comes first and is not optional. The capture batches its writes, so up to a batch of
   * entries exist only in the worker's memory — and a popup opened right after some traffic would
   * otherwise announce "nothing captured on this tab yet" about a tab that has been captured. It
   * also wakes a terminated worker, which is what the export that follows needs anyway.
   */
  const readFacts = useCallback(async (): Promise<PopupFacts> => {
    await browser.runtime.sendMessage(FLUSH_MESSAGE).catch(() => {
      // The worker is starting back up. What is on disk is then what the popup describes.
    });

    const now = Date.now();
    const [subject, domains] = await Promise.all([resolveSubjectTab(), readWatchedDomains()]);
    const watchedDomain = subject ? watchedDomainFor(subject.url, domains) : null;

    const [hostAccess, tabEntryCount, oldest, storage] = await Promise.all([
      watchedDomain ? hasHostAccess(watchedDomain) : Promise.resolve(false),
      subject ? countForTab(subject.tabId, now) : Promise.resolve(0),
      oldestCaptureAt(),
      readStorageState(),
    ]);

    return {
      subject,
      watchedDomain,
      hostAccess,
      tabEntryCount,
      // Measured on the store rather than on the tab, exactly as a report announces it
      // (`export/slice.ts:86`), and capped at the hour the store is allowed to hold.
      coveredMinutes:
        oldest === null ? 0 : Math.min(RETENTION_MS, Math.max(0, now - oldest)) / MS_PER_MINUTE,
      shrunkAt: storage.shrunkAt,
      now,
    };
  }, []);

  const refresh = useCallback(async () => {
    setFacts(await readFacts());
  }, [readFacts]);

  // The agreement is read on its own and followed: it is answered in another tab, and the popup
  // has to open up the moment it lands rather than the next time it is reopened.
  useEffect(() => {
    void readConsent().then(setConsent);
    return onConsentChanged(setConsent);
  }, []);

  useEffect(() => {
    void refresh();

    // Three things move the scope behind this popup's back: another surface editing the list,
    // Chrome's own site-access settings, and a permission prompt answered elsewhere.
    const unsubscribe = onWatchedDomainsChanged(() => void refresh());
    const onPermissionChange = () => void refresh();
    browser.permissions.onAdded.addListener(onPermissionChange);
    browser.permissions.onRemoved.addListener(onPermissionChange);

    return () => {
      unsubscribe();
      browser.permissions.onAdded.removeListener(onPermissionChange);
      browser.permissions.onRemoved.removeListener(onPermissionChange);
    };
  }, [refresh]);

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
   * The out-of-scope exit, and the only one that state offers.
   *
   * It hands over to the settings with the domain already filled in rather than requesting the
   * permission here. Chrome closes a popup when it raises a permission prompt over it, and the
   * promise chain that would then have to store the domain dies with the document — leaving the
   * browser granting access to a domain no list mentions. The settings page is a document that
   * survives its own prompt, and it already owns the whole validate-ask-store sequence
   * (`storage/watched-domains.ts:81`).
   */
  function watchDomainFromPopup(domain: string): void {
    void browser.tabs.create({
      url: browser.runtime.getURL(`/options.html?domain=${encodeURIComponent(domain)}`),
    });
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
    const subject = facts?.subject;
    if (!subject) {
      setFeedback('No web page in this window to report on.');
      return;
    }

    setBusy(true);
    setRetryDepth(null);
    setFeedback(`Cutting the last ${depthMinutes} min…`);

    const answer: unknown = await browser.runtime
      .sendMessage(exportRequest(subject.tabId, depthMinutes))
      .catch((error: unknown) => ({ error: String(error) }));

    if (isExportFailure(answer)) {
      setFeedback(`Export failed: ${answer.error}`);
      setBusy(false);
      return;
    }

    const { bundle, markdown } = answer as ExportResult;
    const outcome = await copyToClipboard(markdown);
    setFeedback(copyAcknowledgement(bundle, outcome));
    setRetryDepth(outcome.ok ? null : depthMinutes);
    setBusy(false);
  }

  const lastChange = state.permissionChanges.at(-1);
  const covered = metrics?.coveredMs ?? 0;
  const status = facts ? scopeStatus(facts) : null;
  const availability = depthAvailability(facts?.coveredMinutes ?? 0);
  // Out of scope, the surface offers the one action that resolves it and nothing else: a depth
  // button there would export a window that was never captured (`phase-8.md:112`).
  const exportable = status !== null && (status.kind === 'capturing' || status.kind === 'degraded');

  // The gate, and nothing under it. Every control below acts on a store the write path is refusing
  // to fill, so a scope line here would announce a capture that is not happening and a depth button
  // would export a window that was never recorded. `popup-root` stays: the popup did mount.
  if (consent !== null && !isCapturePermitted(consent)) {
    return (
      <main
        data-testid="popup-root"
        className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground"
      >
        <h1 className="text-sm font-semibold">Vigie</h1>
        <ConsentRequired state={consent} />
      </main>
    );
  }

  return (
    <main
      data-testid="popup-root"
      className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground"
    >
      <h1 className="text-sm font-semibold">Vigie</h1>

      {status ? (
        <ScopeStatus status={status} onWatch={watchDomainFromPopup} />
      ) : (
        <p data-testid="scope-loading" className="text-xs text-muted-foreground">
          Reading the scope of this tab…
        </p>
      )}

      {exportable && facts ? (
        <>
          <DepthButtons
            availability={availability}
            busy={busy}
            onPick={(depth) => void exportReport(depth)}
          />
          <TabContextLine text={tabContextLine(facts)} />
          <CopyFeedback
            text={feedback}
            retryDepth={retryDepth}
            onRetry={(depth) => void exportReport(depth)}
          />
        </>
      ) : null}

      {/*
        Only one exit is wired. The side panel of phase 10 is not delivered, and a button leading
        to a surface that does not exist is worse than no button at all (`phase-8.md:139`).
      */}
      <Button
        data-testid="open-options"
        variant="outline"
        size="sm"
        onClick={() => void browser.runtime.openOptionsPage()}
      >
        Settings
      </Button>

      <section className="flex flex-col gap-2 border-t pt-3">
        <h2 className="text-xs font-semibold text-muted-foreground">
          Instrumentation — temporary, retired in phase 11
        </h2>

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
          <dd
            data-testid="measure-permission-changes"
            className="text-right font-mono tabular-nums"
          >
            {state.permissionChanges.length}
          </dd>
        </dl>

        <p data-testid="measure-last-permission" className="truncate text-xs text-muted-foreground">
          {lastChange
            ? `${lastChange.change}: ${lastChange.origins.join(', ') || '(none)'}`
            : 'No host permission granted yet.'}
        </p>

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-2 text-xs">
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
            {`${span(covered)} / ${span(RETENTION_MS)}`}
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
    </main>
  );
}
