import type { ExportDepthMinutes } from '@vigie/contract';
import { Clipboard, ClipboardCheck, ClipboardX, LoaderCircle, type LucideIcon } from 'lucide-react';

import { Button } from '@/ui/components/button';

import type { CopyFeedbackKind, CopyFeedbackView } from './state';

interface CopyFeedbackProps {
  feedback: CopyFeedbackView;
  /**
   * The depth to try again, set only when the copy failed. A retry is a new click and therefore a
   * new transient activation — the one thing a failed `writeText` most often lacked.
   */
  retryDepth: ExportDepthMinutes | null;
  onRetry: (depthMinutes: ExportDepthMinutes) => void;
}

/**
 * The acknowledgement, and the only proof the click did anything.
 *
 * A copy changes nothing a user can see: not the page, not the button, and not the clipboard,
 * which cannot be opened to check. So the block that reports it has to look like an event —
 * previously it was a grey line under a context line rendered exactly the same way, and telling
 * "copied" from "not copied yet" meant reading both and comparing wordings.
 *
 * It also carries what left with the user that the clipboard does not show: how deep the report
 * really goes, whether it holds anything, and what it structurally cannot show.
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
const ICON: Record<CopyFeedbackKind, LucideIcon> = {
  idle: Clipboard,
  working: LoaderCircle,
  copied: ClipboardCheck,
  failed: ClipboardX,
};

/**
 * One tone per state.
 *
 * Idle and working stay neutral: a popup that opens already shouting has nothing left to say when
 * something actually happens. The colour arrives with the outcome, which is what makes the arrival
 * itself readable — and it never carries the state alone, the headline beside it says the same
 * thing in words (`design.md:28`).
 */
const TONE: Record<CopyFeedbackKind, string> = {
  idle: 'border-border bg-muted/40 text-muted-foreground',
  working: 'border-border bg-muted/40 text-muted-foreground',
  copied: 'border-success/30 bg-success/10 text-success',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function CopyFeedback({ feedback, retryDepth, onRetry }: CopyFeedbackProps) {
  const Icon = ICON[feedback.kind];

  return (
    <section
      data-testid="export-status"
      data-state={feedback.kind}
      role="status"
      className={`flex flex-col gap-2 rounded-lg border p-3 ${TONE[feedback.kind]}`}
    >
      <p
        data-testid="export-status-headline"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        {/* Hidden from the reading order: the headline right beside it already carries the state,
            and an announced icon would have a screen reader say it twice. */}
        <Icon
          aria-hidden="true"
          className={`size-4 shrink-0 ${feedback.kind === 'working' ? 'animate-spin' : ''}`}
        />
        {feedback.headline}
      </p>

      {feedback.detail.length === 0 ? null : (
        <p data-testid="export-status-detail" className="text-xs text-foreground/80">
          {feedback.detail}
        </p>
      )}

      {retryDepth === null ? null : (
        <Button
          data-testid="copy-retry"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onRetry(retryDepth)}
        >
          Copy again
        </Button>
      )}
    </section>
  );
}
