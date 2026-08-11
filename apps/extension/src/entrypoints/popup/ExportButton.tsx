import type { ExportDepthMinutes } from '@vigie/contract';
import { ChevronDown } from 'lucide-react';

import { Button, buttonVariants } from '@/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components/dropdown-menu';
import { cn } from '@/ui/lib/utils';

import type { DepthAvailability } from './state';

interface ExportButtonProps {
  /** The depth the body exports, decided by `resolveCurrentDepth`. */
  currentDepth: ExportDepthMinutes;
  availability: DepthAvailability[];
  /** True while an export is in flight. */
  busy: boolean;
  onExport: (depthMinutes: ExportDepthMinutes) => void;
}

/**
 * One button that exports, and a caret that changes what it exports.
 *
 * The gesture the plan took on `spec.md:21` is unchanged — a click *is* the export, never a choice
 * to confirm afterwards. What changes is that the choice is no longer made every time: the body
 * carries the depth the user last used, so the common case is one click on a button that already
 * says what it will do. The four tiers are still one gesture away, behind the caret.
 *
 * A tier the store cannot honour keeps its place in the menu, refuses the click, and carries its
 * reason as text under its own label. Not a tooltip: a disabled item takes no pointer events, so a
 * tooltip on it can never be reached (`dropdown-menu.tsx:56`).
 *
 * The two halves are one control visually — outer corners rounded, the seam a shared border — and
 * two controls for the keyboard and the accessibility tree, which is what they are.
 */
export function ExportButton({
  currentDepth,
  availability,
  busy,
  onExport,
}: ExportButtonProps) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold">Export the last</h2>

      <div className="flex">
        <Button
          data-testid="export-run"
          variant="outline"
          size="sm"
          className="flex-1 rounded-r-none"
          disabled={busy}
          onClick={() => onExport(currentDepth)}
        >
          {`Export ${currentDepth} min`}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="export-menu"
            aria-label="Choose another depth"
            disabled={busy}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'rounded-l-none border-l-0 px-2',
            )}
          >
            <ChevronDown aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            {availability.map((depth) => (
              <DropdownMenuItem
                key={depth.depthMinutes}
                data-testid={`export-${depth.depthMinutes}`}
                // Read by the end-to-end suite: a disabled Radix item carries `data-disabled`, not
                // the `disabled` property a `<button>` would expose, and the reason has to be
                // assertable without opening a tooltip that cannot be opened.
                data-enabled={depth.enabled}
                data-reason={depth.reason ?? undefined}
                disabled={!depth.enabled}
                onSelect={() => onExport(depth.depthMinutes)}
              >
                <span>{`${depth.depthMinutes} min`}</span>
                {depth.reason ? (
                  <span className="text-xs text-muted-foreground">{depth.reason}</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  );
}
