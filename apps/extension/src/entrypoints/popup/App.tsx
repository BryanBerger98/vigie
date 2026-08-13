import {
  exportRequest,
  isExportFailure,
  type ExportDepthMinutes,
  type ExportResult,
} from '@vigie/contract';
import { PanelRight } from 'lucide-react';

import {
  EMPTY_CDP_SESSION_STATE,
  onCdpSessionStateChanged,
  readCdpSessionState,
  takeCaptureInterrupted,
  type CdpSessionState,
} from '@/capture/cdp/session-state';
import { START_DEEP_LAYER_MESSAGE, STOP_DEEP_LAYER_MESSAGE } from '@/capture/cdp/session';
import { currentDeepLayerSupport } from '@/capture/cdp/support';
import { ConsentRequired } from '@/consent/ConsentRequired';
import {
  isCapturePermitted,
  onConsentChanged,
  readConsent,
  type ConsentState,
} from '@/consent/state';
import { downloadReport } from '@/export/download';
import { reportFilename } from '@/export/filename';
import { countForTab, oldestCaptureAt } from '@/export/slice';
import { useI18n } from '@/i18n/I18nProvider';
import { RETENTION_MS, readStorageState } from '@/storage/prune';
import { watchedDomainFor } from '@/storage/scope';
import { hasHostAccess, onWatchedDomainsChanged, readWatchedDomains } from '@/storage/watched-domains';
import { FLUSH_MESSAGE } from '@/storage/write';
import { Button } from '@/ui/components/button';

import { DeepLayerControl } from './DeepLayerControl';
import { ExportButton } from './ExportButton';
import { ExportFeedback } from './ExportFeedback';
import { InterruptionNotice } from './InterruptionNotice';
import { PopupHeader } from './PopupHeader';
import { ScopeStatus } from './ScopeStatus';
import { TabContextLine } from './TabContextLine';
import { readLastDepth, writeLastDepth } from './last-depth';
import { resolveSubjectTab } from './subject-tab';
import {
  MS_PER_MINUTE,
  deepLayerView,
  depthAvailability,
  downloadAcknowledgement,
  exportFailure,
  idleFeedback,
  interruptionNotice,
  isDeepLayerFailure,
  resolveCurrentDepth,
  scopeStatus,
  tabContextLine,
  workingFeedback,
  type ExportFeedbackView,
  type PopupFacts,
} from './state';

/**
 * The popup: the whole gesture of the product, from seeing that a domain is watched to holding
 * its report. Nothing between the two but one click (`spec.md:13`).
 *
 * What could be wrong lives in `state.ts` and is asserted without a browser. What is left here is
 * what only a surface can do: read the browser, write the file the click asked for, and re-read
 * when something behind the popup's back moves the scope.
 *
 * Before any of that, the disclosure. While the agreement is missing or outdated the popup shows
 * the gate and nothing else: every control below it acts on a store the write path is refusing to
 * fill, and a depth button there would export a window that was never captured.
 *
 * Nothing else shares the surface. The storage figures the popup used to carry are the settings
 * page's job, where a user goes to audit what is held rather than to export it
 * (`options/StoredData.tsx`), and the worker probe they sat next to is read from
 * `chrome.storage.session` by the end-to-end suite that needs it.
 *
 * The `data-testid` attributes are the handles the end-to-end suite reads; `popup-root` proves the
 * popup mounted and predates this phase.
 *
 * Nothing this component holds in state is a sentence. A choice made in the settings has to reach a
 * popup that is already open (`prd.md:102`), and a sentence built once and stored would still be in
 * the language it was built in when it does. What is stored is what happened; the words are built
 * at render, from the translator the provider hands down.
 */

/** A refused start or stop: what was asked, and what the browser answered. */
interface DeepLayerFailure {
  intent: 'start' | 'stop';
  reason: string;
}

