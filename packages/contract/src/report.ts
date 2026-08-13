import type { CaptureEntry } from './events';

/**
 * Shape of an exported bundle. Frozen here rather than in the renderer, because the report is
 * the product: the Markdown is one rendering of this object, and a second consumer (a future
 * SDK, a diff tool) must read the same thing.
 */

/** The four export depths, in minutes. One hour is a hard ceiling, not a default. */
export const EXPORT_DEPTHS_MINUTES = [5, 15, 30, 60] as const;

export type ExportDepthMinutes = (typeof EXPORT_DEPTHS_MINUTES)[number];

export const MAX_EXPORT_DEPTH_MINUTES = 60;

/**
 * The four ways a report can be incomplete. Each one is stated in the header rather than left
 * to be inferred from an absence — a reader has to know what it cannot see before concluding.
 */
export type GapKind =
  /** The deep layer was not on this window, and nothing else reaches a response body. */
  | 'response-bodies-unavailable'
  /** CORS, CSP, mixed content, failed loads: never routed through `console.*`. */
  | 'browser-messages-out-of-reach'
  /** The page was already loaded when capture started; what preceded it is gone. */
  | 'capture-started-after-page-load'
  /** Storage quota forced the rolling window below the requested depth. */
  | 'window-shrunk-by-quota';

export interface ReportGap {
  kind: GapKind;
  /** The sentence rendered in the report. Explicit prose, not a code a reader must decode. */
  statement: string;
}

/**
 * The sentence each gap is rendered as. Written here rather than in the renderer, so the wording a
 * reader trusts is versioned with the contract and cannot drift between two surfaces.
 *
 * Each one names what is missing *and* why, because a reader who does not know the cause cannot
 * tell a limit of the tool from a symptom of their bug — which is the mistake these lines exist to
 * prevent. `capture-started-after-page-load` is the answer to the open question at `spec.md:24`:
 * a page already open when its domain was added carries no earlier context, and says so.
 */
export const GAP_STATEMENTS: Record<GapKind, string> = {
  'response-bodies-unavailable':
    'Response bodies are not included: the deep capture layer was not running on this tab, and no other channel exposes a response body to an extension. Their absence here says nothing about the responses themselves. Arm the deep layer before reproducing to capture them.',
  'browser-messages-out-of-reach':
    'Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.',
  'capture-started-after-page-load':
    'Capture began after this page had loaded, because its domain was added or the extension was installed while the tab was already open. Nothing emitted before that point exists; reload the page to cover a full load.',
  'window-shrunk-by-quota':
    'The window covered is shorter than the one requested: storage pressure forced the oldest entries out before the hour was up.',
};

/**
 * The same four gaps, in the few words a control surface has room for.
 *
 * A popup is a few hundred pixels wide and cannot render `GAP_STATEMENTS` without burying the
 * button underneath them, but a user who copies a report has to leave knowing what it does not
 * hold. These are that summary, in English, for any consumer that has no catalog of its own.
 *
 * Of the two sets, only `GAP_STATEMENTS` crosses an interface: it is rendered *in the report*, which
 * stays English whatever the interface language is, so a report read by someone else says the same
 * thing as the one that produced it. The summaries are rendered *in the extension*, which follows
 * the chosen language, and the extension therefore keys its own translations on `GapKind` rather
 * than reading these strings. `GapKind` is what keeps the two from being confused for one another.
 */
export const GAP_SUMMARIES: Record<GapKind, string> = {
  'response-bodies-unavailable': 'no response bodies without the deep layer',
  'browser-messages-out-of-reach': 'no browser-generated messages',
  'capture-started-after-page-load': 'nothing before the page had loaded',
  'window-shrunk-by-quota': 'window shortened by storage pressure',
};

/** A gap with its canonical wording. The only way a report should ever build one. */
export function reportGap(kind: GapKind): ReportGap {
  return { kind, statement: GAP_STATEMENTS[kind] };
}

/**
 * The gaps that hold for every report this version produces, whatever the capture observed.
 *
 * One is left, and it is structural in the strict sense: a CORS refusal, a CSP violation and a
 * blocked mixed-content load are printed by the browser itself and routed through no channel an
 * extension can observe. Stating it unconditionally is the point — a reader must know what they
 * cannot see before drawing a conclusion from an absence.
 *
 * Response bodies used to sit here and no longer do. The deep layer reaches them, so their absence
 * has become a fact about one report rather than about the product, and `declareGaps` decides it per
 * window. A gap that is stated when it does not hold costs more than one that is not stated at all:
 * it teaches a reader to skip the header.
 */
export const STRUCTURAL_GAPS: readonly GapKind[] = ['browser-messages-out-of-reach'];

export interface ReportWindow {
  /** Depth the user asked for, before the one-hour ceiling and before what is actually held. */
  requestedDepthMinutes: ExportDepthMinutes;
  /** Instant the bundle was frozen. Nothing after it enters the report. */
  frozenAt: number;
  /** Start of the covered window, epoch milliseconds. */
  from: number;
  /** End of the covered window. Equal to `frozenAt`. */
  to: number;
  /**
   * Depth the store really covers, which is shorter than requested whenever capture started
   * late or the quota shrank the window.
   */
  coveredDepthMinutes: number;
}

export interface ReportSubject {
  domain: string;
  tabId: number;
  url: string;
  title?: string;
}

export interface ReportBundle {
  schemaVersion: number;
  /** Extension version the bundle was produced by, as declared in the manifest. */
  extensionVersion: string;
  window: ReportWindow;
  subject: ReportSubject;
  /** Declared first in the rendering, never as a footnote. */
  gaps: ReportGap[];
  /** One timeline, all kinds mixed, ordered by ascending timestamp. Unsorted beyond that. */
  entries: CaptureEntry[];
}

export function isExportDepth(value: unknown): value is ExportDepthMinutes {
  return EXPORT_DEPTHS_MINUTES.includes(value as ExportDepthMinutes);
}

/**
 * What a surface sends to have a report cut, and what comes back.
 *
 * This crosses a boundary — a popup or a side panel to the service worker — which is why it is
 * declared here rather than in the extension. The worker is the one that has to serve it: it owns
 * the write queue, so it is the only place that can freeze an instant and then guarantee that
 * everything captured before it has reached the disk.
 */
export const EXPORT_MESSAGE = 'vigie:export';

export interface ExportRequest {
  type: typeof EXPORT_MESSAGE;
  /** The tab the report is about. An export is always one tab's story (`prd.md`). */
  tabId: number;
  depthMinutes: ExportDepthMinutes;
}

export interface ExportResult {
  bundle: ReportBundle;
  /** The rendered report — exactly the text the downloaded file holds, rendered once. */
  markdown: string;
}

/** The failure form. Returned rather than thrown: a message channel cannot carry an exception. */
export interface ExportFailure {
  error: string;
}

export function exportRequest(tabId: number, depthMinutes: ExportDepthMinutes): ExportRequest {
  return { type: EXPORT_MESSAGE, tabId, depthMinutes };
}

/**
 * Validates the whole shape, not just the discriminant. The worker answers any page of the
 * extension and, through `externally_connectable` in a later version, possibly more than that.
 */
export function isExportRequest(value: unknown): value is ExportRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ExportRequest>;
  return (
    candidate.type === EXPORT_MESSAGE &&
    typeof candidate.tabId === 'number' &&
    Number.isFinite(candidate.tabId) &&
    isExportDepth(candidate.depthMinutes)
  );
}

export function isExportFailure(value: unknown): value is ExportFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ExportFailure).error === 'string'
  );
}
