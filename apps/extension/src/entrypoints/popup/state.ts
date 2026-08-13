import {
  EXPORT_DEPTHS_MINUTES,
  type ExportDepthMinutes,
  type GapKind,
  type ReportBundle,
} from '@vigie/contract';

import type { DeepLayerSupport } from '@/capture/cdp/support';
import { KEEPALIVE_CHROME_VERSION } from '@/capture/cdp/support';
import type { DownloadOutcome } from '@/export/download';
import type { MessageKey } from '@/i18n/registry';
import type { MessageParams, Translator } from '@/i18n/translate';
import { RETENTION_MS } from '@/storage/prune';

/**
 * What the popup decides, with no browser under it.
 *
 * The surface itself is four small components and a click handler; everything that could be wrong
 * is here — which state the tab is in, which depths the store can honour, and what the user is
 * told they just took away. Kept pure so those three answers are asserted without a browser, and so
 * the components stay renderers rather than places where a rule hides.
 *
 * Every function that returns a sentence takes the translator as its last argument, and keeps
 * returning finished sentences rather than keys. The rule and the sentence still live together —
 * the rule now picks the key, and the catalog holds the words — which is what keeps a state from
 * being rendered while saying nothing about itself (`design.md:21`). Handing keys to the components
 * instead would move that choice into four renderers and rewrite every assertion in this module's
 * tests, for exactly the same pixels.
 */

export const MS_PER_MINUTE = 60_000;