export default function App() {
  const { t } = useI18n();
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [facts, setFacts] = useState<PopupFacts | null>(null);
  const [rememberedDepth, setRememberedDepth] = useState<ExportDepthMinutes | null>(null);
  /**
   * `null` is the idle state, rather than the idle sentence held in state.
   *
   * A sentence stored here would be the one language it was built in, and a popup left open while
   * the settings switch language would keep announcing the old one. What is worth remembering is
   * that nothing has been exported yet; the words for it are built at render, like every other.
   */
  const [feedback, setFeedback] = useState<ExportFeedbackView | null>(null);
  const [busy, setBusy] = useState(false);
  const [cdpSession, setCdpSession] = useState<CdpSessionState>(EMPTY_CDP_SESSION_STATE);
  // The intent and the browser's reason, not the sentence built from them, for the reason above.
  const [deepLayerFailure, setDeepLayerFailure] = useState<DeepLayerFailure | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const noticeTaken = useRef(false);

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

  /**
   * One pass, one render. The remembered depth is read alongside the facts rather than in an effect
   * of its own: a second pass would land after the first paint, and the button's label would
   * announce five minutes before flicking to the depth the user actually last used.
   */
  const refresh = useCallback(async () => {
    const [next, remembered] = await Promise.all([readFacts(), readLastDepth()]);
    setFacts(next);
    setRememberedDepth(remembered);
  }, [readFacts]);

  // The agreement is read on its own and followed: it is answered in another tab, and the popup
  // has to open up the moment it lands rather than the next time it is reopened.
  useEffect(() => {
    void readConsent().then(setConsent);
    return onConsentChanged(setConsent);
  }, []);

  // The deep layer, read the same way and followed for the same reason: it is stopped from Chrome's
  // banner, on a page, with this popup nowhere in the picture.
  useEffect(() => {
    void readCdpSessionState().then(setCdpSession);
    return onCdpSessionStateChanged(setCdpSession);
  }, []);

  /**
   * The interruption mark, read once and consumed by the reading.
   *
   * Not read at all while the agreement is missing: reading clears the mark, and clearing it behind
   * the gate would spend the notice on a surface that does not show it — the user would accept the
   * disclosure and never learn their capture had been cut. Without consent there was no capture to
   * interrupt anyway.
   *
   * The ref is what makes "once" true under `React.StrictMode`, which mounts every effect twice in
   * development (`popup/main.tsx:5`): the second run would read an already-cleared mark and the
   * notice would never appear.
   */
  useEffect(() => {
    if (consent === null || !isCapturePermitted(consent)) return;
    if (noticeTaken.current) return;

    noticeTaken.current = true;
    void takeCaptureInterrupted().then(setInterrupted);
  }, [consent]);

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
   * Arming the deep layer, and stopping it.
   *
   * No permission is requested here. `debugger` is a required permission because Chrome grants it
   * no other way — an optional declaration is dropped at load and every runtime request for it is
   * refused (`capture/cdp/permission.ts:1`). The click therefore only carries an intent, and the
   * banner the user is consenting to appears when the session attaches.
   *
   * The worker is asked to start rather than being started from here, because the sessions have to
   * outlive this document — the popup closes on the next click anywhere. No state is read off the
   * success either: the worker writes the session state, and the subscription above is what brings
   * it back.
   *
   * Only the failure is read, and it is shown rather than swallowed — both the worker's own `{ error }`
   * and a message that never reached it. A start that silently did nothing is what let a permission
   * the browser was refusing outright look like a dead button.
   */
  function actOnDeepLayer(intent: 'start' | 'stop'): void {
    const message = intent === 'stop' ? STOP_DEEP_LAYER_MESSAGE : START_DEEP_LAYER_MESSAGE;

    setDeepLayerFailure(null);
    void browser.runtime.sendMessage(message).then(
      (answer: unknown) => {
        const reason = isDeepLayerFailure(answer) ? answer.error : null;
        if (reason !== null) setDeepLayerFailure({ intent, reason });
      },
      (error: unknown) => setDeepLayerFailure({ intent, reason: String(error) }),
    );
  }

  /**
   * One export, from the click to the file.
   *
   * How long the worker takes no longer matters. The clipboard write this replaced ran on the
   * transient activation the click granted, so a slow answer cost the export outright and the order
   * of everything below was dictated by not spending it. A blob and an anchor depend on no
   * activation (`export/download.ts:12`), which leaves this handler free to be read top to bottom.
   */
  async function exportReport(depthMinutes: ExportDepthMinutes): Promise<void> {
    const subject = facts?.subject;
    if (!subject) {
      setFeedback(exportFailure(t('export.no-subject'), t));
      return;
    }

    setBusy(true);
    setFeedback(workingFeedback(depthMinutes, t));

    const answer: unknown = await browser.runtime
      .sendMessage(exportRequest(subject.tabId, depthMinutes))
      .catch((error: unknown) => ({ error: String(error) }));

    if (isExportFailure(answer)) {
      setFeedback(exportFailure(answer.error, t));
      setBusy(false);
      return;
    }

    const { bundle, markdown } = answer as ExportResult;
    const filename = reportFilename(bundle);
    setFeedback(downloadAcknowledgement(bundle, filename, downloadReport(markdown, filename), t));
    setBusy(false);

    // Not awaited: the label follows the click rather than the next open, and a preference that has
    // not reached disk yet must not hold up the acknowledgement of a file already written.
    setRememberedDepth(depthMinutes);
    void writeLastDepth(depthMinutes);
  }

  const status = facts ? scopeStatus(facts, t) : null;
  // Read at render time, not in an effect: the browser verdict is a property of the browser and
  // never moves, and the click below cannot await anything before asking for the permission.
  const deepLayer = deepLayerView(
    {
      support: currentDeepLayerSupport(),
      armed: cdpSession.armed,
      canceledByUser: cdpSession.canceledByUser,
      attachedTabs: cdpSession.attachedTabs.length,
    },
    t,
  );
  const notice = interruptionNotice(interrupted, t);
  const availability = depthAvailability(facts?.coveredMinutes ?? 0, t);
  const currentDepth = resolveCurrentDepth(rememberedDepth, availability);
  // Out of scope, the surface offers the one action that resolves it and nothing else: a depth
  // button there would export a window that was never captured (`phase-8.md:112`).
  const exportable = status !== null && (status.kind === 'capturing' || status.kind === 'degraded');
  // The side panel reads one tab's thread, so there has to be a tab. Unlike the export it is
  // offered out of scope too: the panel is where the absence of capture is explained, and sending
  // someone to the settings without ever showing them what "watched" looks like is the worse turn.
  const subject = facts?.subject ?? null;

  // The gate, and nothing under it. Every control below acts on a store the write path is refusing
  // to fill, so a scope line here would announce a capture that is not happening and a depth button
  // would export a window that was never recorded. `popup-root` stays: the popup did mount.
  if (consent !== null && !isCapturePermitted(consent)) {
    return (
      <main
        data-testid="popup-root"
        className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground"
      >
        <PopupHeader />
        <ConsentRequired state={consent} />
      </main>
    );
  }

  return (
    <main
      data-testid="popup-root"
      className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground"
    >
      <PopupHeader />

      {/* First, and above the scope: it covers the whole capture window, while everything under it
          covers this tab. The deep layer block further down says whether the capture is running
          now, which is what lets this be read as a statement rather than as an alert. */}
      {notice ? <InterruptionNotice notice={notice} /> : null}

      {status ? (
        <ScopeStatus status={status} onWatch={watchDomainFromPopup} />
      ) : (
        <p data-testid="scope-loading" className="text-xs text-muted-foreground">
          {t('scope.loading')}
        </p>
      )}

      {/* Below the scope and above the export, because it is read in that order: what is being
          captured, then how deeply, then what comes out. It does not depend on the subject tab —
          the layer follows the watched perimeter, not the tab this popup happens to be over. */}
      <DeepLayerControl
        view={deepLayer}
        failure={
          deepLayerFailure
            ? t(deepLayerFailure.intent === 'stop' ? 'deep.stop.failed' : 'deep.start.failed', {
                reason: deepLayerFailure.reason,
              })
            : null
        }
        onAct={actOnDeepLayer}
      />

      {exportable && facts ? (
        <>
          <ExportButton
            currentDepth={currentDepth}
            availability={availability}
            busy={busy}
            onExport={(depth) => void exportReport(depth)}
          />
          <TabContextLine text={tabContextLine(facts, t)} />
          <ExportFeedback feedback={feedback ?? idleFeedback(t)} />
        </>
      ) : null}

      {/* Alone on its line since the settings moved to the header: it is the one exit that belongs
          to the gesture, and it now reads as one rather than as half a row of chrome. */}
      {subject ? (
        <Button
          data-testid="open-sidepanel"
          variant="outline"
          size="sm"
          className="w-full"
          // No `await` before the call, and no handler of our own around it: Chrome only honours
          // `sidePanel.open` inside the gesture that triggered it, and a single awaited promise
          // beforehand already spends that gesture. Everything it needs is read at render time
          // for that reason. Opening the panel closes the popup, so nothing here reports back.
          onClick={() => {
            void browser.sidePanel.open({ tabId: subject.tabId });
          }}
        >
          <PanelRight aria-hidden="true" className="size-4" />
          {t('popup.sidepanel')}
        </Button>
      ) : null}
    </main>
  );
}
