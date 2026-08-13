import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

import {
  buildVariantPath,
  createBuildVariant,
  removeBuildVariant,
} from '../fixtures/build-variant';
import { flushCapture, readCapturedEntries, seedCapturedEntry } from '../fixtures/capture-store';
import { reportFilenamePattern, takeDownload } from '../fixtures/downloaded-report';
import { expect, test } from '../fixtures/extension';
import { startTestSite, type TestSite } from '../fixtures/test-site';

/**
 * The language of the interface, in a browser that really announces one.
 *
 * Nothing here can be stated by a unit test. `chrome.i18n.getUILanguage()` has no faithful mock,
 * a preference shared between two open surfaces needs two real pages, and "without reloading" is
 * only meaningful against a document that could have reloaded. So this file runs the whole
 * mechanism through Chrome, and the units keep the arithmetic.
 *
 * It is the one spec that overrides `uiLanguage`. Every other spec runs under the fixture default
 * of `en-US`, which is what lets the existing English assertions stay untouched.
 *
 * On the language Chrome ends up announcing: `--lang` decides it on Linux and Windows, and is
 * ignored on macOS, where Chromium takes its locale from the operating system. Asking for French
 * and asserting French would therefore pass on the continuous integration machine and fail on a
 * developer's Mac, for a reason that has nothing to do with the product. So the tests below read
 * the language the browser actually announced and assert against that, rather than against the
 * one that was requested. Only the two whose subject *is* the detection need a shipped language
 * to have been announced, and they say so.
 *
 */

test.use({ uiLanguage: 'fr-FR' });
test.setTimeout(60_000);

const LANGUAGE_KEY = 'vigie:language';

/** The settings, as each shipped language renders them. */
const SETTINGS = {
  en: {
    label: 'English',
    automatic: 'Automatic — English',
    language: 'Language',
    domains: 'Watched domains',
    store: 'What is stored right now',
    empty: 'No domain is watched yet. Nothing is being captured.',
    add: 'Add',
    purge: 'Erase everything captured',
    refresh: 'Refresh',
    invalid: '"not a domain" is not a domain. Try example.com, or paste a URL.',
  },
  fr: {
    label: 'Français',
    automatic: 'Automatique — Français',
    language: 'Langue',
    domains: 'Domaines surveillés',
    store: 'Ce qui est stocké en ce moment',
    empty: "Aucun domaine n'est surveillé pour l'instant. Rien n'est capté.",
    add: 'Ajouter',
    purge: 'Tout effacer',
    refresh: 'Actualiser',
    invalid: "« not a domain » n'est pas un domaine. Essayez example.com, ou collez une URL.",
  },
} as const;

type Shipped = keyof typeof SETTINGS;

/** The consent screen, as each shipped language renders it. */
const CONSENT = {
  en: {
    heading: 'What Vigie records',
    captured: 'What Vigie captures',
    limits: 'What bounds it',
    network: 'Network traffic',
    policy: 'Privacy policy',
    policyUrl: /privacy-policy/,
    agreed: (date: string) => `Agreed on ${date}. Vigie is capturing on the domains you designate.`,
  },
  fr: {
    heading: 'Ce que Vigie enregistre',
    captured: 'Ce que Vigie capte',
    limits: 'Ce qui la borne',
    network: 'Trafic réseau',
    policy: 'Politique de confidentialité',
    policyUrl: /politique-de-confidentialite/,
    agreed: (date: string) => `Accepté le ${date}. Vigie capte sur les domaines que vous désignez.`,
  },
} as const;

/** Today, written the way the language on screen writes dates. */
function dateIn(locale: Shipped): string {
  return new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** The `chrome` surface this spec reads from inside an extension page. */
interface ChromeSurface {
  i18n: { getUILanguage(): string };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    session: { set(items: Record<string, unknown>): Promise<void> };
    sync: { get(key: string): Promise<Record<string, unknown>> };
  };
}

/** What the page carries between assertions, and loses if it ever reloads. */
interface AliveMarker {
  __vigieAlive?: true;
}

async function openOptions(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByTestId('options-root')).toBeVisible();
  return page;
}

