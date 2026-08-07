import type { ExportDepthMinutes } from '@vigie/contract';

import { Button } from '@/ui/components/button';

interface CopyFeedbackProps {
  text: string;
  /**
   * The depth to try again, set only when the copy failed. A retry is a new click and therefore a
   * new transient activation — the one thing a failed `writeText` most often lacked.
   */
  retryDepth: ExportDepthMinutes | null;
  onRetry: (depthMinutes: ExportDepthMinutes) => void;
}

/**
 * The acknowledgement. What left with the user that they cannot see in the clipboard: how deep
 * the report really goes, whether it holds anything, and what it structurally cannot show.
 *
 * `role="status"` rather than a plain paragraph: the copy happens with no visible change anywhere
 * else, so a screen reader has to be told the click did something.
 */
export function CopyFeedback({ text, retryDepth, onRetry }: CopyFeedbackProps) {
  return (
    <div className="flex flex-col gap-2">
      <p data-testid="export-status" role="status" className="text-xs text-muted-foreground">
        {text}
      </p>

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
    </div>
  );
}
