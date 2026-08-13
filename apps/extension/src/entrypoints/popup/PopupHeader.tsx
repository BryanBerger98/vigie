import { Settings } from 'lucide-react';

import { useI18n } from '@/i18n/I18nProvider';
import { Button } from '@/ui/components/button';

/**
 * The bar every popup opens on, gate or no gate.
 *
 * It sits above the consent screen as well as above the working popup, because a user who lands on
 * the disclosure is a user who does not yet know what this window is — the moment the brand and the
 * title matter most is exactly the one they used to be missing from.
 *
 * The settings moved up here from the bottom row. They are not part of the export gesture and never
 * were: leaving them beside `Inspect live` made a permanent escape hatch look like a step of the
 * flow, and it cost the one action that *is* a step half of its width.
 */
export function PopupHeader() {
  const { t } = useI18n();

  return (
    <header data-testid="popup-header" className="flex items-center gap-2">
      {/* Empty `alt`: the title sits right beside it and says the same thing. The artwork is the
          only form the brand has — no vector exists — so it is rendered from the same file the
          browser toolbar uses. */}
      <img
        src="/icon/32.png"
        alt=""
        width={20}
        height={20}
        className="size-5 rounded-md"
      />
      <h1 className="text-sm font-semibold">Vigie</h1>

      <div className="flex-1" />

      {/* `title` rather than a tooltip primitive: none exists in this project, and an icon button
          whose only affordance is a hover card is one this phase has no reason to introduce. Both
          carry the same sentence, and both follow the language: an icon with an English label in a
          French interface is an icon with no label for whoever needs one. */}
      <Button
        data-testid="open-options"
        variant="ghost"
        size="icon"
        aria-label={t('popup.settings')}
        title={t('popup.settings')}
        onClick={() => void browser.runtime.openOptionsPage()}
      >
        <Settings aria-hidden="true" className="size-4" />
      </Button>
    </header>
  );
}
