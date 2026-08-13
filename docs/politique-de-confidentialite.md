---
title: Vigie — Politique de confidentialité
description: Ce que l'extension de navigateur Vigie enregistre, où cela reste, et combien de temps c'est conservé.
---

# Vigie — Politique de confidentialité

**Dernière mise à jour : 2026-08-13 · Correspond à la divulgation livrée en version 2.**

Vigie conserve la dernière heure de ce que fait votre navigateur sur les domaines que vous désignez, pour que vous puissiez transmettre le contexte d'un bug déjà survenu au lieu d'essayer de le reproduire.

Cette page énonce la même chose que l'extension énonce avant de capter quoi que ce soit.
Les mots ci-dessous sont ceux de l'écran de consentement ; si les deux venaient à diverger, c'est l'extension qui a tort et cela doit être signalé comme un bug.

## Ce que Vigie capte

### Trafic réseau

Chaque requête émise par un onglet surveillé : son url, sa méthode, son code de statut, ses temps, et ses en-têtes de requête et de réponse bruts.
Ces en-têtes portent des jetons d'authentification, des cookies de session et des clés d'API.
Les corps de réponse ne sont captés que lorsque la capture profonde est active : elle reste éteinte tant que vous ne la démarrez pas depuis le popup, et elle enregistre alors le texte des réponses reçues par un onglet surveillé, jusqu'à 256 kB chacune.

### Sortie console

Tout ce que la page écrit dans la console — log, info, warn, error et debug — avec ses arguments sérialisés en texte.
Ce qu'une application journalise, y compris des données sur les personnes qui l'utilisent, est enregistré exactement tel qu'il a été journalisé.

### Erreurs JavaScript

Exceptions non rattrapées et rejets de promesse non traités, avec leur message et leur trace de pile.

## Ce qui la borne

### Rien ne quitte cette machine

Vigie n'a ni serveur, ni compte, ni télémétrie.
Ce qu'elle enregistre reste dans ce profil de navigateur jusqu'à ce que vous exportiez un rapport vous-même.

### Rien en dehors des domaines que vous désignez

La capture n'a lieu que sur les domaines que vous ajoutez, et seulement tant que le navigateur en accorde l'accès à Vigie.
Tout autre site n'est jamais observé ni stocké.

### Rien de plus vieux d'une heure

Tout ce qui a été capté il y a plus d'une heure est supprimé.
Vous pouvez aussi tout effacer en une fois depuis les paramètres, à tout moment.

## Où vivent les données

Dans le profil de navigateur qui exécute l'extension, dans sa base IndexedDB, et nulle part ailleurs.
Vigie n'opère aucun serveur et n'en contacte aucun : elle n'a aucune permission réseau au-delà de l'observation des requêtes que les onglets surveillés émettent d'eux-mêmes.

Deux conséquences en découlent, et ce sont les honnêtes :

- **Un profil de navigateur qui se synchronise ne synchronise pas cela.** La base de capture est locale à l'appareil.
- **Quiconque peut lire votre profil de navigateur peut lire la capture.** Vigie n'ajoute aucune couche de chiffrement qui lui soit propre ; elle hérite exactement de la protection que le compte du système d'exploitation et le profil de navigateur fournissent déjà.

## Ce qui sort, et seulement à votre demande

Une seule chose, par une seule voie : le rapport.
Choisir une profondeur dans le popup assemble la tranche correspondante de la capture en un document Markdown et l'écrit dans votre dossier de téléchargements, sous la forme `vigie-<domain>-<date>-<time>.md`.
Ce qu'il devient ensuite ne dépend que de vous — un ticket, un message, un collègue.
Le fichier reste sur le disque jusqu'à ce que vous le supprimiez.

Ce rapport porte ce que porte la capture, en-têtes de requête et de réponse compris, plus les corps de réponse que la capture profonde a enregistrés si elle était active.
**Des jetons d'authentification, des cookies de session, des clés d'API et ce qu'une API a répondu s'y trouvent donc.**
Relisez un rapport avant de l'envoyer quelque part où vous n'enverriez pas un cookie de session.

## Combien de temps c'est conservé

Une heure, appliquée à chaque écriture : tout ce qui est plus ancien est supprimé à mesure que de nouvelles entrées arrivent, sans attendre que le navigateur soit inactif ni que l'extension soit ouverte.

Trois autres actions effacent la capture plus tôt :

| Action | Ce qu'elle efface |
| --- | --- |
| Retirer un domaine de la liste surveillée | Tout ce qui a été capté sur ce domaine |
| **Tout effacer**, dans les paramètres | La base entière, immédiatement |
| Désinstaller l'extension | La base entière, avec les données de profil de l'extension |

L'écran des paramètres montre ce qui est conservé à tout instant : le nombre d'entrées, l'espace qu'elles occupent, l'âge de la plus ancienne, et la répartition par domaine.
Rien de tout cela n'est une affirmation à croire sur parole — c'est lu directement dans la base.

## Consentement

Vigie ne capte rien tant que la divulgation n'a pas été lue et acceptée.
Avant cela, le chemin d'écriture refuse chaque entrée, et le popup comme les paramètres affichent la divulgation au lieu d'eux-mêmes.

L'accord porte sur ce qui est capté, pas sur l'extension.
Si une version future capte quelque chose que cette page ne décrit pas, la divulgation change, la capture s'arrête, et Vigie redemande.

Traduire cette divulgation ne redemande rien : l'accord porte sur la capture, et elle n'a pas changé.

## Permissions, et pourquoi chacune existe

| Permission | Pourquoi |
| --- | --- |
| `webRequest` | Observer les requêtes qu'un onglet surveillé émet — la capture réseau elle-même |
| `storage` | Conserver la capture, la liste des domaines surveillés et votre accord |
| `scripting` | Injecter la capture console et erreurs dans les seuls onglets surveillés |
| `activeTab` | Nommer l'onglet unique sur lequel vous avez ouvert le popup, pour que le rapport et la proposition de surveiller un site puissent dire lequel |
| `sidePanel` | Ouvrir le panneau qui montre ce qui est capté sur l'onglet que vous regardez |
| `debugger` | Lire les corps de réponse, et seulement tant que la capture profonde est active. Chrome l'exige dans le manifeste, donc l'avertissement s'affiche à l'installation même si vous ne démarrez jamais la couche ; rien ne s'attache tant que vous ne le faites pas, et Chrome affiche un bandeau sur chaque onglet pendant son exécution |
| Accès à l'hôte, par domaine, optionnel | Accordé par vous un domaine à la fois, et révocable depuis `chrome://extensions` à tout moment |

L'accès à l'hôte n'est délibérément pas demandé pour tous les sites.
Un domaine que vous n'avez pas désigné est un domaine que le navigateur ne confie jamais à Vigie.

## Tiers

Aucun.
Pas d'analytique, pas de rapport de plantage, pas de publicité, pas de courtier en données, aucune vente ni transfert d'aucune sorte.
Il n'y a pas de destinataire parce qu'il n'y a pas de transmission.

## Enfants

Vigie est un outil de développement et ne s'adresse pas aux enfants.

## Contact

Questions, ou divergence entre cette page et ce que fait l'extension :
[contact@bryanberger.dev](mailto:contact@bryanberger.dev), ou une issue sur
[le dépôt](https://github.com/BryanBerger98/vigie).
