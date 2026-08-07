import type { ExportDepthMinutes } from '@vigie/contract';

import { Button } from '@/ui/components/button';

import { depthNotice, type DepthAvailability } from './state';

interface DepthButtonsProps {
  availability: DepthAvailability[];
  /** True while an export is in flight. Nothing is selected, so there is nothing to re-click. */
  busy: boolean;
  onPick: (depthMinutes: ExportDepthMinutes) => void;
}

/**
 * Four buttons, one row, nothing preselected.
 *
 * A click is the export, not a choice to confirm afterwards — the decision the plan took on
 * `spec.md:21`. So there is no selected state to render and no submit button to look for: the
 * whole gesture between opening the popup and holding the report is this one click.
 *
 * A tier the capture cannot honour is disabled *and* says why, under the row. A tooltip would not
 * do: the button carries `disabled:pointer-events-none`, so a disabled tier never receives the
 * hover that would reveal one.
 */
export function DepthButtons({ availability, busy, onPick }: DepthButtonsProps) {
  const notice = depthNotice(availability);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold">Export the last</h2>

      <div className="flex gap-2">
        {availability.map((depth) => (
          <Button
            key={depth.depthMinutes}
            data-testid={`export-${depth.depthMinutes}`}
            data-reason={depth.reason ?? undefined}
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={busy || !depth.enabled}
            aria-label={
              depth.reason
                ? `${depth.depthMinutes} min, unavailable: ${depth.reason}`
                : `Export the last ${depth.depthMinutes} minutes`
            }
            onClick={() => onPick(depth.depthMinutes)}
          >
            {`${depth.depthMinutes} min`}
          </Button>
        ))}
      </div>

      {notice ? (
        <p data-testid="depth-notice" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
