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
