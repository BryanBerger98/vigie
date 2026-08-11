import { FileCheck2, FileDown, FileX2, LoaderCircle, type LucideIcon } from 'lucide-react';

import type { ExportFeedbackKind, ExportFeedbackView } from './state';

interface ExportFeedbackProps {
  feedback: ExportFeedbackView;
}

/**
 * The acknowledgement, and the only proof the click did anything.
 *
 * A download changes nothing on the surface that produced it: not the page, not the button, and the
 * file lands in a list the popup cannot show. So the block that reports it has to look like an
 * event — previously it was a grey line under a context line rendered exactly the same way, and
 * telling "done" from "not yet" meant reading both and comparing wordings.
 *
 * It carries the filename first, then what the file cannot say from the outside: how deep the
 * report really goes, whether it holds anything, and what it structurally cannot show.
 *
 * There is no retry button any more. The one it replaced existed because a refused `writeText` had
 * usually just lost its transient activation, and a second click was a second activation. A
 * download depends on no such thing, so a failure here is a real failure — and trying again is the
 * Export button, which is where a user already looks.
 *
 * `role="status"` rather than a plain paragraph, on the block rather than on one line inside it:
 * the whole acknowledgement is what changed, and a screen reader has to be told the click did
 * something when nothing else on the surface moved.
 */

/**
 * One icon per state. Four silhouettes, not four hues — the same rule the scope block follows
 * (`ScopeStatus.tsx:32`): the distinction survives a greyscale screenshot and a reader who does
 * not separate red from green.
 */
const ICON: Record<ExportFeedbackKind, LucideIcon> = {
  idle: FileDown,
  working: LoaderCircle,
  downloaded: FileCheck2,
  failed: FileX2,
};

/**
 * One tone per state.
 *
 * Idle and working stay neutral: a popup that opens already shouting has nothing left to say when
 * something actually happens. The colour arrives with the outcome, which is what makes the arrival
 * itself readable — and it never carries the state alone, the headline beside it says the same
 * thing in words (`design.md:28`).
 */
const TONE: Record<ExportFeedbackKind, string> = {
  idle: 'border-border bg-muted/40 text-muted-foreground',
  working: 'border-border bg-muted/40 text-muted-foreground',
  downloaded: 'border-success/30 bg-success/10 text-success',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function ExportFeedback({ feedback }: ExportFeedbackProps) {
  const Icon = ICON[feedback.kind];

  return (
    <section
      data-testid="export-status"
      data-state={feedback.kind}
      role="status"
      className={`flex flex-col gap-2 rounded-lg border p-3 ${TONE[feedback.kind]}`}
    >
      {/* Aligned to the top rather than centred, and wrapping on any character: a filename is longer
          than a popup is wide, and it is the one string here that must never be cut off. */}
      <p
        data-testid="export-status-headline"
        className="flex items-start gap-2 text-sm font-semibold break-all"
      >
        {/* Hidden from the reading order: the headline right beside it already carries the state,
            and an announced icon would have a screen reader say it twice. */}
        <Icon
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 ${feedback.kind === 'working' ? 'animate-spin' : ''}`}
        />
        {feedback.headline}
      </p>

      {feedback.detail.length === 0 ? null : (
        <p data-testid="export-status-detail" className="text-xs text-foreground/80">
          {feedback.detail}
        </p>
      )}
    </section>
  );
}
