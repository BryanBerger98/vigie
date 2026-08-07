---
objective: "Une extension Chrome autonome capture en continu le trafic réseau, la console et les erreurs JS des seuls domaines désignés, et place en un clic un rapport Markdown de l'onglet actif dans le presse-papier, sur une fenêtre bornée à 60 minutes."
status: in-progress
---

# Plan: Vigie — première version de l'extension

## Overview

| Field      | Value                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| **Goal**   | Prouver qu'un rapport de contexte navigateur porte de la valeur, avant d'engager le SDK, la vidéo et `chrome.debugger` |
| **Source** | [`spec.md`](./spec.md), issue de [`prd.md`](./prd.md) et [`brainstorm.md`](./brainstorm.md)                          |

Le dépôt ne contient aucun code : `git log` répond `your current branch 'main' does not have any commits yet`. Toutes les phases créent, aucune ne modifie du code existant. La disposition cible vient de `aidd_docs/INSTALL.md:100-160`, réduite au périmètre de cette version — ni `packages/sdk/`, ni `capture/video/`, ni `capture/cdp/`, ni `entrypoints/offscreen/`, ni `storage/opfs.ts`.

Deux phases sont des mesures, pas des livraisons de fonctionnalité. Elles portent les deux inconnues que `prd.md:95` et `spec.md:19` désignent comme décisives, et chacune précède le code qui en dépend.

## Phases

| #   | Phase                                  | File                             |
| --- | -------------------------------------- | -------------------------------- |
| 1   | Socle monorepo et harnais de tests     | [`phase-1.md`](./phase-1.md)     |
| 2   | Mesure — permissions d'hôte optionnelles | [`phase-2.md`](./phase-2.md)   |
| 3   | Domaines surveillés et portée          | [`phase-3.md`](./phase-3.md)     |
| 4   | Capture réseau et stockage roulant     | [`phase-4.md`](./phase-4.md)     |
| 5   | Capture console et erreurs JS          | [`phase-5.md`](./phase-5.md)     |
| 6   | Mesure — volume d'une heure et sobriété | [`phase-6.md`](./phase-6.md)    |
| 7   | Assemblage et rendu du rapport         | [`phase-7.md`](./phase-7.md)     |
| 8   | Popup d'export                         | [`phase-8.md`](./phase-8.md)     |
| 9   | Consentement, transparence et purge    | [`phase-9.md`](./phase-9.md)     |
| 10  | Side panel de lecture                  | [`phase-10.md`](./phase-10.md)   |
| 11  | Recette de bout en bout et paquet CWS  | [`phase-11.md`](./phase-11.md)   |

La phase 10 ne sert aucun critère de `spec.md:38-46`. Elle est livrable indépendamment et peut être reportée sans invalider la version.

## Resources

| Source                                                                                          | Verified                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| <https://developer.chrome.com/docs/extensions/reference/api/webRequest>                          | L'API observationnelle reste disponible en MV3 ; seul `webRequestBlocking` est retiré. Corps de réponse jamais accessibles. Corps de requête via `requestBody`, en-têtes restreints via `extraHeaders` avec un coût de performance annoncé |
| <https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts>                  | Le monde `MAIN` est accessible via la propriété `world` ; il n'a aucun accès aux API `chrome.*` et communique par `window.postMessage` |
| <https://wxt.dev/guide/essentials/content-scripts.html>                                          | WXT déconseille `world: 'MAIN'` et recommande `injectScript()` avec un `defineUnlistedScript()` déclaré en `web_accessible_resources` |
| <https://developer.chrome.com/docs/extensions/reference/api/permissions>                         | `chrome.permissions.request()` exige un geste utilisateur ; `onAdded` et `onRemoved` existent                                        |
| <https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle>        | Terminaison à 30 secondes d'inactivité, variables globales perdues, persistance par `chrome.storage` ou IndexedDB                    |
| <https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>                      | Le consentement doit être obtenu dans l'interface du produit, jamais seulement dans une politique de confidentialité. Clause « Minimum Permission » |

Versions relevées le 2026-08-07 par `npm view` : WXT `0.21.3` (toujours pré-1.0), Dexie `4.4.4`, Turbo `2.10.8`.

## Decisions

| Decision                                                                                      | Why                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Permissions d'hôte **optionnelles**, demandées à l'ajout d'un domaine, avec repli documenté sur `<all_urls>` | Résout le TBD de `spec.md:19`. Le navigateur garantit lui-même la portée au lieu de notre seul code, et la clause « Minimum Permission » du CWS pousse dans le même sens. La phase 2 vérifie que `webRequest` suit un octroi à chaud avant que quoi que ce soit ne s'appuie dessus |
| Un fil de capture **par onglet** ; le trafic sans onglet rattachable n'est pas stocké          | Résout le TBD de `spec.md:22`. `spec.md:13` borne l'export à l'onglet actif et `prd.md:49` refuse de noyer le contexte utile. Les requêtes à `tabId = -1` — prefetch, service worker de page — n'appartiennent à aucun fil : les stocker créerait de la donnée jamais exportable |
| Saturation du stockage : la fenêtre **rétrécit et le signale**                                  | Résout le TBD de `spec.md:23`. Rétrécir en silence recrée exactement le défaut que le produit prétend supprimer — découvrir au moment de l'export que la période demandée n'était pas couverte                    |
| Les quatre paliers sont quatre boutons d'export, **aucun présélectionné**                      | Résout le TBD de `spec.md:21`. `spec.md:11` exige les quatre sur la même surface sans écran intermédiaire ; en faire directement l'action supprime la question du défaut au lieu de la trancher                   |
| Le filtre de portée et la purge horaire vivent sur le **chemin d'écriture**                     | `database.md:38-39`. Un filtre à l'export laisserait le trafic non surveillé atteindre le disque, ce qui contredirait la revendication de confidentialité du produit ; une purge sur minuterie ne survivrait pas à la terminaison du service worker |
| `packages/contract` existe dès cette version, sans SDK                                          | La forme stockée devient une migration Dexie dès qu'elle change (`database.md:44`). La figer dans un paquet dédié maintenant évite de la reconstruire quand le SDK arrivera                                        |
| Le rapport signale ses trous — corps de réponse, messages navigateur, capture démarrée tard     | `prd.md:79` l'exige pour les corps de réponse. La même règle vaut pour les messages console générés par le navigateur, qui échappent au patch `console.*` (`INSTALL.md:212`), et pour le contexte antérieur au chargement de l'extension |
