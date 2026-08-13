import type { SubmitEvent } from 'react';

import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/registry';
import type { MessageParams } from '@/i18n/translate';
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
 * Which of the three outcomes was reported, kept as a key rather than as a sentence.
 *
 * A resolved sentence would freeze the language it was resolved in: switching language with an
 * error on screen would repaint the whole page around a message left in the previous one.
 */
interface FormError {
  key: MessageKey;
  params: MessageParams;
}

/**
 * Adds a domain to the watched list.
 *
 * The sequence — validate, ask the browser, store only if it said yes — belongs to `watchDomain`,
 * where it can be tested without a browser. What is left here is the part that only a screen can
 * do: keep the call inside the gesture, and say out loud which of the three outcomes happened.
 */
export function AddDomainForm({ onAdded, initialDomain = '' }: AddDomainFormProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialDomain);
  const [error, setError] = useState<FormError | null>(null);
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
          setError({ key: 'domains.add.invalid', params: { value: value.trim() } });
          return;
        }
        if (outcome.status === 'refused') {
          setError({ key: 'domains.add.refused', params: { domain: outcome.domain } });
          return;
        }
        setValue('');
        onAdded();
      })
      .catch((cause: unknown) => {
        console.error('[vigie] could not add %s', value, cause);
        setError({ key: 'domains.add.failed', params: { value: value.trim() } });
      })
      .finally(() => setPending(false));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Input
          data-testid="add-domain-input"
          aria-label={t('domains.add.label')}
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
          {t('domains.add.submit')}
        </Button>
      </div>

      {error ? (
        <p id="add-domain-error" data-testid="add-domain-error" role="alert" className="text-sm text-destructive">
          {t(error.key, error.params)}
        </p>
      ) : null}
    </form>
  );
}