async function openConsent(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/consent.html`);
  await expect(page.getByTestId('consent-root')).toBeVisible();
  return page;
}

/** Choose a language from the settings, then close them. The choice outlives the tab. */
async function chooseLanguage(
  context: BrowserContext,
  extensionId: string,
  locale: Shipped,
): Promise<void> {
  const options = await openOptions(context, extensionId);
  await languageSelect(options).selectOption(locale);
  await expect(languageSelect(options)).toHaveValue(locale);
  await options.close();
}

/** The language this Chrome announces, reduced to the root the resolver matches catalogs on. */
async function announcedLanguage(page: Page): Promise<string> {
  const tag = await page.evaluate(() => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    return chrome.i18n.getUILanguage();
  });
  return tag.toLowerCase().split('-')[0] ?? tag;
}

/**
 * The language the settings are expected to speak on a profile that never chose one, and the
 * other shipped one, which is what an explicit choice has to be able to switch to.
 */
async function languagesInPlay(page: Page): Promise<{ announced: string; spoken: Shipped; other: Shipped }> {
  const announced = await announcedLanguage(page);
  const spoken: Shipped = announced === 'fr' ? 'fr' : 'en';
  return { announced, spoken, other: spoken === 'fr' ? 'en' : 'fr' };
}

/**
 * A mark on the document, so that "the page changed language" can be told apart from "the page
 * was replaced by another one that happened to be in the other language".
 */
async function markAlive(page: Page): Promise<void> {
  await page.evaluate(() => {
    (globalThis as AliveMarker).__vigieAlive = true;
  });
}

async function isStillTheSameDocument(page: Page): Promise<boolean> {
  return page.evaluate(() => (globalThis as AliveMarker).__vigieAlive === true);
}

function languageSelect(page: Page) {
  return page.getByTestId('language-select');
}

/** The label the automatic value carries, which is where the detected language is named. */
function automaticOption(page: Page) {
  return languageSelect(page).locator('option[value="auto"]');
}

test('the settings speak the language the browser announced, with nothing configured', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  const { announced, spoken } = await languagesInPlay(options);
  test.skip(
    !(announced in SETTINGS),
    `this browser announced "${announced}", which Vigie does not ship; the fallback is its own rule`,
  );
  const words = SETTINGS[spoken];

  await expect(languageSelect(options)).toHaveValue('auto');
  await expect(options.getByRole('heading', { name: words.language })).toBeVisible();
  await expect(options.getByRole('heading', { name: words.domains })).toBeVisible();
  await expect(options.getByRole('heading', { name: words.store })).toBeVisible();
  await expect(options.getByTestId('watched-domains-empty')).toHaveText(words.empty);
  await expect(options.getByTestId('add-domain-submit')).toHaveText(words.add);
  await expect(options.getByTestId('purge-store')).toHaveText(words.purge);
  await expect(options.getByTestId('stored-refresh')).toHaveText(words.refresh);
});

test('the automatic value names the language the browser announced', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  const { announced, spoken } = await languagesInPlay(options);
  test.skip(
    !(announced in SETTINGS),
    `this browser announced "${announced}", which Vigie does not ship; the fallback is its own rule`,
  );

  await expect(automaticOption(options)).toHaveText(SETTINGS[spoken].automatic);
  // Each language under its own name, untranslated: a list of languages is read by someone
  // looking for theirs, who by definition cannot read the language it would be translated into.
  await expect(languageSelect(options).locator('option')).toHaveText([
    SETTINGS[spoken].automatic,
    SETTINGS.en.label,
    SETTINGS.fr.label,
  ]);
});

test('nothing in the settings is left untranslated', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await languageSelect(options).selectOption('fr');

  await expect(options.getByRole('heading', { name: SETTINGS.fr.language })).toBeVisible();
  await expect(options.getByRole('heading', { name: SETTINGS.fr.domains })).toBeVisible();
  await expect(options.getByRole('heading', { name: SETTINGS.fr.store })).toBeVisible();
  await expect(options.getByTestId('watched-domains-empty')).toHaveText(SETTINGS.fr.empty);
  await expect(options.getByTestId('add-domain-submit')).toHaveText(SETTINGS.fr.add);
  await expect(options.getByTestId('purge-store')).toHaveText(SETTINGS.fr.purge);
  await expect(options.getByTestId('stored-refresh')).toHaveText(SETTINGS.fr.refresh);
  await expect(options.getByTestId('stored-empty')).toHaveText(
    "Rien n'a encore été capté. Vigie n'écrit que lorsqu'un domaine surveillé est ouvert.",
  );
});

test('an error message is written in the interface language too', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  const { other } = await languagesInPlay(options);
  await languageSelect(options).selectOption(other);

  await options.getByTestId('add-domain-input').fill('not a domain');
  await options.getByTestId('add-domain-submit').click();

  await expect(options.getByTestId('add-domain-error')).toHaveText(SETTINGS[other].invalid);
});

test('an explicit choice overrides the browser, where the page stands', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  const { other } = await languagesInPlay(options);
  await markAlive(options);

  await languageSelect(options).selectOption(other);

  await expect(options.getByRole('heading', { name: SETTINGS[other].domains })).toBeVisible();
  await expect(options.getByTestId('add-domain-submit')).toHaveText(SETTINGS[other].add);
  expect(await isStillTheSameDocument(options)).toBe(true);
});

test('the choice outlives the tab that made it', async ({ context, extensionId }) => {
  const first = await openOptions(context, extensionId);
  const { other } = await languagesInPlay(first);
  await languageSelect(first).selectOption(other);
  await expect(first.getByTestId('add-domain-submit')).toHaveText(SETTINGS[other].add);
  await first.close();

  const second = await openOptions(context, extensionId);

  await expect(languageSelect(second)).toHaveValue(other);
  await expect(second.getByRole('heading', { name: SETTINGS[other].domains })).toBeVisible();
});

test('going back to automatic gives the browser its say again', async ({
  context,
  extensionId,
}) => {
  const options = await openOptions(context, extensionId);
  const { spoken, other } = await languagesInPlay(options);
  await markAlive(options);

  await languageSelect(options).selectOption(other);
  await expect(options.getByRole('heading', { name: SETTINGS[other].domains })).toBeVisible();

  await languageSelect(options).selectOption('auto');

  await expect(options.getByRole('heading', { name: SETTINGS[spoken].domains })).toBeVisible();
  expect(await isStillTheSameDocument(options)).toBe(true);
});

test('a second settings tab follows the change without reloading', async ({
  context,
  extensionId,
}) => {
  const chooser = await openOptions(context, extensionId);
  const bystander = await openOptions(context, extensionId);
  const { other } = await languagesInPlay(chooser);
  await markAlive(bystander);

  await languageSelect(chooser).selectOption(other);

  await expect(bystander.getByRole('heading', { name: SETTINGS[other].domains })).toBeVisible();
  await expect(languageSelect(bystander)).toHaveValue(other);
  expect(await isStillTheSameDocument(bystander)).toBe(true);
});

test('the choice stays on this machine', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);

  await languageSelect(options).selectOption('fr');
  await expect(languageSelect(options)).toHaveValue('fr');

  const stored = await options.evaluate(async (key) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    const [local, sync] = await Promise.all([
      chrome.storage.local.get(key),
      chrome.storage.sync.get(key),
    ]);
    return { local: local[key] ?? null, sync: sync[key] ?? null };
  }, LANGUAGE_KEY);

  expect(stored.local).toBe('fr');
  // A language is a property of this browser, not of the person: it must not travel with the account.
  expect(stored.sync).toBeNull();
});

/**
 * The disclosure. It is the surface the whole translation exists for: someone who agreed without
 * having understood has not agreed, whatever box was ticked (`prd.md:21`).
 *
 * The fixture has already accepted on this profile, through the button, before each test below.
 */

test('translating the disclosure does not ask for consent again', async ({
  context,
  extensionId,
}) => {
  const before = await openConsent(context, extensionId);
  await expect(before.getByTestId('consent-accepted')).toBeVisible();
  await before.close();

  await chooseLanguage(context, extensionId, 'fr');

  const after = await openConsent(context, extensionId);
  await expect(after.getByTestId('consent-accepted')).toBeVisible();
  await expect(after.getByTestId('consent-accept')).toHaveCount(0);

  // And no surface fell back behind the gate either: consent is a stored fact, not a wording.
  const options = await openOptions(context, extensionId);
  await expect(options.getByTestId('consent-required')).toHaveCount(0);
});

test('the disclosure announces the same things in both languages', async ({
  context,
  extensionId,
}) => {
  await chooseLanguage(context, extensionId, 'fr');
  const screen = await openConsent(context, extensionId);

  await expect(screen.getByRole('heading', { name: CONSENT.fr.heading })).toBeVisible();
  await expect(screen.getByRole('heading', { name: CONSENT.fr.captured })).toBeVisible();
  await expect(screen.getByRole('heading', { name: CONSENT.fr.limits })).toBeVisible();
  await expect(screen.getByTestId('consent-promise')).not.toBeEmpty();

  // The six categories are anchored on their id, so translating cannot quietly drop one.
  await expect(screen.getByTestId('consent-captured')).toHaveCount(3);
  await expect(screen.getByTestId('consent-limit')).toHaveCount(3);
  for (const category of ['network', 'console', 'error']) {
    await expect(
      screen.locator(`[data-testid="consent-captured"][data-category="${category}"]`),
    ).toBeVisible();
  }
  for (const limit of ['local', 'scope', 'hour']) {
    await expect(
      screen.locator(`[data-testid="consent-limit"][data-category="${limit}"]`),
    ).toBeVisible();
  }

  // And they are announced in French, not merely counted.
  await expect(
    screen.locator('[data-testid="consent-captured"][data-category="network"]'),
  ).toContainText(CONSENT.fr.network);
});

test('the policy link points at the policy written in the language on screen', async ({
  context,
  extensionId,
}) => {
  for (const locale of ['fr', 'en'] as const) {
    await chooseLanguage(context, extensionId, locale);
    const screen = await openConsent(context, extensionId);

    const link = screen.getByTestId('privacy-policy-link');
    await expect(link).toHaveText(CONSENT[locale].policy);
    await expect(link).toHaveAttribute('href', CONSENT[locale].policyUrl);

    await screen.close();
  }
});

test('the date of the agreement follows the chosen language, not the browser', async ({
  context,
  extensionId,
}) => {
  const settings = await openOptions(context, extensionId);
  const { other } = await languagesInPlay(settings);
  await settings.close();

  // `other` is precisely the language the browser did not announce.
  await chooseLanguage(context, extensionId, other);
  const screen = await openConsent(context, extensionId);

  await expect(screen.getByTestId('consent-accepted')).toHaveText(
    CONSENT[other].agreed(dateIn(other)),
  );
});

/**
 * The popup: the narrowest surface of the product, and the one the width rule was written for.
 *
 * Everything above runs on the shipped build, because the settings and the disclosure need no host
 * access. The popup does: it says nothing worth measuring until something is being captured, and a
 * capture needs a watched domain the browser really grants. Hence the build variant, the same one
 * `popup-export.spec.ts` loads and for the same reason (`fixtures/build-variant.ts:8`).
 *
 * Width is the reason this lives in a browser at all. French runs a fifth longer than English, and
 * no assertion on text can see a label that fits its sentence and not its box. `popup-root` is fixed
 * at 320 px by `w-80` (`popup/App.tsx:339`), so the box is the same here as in the real popup window
 * even though Playwright renders it in an ordinary tab.
 */

const POPUP_BUILD = buildVariantPath('ui-language-popup');

/** What `w-80` fixes the surface to, and what clips anything drawn beside it. */
const POPUP_WIDTH = 320;

/** The popup, as French renders it. Every sentence below comes from `catalogs/fr.ts`. */
const POPUP_FR = {
  outOfScope: 'Hors périmètre',
  capturing: 'Capture en cours',
  watch: (domain: string) => `Surveiller ${domain}`,
  settings: 'Ouvrir les paramètres',
  sidepanel: 'Inspecter en direct',
  exportTitle: "Profondeur d'export",
  exportMenu: 'Choisir une autre profondeur',
  idle: "Aucun export pour l'instant",
  saved: (filename: string) => `${filename} enregistré`,
  gaps: 'Déclaré dans le rapport :',
  interruption: 'Capture interrompue',
} as const;

/**
 * The one gap the fallback test takes away, in both its wordings.
 *
 * `response-bodies-unavailable` because it is the gap every export declares as long as the deep
 * layer is off, which is the state a run is in unless it arms it on purpose (`export/gaps.ts:86`).
 */
const HOLED_GAP = {
  english: 'no response bodies without the deep layer',
  french: 'aucun corps de réponse sans la capture profonde',
} as const;

/**
 * The gap's entry in a built catalog, whichever way the bundler chose to quote its value. It emits
 * template literals today; the shape is matched rather than assumed so a change of bundler fails
 * loudly in `punchTheFrenchHole` instead of quietly leaving the catalog whole.
 */
const GAP_ENTRY = /"export\.gap\.response-bodies-unavailable":(["'`])((?:\\.|(?!\1)[^\\])*)\1,?/g;

