import { Button } from '@/ui/components/button';

import { openConsentScreen } from './state';
import type { ConsentState } from './state';

/**
 * What every surface shows instead of itself while the capture is locked.
 *
 * It replaces the surface rather than sitting above it: the popup's depth buttons would export a
 * window nothing was ever written to, and the settings' add-domain form would designate a domain
 * nothing is captured on. Both would read as a product that silently does nothing.
 *
 * The two locked states are told apart out loud. "Never asked" and "asked about a smaller capture
 * than the one now shipped" are different facts, and only the second one has something to tell the
 * user (`consent/state.ts:18`).
 */
export function ConsentRequired({ state }: { state: ConsentState }) {
  const stale = state.status === 'stale';

  return (
    <section
      data-testid="consent-required"
      data-state={state.status}
      className="flex flex-col items-start gap-3 rounded-md border p-4"
    >
      <p className="text-sm font-medium">
        {stale ? 'What Vigie captures has changed' : 'Vigie has not started capturing'}
      </p>
      <p className="text-sm text-muted-foreground">
        {stale
          ? 'Nothing is being captured until you have read the updated disclosure and agreed to it.'
          : 'Nothing is captured until you have read what Vigie records and agreed to it.'}
      </p>
      <Button data-testid="open-consent" size="sm" onClick={() => void openConsentScreen()}>
        Read what Vigie records
      </Button>
    </section>
  );
}
