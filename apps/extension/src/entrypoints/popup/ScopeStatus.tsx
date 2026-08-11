import { EyeOff, Minus, Radio, TriangleAlert, type LucideIcon } from 'lucide-react';

import { Button } from '@/ui/components/button';

import type { ScopeStatusView } from './state';

interface ScopeStatusProps {
  status: ScopeStatusView;
  /** Called with the domain the user is offering to watch. Only ever reached out of scope. */
  onWatch: (domain: string) => void;
}

/**
 * The most legible thing on the surface, because it is the one that is easiest to get wrong.
 *
 * Nothing visibly happens whether the capture is running or not, so out of scope has to be read
 * on arrival rather than discovered at export time (`design.md:21`). It is therefore the only
 * state carrying an action, and the action is the single one that resolves it: watch this domain.
 *
 * The state is carried by its label and by an icon, never by the border colour alone
 * (`design.md:28`). `data-state` is the same information for the end-to-end suite, which cannot
 * assert on a colour either.
 *
 * Shared with the side panel, which imports this file rather than restating the four states
 * (`sidepanel/App.tsx:8`). One surface saying "out of scope" while the other says something else
 * about the same tab is two truths, and neither would be trustworthy.
 */

/**
 * One icon per state. Four silhouettes, not four hues: the distinction has to survive a greyscale
 * screenshot, a monochrome display and a reader who does not separate red from green.
 */
const ICON: Record<ScopeStatusView['kind'], LucideIcon> = {
  'no-subject': Minus,
  'out-of-scope': EyeOff,
  capturing: Radio,
  degraded: TriangleAlert,
};

/**
 * One tone per state, and no two states sharing one.
 *
 * `degraded` and `out-of-scope` used to both sit on `border-destructive`, which made the frame say
 * nothing: half of what it distinguished was a difference the eye could not see. Degraded is a
 * capture that still runs on less than it promised, which is a warning; out of scope is a capture
 * that is not happening at all, which is the destructive one.
 */
const TONE: Record<ScopeStatusView['kind'], string> = {
  'no-subject': 'border-border bg-muted/40 text-muted-foreground',
  'out-of-scope': 'border-destructive/30 bg-destructive/10 text-destructive',
  capturing: 'border-success/30 bg-success/10 text-success',
  degraded: 'border-warning/30 bg-warning/10 text-warning',
};

export function ScopeStatus({ status, onWatch }: ScopeStatusProps) {
  const Icon = ICON[status.kind];

  return (
    <section
      data-testid="scope-status"
      data-state={status.kind}
      className={`flex flex-col gap-2 rounded-lg border p-3 ${TONE[status.kind]}`}
    >
      <p data-testid="scope-label" className="flex items-center gap-2 text-sm font-semibold">
        {/* Hidden from the reading order: the label right beside it already carries the state, and
            an announced icon would have a screen reader say it twice. */}
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {status.label}
      </p>

      <p data-testid="scope-detail" className="text-xs text-foreground/80">
        {status.detail}
      </p>

      {status.offerDomain ? (
        <Button
          data-testid="scope-watch-domain"
          size="sm"
          className="self-start"
          onClick={() => onWatch(status.offerDomain as string)}
        >
          {`Watch ${status.offerDomain}`}
        </Button>
      ) : null}
    </section>
  );
}
