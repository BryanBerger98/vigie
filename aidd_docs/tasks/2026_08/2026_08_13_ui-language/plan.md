---
objective: "Les quatre surfaces de l'extension et la fiche du Chrome Web Store s'affichent en anglais ou en français, la langue suit le navigateur par défaut et se force depuis les paramètres, sans altérer le rapport exporté ni redemander un consentement."
status: implemented
---

# Plan: La langue de l'interface se choisit

## Overview

| Field      | Value                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| **Goal**   | Deux langues sur toutes les surfaces, un réglage à trois valeurs, un rapport exporté inchangé   |
| **Source** | `aidd_docs/tasks/2026_08/2026_08_13_ui-language/prd.md`                                         |

Le point décisif est arrêté d'entrée : `chrome.i18n` seul ne peut pas satisfaire le PRD.
L'API résout au chargement, suit la langue du navigateur et n'offre aucune surcharge à l'exécution.
Trois critères tombent d'un coup : le choix explicite qui l'emporte sur le navigateur (`prd.md:87`), l'application à chaud aux surfaces déjà ouvertes (`prd.md:102`) et Automatique qui nomme la langue détectée (`prd.md:85`).

Le chantier porte donc deux mécanismes disjoints, et le découpage en phases suit cette ligne de partage.

| Mécanisme                                                                    | Ce qu'il sert                    | Phase |
| ---------------------------------------------------------------------------- | ---------------------------------- | ----- |
| `public/_locales/{en,fr}/messages.json` et `default_locale` dans le manifeste | Nom et description, fiche du store | 7     |
| Catalogues embarqués, locale résolue, préférence dans `storage.local`        | Popup, panneau, paramètres, consentement | 2 à 6 |

## Phases

| #   | Phase                                    | File                         |
| --- | ---------------------------------------- | ---------------------------- |
| 1   | Geler l'anglais et figer le glossaire    | [`phase-1.md`](./phase-1.md) |
| 2   | La couche de traduction, sans surface    | [`phase-2.md`](./phase-2.md) |
| 3   | Le sélecteur et les paramètres           | [`phase-3.md`](./phase-3.md) |
| 4   | Le consentement et la politique française | [`phase-4.md`](./phase-4.md) |
| 5   | Le popup                                 | [`phase-5.md`](./phase-5.md) |
| 6   | Le panneau latéral                       | [`phase-6.md`](./phase-6.md) |
| 7   | Le manifeste et la fiche du store        | [`phase-7.md`](./phase-7.md) |

## Resources

| Source                                                                | Verified                                                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| <https://wxt.dev/guide/essentials/i18n.html>                            | Les messages vivent dans `public/_locales/<code>/messages.json`, `default_locale` se déclare dans `defineConfig({ manifest })`, et `@wxt-dev/i18n` n'apporte que des types en gardant la limitation de l'API |
| <https://developer.chrome.com/docs/extensions/reference/api/i18n>       | `getMessage()` suit la langue du navigateur sans surcharge possible, `getUILanguage()` renvoie un code unique de la forme `en-US`, le repli va de la locale complète à la locale sans région puis à `default_locale` |
| <https://developer.chrome.com/docs/webstore/cws-dashboard-listing>      | La fiche du store est localisée depuis les répertoires `_locales` de l'extension, et le tableau de bord signale une incohérence entre les deux |
| <https://developer.chrome.com/docs/extensions/reference/manifest/default-locale> | `default_locale` est obligatoire dès qu'un répertoire `_locales` existe, et interdit en son absence |

## Decisions

| Decision                                                                                | Why                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deux mécanismes disjoints, `_locales` pour le manifeste et une couche React pour les surfaces | `chrome.i18n` ne se surcharge pas à l'exécution ; sans la seconde couche, le choix explicite, le changement à chaud et la langue détectée sont hors d'atteinte |
| `popup/state.ts` reçoit un traducteur et continue de rendre des phrases finies            | La solution inverse, des clés renvoyées au composant, réécrirait quatre composants et l'intégralité des tests unitaires du module pour le même résultat visible |
| Les catalogues sont découverts par `import.meta.glob`, jamais énumérés à la main          | Une troisième langue devient un fichier déposé, ce qui est littéralement le critère `prd.md:125`                                                  |
| La préférence vit dans `chrome.storage.local`                                             | Le réglage doit rester propre à l'installation (`prd.md:88`) ; `sync` le ferait voyager d'une machine à l'autre                                    |
| Une traduction qui déborde est abrégée, la surface ne bouge pas                           | Trois plafonds, dont deux infranchissables : le popup à 320 px (`popup/App.tsx`, `w-80`), la colonne de termes du panneau à 7.5rem (`EntryRow.tsx:177`), et la description du manifeste à 132 caractères — l'anglais actuel en fait déjà 135 (`wxt.config.ts:9`) |
| `CONSENT_TEXT_VERSION` ne bouge pas pour une traduction                                   | La version suit ce qui est capté, pas les mots qui le disent ; la bouger redemanderait le consentement à tous, ce que `prd.md:108` interdit        |
