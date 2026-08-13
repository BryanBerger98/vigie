---
type: task
status: proposed
source: cdp-response-body-storage-cost
related_to:
  - cdp-session-boundaries
---

# Task: rendre l'absence de corps de réponse explicable au contrat

## Outcome

`ResponseBodyState` distingue les raisons pour lesquelles un corps de réponse est absent, au lieu de les confondre toutes sous `unavailable`.

## Scope

- Includes : le type `ResponseBodyState` et le champ `NetworkEntry.responseBody` dans `packages/contract/src/events.ts`, la validation qui les accompagne, et la version Dexie qu'impose tout changement de forme stockée (`aidd_docs/memory/database.md:43`).
- Excludes : la couche de capture CDP elle-même, le filtre par type de ressource, le seuil de troncature, et la forme de l'export.

## Done When

- Un corps évincé du buffer CDP, un corps tronqué à l'écriture, un corps qu'aucune couche ne peut atteindre, un corps jamais demandé, un corps hors d'atteinte parce que la requête traversait une borne de session et un corps que CDP n'a jamais commité faute d'avoir conclu la requête sont six états distincts, chacun lisible sans consulter autre chose que l'entrée. **Six, arrêté** : [[cdp-body-read-timing]] a tranché le sixième.
- La validation du contrat rejette un état inconnu plutôt que de le laisser passer.
- Une nouvelle version Dexie est ajoutée sans toucher aux blocs existants, les extensions installées se mettant à jour sur des données vivantes.

## Completion Evidence

- La suite du paquet `contract` couvre chacun des états et le rejet d'un état inconnu.
- La migration Dexie s'applique sur une base écrite par la version précédente.

## Why

Le Spike `cdp-response-body-storage-cost` a établi que l'échec de récupération est un fonctionnement normal, pas une anomalie : le buffer CDP évince ce qui dépasse `maxResourceBufferSize`, et le corps disparaît dès que sa page navigue — 60 échecs sur 60 en récupération différée. Un `unavailable` unique rend ces cas indiscernables d'une couche qui n'a simplement rien tenté, ce qui prive le diagnostic de l'information la plus utile : savoir si le corps a existé.

`cdp-session-boundaries` a ajouté une cinquième cause, celle-là structurelle : une requête déjà en vol quand la session s'ouvre n'a jamais de corps, `getResponseBody` échouant sur 12 orphelins sur 12 même lorsque leur URL est connue. C'est le seul état où l'entrée elle-même reste complète — elle vient de `webRequest` — alors que le corps est définitivement hors d'atteinte. Le confondre avec une éviction ferait croire à un réglage de buffer trop petit.

`cdp-terminal-event-gap` en ajoute une sixième, symétrique de la précédente : une requête que CDP possède et ne conclut jamais, parce que personne n'a pompé son flux. Son entrée est complète — elle vient de la couche CDP, qui a vu son `requestWillBeSent` — et son corps n'a jamais été commité.

[[cdp-body-read-timing]] a tranché ce qui restait contesté, et le sixième état entre au contrat à six, mais pas sur le critère prévu. Le message d'erreur ne désigne rien : `No data found for resource with given identifier` recouvre trois situations distinctes, dont celle-ci, et il est revenu sur 3 053 requêtes que `webRequest` avait conclues sans qu'aucun délai n'y change quoi que ce soit. Ce qui distingue le sixième état est observable ailleurs et sans ambiguïté : aucun `Network.loadingFinished` n'est arrivé au moment où l'entrée est écrite. Seul `No resource with given identifier found` garde sa valeur de signal, pour l'orphelin de la borne de session.