let site: TestSite;

async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByTestId('popup-root')).toBeVisible();
  return page;
}

/** The side panel as an ordinary tab, which is how the suite reaches it (`sidepanel-read.spec.ts:19`). */
async function openSidePanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByTestId('sidepanel-root')).toBeVisible();
  return page;
}

async function watch(options: Page, domain: string): Promise<void> {
  await options.getByTestId('add-domain-input').fill(domain);
  await options.getByTestId('add-domain-submit').click();
  await expect(options.getByTestId('watched-domain-row')).toHaveCount(1);
}

/**
 * Marks the capture as having been interrupted.
 *
 * The banner is the one popup state a run cannot reach by browsing: it is raised by an update that
 * killed a debugger session, and consumed by whichever surface reads it first
 * (`capture/cdp/session-state.ts:237`). Written straight to the session area it lives in, because
 * the alternative is to update the extension mid-test.
 */
function markCaptureInterrupted(page: Page): Promise<void> {
  return page.evaluate(async (key) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
    await chrome.storage.session.set({ [key]: true });
  }, 'vigie:capture-interrupted');
}

/**
 * A watched site with traffic on disk, and the popup opened over it.
 *
 * The order is `popup-export.spec.ts:77`'s, and matters for the same reason: the site tab is the
 * only web tab of the window, so it is unambiguously the subject, and the popup is opened after the
 * first write so it describes a store that holds something.
 */
async function capturingPopup(
  context: BrowserContext,
  extensionId: string,
): Promise<{ options: Page; noisy: Page; popup: Page }> {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  await expect
    .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  const popup = await openPopup(context, extensionId);
  await expect(popup.getByTestId('scope-status')).toHaveAttribute('data-state', 'capturing');

  return { options, noisy, popup };
}

/**
 * Every label of the popup that does not fit where it is drawn.
 *
 * Two failures, not one, because a label can overflow in two directions. A box reaching past the
 * surface's content column has pushed the layout wider than the popup window, which clips it; a box
 * whose own content is wider than itself is being clipped inside its container. Neither is visible
 * to an assertion on text, and translation alone reaches both.
 *
 * Half a pixel of slack: borders land on fractional device pixels, and a rounding difference is not
 * an overflow. Returned as a list rather than asserted here, so a failure names the sentence.
 */
