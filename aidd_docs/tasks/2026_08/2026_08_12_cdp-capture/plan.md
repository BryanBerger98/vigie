---
title: "Plan: la couche de capture `chrome.debugger`"
objective: "La couche `capture/cdp/` est optionnelle, bornée par l'utilisateur, remplace `webRequest` sur les onglets attachés, livre les corps de réponse filtrés et se relève seule après une mort du service worker."
status: implemented
updated: 2026-08-13
owner: bryan
---

<!-- Fill or omit these sections; never add, rename, or reorder one. -->

# Plan: la couche de capture `chrome.debugger`

## Overview

| Field      | Value                   |
| ---------- | ----------------------- |
| **Goal**   | Faire entrer la troisième couche de capture dans le produit, avec sa permission optionnelle, sa règle de propriété par requête, ses corps de réponse et sa reprise au démarrage. |
| **Source** | `aidd_docs/backlog/spikes/` (14 Spikes, 11 résolus, 2 ouverts, 1 bloqué), `aidd_docs/backlog/tasks/` (4 tâches proposées), et les conclusions déjà consignées dans `aidd_docs/memory/architecture.md:65-93` et `aidd_docs/memory/design.md:20-23`. |

## Phases

| #   | Phase        | File                         |
| --- | ------------ | ---------------------------- |
| 1   | Trancher la joignabilité du corps de réponse | [`phase-1.md`](./phase-1.md) |
| 2   | Le contrat et sa migration | [`phase-2.md`](./phase-2.md) |
| 3   | La session, de son démarrage à son arrêt | [`phase-3.md`](./phase-3.md) |
| 4   | La propriété d'une requête | [`phase-4.md`](./phase-4.md) |
| 5   | Les corps de réponse | [`phase-5.md`](./phase-5.md) |
| 6   | La reprise et son avis | [`phase-6.md`](./phase-6.md) |

## Decisions

<!-- Architecture-magnitude only, one you'd regret reversing. Omit if none qualify. -->

| Decision   | Why   |
| ---------- | ----- |
| CDP remplace `webRequest` sur l'onglet attaché, au lieu de fusionner avec lui | Aucune clé commune entre les deux couches. La corrélation `method + URL` marche — 147 sur 147 — mais coûte 1000 ms de retenue par écriture pour n'ajouter que des artefacts de pile réseau. `architecture.md:70` |
| La propriété se décide par requête à son événement terminal, servie par une file de 50 ms | L'événement terminal de `webRequest` précède l'annonce CDP de 42,6 ms pour 98 % des requêtes : une consultation immédiate échoue 294 fois sur 299. Le chemin d'écriture tient donc une file. `architecture.md:71` |
| Le sixième état de corps n'est figé qu'après la mesure de la phase 1 | `architecture.md:72` porte deux verdicts contraires : 6 lectures réussies sur 6, et 0 sur 2 122. Figer une lecture contestée coûterait une correction de contrat sur des données déjà écrites. |
| `debugger` entre par `optional_permissions`, jamais par `permissions` | Chrome désactive une extension publiée jusqu'à l'acceptation d'une permission nouvellement ajoutée qui avertit. Une extension désactivée est une capture à relancer à la main. `architecture.md:75` |
| Chrome antérieur à 118 : la couche est refusée à l'exécution, `minimum_chrome_version` reste à 114 | Le maintien en vie du worker par une session attachée date de Chrome 118. Relever le minimum couperait la capture de base à des utilisateurs qui n'activeront jamais la couche. `architecture.md:84` |
| `Target.setAutoAttach` reste hors de l'architecture | `cdp-oopif-frequency.md` est bloqué faute d'applications métier authentifiées. L'unique iframe hors processus observée est un lecteur vidéo déjà écarté par le filtre de corps. `architecture.md:88` |
| Le double comptage de `webRequest` n'entre pas dans ce plan | `network-restart-double-count.md` décrit un défaut antérieur à CDP et indépendant de lui — 6 occurrences sur 366 — dont la correction vit dans `capture/network/`. |
