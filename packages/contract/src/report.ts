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
  /** `webRequest` never exposes response bodies. Structural, not a failure. */
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
    'Response bodies are not included. Chrome exposes no response body to an observing extension, in any version, so their absence here says nothing about the responses themselves.',
  'browser-messages-out-of-reach':
    'Messages the browser generates itself are missing: CORS and CSP violations, mixed content, and failed resource loads. They are printed by the browser rather than routed through console.*, which is the only channel this capture can observe.',
  'capture-started-after-page-load':
    'Capture began after this page had loaded, because its domain was added or the extension was installed while the tab was already open. Nothing emitted before that point exists; reload the page to cover a full load.',
  'window-shrunk-by-quota':
    'The window covered is shorter than the one requested: storage pressure forced the oldest entries out before the hour was up.',
};

/** A gap with its canonical wording. The only way a report should ever build one. */
export function reportGap(kind: GapKind): ReportGap {
  return { kind, statement: GAP_STATEMENTS[kind] };
}

/**
 * The gaps that hold for every report this version produces, whatever the capture observed.
 *
 * They are structural: no response body will ever be available, and no browser-generated message
 * will ever be captured without `chrome.debugger`. Stating them unconditionally is the point —
 * a reader must know what they cannot see before drawing a conclusion from an absence.
 */
export const STRUCTURAL_GAPS: readonly GapKind[] = [
  'response-bodies-unavailable',
  'browser-messages-out-of-reach',
];

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