async function overflowingLabels(popup: Page): Promise<string[]> {
  return popup.getByTestId('popup-root').evaluate((root) => {
    const style = getComputedStyle(root);
    const bounds = root.getBoundingClientRect();
    const left = bounds.left + Number.parseFloat(style.paddingLeft);
    const right = bounds.right - Number.parseFloat(style.paddingRight);
    const offenders: string[] = [];

    for (const node of root.querySelectorAll<HTMLElement>('*')) {
      const said = (node.textContent ?? '').trim().replaceAll(/\s+/g, ' ');
      if (said === '') continue;

      const box = node.getBoundingClientRect();
      if (box.width === 0) continue;

      if (box.left < left - 0.5 || box.right > right + 0.5) offenders.push(`outside: ${said}`);
      // `clientWidth` is zero on an inline box and on anything outside HTML, which is what keeps
      // the icons out of this: they carry no text and would answer nonsense if they did.
      if (node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 0.5) {
        offenders.push(`clipped: ${said}`);
      }
    }

    return offenders;
  });
}

/**
 * How far the depth menu reaches past the popup, in pixels. Zero or less is what fits.
 *
 * Measured against the surface rather than against a container of its own: Radix draws the menu in
 * a portal outside `popup-root`, so `overflowingLabels` never sees it, and in a real popup it is
 * clipped by the window rather than by any element. Its items carry the longest interpolated
 * sentence of the whole surface — the reason a depth is refused, with two durations in it.
 */
async function menuOverflow(popup: Page): Promise<number> {
  await popup.getByTestId('export-menu').click();
  const menu = popup.getByRole('menu');
  await expect(menu).toBeVisible();

  const overflow = await menu.evaluate(
    (node, width) => node.getBoundingClientRect().width - width,
    POPUP_WIDTH,
  );

  await popup.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  return overflow;
}

/**
 * Takes one key away from the French catalog of a build, leaving the English one whole.
 *
 * There is no runtime lever for this. The catalogs are read by `import.meta.glob` at build time and
 * inlined eagerly (`i18n/registry.ts:46`), so a hole in French can only be punched in the built
 * chunk. Both catalogs carry the key, and the English value is what tells the two apart — which is
 * also the sentence the surface then has to fall back to.
 *
 * Every chunk is walked rather than the one that serves the popup, because the bundle holds two
 * copies of the catalog: the service worker inlines its own alongside the shared one the surfaces
 * import. Leaving either whole would leave the hole unpunched somewhere and make the outcome depend
 * on which copy answered.
 */
async function punchTheFrenchHole(buildPath: string): Promise<void> {
  let punched = 0;
  let kept = 0;

  for (const entry of await readdir(buildPath, { recursive: true })) {
    if (!entry.endsWith('.js')) continue;

    const file = join(buildPath, entry);
    const source = await readFile(file, 'utf8');
    const patched = source.replaceAll(GAP_ENTRY, (match: string, _quote: string, value: string) => {
      if (value === HOLED_GAP.english) {
        kept += 1;
        return match;
      }
      punched += 1;
      return '';
    });

    if (patched !== source) await writeFile(file, patched);
  }

  // Both numbers, not just the first: a match the English test failed to recognise would delete the
  // fallback along with the hole and leave a test that can only pass by saying nothing.
  expect(
    punched,
    'no built chunk holds the French gap; the bundler changed how it quotes',
  ).toBeGreaterThan(0);
  expect(kept, 'the English gap is gone too; the fallback has nothing left to answer with').toBe(
    punched,
  );
}

