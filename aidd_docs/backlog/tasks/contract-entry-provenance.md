---
type: task
status: proposed
source: cdp-webrequest-deduplication
related_to:
  - contract-response-body-state
  - cdp-session-boundaries
---

# Task: dire au contrat quelle couche a produit une entrée

## Outcome

Une entrée réseau porte la couche de capture qui l'a produite, et `requestId` cesse d'être documenté comme un identifiant `chrome.webRequest`.

## Scope

- Includes : le champ de provenance ajouté à `NetworkEntry` et sa validation dans `packages/contract/src/events.ts`, la correction du commentaire de `requestId` à la ligne 39 du même fichier, et la version Dexie qu'impose tout changement de forme stockée (`aidd_docs/memory/database.md:43`).
- Excludes : l'écriture de la couche `capture/cdp/` et l'affichage de la provenance dans le rapport et dans l'export. La règle de bascule aux bornes de la session n'est plus une exclusion : `cdp-session-boundaries` l'a tranchée, et le contrat doit pouvoir l'exprimer.

## Done When

- La provenance est portée **par entrée** et non par champ : une entrée vient d'une couche et d'une seule, la substitution mesurée n'ayant jamais à mélanger deux sources dans une même entrée. Cela vaut aussi aux bornes de session, où une requête à cheval revient entièrement à `webRequest` — jamais un début CDP complété par `webRequest`.
- Le signal qui déclenche l'écriture ne détermine pas la provenance. `cdp-terminal-event-gap` a établi que l'événement terminal qui déclenche l'écriture est celui de la requête, observé par n'importe laquelle des deux couches — en pratique celui de `webRequest`, qui ne manque jamais. Une entrée déclenchée par `webRequest` mais renseignée par CDP reste une entrée CDP : `webRequest` n'y apporte aucun champ, seulement le moment. La règle « une entrée, une couche » n'en souffre donc pas, mais elle doit être écrite de façon à ne pas se lire comme son contraire.
- `requestId` est décrit comme l'identifiant de la couche qui a produit l'entrée, sans stabilité d'une couche à l'autre, avec la mention que la forme CDP `<identifiant de processus>.<compteur>` n'est unique que dans un processus de rendu et pour la durée de la session.
- La validation rejette une provenance inconnue plutôt que de la laisser passer, comme pour les autres champs énumérés du contrat.
- Une nouvelle version Dexie est ajoutée sans toucher aux blocs existants, les extensions installées se mettant à jour sur des données vivantes.

## Completion Evidence

- La suite du paquet `contract` couvre chaque provenance et le rejet d'une valeur inconnue.
- La migration Dexie s'applique sur une base écrite par la version précédente.

## Why

Le Spike `cdp-webrequest-deduplication` a établi qu'aucune clé commune n'existe entre `chrome.webRequest` et `chrome.debugger` : les deux couches numérotent la même requête avec deux générateurs indépendants, et celui de CDP repart de zéro à chaque changement de processus de rendu. La branche retenue est la substitution sur l'onglet attaché, non la fusion — ce qui rend inutile toute clé de corrélation, mais rend indispensable de savoir d'où vient une entrée. Sans ce champ, un lecteur ne peut pas expliquer pourquoi une entrée porte un corps de réponse et sa voisine non, ni pourquoi un identifiant change de forme au milieu d'une fenêtre d'export. La documentation actuelle de `requestId`, « `chrome.webRequest` request id », devient fausse le jour où la couche CDP écrit.

Regroupable avec `contract-response-body-state` : les deux touchent `NetworkEntry`, sa validation et la même version Dexie, et les fusionner évite deux migrations là où une suffit.
