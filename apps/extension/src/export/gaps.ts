import { reportGap, STRUCTURAL_GAPS, type CaptureEntry, type ReportGap } from '@vigie/contract';

import type { StorageState } from '@/storage/prune';

import type { WindowBounds } from './slice';

/**
 * What the report cannot show, stated rather than left to be inferred.
 *
 * An absence in a debugging report is ambiguous by nature: a missing CORS error reads either as
 * "there was none" or as "the tool cannot see them", and those lead to opposite conclusions. Every
 * gap this version has is therefore written out as a sentence at the head of the report
 * (`prd.md:79`), and the wording lives in the contract so two surfaces cannot drift apart.
 *
 * Two of the four are structural — they hold for every report this version produces — and two are
 * situational. The structural ones come first because they change how the whole body must be read;
 * the situational ones follow, because they change only what the window happened to contain.
 */

/** The `webRequest` resource type of a page's own document request. */
const MAIN_FRAME = 'main_frame';

export interface GapContext {
  bounds: WindowBounds;
  /** The sliced window, already cut to the tab. */
  entries: readonly CaptureEntry[];
  /** The last readout the purge left behind — the only place a quota shrink is recorded. */
  storage: StorageState;
}

/**
 * Whether the report contains the page's own load.
 *
 * The document request is the first thing the capture sees on a page it was watching when it
 * loaded. Its absence means the capture was not there for it: the domain was added, or the
 * extension installed, while the tab was already open — or the load has since fallen out of the
 * rolling hour, which leaves the reader in exactly the same position and with the same remedy.
 */
function sawPageLoad(entries: readonly CaptureEntry[]): boolean {
  return entries.some((entry) => entry.kind === 'network' && entry.resourceType === MAIN_FRAME);
}

/**
 * Whether the purge had to go past the hour while this window was being captured.
 *
 * A shrink older than the window is not this report's problem: it dropped entries nobody asked
 * for here. One inside it dropped entries that would have been in this report, and that is the
 * whole reason the readout carries a timestamp rather than a flag (`prune.ts:56`).
 */
function shrunkInside(bounds: WindowBounds, storage: StorageState): boolean {
  return storage.shrunkAt !== null && storage.shrunkAt >= bounds.from;
}

export function declareGaps(context: GapContext): ReportGap[] {
  const gaps = STRUCTURAL_GAPS.map(reportGap);

  if (!sawPageLoad(context.entries)) gaps.push(reportGap('capture-started-after-page-load'));
  if (shrunkInside(context.bounds, context.storage)) gaps.push(reportGap('window-shrunk-by-quota'));

  return gaps;
}