test.describe('the popup', () => {
  test.use({ extensionPath: POPUP_BUILD });

  test.beforeAll(async () => {
    await createBuildVariant(POPUP_BUILD);
    site = await startTestSite();
  });

  test.afterAll(async () => {
    await site.close();
    await removeBuildVariant(POPUP_BUILD);
  });

  // A capture, an export and a file on disk. The minute the settings tests run under is not enough.
  test.beforeEach(() => {
    test.setTimeout(90_000);
  });

  test('names its scope in French, out of scope and then capturing', async ({
    context,
    extensionId,
  }) => {
    await chooseLanguage(context, extensionId, 'fr');

    const page = await context.newPage();
    await page.goto(`${site.origin}/`, { waitUntil: 'load' });

    // Nothing watched: the state a first-time user opens the popup in, and the only one carrying an
    // action. Its label interpolates a domain, so it can only be read on a real one.
    const popup = await openPopup(context, extensionId);
    await expect(popup.getByTestId('scope-status')).toHaveAttribute('data-state', 'out-of-scope');
    await expect(popup.getByTestId('scope-label')).toHaveText(POPUP_FR.outOfScope);
    await expect(popup.getByTestId('scope-detail')).toContainText(
      `${site.host} n'est pas surveillé`,
    );
    await expect(popup.getByTestId('scope-watch-domain')).toHaveText(POPUP_FR.watch(site.host));

    // The two labels an icon button has and a reader may never see. `Vigie` is not among them.
    await expect(popup.getByTestId('open-options')).toHaveAttribute(
      'aria-label',
      POPUP_FR.settings,
    );
    await expect(popup.getByTestId('open-options')).toHaveAttribute('title', POPUP_FR.settings);
    await expect(popup.getByTestId('open-sidepanel')).toHaveText(POPUP_FR.sidepanel);
    await expect(popup.getByTestId('popup-header')).toContainText('Vigie');

    const options = await openOptions(context, extensionId);
    await watch(options, site.host);
    await page.reload({ waitUntil: 'load' });
    await expect
      .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
      .toBeGreaterThan(0);

    await popup.reload();

    await expect(popup.getByTestId('scope-status')).toHaveAttribute('data-state', 'capturing');
    await expect(popup.getByTestId('scope-label')).toHaveText(POPUP_FR.capturing);
    await expect(popup.getByTestId('scope-detail')).toContainText(`${site.host} est surveillé`);
    await expect(popup.getByTestId('tab-context')).toContainText('min disponibles');
    await expect(popup.getByRole('heading', { name: POPUP_FR.exportTitle })).toBeVisible();
    await expect(popup.getByTestId('export-run')).toContainText('Exporter');
    await expect(popup.getByTestId('export-menu')).toHaveAttribute(
      'aria-label',
      POPUP_FR.exportMenu,
    );
    await expect(popup.getByTestId('export-status-headline')).toHaveText(POPUP_FR.idle);
  });

  test('acknowledges an export in French while the report it wrote stays English', async ({
    context,
    extensionId,
  }) => {
    await chooseLanguage(context, extensionId, 'fr');
    const { popup } = await capturingPopup(context, extensionId);

    const report = await takeDownload(popup, () => popup.getByTestId('export-run').click());

    await expect(popup.getByTestId('export-status')).toHaveAttribute('data-state', 'downloaded');
    await expect(popup.getByTestId('export-status-headline')).toHaveText(
      POPUP_FR.saved(report.filename),
    );
    await expect(popup.getByTestId('export-status-detail')).toContainText(POPUP_FR.gaps);
    await expect(popup.getByTestId('export-status-detail')).toContainText(HOLED_GAP.french);

    // The same capture, the other audience. A report is read by whoever it is handed to and is not
    // translated (`prd.md:55`); the name it is filed under is not either.
    expect(report.filename).toMatch(reportFilenamePattern(site.host));
    expect(report.text).toContain('Response bodies are not included');
    expect(report.text).not.toContain('corps de réponse');
  });

  test('renders no French label wider than the box it sits in, in any state', async ({
    context,
    extensionId,
  }) => {
    await chooseLanguage(context, extensionId, 'fr');

    const page = await context.newPage();
    await page.goto(`${site.origin}/`, { waitUntil: 'load' });

    const options = await openOptions(context, extensionId);
    await markCaptureInterrupted(options);

    // Out of scope, under the interruption banner: the longest sentence of the surface, the state
    // that carries an action naming a domain, and the notice that can appear over any of them.
    const popup = await openPopup(context, extensionId);
    await expect(popup.getByTestId('interruption-label')).toHaveText(POPUP_FR.interruption);
    await expect(popup.getByTestId('scope-watch-domain')).toBeVisible();
    expect(await overflowingLabels(popup)).toEqual([]);

    // Capturing: the context line, the deep-layer block and the export row are drawn at once, and
    // the context line is the one carrying a domain, a tab number and a duration on a single line.
    await watch(options, site.host);
    await page.reload({ waitUntil: 'load' });
    await expect
      .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    await popup.reload();
    await expect(popup.getByTestId('tab-context')).toBeVisible();
    expect(await overflowingLabels(popup)).toEqual([]);

    expect(await menuOverflow(popup)).toBeLessThanOrEqual(0);

    // And the acknowledgement, which carries an untranslated filename and a list of gaps.
    await takeDownload(popup, () => popup.getByTestId('export-run').click());
    await expect(popup.getByTestId('export-status')).toHaveAttribute('data-state', 'downloaded');
    expect(await overflowingLabels(popup)).toEqual([]);
  });

  test('changes language without interrupting or altering the capture', async ({
    context,
    extensionId,
  }) => {
    const { options, noisy, popup } = await capturingPopup(context, extensionId);
    const before = await readCapturedEntries(options);
    expect(before.length).toBeGreaterThan(0);

    await chooseLanguage(context, extensionId, 'fr');
    await expect(popup.getByTestId('scope-label')).toHaveText(POPUP_FR.capturing);

    // Nothing that was captured before the change was rewritten by it: the language is a property
    // of the interface, and the store holds facts that have no language at all.
    const kept = new Map((await readCapturedEntries(options)).map((entry) => [entry.id, entry]));
    for (const entry of before) expect(kept.get(entry.id)).toEqual(entry);

    // And the capture is still running: traffic produced after the change lands like any other.
    await noisy.goto(`${site.origin}/?after-the-change`, { waitUntil: 'load' });
    await expect
      .poll(
        async () =>
          (await readCapturedEntries(options)).filter((entry) =>
            entry.url?.includes('after-the-change'),
          ).length,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
  });

  test('carries a change to the popup and the side panel at once, without reloading either', async ({
    context,
    extensionId,
  }) => {
    const { popup } = await capturingPopup(context, extensionId);
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.getByTestId('scope-status')).toHaveAttribute('data-state', 'capturing');

    await markAlive(popup);
    await markAlive(panel);

    await chooseLanguage(context, extensionId, 'fr');

    // Word for word on both, which is the whole reason they share `state.ts`: a reader moving from
    // one surface to the other must not have to reconcile two wordings of one fact.
    await expect(popup.getByTestId('scope-label')).toHaveText(POPUP_FR.capturing);
    await expect(panel.getByTestId('scope-label')).toHaveText(POPUP_FR.capturing);
    await expect(popup.getByTestId('scope-detail')).toContainText(`${site.host} est surveillé`);
    await expect(panel.getByTestId('scope-detail')).toContainText(`${site.host} est surveillé`);
    await expect(panel.getByTestId('tab-context')).toContainText('min disponibles');

    expect(await isStillTheSameDocument(popup)).toBe(true);
    expect(await isStillTheSameDocument(panel)).toBe(true);
  });

  /**
   * The fallback, on the one surface where a hole is visible without being a blank.
   *
   * `fr.ts` is annotated `Partial` so that a missing key is a hole English fills rather than a
   * compilation error that would force a placeholder sentence to be written. That promise is worth
   * nothing until a hole has actually been punched and the surface has been read afterwards.
   */
  test.describe('with a gap the French catalog does not hold', () => {
    const HOLED_BUILD = buildVariantPath('ui-language-fallback');

    test.use({ extensionPath: HOLED_BUILD });

    test.beforeAll(async () => {
      await createBuildVariant(HOLED_BUILD);
      await punchTheFrenchHole(HOLED_BUILD);
    });

    test.afterAll(async () => {
      await removeBuildVariant(HOLED_BUILD);
    });

    test('falls back to English inside an otherwise French acknowledgement', async ({
      context,
      extensionId,
    }) => {
      await chooseLanguage(context, extensionId, 'fr');
      const { popup } = await capturingPopup(context, extensionId);

      await takeDownload(popup, () => popup.getByTestId('export-run').click());

      const detail = popup.getByTestId('export-status-detail');
      // The sentence around it is still French: the fallback is per key, not per surface.
      await expect(detail).toContainText(POPUP_FR.gaps);
      await expect(detail).toContainText(HOLED_GAP.english);
      await expect(detail).not.toContainText(HOLED_GAP.french);
    });
  });
});

