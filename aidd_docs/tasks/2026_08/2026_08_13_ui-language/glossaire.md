---
title: Glossaire français des termes du domaine
status: stable
updated: 2026-08-13
owner: bryan
---

# Glossaire français des termes du domaine

Un terme, un équivalent, sur toutes les surfaces.
Deux traductions d'un même terme se lisent comme deux notions (`prd.md:94`).
Le vocabulaire se fige ici, avant la première chaîne traduite, et ne se rediscute plus pendant.

## ✂️ La règle d'abrègement

La traduction s'abrège, la surface ne s'élargit jamais.
Un libellé français qui déborde prend sa forme courte de la colonne prévue.
Une forme courte absente de ce glossaire est un défaut, pas une liberté du traducteur : le terme revient ici avant d'être abrégé ailleurs.

| Plafond | Mesure | Source |
| --- | ---: | --- |
| Largeur du popup | 320 px | `popup/App.tsx:304` (`w-80`) |
| Colonne des termes du panneau | 7.5rem en `text-xs` | `EntryRow.tsx:177` |
| Description du manifeste et du store | 132 caractères | `wxt.config.ts:9` |

> [!IMPORTANT]
> La description anglaise mesurait 135 caractères, donc déjà hors plafond avant toute traduction.
> Raccourcie en phase 7 à 117 caractères, la française en fait 129 : toute reformulation se remesure dans les deux langues.

## 🔧 Divergences relevées et corrigées

Une divulgation produit et une politique publiée qui divergent sont un motif de rejet à elles seules (`prd.md:138`).
Traduire avant de réconcilier produirait la divergence en deux exemplaires.

| Constat | Où | Traitement |
| --- | --- | --- |
| Sortie annoncée comme un copier | `consent/text.ts:79` | Corrigé en export |
| Corps de réponse déclarés jamais captés | `text.ts:57`, `privacy-policy.md:23` | Réécrits, la capture profonde les atteint |
| Permission `debugger` non justifiée | `docs/privacy-policy.md` | Ligne ajoutée au tableau |
| Avertissement d'export muet sur les corps | `docs/privacy-policy.md` | Avertissement élargi |
| Badge `no body` systématique | `EntryRow.tsx:111`, `:215` | Réservé aux entrées réellement sans corps |

Le dernier constat coûte une phrase que la phase 6 devait traduire telle quelle.
`not available — webRequest never exposes one` s'affichait sur toutes les requêtes ; la couche profonde atteint les corps, donc l'énoncé mentait sur chaque entrée CDP.
Il est remplacé par l'état propre à l'entrée, traduit, celui-là même que le rapport publie (`export/markdown.ts:112`) : le nom de l'API disparaît de la surface, comme il a déjà disparu du rapport (`export/markdown.ts:355`).

`CONSENT_TEXT_VERSION` passe de `1` à `2` : une catégorie captée a été élargie, pas seulement reformulée.
Rien n'est publié, donc personne n'est redemandé.

## ⏳ Dépendances externes

Ce qui reste dû avant mise en ligne, et que le code ne peut pas produire.

| Dépendance | Pourquoi | Échéance |
| --- | --- | --- |
| Relecture humaine du consentement français | Un consentement ne s'auto-valide pas (`prd.md:134`) | Avant soumission |
| Publication des deux politiques | Le lien suit la langue lue (`deployment.md:33`) | Avant soumission |

Les deux adresses répondent 404, mesuré le 2026-08-13 : le site GitHub Pages n'a jamais été activé.
L'anglaise était déjà due avant ce chantier, la française ne fait que doubler la même dépendance.

`CONSENT_TEXT_VERSION` reste à `2` pendant toute la traduction.
La version suit ce qui est capté, pas les mots qui le disent — `consent/text.test.ts` tient les deux à l'écart.

## 🧭 Termes du produit

| Terme anglais | Équivalent français | Forme courte | Surfaces |
| --- | --- | --- | --- |
| capture | capture | — | toutes |
| to capture | capter | — | toutes |
| watched domain | domaine surveillé | domaine | popup, paramètres, panneau |
| scope | périmètre | — | popup, panneau |
| out of scope | hors périmètre | — | popup, panneau |
| host access | accès de l'hôte | accès | popup, paramètres |
| degraded | dégradé | — | popup, panneau |
| capturing | capture en cours | en cours | popup |
| entry / entries | entrée / entrées | — | popup, panneau, paramètres |
| store | base locale | base | paramètres |
| report | rapport | — | popup, consentement |
| to export | exporter | — | popup |
| export | export | — | popup |
| depth | profondeur | — | popup |
| export window | fenêtre d'export | fenêtre | popup |
| rolling window | fenêtre glissante | fenêtre | panneau, paramètres |
| bundle | lot d'export | lot | aucune, terme de code |
| gap | lacune | — | popup |
| deep capture | capture profonde | profonde | popup |
| deep layer | couche profonde | — | aucune, terme de code |
| tab | onglet | — | popup, panneau |
| thread | fil | — | panneau |
| storage pressure | pression de stockage | stockage | popup, panneau |
| to erase | effacer | — | paramètres |
| downloads | téléchargements | — | popup, consentement |
| settings | paramètres | — | popup |
| banner | bandeau | — | popup |
| interruption | interruption | — | popup, panneau |

Les trois termes que le PRD laissait ouverts sont tranchés ici (`prd.md:142`).
`deep layer` et `bundle` ne touchent aucune surface : ce sont des noms de code, et l'utilisateur lit « capture profonde » et « rapport ».
`export window` désigne la tranche demandée à l'export, `rolling window` l'heure que la base retient — deux notions distinctes, deux équivalents distincts.