/** Minutes as a human reads them: `15`, not `15.0`; `12.4`, not `12.43333`. */
export function minutes(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The tab a report would be about, once the browser has said what it will say about it. */
export interface SubjectTab {
  tabId: number;
  url: string;
  title?: string;
  /** Host of `url`. Always known: a tab with no readable address is not a subject at all. */
  host: string;
}

/** Everything the popup reads before it can render anything. */
export interface PopupFacts {
  /** `null` when this window holds no web page the extension can report on. */
  subject: SubjectTab | null;
  /** The watched domain covering the subject, `null` when it is out of scope. */
  watchedDomain: string | null;
  /** Whether the browser still grants host access for that domain. */
  hostAccess: boolean;
  /** Entries the store holds for the subject tab, over the whole rolling window. */
  tabEntryCount: number;
  /** Minutes the store reaches back, all tabs — the same measure a report announces. */
  coveredMinutes: number;
  /** Epoch ms of the last prune the quota forced past the hour. `null` if it never happened. */
  shrunkAt: number | null;
  now: number;
}

export type ScopeKind = 'no-subject' | 'out-of-scope' | 'capturing' | 'degraded';

export interface ScopeStatusView {
  kind: ScopeKind;
  /** The state, spelled out. Never left to colour alone (`design.md:28`). */
  label: string;
  /** Why, in one sentence — including which half of a degraded state broke. */
  detail: string;
  /** The domain the add action offers. `null` when there is nothing to offer. */
  offerDomain: string | null;
}

/**
 * Which of the three capture states the tab is in.
 *
 * `design.md:20` names four; recording is out of this version's perimeter, so three are reachable
 * here. The fourth branch is not a state of the capture but of the window — no web page open at
 * all — and it is answered separately rather than dressed up as "out of scope", which would offer
 * to watch a domain that does not exist.
 *
 * Degraded has two causes and says which one: a revoked host permission has stopped the capture
 * outright, while a shrunk window is still capturing but over less than the hour promised. Telling
 * a user "degraded" without saying which leaves them unable to act on either.
 */
export function scopeStatus(facts: PopupFacts, t: Translator): ScopeStatusView {
  const { subject, watchedDomain } = facts;

  if (!subject) {
    return {
      kind: 'no-subject',
      label: t('scope.none.label'),
      detail: t('scope.none.detail'),
      offerDomain: null,
    };
  }

  if (!watchedDomain) {
    return {
      kind: 'out-of-scope',
      label: t('scope.out.label'),
      detail: t('scope.out.detail', { host: subject.host }),
      offerDomain: subject.host,
    };
  }

  if (!facts.hostAccess) {
    return {
      kind: 'degraded',
      label: t('scope.revoked.label'),
      detail: t('scope.revoked.detail', { domain: watchedDomain }),
      offerDomain: null,
    };
  }

  if (isShrunk(facts)) {
    return {
      kind: 'degraded',
      label: t('scope.shrunk.label'),
      detail: t('scope.shrunk.detail', {
        domain: watchedDomain,
        minutes: minutes(facts.coveredMinutes),
      }),
      offerDomain: null,
    };
  }

  return {
    kind: 'capturing',
    label: t('scope.capturing.label'),
    detail: t.plural(
      facts.tabEntryCount,
      'scope.capturing.detail.one',
      'scope.capturing.detail.other',
      { domain: watchedDomain },
    ),
    offerDomain: null,
  };
}

/**
 * A shrink still inside the rolling window. An older one shortened a window that has since been
 * replaced entry by entry, and reporting it would describe a past the store no longer holds.
 *
 * Exported because the side panel marks the low edge of its thread with the same distinction, and
 * two surfaces answering "was this window cut short" differently is two truths (`phase-10.md:126`).
 */
export function isShrunk({ shrunkAt, now }: PopupFacts): boolean {
  return shrunkAt !== null && now - shrunkAt < RETENTION_MS;
}

export interface DepthAvailability {
  depthMinutes: ExportDepthMinutes;
  enabled: boolean;
  /** Why it is off. Rendered, never only a tooltip: a disabled button takes no pointer events. */
  reason: string | null;
}

/**
 * Which depths the store can honour, and why the others cannot be clicked.
 *
 * The rule is not "disable everything deeper than what is held". A window shorter than the depth
 * asked for is the normal case — it is what `coveredDepthMinutes` exists to announce, and what
 * makes a sixty-minute click on a forty-minute store a legitimate request answered honestly.
 * Disabling those would make that acknowledgement unreachable.
 *
 * What is disabled is a tier the capture has not even reached the *previous* one of: asking for
 * thirty minutes against four minutes of capture is not a shortened window, it is a button that
 * cannot do anything the five-minute one does not already do. The shallowest tier is never
 * disabled — a store holding nothing still has to be exportable, so the emptiness is stated by a
 * report rather than by a surface that refuses to produce one.
 */
export function depthAvailability(coveredMinutes: number, t: Translator): DepthAvailability[] {
  return EXPORT_DEPTHS_MINUTES.map((depthMinutes, index) => {
    const previous = EXPORT_DEPTHS_MINUTES[index - 1];
    if (previous === undefined || coveredMinutes >= previous) {
      return { depthMinutes, enabled: true, reason: null };
    }
    return {
      depthMinutes,
      enabled: false,
      reason: t('export.depth.locked', { previous, held: minutes(coveredMinutes) }),
    };
  });
}

/** The depth a popup opens on before any export has ever been taken from this profile. */
export const DEFAULT_EXPORT_DEPTH_MINUTES: ExportDepthMinutes = 5;

/**
 * The depth the button offers, before anything is clicked.
 *
 * Nothing remembered is the first launch, and it opens on the shallowest tier. Not on the deepest
 * the store could serve: a first-time user is being shown what the gesture *is*, and the smallest
 * window is the one whose result they can read in full and judge the product on.
 *
 * A remembered depth is reused as-is when the store can still honour it — someone who exports
 * fifteen-minute windows all day should not re-pick fifteen every time the popup opens.
 *
 * When it cannot — a purge, a browser restarted five minutes ago — the fallback is the deepest tier
 * still honourable rather than the default. The remembered value says the user wants as much
 * context as they can get, and dropping them to five minutes because thirty is momentarily out of
 * reach would answer a question they did not ask. The shallowest tier is never disabled
 * (`state.ts:157`), so this always lands on something.
 */
export function resolveCurrentDepth(
  remembered: ExportDepthMinutes | null,
  availability: DepthAvailability[],
): ExportDepthMinutes {
  if (remembered === null) return DEFAULT_EXPORT_DEPTH_MINUTES;

  const enabled = availability.filter((depth) => depth.enabled);
  if (enabled.some((depth) => depth.depthMinutes === remembered)) return remembered;
  return enabled.at(-1)?.depthMinutes ?? DEFAULT_EXPORT_DEPTH_MINUTES;
}

/**
 * What the export will cover, before anything is clicked.
 *
 * The empty case is the reason this line exists at all. A user who clicks and *then* learns the
 * window held nothing has already pasted an empty report somewhere; the phase requires the
 * emptiness to be known first, so it is stated here, on open (`phase-8.md:133`).
 */
export function tabContextLine(facts: PopupFacts, t: Translator): string {
  const { subject } = facts;
  if (!subject) return t('popup.context.none');

  const who = { domain: facts.watchedDomain ?? subject.host, tabId: subject.tabId };
  if (facts.tabEntryCount === 0) return t('popup.context.empty', who);

  return t.plural(facts.tabEntryCount, 'popup.context.held.one', 'popup.context.held.other', {
    ...who,
    minutes: minutes(facts.coveredMinutes),
  });
}

/**
 * Where the export is, from the point of view of someone who has not opened their downloads yet.
 *
 * Four states rather than one sentence that keeps changing. A download leaves no trace on the
 * surface that produced it — not on the page, not on the button — so the only proof the click
 * worked is this block. It had none of the marks of an event: idle, working, done and refused all
 * rendered as the same grey line, under a context line rendered the same way again. A reader had to
 * compare wordings to find out whether anything had happened.
 */
export type ExportFeedbackKind = 'idle' | 'working' | 'downloaded' | 'failed';

export interface ExportFeedbackView {
  kind: ExportFeedbackKind;
  /** What happened, in the few words that carry the state on their own (`design.md:28`). */
  headline: string;
  /** What the headline has no room for. Empty when there is nothing to add. */
  detail: string;
}

/**
 * Before any click. Says the gesture exists, and does not pretend anything has been written.
 *
 * A function rather than the constant it used to be: a frozen object is a sentence chosen once, at
 * module load, in whichever language was current then — and this one is on screen every time the
 * popup opens.
 */
export function idleFeedback(t: Translator): ExportFeedbackView {
  return { kind: 'idle', headline: t('export.idle.headline'), detail: t('export.idle.detail') };
}

/** Between the click and the answer. The depth is repeated: it is what the wait is for. */
export function workingFeedback(
  depthMinutes: ExportDepthMinutes,
  t: Translator,
): ExportFeedbackView {
  return {
    kind: 'working',
    headline: t('export.working.headline', { minutes: depthMinutes }),
    detail: '',
  };
}

/** The report was never rendered at all, and the reason is the worker's own words. */
export function exportFailure(reason: string, t: Translator): ExportFeedbackView {
  return { kind: 'failed', headline: t('export.failed.headline'), detail: reason };
}

/**
 * What the user is told they just took away.
 *
 * The filename leads, because it is the one thing that turns "it worked" into something actionable:
 * a download list holds everything the browser ever wrote, and a user who does not know what to
 * look for has been told nothing. It is also what the acknowledgement gained by becoming a file —
 * a clipboard has no name to give.
 *
 * The detail then carries what the file itself cannot say from the outside: how deep the report
 * really goes, whether it holds anything at all, and what it structurally cannot show. A depth is
 * only mentioned when it differs from the one asked for — repeating "5 min" after a five-minute
 * click is noise that trains the reader to skip the line where it matters.
 */
export function downloadAcknowledgement(
  bundle: ReportBundle,
  filename: string,
  outcome: DownloadOutcome,
  t: Translator,
): ExportFeedbackView {
  if (!outcome.ok) {
    return {
      kind: 'failed',
      headline: t('export.refused.headline'),
      detail: t('export.refused.detail', { reason: outcome.reason }),
    };
  }

  const { requestedDepthMinutes, coveredDepthMinutes } = bundle.window;
  const count = bundle.entries.length;

  const held =
    count === 0
      ? t('export.saved.empty', { minutes: minutes(requestedDepthMinutes) })
      : t.plural(count, 'export.saved.entries.one', 'export.saved.entries.other');

  // A tenth of a minute of slack: the covered depth is a measured duration, and the two are equal
  // in every way a reader cares about long before they are equal as floats.
  const shorter =
    coveredDepthMinutes < requestedDepthMinutes - 0.05
      ? t('export.saved.shorter', {
          covered: minutes(Number(coveredDepthMinutes.toFixed(1))),
          requested: requestedDepthMinutes,
        })
      : '';

  const gaps =
    bundle.gaps.length === 0
      ? ''
      : t('export.saved.gaps', {
          gaps: bundle.gaps.map((gap) => t(gapSummaryKey(gap.kind))).join(', '),
        });

  return {
    kind: 'downloaded',
    headline: t('export.saved.headline', { filename }),
    detail: [held, shorter, gaps].filter((part) => part.length > 0).join(' '),
  };
}

/**
 * The short form of a gap, keyed on the kind and never on the English sentence.
 *
 * The contract carries two wordings for the same four gaps, and they part company here.
 * `GAP_STATEMENTS` is rendered in the report and stays English, the report being outside this
 * translation (`prd.md:55`); the summaries the popup shows are catalog entries. `GapKind` is the
 * seam that keeps the two from being confused for one another.
 */
function gapSummaryKey(kind: GapKind): MessageKey {
  return `export.gap.${kind}`;
}

export interface InterruptionNoticeView {
  /** What happened, spelled out. Never left to an icon alone (`design.md:28`). */
  label: string;
  detail: string;
}

/**
 * The one death worth telling the user about, and the two facts it owes them.
 *
 * It says the extension was updated and that this stopped the capture. It does not say what to do
 * about it — there is nothing to do — and above all it does not say whether the capture came back:
 * the deep layer block sits directly under it and already answers that, in the present tense, from
 * the state rather than from a memory. Repeating it here would be a second truth about the same
 * thing, and the one written first would be the one that ages.
 *
 * A worker stop or a crash produces nothing to show. Both resume on the next request, so the notice
 * would announce an interruption the user never had and cannot distinguish from a real one.
 *
 * `null` is the normal case. Returning it rather than a "nothing happened" view is what lets the
 * surfaces render the block or not without holding the rule themselves.
 */
export function interruptionNotice(
  interrupted: boolean,
  t: Translator,
): InterruptionNoticeView | null {
  if (!interrupted) return null;

  return { label: t('interruption.label'), detail: t('interruption.detail') };
}

/**
 * Where the deep capture layer stands.
 *
 * It is the one capability of this product the user turns on themselves, and the only one with a
 * visible price: while it runs Chrome puts a banner on every tab of the profile that the user cannot
 * dismiss. So the block says what it costs before it is armed, and what is running once it is —
 * anything less would be a banner appearing over a click that never mentioned it.
 *
 * `canceled` is a state of its own rather than a return to `stopped`. The user refused from Chrome's
 * banner, not from this popup, and the surface that will not re-attach on its own has to say so —
 * otherwise a layer showing "off" right after a refusal reads as a product that ignored it.
 */
export type DeepLayerKind = 'unavailable' | 'stopped' | 'active' | 'canceled';

/** The one action the block offers, or `null` when the browser leaves nothing to offer. */
export interface DeepLayerAction {
  label: string;
  intent: 'start' | 'stop';
}

export interface DeepLayerView {
  kind: DeepLayerKind;
  /** The state, spelled out. Never left to colour alone (`design.md:28`). */
  label: string;
  detail: string;
  action: DeepLayerAction | null;
}

/**
 * Whether the worker's answer to a start or a stop is a failure.
 *
 * The worker answers the session state when it worked and `{ error }` when it did not
 * (`entrypoints/background.ts:310`), and the popup has to tell the two apart: a start that threw
 * used to leave the button looking like it had done nothing, which is exactly how a permission the
 * browser was refusing outright stayed invisible for a whole phase.
 */
export function isDeepLayerFailure(answer: unknown): answer is { error: string } {
  return (
    typeof answer === 'object' &&
    answer !== null &&
    typeof (answer as { error?: unknown }).error === 'string'
  );
}

/** What the popup reads before it can render the block. */
export interface DeepLayerFacts {
  /** The browser's verdict, from `capture/cdp/support.ts`. */
  support: DeepLayerSupport;
  /** Whether the user armed the layer. */
  armed: boolean;
  /** Whether Chrome's banner Cancel took every session down. */
  canceledByUser: boolean;
  /** How many tabs hold a session right now. */
  attachedTabs: number;
}

/**
 * The four states, and the sentence each of them owes the user.
 *
 * Unavailability comes first and is unconditional: below Chrome 118 an attached session lets the
 * service worker die without a word, so a layer offered there would arm, put the banner up, and stop
 * capturing at the first idle moment. The reason is named — a refusal with no reason reads as a bug.
 */
export function deepLayerView(facts: DeepLayerFacts, t: Translator): DeepLayerView {
  const start: DeepLayerAction = { label: t('deep.start'), intent: 'start' };

  if (!facts.support.supported) {
    // A version below the threshold always carries its number (`support.ts:89`); the type is the
    // one that cannot say so. Left out rather than blanked if it ever were absent, so the sentence
    // would read as the defect it is instead of as one that meant to say nothing.
    const chrome = facts.support.chromeMajorVersion;
    const version: MessageParams = chrome === null ? {} : { version: chrome };

    return {
      kind: 'unavailable',
      label: t('deep.unavailable.label'),
      detail:
        facts.support.reason === 'below-keepalive'
          ? t('deep.unavailable.version', { ...version, required: KEEPALIVE_CHROME_VERSION })
          : t('deep.unavailable.browser'),
      action: null,
    };
  }

  if (facts.canceledByUser) {
    return {
      kind: 'canceled',
      label: t('deep.canceled.label'),
      detail: t('deep.canceled.detail'),
      action: start,
    };
  }

  if (facts.armed) {
    return {
      kind: 'active',
      label: t('deep.active.label'),
      detail: t.plural(facts.attachedTabs, 'deep.active.detail.one', 'deep.active.detail.other'),
      action: { label: t('deep.stop'), intent: 'stop' },
    };
  }

  return {
    kind: 'stopped',
    label: t('deep.stopped.label'),
    detail: t('deep.stopped.detail'),
    action: start,
  };
}
