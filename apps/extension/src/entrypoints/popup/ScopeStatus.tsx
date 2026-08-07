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
 * The state is carried by its label and by a glyph, never by the border colour alone
 * (`design.md:28`). `data-state` is the same information for the end-to-end suite, which cannot
 * assert on a colour either.
 */

/** One mark per state. Shape, not hue: it survives a monochrome screen and a screenshot diff. */
const MARK: Record<ScopeStatusView['kind'], string> = {
  'no-subject': '—',
  'out-of-scope': '○',
  capturing: '●',
  degraded: '△',
};

const TONE: Record<ScopeStatusView['kind'], string> = {
  'no-subject': 'border-border',
  'out-of-scope': 'border-destructive',
  capturing: 'border-primary',
  degraded: 'border-destructive',
};

export function ScopeStatus({ status, onWatch }: ScopeStatusProps) {
  return (
    <section
      data-testid="scope-status"
      data-state={status.kind}
      className={`flex flex-col gap-2 rounded-md border-l-2 pl-3 ${TONE[status.kind]}`}
    >
      <p className="text-sm font-semibold">
        <span aria-hidden="true" className="mr-1.5 font-normal">
          {MARK[status.kind]}
        </span>
        {status.label}
      </p>

      <p data-testid="scope-detail" className="text-xs text-muted-foreground">
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
