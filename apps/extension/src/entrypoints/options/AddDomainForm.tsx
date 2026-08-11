import type { SubmitEvent } from 'react';

import { watchDomain } from '@/storage/watched-domains';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';

interface AddDomainFormProps {
  /** Called once a domain made it into the list, so the page can read it back. */
  onAdded: () => void;
  /**
   * What the field starts with. Filled when the popup handed a domain over: the user asked to
   * watch a specific site, and retyping it here would be the second half of a request they
   * already made.
   */
  initialDomain?: string;
}

/**
 * Adds a domain to the watched list.
 *
 * The sequence — validate, ask the browser, store only if it said yes — belongs to `watchDomain`,
 * where it can be tested without a browser. What is left here is the part that only a screen can
 * do: keep the call inside the gesture, and say out loud which of the three outcomes happened.
 */
export function AddDomainForm({ onAdded, initialDomain = '' }: AddDomainFormProps) {
  const [value, setValue] = useState(initialDomain);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);

    // Reached without an intervening `await`: Chrome ties the permission prompt to the user
    // gesture that submitted this form, and any suspension before the call loses it.
    watchDomain(value)
      .then((outcome) => {
        if (outcome.status === 'invalid') {
          setError(`"${value.trim()}" is not a domain. Try example.com, or paste a URL.`);
          return;
        }
        if (outcome.status === 'refused') {
          setError(`Chrome did not grant access to ${outcome.domain}, so it was not added.`);
          return;
        }
        setValue('');
        onAdded();
      })
      .catch((cause: unknown) => {
        console.error('[vigie] could not add %s', value, cause);
        setError(`Something went wrong while adding "${value.trim()}".`);
      })
      .finally(() => setPending(false));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Input
          data-testid="add-domain-input"
          aria-label="Domain to watch"
          aria-invalid={error !== null}
          aria-describedby={error ? 'add-domain-error' : undefined}
          placeholder="example.com"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={pending}
        />
        <Button data-testid="add-domain-submit" type="submit" disabled={pending || !value.trim()}>
          Add
        </Button>
      </div>

      {error ? (
        <p id="add-domain-error" data-testid="add-domain-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