/**
 * The side panel: the densest surface of the product in technical vocabulary, and the one the
 * glossary was written for.
 *
 * Its thread is seeded rather than provoked. A run can produce network, console and error entries
 * by loading the noisy page, but it cannot produce a failed request, a request still open, a
 * completed one without a status, a truncated body and a truncated console line — in one window,
 * with values an assertion can name. Each of those is a branch of `label()` or of `outcomeText()`,
 * and they are exactly what the phase claims to have translated. The capture still runs first: the
 * store is created by the write path, and a seed needs the table to exist
 * (`fixtures/capture-store.ts:88`).
 *
 * The width rule of the popup returns here in another shape. The detail grid fixes its first column
 * at `7.5rem` (`EntryRow.tsx:256`), and a `dt` there carries no `truncate`: a term too long for the
 * column wraps to a second line instead of being clipped. So what is measured is line count, not
 * `scrollWidth` — the popup's instrument would report nothing at all on this surface.
 */

const PANEL_BUILD = buildVariantPath('ui-language-panel');

/** `7.5rem` resolved against the root font size. The column the twelve terms have to fit inside. */
const TERM_COLUMN = 120;

/** How many entries `Timeline` mounts at once (`Timeline.tsx:30`). One more raises the button. */
const RENDER_WINDOW = 200;

/** The thread, as French renders it. */
const PANEL_FR = {
  edgeKept: 'Début de la fenêtre — une heure',
  edgeShortened: 'Début de la fenêtre — raccourcie',
  empty: "Rien de capté sur cet onglet depuis une heure. La suite apparaîtra ici d'elle-même.",
  older: (count: number) =>
    `Afficher les plus anciennes — ${count} autre entrée dans cette fenêtre`,
  noBody: 'sans corps',
  network: [
    'issue',
    'url',
    'en-têtes requête',
    'corps requête',
    'en-têtes réponse',
    'corps réponse',
    'note',
  ],
  console: ['niveau', 'texte', 'note'],
  error: ['source', 'message', 'pile', 'note'],
} as const;

/** The field titles the report gives the same entry, in the order `networkSection` lays them out. */
const REPORT_FIELDS = ['Request headers', 'Request body', 'Response headers', 'Response body'];

/** Where `prune.ts` records that a window was cut short, and the panel reads it from. */
const STORAGE_STATE_KEY = 'vigie:storage-state';

/**
 * Six entries covering the twelve detail terms, the four folded labels and the three outcomes.
 *
 * Values are chosen to be recognisable on sight and to belong to categories the phase declares
 * untranslatable: a `net::ERR_*` cause, a `chrome.webRequest` resource type, a console level, an
 * error source, a header name. If any of them ever comes out translated, it comes out wrong.
 */
function seeds(tabId: number, at: number) {
  const base = { domain: site.host, tabId, provenance: 'webRequest' } as const;

  return {
    failed: {
      ...base,
      kind: 'network',
      timestamp: at - 5_000,
      requestId: 'fr-failed',
      url: `${site.origin}/fr-failed`,
      method: 'GET',
      outcome: 'failed',
      error: 'net::ERR_CONNECTION_TIMED_OUT',
      durationMs: 30,
      resourceType: 'xmlhttprequest',
      responseBody: 'unavailable',
    },
    pending: {
      ...base,
      kind: 'network',
      timestamp: at - 4_000,
      requestId: 'fr-pending',
      url: `${site.origin}/fr-pending`,
      method: 'GET',
      outcome: 'pending',
      resourceType: 'fetch',
      responseBody: 'unfinished',
    },
    noStatus: {
      ...base,
      kind: 'network',
      timestamp: at - 3_000,
      requestId: 'fr-no-status',
      url: `${site.origin}/fr-no-status`,
      method: 'GET',
      outcome: 'completed',
      resourceType: 'image',
      responseBody: 'filtered',
    },
    console: {
      ...base,
      kind: 'console',
      timestamp: at - 2_000,
      level: 'warn',
      text: 'deprecated call\nsecond line',
      truncated: true,
    },
    error: {
      ...base,
      kind: 'error',
      timestamp: at - 1_000,
      source: 'uncaught',
      message: 'Cannot read properties of null',
      stack: 'at boot (app.js:12)',
      truncated: true,
    },
    // Last of the six, so its section is the last one of the report and can be sliced to the end.
    completed: {
      ...base,
      kind: 'network',
      timestamp: at - 500,
      requestId: 'fr-completed',
      url: `${site.origin}/fr-completed?asked=1`,
      method: 'POST',
      outcome: 'completed',
      statusCode: 200,
      durationMs: 12,
      resourceType: 'xmlhttprequest',
      requestHeaders: [{ name: 'content-type', value: 'application/json' }],
      responseHeaders: [{ name: 'x-vigie', value: 'kept' }],
      requestBody: '{"asked":true}',
      responseBody: 'truncated',
      responseBodyText: 'cut at the ceiling',
    },
  };
}

/**
 * A watched site with traffic on disk, and the id of the tab that produced it.
 *
 * The noisy tab stays open, and not out of convenience: it is the subject. The panel resolves the
 * most recently accessed *web* tab of the window (`popup/subject-tab.ts:51`), and with none left
 * open the surface has nothing to describe and renders no thread at all.
 *
 * The worker is flushed before the id is read, so the tab is one the store really knows about
 * rather than one the write path still has in a pending batch.
 */
