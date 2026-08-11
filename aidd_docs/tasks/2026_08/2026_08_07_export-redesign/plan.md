---
objective: "La popup ne porte plus que l'export — un geste rejoue le palier courant, un geste de plus atteint les trois autres — et le rapport remis est un document Markdown structuré dont un lecteur atteint les anomalies sans le parcourir en entier."
status: implemented
---

# Plan: Vigie — refonte du geste d'export et du rapport

## Overview

| Field      | Value                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Goal**   | Réduire la surface livrée à ce qui sert l'export, et rendre le rapport exploitable sans lecture intégrale                     |
| **Source** | [`spec-export-redesign.md`](../2026_08_06_extension-scope/spec-export-redesign.md), issue de [`brainstorm-refonte-export.md`](../2026_08_06_extension-scope/brainstorm-refonte-export.md) |

Cette spec amende [`spec.md`](../2026_08_06_extension-scope/spec.md) sans la remplacer : elle rend caduques `spec.md:11` et `spec.md:13`, referme les questions ouvertes `spec.md:20` et `spec.md:21`. Le plan de la V1 reste au dossier `2026_08_06_extension-scope/` ; celui-ci ne le prolonge pas, il en corrige le produit livré.

Tout le code existe déjà. Aucune phase ne part d'une page blanche : trois modifient, une supprime plus qu'elle n'écrit.

L'ordre n'est pas celui de la spec. Le ménage passe en premier parce qu'il retire 110 lignes de `popup/App.tsx` que les phases 3 et 4 devraient sinon contourner. Le rapport passe en deuxième parce qu'il est la seule vraie difficulté et qu'il ne touche aucune surface — il peut être repris ou repoussé sans bloquer le reste.

## Phases

| #   | Phase                                | File                         |
| --- | ------------------------------------ | ---------------------------- |
| 1   | Retrait de l'instrumentation         | [`phase-1.md`](./phase-1.md) |
| 2   | Le rapport structuré                 | [`phase-2.md`](./phase-2.md) |
| 3   | Le geste d'export                    | [`phase-3.md`](./phase-3.md) |
| 4   | La surface — états, thème, en-tête   | [`phase-4.md`](./phase-4.md) |

La phase 2 est indépendante des trois autres : elle ne touche que `src/export/`. Les phases 3 et 4 se suivent obligatoirement, elles modifient le même fichier.

## Resources

| Source                                                                    | Verified                                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| <https://www.npmjs.com/package/lucide-react>                              | `1.30.0` au 2026-08-07. Peer `react ^19` — compatible avec le `19.2.8` du projet (`apps/extension/package.json:21`)                             |
| <https://www.npmjs.com/package/@radix-ui/react-dropdown-menu>             | `2.1.24` au 2026-08-07. Peers `react`/`react-dom` `^19.0` — compatibles. Aucune dépendance Radix n'existe encore dans le projet                  |
| <https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy> | La CSP par défaut des `extension_pages` en MV3 est `script-src 'self'; object-src 'self'` — aucune directive `style-src`, donc les styles injectés par Radix ne sont pas restreints. À reconfirmer sur le build en phase 3 |

## Decisions

| Decision                                                                                                          | Why                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le rapport devient un document Markdown structuré : tableau de cadrage, section par entrée, fences typées, `<details>` | Révoque la décision de `markdown.ts:14-32`, qui gardait le rendu plat pour survivre à une coupure n'importe où. **Risque accepté** : un rapport tronqué au milieu d'un tableau ou d'un `<details>` devient partiellement inexploitable (`spec-export-redesign.md:65`)                        |
| Une anomalie est un marqueur `[!]` dans le titre de sa section, plus un compte par type dans le tableau de tête       | La spec interdit un index ligne à ligne (`spec-export-redesign.md:40`) mais exige d'atteindre les anomalies sans lecture intégrale (`:22`). Un marqueur greppable dans le titre satisfait les deux, sans redite du contenu. Une section « Failures » séparée a été écartée : elle republie chaque anomalie |
| `@radix-ui/react-dropdown-menu` entre comme dépendance                                                              | Revient sur la décision de `button.tsx:9-11`, qui avait retiré `asChild` pour éviter Radix. Un menu doit gérer clavier, focus et ARIA ; l'écrire à la main pour un composant qui porte le geste principal du produit est une régression d'accessibilité qu'on ne rattrape pas |
| L'instrumentation de mesure est supprimée, pas déplacée                                                             | Les réglages portent déjà entrées, octets, âge du plus ancien, ventilation et purge (`StoredData.tsx:73-148`). **Coût assumé** : le protocole de `measure-storage.md` perd son instrument ; une future campagne devra le refaire (`spec-export-redesign.md:37`)                              |
| Deux paires de tokens `--success` / `--warning`, jamais d'utilitaire `dark:`                                          | La variante `dark:` de `globals.css:11` cible `.dark *` et aucune ligne du code ne pose cette classe. Le seul mécanisme actif est la media query `prefers-color-scheme` de `globals.css:85-107`. Écrire `bg-green-50 dark:bg-green-950` donnerait une tache pâle sur fond sombre |

