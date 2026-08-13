import { History } from 'lucide-react';

import type { InterruptionNoticeView } from './state';

interface InterruptionNoticeProps {
  notice: InterruptionNoticeView;
}

/**
 * A statement, not an alert. Nothing here can be clicked.
 *
 * It reports something already over: the extension was updated and that took the capture with it.
 * There is no action that undoes it and none is offered — a button here would suggest the user was
 * supposed to do something, and the only honest instruction would be "wait", which is not an
 * instruction. The neutral tone is the same choice: a warning frame would put the reader on alert
 * about a past event whose consequence the block right underneath already states in the present.
 *
 * It sits first because it covers the whole capture window, while everything below it covers the
 * current tab. It is shown once and never again — the mark is read and cleared in the same move
 * (`capture/cdp/session-state.ts:213`), so the next opening of this surface has nothing to render.
 *
 * Shared with the side panel for the reason `ScopeStatus.tsx:24` gives: two surfaces wording the
 * same fact differently is two truths.
 */
export function InterruptionNotice({ notice }: InterruptionNoticeProps) {
  return (
    <section
      data-testid="interruption-notice"
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-muted-foreground"
    >
      <p data-testid="interruption-label" className="flex items-center gap-2 text-sm font-semibold">
        {/* Hidden from the reading order: the label beside it already carries the fact, and an
            announced icon would have a screen reader say it twice (`ScopeStatus.tsx:65`). */}
        <History aria-hidden="true" className="size-4 shrink-0" />
        {notice.label}
      </p>

      <p data-testid="interruption-detail" className="text-xs text-foreground/80">
        {notice.detail}
      </p>
    </section>
  );
}
