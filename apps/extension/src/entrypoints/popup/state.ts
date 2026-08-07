import {
  EXPORT_DEPTHS_MINUTES,
  GAP_SUMMARIES,
  type ExportDepthMinutes,
  type ReportBundle,
} from '@vigie/contract';

import type { CopyOutcome } from '@/export/clipboard';
import { RETENTION_MS } from '@/storage/prune';

/**
 * What the popup decides, with no browser under it.
 *
 * The surface itself is four small components and a click handler; everything that could be wrong
 * is here — which state the tab is in, which depths the store can honour, and what the user is
 * told they just copied. Kept pure so those three answers are asserted without a browser, and so
 * the components stay renderers rather than places where a rule hides.
 *
 * Every sentence this module returns is user-facing text. It lives beside the rule that produces
 * it on purpose: a state whose wording is written elsewhere is a state that can be rendered while
 * saying nothing about itself, which is the exact failure `design.md:21` warns about.
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
export function scopeStatus(facts: PopupFacts): ScopeStatusView {
  const { subject, watchedDomain } = facts;

  if (!subject) {
    return {
      kind: 'no-subject',
      label: 'No page to report on',
      detail: 'This window has no web page open, so there is nothing being captured to export.',
      offerDomain: null,
    };
  }

  if (!watchedDomain) {
    return {
      kind: 'out-of-scope',
      label: 'Out of scope',
      detail: `${subject.host} is not watched. Nothing on this tab is being captured, and nothing from before it is watched can ever be exported.`,
      offerDomain: subject.host,
    };
  }

  if (!facts.hostAccess) {
    return {
      kind: 'degraded',
      label: 'Degraded — host access revoked',
      detail: `${watchedDomain} is still on the watched list, but Chrome no longer grants access to it, so nothing is being captured. Grant it again from the settings.`,
      offerDomain: null,
    };
  }

  if (isShrunk(facts)) {
    return {
      kind: 'degraded',
      label: 'Degraded — window shortened',
      detail: `${watchedDomain} is being captured, but storage pressure pushed the oldest entries out: ${minutes(facts.coveredMinutes)} min are held instead of 60.`,
      offerDomain: null,
    };
  }

  return {
    kind: 'capturing',
    label: 'Capturing',
    detail: `${watchedDomain} is watched. ${facts.tabEntryCount} ${facts.tabEntryCount === 1 ? 'entry' : 'entries'} captured on this tab.`,
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
export function depthAvailability(coveredMinutes: number): DepthAvailability[] {
  return EXPORT_DEPTHS_MINUTES.map((depthMinutes, index) => {
    const previous = EXPORT_DEPTHS_MINUTES[index - 1];
    if (previous === undefined || coveredMinutes >= previous) {
      return { depthMinutes, enabled: true, reason: null };
    }
    return {
      depthMinutes,
      enabled: false,
      reason: `needs ${previous} min of capture, ${minutes(coveredMinutes)} min held`,
    };
  });
}

/** The disabled tiers, said out loud under the row rather than greyed out in silence. */
export function depthNotice(availability: DepthAvailability[]): string | null {
  const off = availability.filter((depth) => !depth.enabled);
  if (off.length === 0) return null;

  const tiers = off.map((depth) => `${depth.depthMinutes} min`).join(' and ');
  return `${tiers} unavailable: the capture does not reach back that far yet.`;
}

/**
 * What the export will cover, before anything is clicked.
 *
 * The empty case is the reason this line exists at all. A user who clicks and *then* learns the
 * window held nothing has already pasted an empty report somewhere; the phase requires the
 * emptiness to be known first, so it is stated here, on open (`phase-8.md:133`).
 */
export function tabContextLine(facts: PopupFacts): string {
  const { subject } = facts;
  if (!subject) return 'No tab selected.';

  const who = `${facts.watchedDomain ?? subject.host} · tab ${subject.tabId}`;
  if (facts.tabEntryCount === 0) {
    return `${who} · nothing captured on this tab yet, so a report would come out empty.`;
  }
  return `${who} · ${minutes(facts.coveredMinutes)} min available, ${facts.tabEntryCount} entries on this tab.`;
}

/**
 * What the user is told they just took away.
 *
 * Three things have to survive the copy, and none of them is visible in the clipboard: how deep
 * the report really goes, whether it holds anything at all, and what it structurally cannot show.
 * A depth is only mentioned when it differs from the one asked for — repeating "5 min" after a
 * five-minute click is noise that trains the reader to skip the line where it matters.
 */
export function copyAcknowledgement(bundle: ReportBundle, outcome: CopyOutcome): string {
  if (!outcome.ok) return `Report ready but not copied: ${outcome.reason}`;

  const { requestedDepthMinutes, coveredDepthMinutes } = bundle.window;
  const count = bundle.entries.length;

  const copied =
    count === 0
      ? `Copied an empty report: nothing was captured on this tab in the last ${minutes(requestedDepthMinutes)} min.`
      : `Copied ${count} ${count === 1 ? 'entry' : 'entries'}.`;

  // A tenth of a minute of slack: the covered depth is a measured duration, and the two are equal
  // in every way a reader cares about long before they are equal as floats.
  const shorter =
    coveredDepthMinutes < requestedDepthMinutes - 0.05
      ? ` It covers ${minutes(Number(coveredDepthMinutes.toFixed(1)))} min, not the ${requestedDepthMinutes} min asked: the capture does not reach further back.`
      : '';

  const gaps =
    bundle.gaps.length === 0
      ? ''
      : ` Declared in the report: ${bundle.gaps.map((gap) => GAP_SUMMARIES[gap.kind]).join(', ')}.`;

  return `${copied}${shorter}${gaps}`;
}
