import {
  CAPTURED,
  CONSENT_PROMISE,
  NOT_CAPTURED,
  PRIVACY_POLICY_URL,
  type DisclosureItem,
} from './text';

/**
 * The disclosure, rendered. One component for the two places it has to appear: the first-run screen
 * and the settings, where it stays readable after acceptance (`phase-9.md` tasks 2 and 3).
 *
 * Sharing the rendering is what makes the two agree by construction. Two copies of these
 * paragraphs would drift the first time one of them is edited, and a divergence between what the
 * product discloses in one surface and in another is the same defect as a divergence with the
 * privacy policy.
 *
 * The `data-testid` handles are what the end-to-end suite counts the announced categories on.
 */

function Item({ item }: { item: DisclosureItem }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{item.title}</span>
      <span className="text-muted-foreground">{item.body}</span>
    </div>
  );
}

export function Disclosure() {
  return (
    <div data-testid="consent-disclosure" className="flex flex-col gap-5 text-sm">
      <p data-testid="consent-promise">{CONSENT_PROMISE}</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">What Vigie captures</h2>
        <ul className="flex flex-col gap-3">
          {CAPTURED.map((item) => (
            <li key={item.id} data-testid="consent-captured" data-category={item.id}>
              <Item item={item} />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">What bounds it</h2>
        <ul className="flex flex-col gap-3">
          {NOT_CAPTURED.map((item) => (
            <li key={item.id} data-testid="consent-limit" data-category={item.id}>
              <Item item={item} />
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm">
        <a
          data-testid="privacy-policy-link"
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Privacy policy
        </a>
      </p>
    </div>
  );
}