## 🧵 Termes du détail du panneau

La colonne des termes est figée à 7.5rem, donc c'est elle qui arbitre les formes courtes.

| Terme anglais | Équivalent français | Forme courte | Surfaces |
| --- | --- | --- | --- |
| outcome | issue | — | panneau |
| url | url | — | panneau |
| request headers | en-têtes de requête | en-têtes requête | panneau |
| request body | corps de requête | corps requête | panneau |
| response headers | en-têtes de réponse | en-têtes réponse | panneau |
| response body | corps de réponse | corps réponse | panneau |
| level | niveau | — | panneau |
| text | texte | — | panneau |
| note | note | — | panneau |
| source | source | — | panneau |
| message | message | — | panneau |
| stack | pile d'appels | pile | panneau |
| no body | sans corps | — | panneau |
| truncated | tronqué | — | panneau |
| failed | échec | — | panneau |
| pending | en cours | — | panneau |
| no status | sans statut | — | panneau |
| start of the window | début de la fenêtre | début | panneau |
| shortened | raccourcie | — | panneau |

`url` reste `url` : c'est un identifiant technique, exclu de la traduction (`prd.md:95`).
L'ordre des champs ne change pas, et c'est lui qui porte désormais la correspondance avec le rapport, resté anglais.

## 🔗 Appariement avec le rapport

`EntryRow.tsx` revendiquait que lire le détail prédit l'export, mot pour mot.
Traduire le panneau en gardant le rapport anglais (`prd.md:55`) casse cette correspondance littérale et la remplace par une correspondance de structure : les mêmes champs, dans le même ordre, sous des noms que ce tableau apparie.
C'est donc ici, et nulle part ailleurs, qu'un lecteur retrouve quel terme français désigne quel champ du rapport.

| Terme du panneau | Champ du rapport | Où |
| --- | --- | --- |
| issue | le dénouement du titre de section | `markdown.ts:325` |
| url | la ligne 🔗 du bloc méta | `markdown.ts:360` |
| en-têtes requête | `Request headers (N)` | `markdown.ts:402` |
| corps requête | `Request body` | `markdown.ts:289` |
| en-têtes réponse | `Response headers (N)` | `markdown.ts:404` |
| corps réponse | `Response body` | `markdown.ts:301` |
| niveau | `console.<niveau>` du titre de section | `markdown.ts:409` |
| texte | le bloc de texte, section console | `markdown.ts:413` |
| note | la troncature, dans le bloc méta | `markdown.ts:385` |
| source | la source du titre de section | `markdown.ts:417` |
| message | le bloc de texte, section erreur | `markdown.ts:421` |
| pile | le bloc replié `Stack` | `markdown.ts:422` |

Quatre des douze n'ont pas de champ nommé dans le rapport : issue, url, niveau et source y sont portés par le titre de section ou par le bloc méta, pas par un intertitre.
La correspondance vaut quand même : c'est le même fait, au même endroit du même ordre de lecture.

## 🔏 Termes du consentement

| Terme anglais | Équivalent français | Forme courte | Surfaces |
| --- | --- | --- | --- |
| disclosure | divulgation | — | consentement, paramètres |
| consent | consentement | — | consentement |
| network traffic | trafic réseau | — | consentement |
| console output | sortie console | — | consentement |
| JavaScript errors | erreurs JavaScript | — | consentement |
| authentication token | jeton d'authentification | jeton | consentement |
| session cookie | cookie de session | cookie | consentement |
| API key | clé d'API | — | consentement |
| telemetry | télémétrie | — | consentement |
| browser profile | profil de navigateur | profil | consentement |
| privacy policy | politique de confidentialité | politique | consentement |
| stack trace | trace de pile | pile | consentement |
| unhandled promise rejection | rejet de promesse non traité | rejet non traité | consentement |

## ⚙️ Termes des paramètres

| Terme anglais | Équivalent français | Forme courte | Surfaces |
| --- | --- | --- | --- |
| Entries held | Entrées conservées | Entrées | paramètres |
| Space used | Espace occupé | Espace | paramètres |
| Oldest entry | Entrée la plus ancienne | Plus ancienne | paramètres |
| Watched domains | Domaines surveillés | Domaines | paramètres |
| Access granted | Accès accordé | Accordé | paramètres |
| Access missing | Accès manquant | Manquant | paramètres |
| Remove and erase | Retirer et effacer | Retirer | paramètres |
| Erase everything captured | Tout effacer | — | paramètres |
| Refresh | Actualiser | — | paramètres |

## 🚫 Ce qui ne se traduit pas

Le nommer évite qu'un relecteur le traduise par zèle.

| Catégorie | Exemples | Pourquoi |
| --- | --- | --- |
| Nom du produit | `Vigie` | Un produit ne se traduit pas |
| Identifiants techniques | URL, domaines, en-têtes HTTP | Exclus par `prd.md:95` |
| Données captées | codes de statut, méthodes, niveaux | Traduire falsifierait l'observation |
| Sources et types | sources d'erreur, types CDP | Vocabulaire du navigateur |
| Noms d'API | `webRequest`, `debugger` | Des noms, pas des mots |
| Unités et symboles | `B`, `kB`, `MB`, `ms`, `min`, `h` | Formes internationales |
| Marques du fil | `⇅`, `›`, `✗` | Des formes, pas des mots (`design.md:28`) |
| Horloge | `HH:MM:SS.mmm` | Format fixe partagé avec le rapport |
| Rapport exporté | statements de lacunes, en-têtes de section | Hors périmètre (`prd.md:55`) |
| Commentaires de code | tout le dépôt | Le lecteur est un contributeur |
