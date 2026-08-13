import { Ban, Hand, Power, Radar, type LucideIcon } from 'lucide-react';

import { Button } from '@/ui/components/button';

import type { DeepLayerView } from './state';

interface DeepLayerControlProps {
  view: DeepLayerView;
  /**
   * What the worker answered when it could not do what the click asked, or `null`.
   *
   * It is rendered here rather than folded into `view`: the four states describe what the layer is
   * doing, and a failed click leaves that unchanged — the layer is still off, and saying so twice
   * with different words would hide which of the two lines is the new fact.
   */
  failure: string | null;
  /** Called on the click itself, with nothing awaited before it. See `App.tsx`. */
  onAct: (intent: 'start' | 'stop') => void;
}

/**
 * The one capability the user arms themselves, and the only one whose price is visible on every
 * tab of the profile.
 *
 * Built on the same three rules as `ScopeStatus.tsx`: an icon per state so the distinction survives
 * a greyscale screen, a label so the state is never carried by colour alone (`design.md:28`), and a
 * `data-state` for the end-to-end suite, which can assert on neither an icon nor a hue.
 *
 * Nothing here mentions DevTools. The two coexist in both arrival orders — whoever attached first
 * keeps the tab — and telling a user about a conflict they will meet once a year is telling them
 * about DevTools instead of about their capture.
 */

/**
 * One icon per state. Four silhouettes: a refusal by the browser, a switch that is off, a capture
 * that is running, and a refusal by the user — which is the one that must not read as "off".
 */
const ICON: Record<DeepLayerView['kind'], LucideIcon> = {
  unavailable: Ban,
  stopped: Power,
  active: Radar,
  canceled: Hand,
};

/**
 * One tone per state. `canceled` sits on the warning tone rather than on the neutral one `stopped`
 * uses: something the user asked for stopped, and a state that looks identical to never having
 * started it would hide the only fact worth reading here.
 */
const TONE: Record<DeepLayerView['kind'], string> = {
  unavailable: 'border-border bg-muted/40 text-muted-foreground',
  stopped: 'border-border bg-muted/40 text-foreground',
  active: 'border-success/30 bg-success/10 text-success',
  canceled: 'border-warning/30 bg-warning/10 text-warning',
};

export function DeepLayerControl({ view, failure, onAct }: DeepLayerControlProps) {
  const Icon = ICON[view.kind];
  const { action } = view;

  return (
    <section
      data-testid="deep-layer"
      data-state={view.kind}
      className={`flex flex-col gap-2 rounded-lg border p-3 ${TONE[view.kind]}`}
    >
      <p data-testid="deep-layer-label" className="flex items-center gap-2 text-sm font-semibold">
        {/* Hidden from the reading order: the label beside it already carries the state. */}
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {view.label}
      </p>

      <p data-testid="deep-layer-detail" className="text-xs text-foreground/80">
        {view.detail}
      </p>

      {failure ? (
        <p data-testid="deep-layer-failure" className="text-xs font-medium text-destructive">
          {failure}
        </p>
      ) : null}

      {action ? (
        <Button
          data-testid="deep-layer-action"
          data-intent={action.intent}
          size="sm"
          variant={action.intent === 'stop' ? 'outline' : 'default'}
          className="self-start"
          onClick={() => onAct(action.intent)}
        >
          {action.label}
        </Button>
      ) : null}
    </section>
  );
}
