---
type: task
status: proposed
source: cdp-webrequest-deduplication
---

# Task: cesser de compter deux fois une requête que le navigateur a relancée

## Outcome

Une requête que le renderer relance après une sonde de cache infructueuse apparaît une fois dans le rapport, et non comme un échec suivi d'une requête réussie.

## Scope

- Includes : l'assemblage des événements `chrome.webRequest` dans `apps/extension/src/capture/network/`, et la règle qui décide si une entrée close sur erreur mérite d'être conservée.
- Excludes : la couche CDP, qui ne présente pas le défaut. Le contrat, sauf si la correction impose d'exprimer un nouvel état. La forme du rapport et celle de l'export.

## Done When

- Une requête terminée par `net::ERR_CACHE_MISS` ou `net::ERR_ABORTED` puis immédiatement relancée vers la même URL avec la même méthode produit une seule entrée, celle qui porte le résultat réel.
- Une requête réellement échouée, sans relance, reste visible en tant qu'échec : la correction ne doit pas rendre les vraies erreurs muettes.
- La fenêtre pendant laquelle une entrée close sur erreur attend sa relance éventuelle est bornée et documentée, `RequestAssembler` gardant par ailleurs son délai de 30 s inchangé (`apps/extension/src/capture/network/assemble.ts:24`).

## Completion Evidence

- Un test rejoue la séquence mesurée — `onBeforeRequest`, `onSendHeaders`, `onErrorOccurred` en `net::ERR_CACHE_MISS`, puis la même URL sous un nouveau `requestId` qui se termine en 200 — et vérifie qu'une seule entrée sort.
- Un second test vérifie qu'un échec isolé survit.

## Why

Le Spike `cdp-webrequest-deduplication` a mesuré 6 occurrences sur 366 requêtes lors d'un tour de navigation ordinaire. Le mécanisme est celui de la sonde « cache seulement » du renderer : elle échoue, et le chargement repart aussitôt sous un identifiant `webRequest` neuf, la réutilisation d'identifiant n'étant prévue que pour les redémarrages qui passent par `RequestIDGenerator::SaveID`. Le lecteur d'un rapport voit donc un échec réseau qui n'a jamais eu lieu du point de vue de la page, juste avant la requête qui a réussi — soit exactement le genre de faux signal qu'un outil de diagnostic ne doit pas produire. Le défaut est antérieur à la couche CDP et indépendant d'elle.