## Amendement — lisibilité du rapport (2026-08-10)

Le rendu livré par la phase 2 respectait la spec et restait illisible : chaque titre de section
s'ouvrait sur vingt-quatre caractères d'horodatage identiques d'une entrée à l'autre, aucune ancre
visuelle ne distinguait les types, et `Response body: not available.` occupait un paragraphe entier
sous chaque requête.

Cause : le docblock de `markdown.ts` posait l'agent comme destinataire, alors que
`spec-export-redesign.md:59` place le PO, le QA et le développeur en premier, l'agent en second.

Ce qui change dans `apps/extension/src/export/markdown.ts` :

| Décision                                                                        | Remplace                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Le titre s'ouvre sur ce qui distingue l'entrée ; l'horodatage complet passe sur la ligne de méta juste dessous | L'horodatage en tête de titre, identique partout                   |
| Une émoji par titre porte le type — `🌐` `💬` `⚠️`, et `🛑` pour toute anomalie ; le mot à côté dit la même chose | Le marqueur `[!]`, et aucune ancre de type                        |
| Une ligne de verdict au-dessus du tableau : nombre d'anomalies et caractère à chercher | La ligne `\| Anomalies \| N \|` du tableau                          |
| L'absence de corps de réponse rejoint la ligne de méta de la requête             | Un paragraphe `Response body: not available.` par requête          |
| Chaque lacune est introduite par sa forme courte en gras (`GAP_SUMMARIES`)       | Une phrase longue sans point d'entrée                              |
| Durées au-delà d'une seconde rendues en secondes ; corps de requête replié       | `30012 ms` ; corps de requête déplié                               |

Contrainte tenue : l'émoji ne porte jamais seule le sens — le mot du titre le redit, même règle que
la couleur sur la surface (`design.md:28`).

### Second passage — typographie du titre et bloc de méta (2026-08-10)

Le premier amendement a corrigé la structure, pas la typographie. Sur un rendu réel, `GET /html/agendas/get_unplanned_bis.php → 200` restait composé dans la même graisse que la prose autour : rien ne disait où commence l'identifiant, et `200` demandait au lecteur de connaître le registre.

| Décision                                                                                  | Remplace                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Méthode et chemin en span de code : ``### 🌐 `GET /html/agendas/get_unplanned_bis.php```   | Le même texte en prose, indistinct du reste du titre        |
| Le statut porte sa phrase de raison et une émoji de classe : `✅ 200 OK`, `❌ 500 Internal Server Error` — nouveau module `apps/extension/src/export/status.ts` | Le code nu, `→ 200`                                        |
| Cinq classes d'émoji de statut — `ℹ️` `✅` `↪️` `⚠️` `❌` — parce que ce sur quoi un lecteur agit n'est pas binaire : un `304` est le cache qui fonctionne, un `404` la faute de l'appelant, un `502` rarement | Aucune distinction visuelle entre les statuts             |
| Un échec de transport porte sa cause dans le titre : `💥 net::ERR_CONNECTION_TIMED_OUT`   | `failed`, la cause une ligne plus bas                       |
| Le bloc de méta devient une citation à deux lignes : `> 🔗 URL` puis `> 🕑 instant · ⏱ durée · 📄 type · no response body` | Deux lignes de prose nue, l'URL en autolien isolé           |
| L'URL du bloc est un lien dont le libellé est un span de code — cliquable **et** en chasse fixe | Un autolien `<url>`, cliquable mais composé en graisse de texte |
| `console.warn` et `uncaught` en span de code dans leurs titres                             | Le niveau et la source en prose                             |

Deux détails de rendu qui ne se voient qu'à l'exécution :

- **Retour forcé dans la citation.** Deux espaces terminent la première ligne du bloc. Sans eux CommonMark fusionne les lignes d'une citation en un seul paragraphe, et l'URL et les instants arrivent collés — l'inverse de ce que le bloc existe pour faire.
- **Destination entre chevrons.** `[libellé](<url>)` plutôt que `[libellé](url)` : une URL peut porter une parenthèse fermante non appariée, qui terminerait une destination nue. Une URL contenant `<`, `>` ou un saut de ligne retombe sur un span de code simple, non cliquable plutôt que cassé.

**Coût assumé** : le lien redouble l'URL dans le Markdown brut. Aligné sur la décision existante de ne rien élaguer (`markdown.ts` — les en-têtes passent entiers), et sur l'ordre des destinataires : l'humain d'abord, l'agent ensuite.

Contrainte tenue, à nouveau : chaque émoji est adossée à une valeur qui dit la même chose. `✅` précède `200 OK`, `🕑` un instant ISO, `🔗` une URL. Une émoji qui n'ancre aucun champ n'entre pas — ce qui borne le compte au lieu de le laisser dériver vers la décoration.