async function capturingTab(
  context: BrowserContext,
  extensionId: string,
): Promise<{ options: Page; noisy: Page; tabId: number }> {
  const options = await openOptions(context, extensionId);
  await watch(options, site.host);

  const noisy = await site.openNoisy(context);
  await expect
    .poll(async () => (await readCapturedEntries(options)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  await flushCapture(options);

  const [first] = await readCapturedEntries(options);
  if (first === undefined) throw new Error('the capture wrote nothing, so no tab can be seeded');
  return { options, noisy, tabId: first.tabId };
}

/**
 * Erases the store through the settings, which is the only erasure the panel observes.
 *
 * A raw delete from a page would leave the worker's queue and Dexie's live query untouched: the
 * button asks the worker, which is what makes an open thread empty itself (`options/StoredData.tsx:70`).
 */
async function emptyTheStore(options: Page): Promise<void> {
  await options.bringToFront();
  await options.getByTestId('purge-store').click();
  await expect(options.getByTestId('stored-entries')).toHaveText('0');
}

/** Puts the six entries on disk, and hands back the timestamps each of them is addressed by. */
async function seedThread(options: Page, tabId: number): Promise<ReturnType<typeof seeds>> {
  const written = seeds(tabId, Date.now());
  for (const entry of Object.values(written)) await seedCapturedEntry(options, entry);
  return written;
}

/**
 * The panel, once it is describing a capture rather than loading.
 *
 * Both readable states are accepted: a window cut short by storage pressure is degraded, and it is
 * one of the two edges this section reads (`sidepanel/App.tsx:222`).
 */
async function openThread(context: BrowserContext, extensionId: string): Promise<Page> {
  const panel = await openSidePanel(context, extensionId);
  await expect(panel.getByTestId('scope-status')).toHaveAttribute(
    'data-state',
    /capturing|degraded/,
  );
  return panel;
}

function entryAt(panel: Page, timestamp: number) {
  return panel.locator(`[data-testid="entry-row"][data-at="${timestamp}"]`);
}

/** Opens one entry and hands back its detail list. `<details>` hides its content until then. */
async function unfold(panel: Page, timestamp: number) {
  const row = entryAt(panel, timestamp);
  await expect(row).toHaveCount(1);
  await row.getByTestId('entry-summary').click();

  const detail = row.getByTestId('entry-detail');
  await expect(detail).toBeVisible();
  return detail;
}

/**
 * Every French term that does not fit the column it is drawn in, and the column's own width.
 *
 * Measured with a range over the term's contents rather than on the element: a `dt` is a grid item
 * filling its column whatever it holds, so its own box says nothing about the text inside it. A
 * range returns one rectangle per line box, which makes "this term wrapped" a count.
 *
 * The column is read back rather than assumed, so that a change to the grid is a failure with a
 * number in it instead of a suite that silently starts measuring something else.
 */
async function crampedTerms(panel: Page): Promise<{ column: number; offenders: string[] }> {
  return panel.getByTestId('sidepanel-root').evaluate((root) => {
    const offenders: string[] = [];
    const range = document.createRange();
    let column = 0;

    for (const term of root.querySelectorAll<HTMLElement>('[data-testid="entry-detail"] dt')) {
      const said = (term.textContent ?? '').trim();
      if (said === '') continue;

      const grid = term.parentElement;
      if (grid) {
        const [first = '0'] = getComputedStyle(grid).gridTemplateColumns.split(' ');
        column = Number.parseFloat(first);
      }

      range.selectNodeContents(term);
      const rects = [...range.getClientRects()];
      if (rects.length === 0) continue;

      if (rects.length > 1) offenders.push(`wrapped onto ${rects.length} lines: ${said}`);

      const widest = Math.max(...rects.map((rect) => rect.width));
      if (widest > column + 0.5) offenders.push(`${Math.round(widest)}px wide: ${said}`);
    }

    return { column, offenders };
  });
}

/**
 * Marks the window as having been cut short by storage pressure.
 *
 * The same lever `acceptance.spec.ts:138` pulls, and for the same reason: a real shrink needs a
 * store larger than the browser's allowance, which is minutes of traffic this suite has no reason
 * to produce. Written after the last flush, since the purge rewrites this record on every write.
 */
function seedShrunkWindow(page: Page, at: number): Promise<void> {
  return page.evaluate(
    async ({ key, shrunkAt }) => {
      const { chrome } = globalThis as unknown as { chrome: ChromeSurface };
      const stored = await chrome.storage.local.get(key);
      const previous = (stored[key] ?? {}) as Record<string, unknown>;
      await chrome.storage.local.set({ [key]: { ...previous, shrunkAt } });
    },
    { key: STORAGE_STATE_KEY, shrunkAt: at },
  );
}

test.describe('the side panel', () => {
  test.use({ extensionPath: PANEL_BUILD });

  test.beforeAll(async () => {
    await createBuildVariant(PANEL_BUILD);
    site = await startTestSite();
  });

  test.afterAll(async () => {
    await site.close();
    await removeBuildVariant(PANEL_BUILD);
  });

  // A capture, six seeds and a thread to render. The minute the settings tests run under is short.
  test.beforeEach(() => {
    test.setTimeout(90_000);
  });

  test('names the twelve terms of an unfolded entry in French, and the edge above them', async ({
    context,
    extensionId,
  }) => {
    await chooseLanguage(context, extensionId, 'fr');
    const { options, tabId } = await capturingTab(context, extensionId);
    const seeded = await seedThread(options, tabId);

    const panel = await openThread(context, extensionId);

    // The low edge, which is the one place the surface could lie by staying silent.
    const edge = panel.getByTestId('window-edge');
    await expect(edge).toHaveAttribute('data-reason', 'retention');
    await expect(edge).toContainText(PANEL_FR.edgeKept);
    await expect(panel.getByTestId('window-edge-detail')).toContainText('purgé');

    // Six terms and a note, in the report's own order — the correspondence the phase kept when it
    // gave up the word-for-word one (`phase-6.md:9`).
    const network = await unfold(panel, seeded.completed.timestamp);
    await expect(network.locator('dt')).toHaveText([...PANEL_FR.network]);
    await expect(network).toContainText('terminée 200 en 12 ms (xmlhttprequest)');
    await expect(network).toContainText('capté, coupé au plafond de capture');
    // And the captured values inside them, none of which is a word of any language.
    await expect(network).toContainText(seeded.completed.url);
    await expect(network).toContainText('content-type: application/json');
    await expect(network).toContainText('x-vigie: kept');
    await expect(network).toContainText('{"asked":true}');
    await expect(network).toContainText('cut at the ceiling');

    const line = await unfold(panel, seeded.console.timestamp);
    await expect(line.locator('dt')).toHaveText([...PANEL_FR.console]);
    await expect(line).toContainText('deprecated call');
    await expect(line).toContainText('texte tronqué par la capture');

    const failure = await unfold(panel, seeded.error.timestamp);
    await expect(failure.locator('dt')).toHaveText([...PANEL_FR.error]);
    await expect(failure).toContainText('at boot (app.js:12)');
    // The entry is truncated, not its text: the two notes English distinguishes stay distinct.
    await expect(failure).toContainText('tronquée par la capture');
    await expect(failure).not.toContainText('texte tronqué');
  });

  test('states each outcome in French while every observed value passes through', async ({
    context,
    extensionId,
  }) => {
    await chooseLanguage(context, extensionId, 'fr');
    const { options, tabId } = await capturingTab(context, extensionId);
    const seeded = await seedThread(options, tabId);

    const panel = await openThread(context, extensionId);

    // Folded: the middle column, which is a translation on a request and a captured value on
    // everything else.
    await expect(entryAt(panel, seeded.failed.timestamp).getByTestId('entry-summary')).toContainText(
      'échec',
    );
    await expect(
      entryAt(panel, seeded.pending.timestamp).getByTestId('entry-summary'),
    ).toContainText('en cours');
    await expect(
      entryAt(panel, seeded.noStatus.timestamp).getByTestId('entry-summary'),
    ).toContainText('sans statut');
    await expect(
      entryAt(panel, seeded.completed.timestamp).getByTestId('entry-summary'),
    ).toContainText('200');
    await expect(
      entryAt(panel, seeded.console.timestamp).getByTestId('entry-summary'),
    ).toContainText('warn');
    await expect(entryAt(panel, seeded.error.timestamp).getByTestId('entry-summary')).toContainText(
      'uncaught',
    );

    // Unfolded: the three outcomes, each carrying its untranslated cause and resource type.
    const failed = await unfold(panel, seeded.failed.timestamp);
    await expect(failed).toContainText('échec en 30 ms : net::ERR_CONNECTION_TIMED_OUT');
    await expect(failed).toContainText('(xmlhttprequest)');

    const pending = await unfold(panel, seeded.pending.timestamp);
    await expect(pending).toContainText('toujours ouverte (fetch)');

    const noStatus = await unfold(panel, seeded.noStatus.timestamp);
    await expect(noStatus).toContainText('terminée (sans statut) (image)');

    // The badge marks an absence, so it sits on the three entries that have nothing to show and on
    // none of the others. Its title is the reason, which differs on each of them.
    const badge = entryAt(panel, seeded.failed.timestamp).getByTestId('entry-no-body');
    await expect(badge).toHaveText(PANEL_FR.noBody);
    await expect(badge).toHaveAttribute(
      'title',
      'non capté — la capture profonde ne tournait pas sur cet onglet',
    );
    await expect(
      entryAt(panel, seeded.pending.timestamp).getByTestId('entry-no-body'),
    ).toHaveAttribute('title', "jamais livré — la requête ne s'est pas conclue");
    await expect(
      entryAt(panel, seeded.noStatus.timestamp).getByTestId('entry-no-body'),
    ).toHaveAttribute('title', "non demandé — hors de ce qu'un rapport peut porter");
    await expect(
      entryAt(panel, seeded.completed.timestamp).getByTestId('entry-no-body'),
    ).toHaveCount(0);
  });

  test('keeps every French term inside the column the grid fixes for it', async ({
    context,
    extensionId,
  }) => {
    await chooseLanguage(context, extensionId, 'fr');
    const { options, tabId } = await capturingTab(context, extensionId);
    const seeded = await seedThread(options, tabId);

    const panel = await openThread(context, extensionId);
    for (const entry of Object.values(seeded)) await unfold(panel, entry.timestamp);

    const { column, offenders } = await crampedTerms(panel);
    expect(column).toBeCloseTo(TERM_COLUMN, 0);
    expect(offenders).toEqual([]);
  });

  test('says in French that the window was cut short, and by how much', async ({
    context,
    extensionId,
  }) => {
    await chooseLanguage(context, extensionId, 'fr');
    const { options, tabId } = await capturingTab(context, extensionId);
    await seedThread(options, tabId);
    await seedShrunkWindow(options, Date.now());

    const panel = await openThread(context, extensionId);

    const edge = panel.getByTestId('window-edge');
    await expect(edge).toHaveAttribute('data-reason', 'quota');
    await expect(edge).toContainText(PANEL_FR.edgeShortened);

    // The quantity is the whole point of this wording: a shortened window says how far it reaches
    // and what it promised, or it says nothing a reader can act on.
    const detail = panel.getByTestId('window-edge-detail');
    await expect(detail).toContainText('purgé');
    await expect(detail).toHaveText(/ne remonte qu'à \S+ min au lieu de 60/);
  });

  test('holds back the older entries and empties itself, both in French', async ({
    context,
    extensionId,
  }) => {
    await chooseLanguage(context, extensionId, 'fr');
    const { options, tabId } = await capturingTab(context, extensionId);

    // Erased first, so the thread holds exactly what is seeded next. The real capture created the
    // table, which is all a seed needs from it, and its own count is neither known nor stable.
    await emptyTheStore(options);

    // One more than the render window, so the button announces a single held entry: the singular
    // is the form a plural written as `{count} entries` gets wrong, and the one worth measuring.
    const at = Date.now();
    for (let index = 0; index < RENDER_WINDOW + 1; index += 1) {
      await seedCapturedEntry(options, {
        kind: 'console',
        domain: site.host,
        tabId,
        timestamp: at - RENDER_WINDOW + index,
        level: 'log',
        text: `filler ${index}`,
        truncated: false,
      });
    }

    const panel = await openThread(context, extensionId);
    const older = panel.getByTestId('timeline-older');
    await expect(older).toHaveText(PANEL_FR.older(1));
    await expect(panel.getByTestId('entry-row')).toHaveCount(RENDER_WINDOW);

    await older.click();
    await expect(older).toHaveCount(0);
    await expect(panel.getByTestId('entry-row')).toHaveCount(RENDER_WINDOW + 1);

    // Erased through the worker, which is what makes the panel see it live: a thread with nothing
    // left in it is the one state where a silent surface is indistinguishable from a broken one.
    await emptyTheStore(options);
    await expect(panel.getByTestId('timeline-empty')).toHaveText(PANEL_FR.empty);
  });

  test('exports the same window as an English report holding the same fields in order', async ({
    context,
    extensionId,
  }) => {
    await chooseLanguage(context, extensionId, 'fr');
    const { options, tabId } = await capturingTab(context, extensionId);
    const seeded = await seedThread(options, tabId);

    const panel = await openThread(context, extensionId);
    const network = await unfold(panel, seeded.completed.timestamp);
    await expect(network.locator('dt')).toHaveText([...PANEL_FR.network]);

    const popup = await openPopup(context, extensionId);
    const report = await takeDownload(popup, () => popup.getByTestId('export-run').click());

    // The section of the entry just read, cut at the next one: every section carries these four
    // titles, so an unbounded slice would be measuring the order of the whole report.
    const start = report.text.indexOf('fr-completed');
    expect(start, 'the seeded entry is missing from the report it was cut from').toBeGreaterThan(-1);
    const next = report.text.indexOf('\n### ', start);
    const section = next === -1 ? report.text.slice(start) : report.text.slice(start, next);

    const order = REPORT_FIELDS.map((field) => section.indexOf(field));
    expect(order.every((index) => index >= 0), `missing fields in ${section}`).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));

    // Same fields, same order, other language. Both halves matter: a report that started speaking
    // French would break every reader it is handed to (`prd.md:55`).
    expect(section).not.toContain('en-têtes');
    expect(section).not.toContain('corps réponse');
  });
});
