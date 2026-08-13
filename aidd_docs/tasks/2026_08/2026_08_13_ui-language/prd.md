---
title: "Vigie — choix de la langue de l'interface"
status: draft
updated: 2026-08-13
owner: bryan
---

# Vigie — choix de la langue de l'interface

Toutes les surfaces de l'extension s'affichent en anglais ou en français, ainsi que la fiche du Chrome Web Store.
La langue suit celle du navigateur par défaut, se change dans les paramètres, et le rapport exporté reste en anglais.

## 🎯 Contexte

Vigie s'adresse aux product owners, QA et développeurs qui débuggent leur propre application.
Rien dans le fonctionnement du produit ne dépend de la langue : la capture est technique, l'export est un fichier.
Ce qui en dépend, ce sont deux décisions : installer, et accepter.

L'écran de consentement porte la seconde.
Il énumère ce qui est capté, en-têtes portant des jetons d'authentification et contenu console pouvant inclure des données personnelles.
Un utilisateur qui accepte sans avoir compris n'a pas consenti, quelle que soit la case cochée.

Le moment est celui d'avant la publication.
Traduire maintenant évite de retraduire une fiche déjà indexée, et évite de modifier après coup un texte de consentement que des utilisateurs installés ont déjà accepté.

## ❌ Problème

Trois coûts, du plus tôt au plus tard dans le parcours.

| Coût | Où il tombe |
| --- | --- |
| La fiche du store parle anglais | Avant l'installation, avant toute démonstration |
| Le consentement est dense et bloquant | Au premier lancement, avant tout usage |
| La langue n'est réglable nulle part | En usage, même pour un bilingue |

L'abandon le plus coûteux est le premier : il survient avant que le produit ait montré quoi que ce soit.
Le second est le plus grave : un consentement survolé faute d'être lisible reste juridiquement fragile et pratiquement inutile.

## ✅ Objectifs

| Objectif | Preuve observable |
| --- | --- |
| Décider d'installer dans sa langue | Fiche française sur navigateur français |
| Consentir en comprenant | Divulgation intégralement lisible en français |
| Rendre la langue choisissable | Un réglage dans les paramètres |
| Ne rien demander à l'arrivée | Aucun choix au premier lancement |
| Ne pas altérer le livrable | Export identique dans les deux langues |
| Ne pas rouvrir le consentement | Aucun utilisateur redemandé après la traduction |
| Rendre la langue suivante bon marché | Une langue de plus, aucun code |

## 🚧 Hors périmètre

| Exclu | Pourquoi |
| --- | --- |
| Le rapport exporté | Format unique pour tous les destinataires |
| Toute langue hors anglais et français | Socle prêt, troisième langue non livrée |
| La langue du site observé | Le choix porte sur Vigie seule |
| README, guide de contribution, `docs/sdk.md`, `@vigie/sdk` | Leur lecteur est un contributeur |
| Les messages du navigateur | Chrome suit sa propre langue |
| Une traduction contributive | Ni fichier ouvert, ni relecture communautaire |
| Le nom du produit | Vigie ne se traduit pas |

## 👤 User stories

- En tant qu'utilisateur francophone, je veux voir la fiche du store dans ma langue, afin de savoir ce que j'installe avant de l'installer.
- En tant qu'utilisateur francophone, je veux lire ce qui est capté dans ma langue, afin d'accepter en connaissance de cause.
- En tant qu'utilisateur, je veux que l'extension parle ma langue sans avoir rien réglé, afin de ne pas payer une configuration pour un comportement évident.
- En tant qu'utilisateur bilingue, je veux forcer la langue de l'interface, afin qu'elle ne dépende pas du réglage de mon navigateur.
- En tant qu'utilisateur ayant forcé une langue, je veux pouvoir revenir au comportement automatique, afin que le choix ne soit pas une porte à sens unique.
- En tant que développeur, je veux un rapport exporté identique quelle que soit ma langue, afin de le coller à un agent ou à un collègue sans me demander ce qu'il contient.
- En tant qu'utilisateur ayant déjà accepté, je veux que passer au français ne me redemande rien, afin qu'un changement de langue reste un changement de langue.

## 📋 Critères d'acceptation

### Langue par défaut

- Un navigateur en français affiche Vigie en français, sans aucun réglage.
- Une variante régionale suit sa racine : `fr-CA` et `fr-BE` affichent le français.
- Toute autre langue, connue ou non, affiche l'anglais.
- Le premier lancement ne pose aucune question de langue.

### Choix explicite

- Les paramètres proposent trois valeurs : Automatique, English, Français.
- Automatique est la valeur initiale, et l'interface nomme la langue qu'elle a détectée.
- Sur Automatique, changer la langue du navigateur change celle de Vigie.
- Un choix explicite l'emporte sur le navigateur, et revenir à Automatique rétablit le suivi.
- Le réglage reste propre à l'installation : il ne suit pas l'utilisateur d'une machine à l'autre.
- Le réglage est visible depuis les paramètres seuls, sans écran intermédiaire.

### Couverture

- Popup, panneau latéral, paramètres et écran de consentement sont intégralement traduits : libellés, textes d'aide, messages d'erreur, états vides et de chargement.
- Les termes du domaine sont traduits, jamais laissés en anglais : chacun a un équivalent unique, fixé par le glossaire et employé sur toutes les surfaces.
- Aucun texte anglais ne subsiste dans une interface réglée en français, hors identifiants techniques : URL, en-têtes HTTP, noms de domaine, codes de statut.
- La date d'acceptation du consentement suit la langue choisie, pas celle du navigateur.
- Un texte sans traduction s'affiche en anglais, jamais vide ni sous sa forme brute.
- Aucun libellé français ne déborde ni ne se tronque dans le popup, la surface la plus étroite.

### Changement de langue

- Le changement s'applique immédiatement aux surfaces déjà ouvertes, sans rechargement ni redémarrage.
- La capture en cours n'est ni interrompue ni altérée.
- Ce qui a déjà été capté reste exportable à l'identique.

### Consentement

- Traduire la divulgation ne redemande le consentement à personne.
- La version française énonce exactement les mêmes catégories captées et les mêmes limites que l'anglaise.
- La politique de confidentialité publiée existe en français, concordante mot pour mot avec l'écran.
- L'écran français renvoie vers la politique française.

### Fiche du store

- Le nom et la description affichés suivent la langue du navigateur, avec l'anglais en repli.
- Les deux fiches décrivent le même produit et les mêmes permissions.

### Export

- Le contenu rédigé du rapport est le même quelle que soit la langue de l'interface.
- Le nom du fichier téléchargé ne varie pas avec la langue.

### Langue suivante

- Ajouter une troisième langue ne demande de toucher aucune surface : le sélecteur et les textes la prennent en compte du seul fait qu'elle existe.

## 🔗 Dépendances

| Dépendance | Ce qu'elle bloque |
| --- | --- |
| Console développeur du Chrome Web Store | La fiche française, hors build |
| Politique de confidentialité française publiée | La soumission au store |
| Glossaire français des termes du domaine | La traduction des surfaces |
| Relecture humaine du consentement | La mise en ligne du consentement |
| Gel du texte anglais avant traduction | Le démarrage de la traduction |
| Recette adossée aux libellés anglais | La validation de la traduction |

Une divulgation produit et une politique publiée qui divergent sont un motif de rejet à elles seules, pas une imperfection de forme.

## ❓ Questions ouvertes

- **Les équivalents français exacts.** Le principe est arrêté, le vocabulaire ne l'est pas : _deep layer_, _bundle_ et _export window_ n'ont pas de traduction retenue. Le glossaire se fige avant la première chaîne traduite, pas pendant.
- **Les captures d'écran de la fiche française.** Refaites sur une interface en français, ou celles de l'interface anglaise réutilisées ? Une fiche française illustrée en anglais annule une partie du bénéfice.
- **Ce qui cède quand une traduction ne rentre pas.** Le français est plus long, la description courte du store est plafonnée et le popup est étroit. La règle est-elle d'abréger la traduction, ou d'élargir la surface ?
