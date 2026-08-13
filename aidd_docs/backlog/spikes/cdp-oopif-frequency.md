---
type: spike
status: blocked
source: cdp-attachment-scope
depends_on:
  - cdp-attachment-scope
---

# Spike: cdp-oopif-frequency

## Question

Sur des applications métier authentifiées, quelle part du trafic applicatif passe par une iframe hors processus qu'une session `chrome.debugger` ouverte sur un `tabId` ne voit pas ?

## Decision

`Target.setAutoAttach` entre-t-il dans l'architecture de `capture/cdp/` ?

Il en est aujourd'hui délibérément exclu (`aidd_docs/memory/architecture.md:88`), et l'exclusion repose sur un échantillon d'une seule iframe hors processus parmi quatre applications, toutes publiques et sans compte — un lecteur vidéo embarqué dont les types de ressource sont déjà écartés par le filtre de corps. L'écart de couverture, lui, est total et non partiel : sur une iframe cross-site, `webRequest` a rapporté ses 5 requêtes et CDP aucune.

Le choix décide de deux choses : la présence d'un auto-attach en cascade dans la couche, avec le `sessionId` à porter dans chaque commande et chaque événement ; et le sort de la quatrième cause de corps manquant, aujourd'hui documentée comme une dégradation propre puisque l'entrée survit par `webRequest`.

Ouvert sans qu'un cas réel le motive, contrairement à la condition posée par [[cdp-attachment-scope]]. Il est persisté pour rester trouvable ; son instruction attend ce cas.

## Bounds

- Evidence needed :
  - Fréquence des iframes hors processus sur des applications métier authentifiées : widget de paiement, authentification déportée, support embarqué, tableau de bord tiers. Ce sont exactement les surfaces que l'échantillon de [[cdp-attachment-scope]] ne pouvait pas contenir.
  - Part du trafic XHR et Fetch qui y transite, et non la seule existence de la frame. L'écart de couverture ne compte que s'il porte de la charge applicative.
  - Coût de `Target.setAutoAttach` avec `flatten: true` : nombre de sessions ouvertes, cascade nécessaire pour une iframe imbriquée puisque l'auto-attach ne descend qu'aux enfants immédiats, et rétention par session enfant aux tailles retenues.
  - Ce que `webRequest` couvre déjà : il voit le trafic de l'iframe et l'impute au même onglet, donc l'entrée existe et seul le corps manque. Le bénéfice à mesurer est un bénéfice de corps, pas de couverture.
  - Conditions d'existence d'une iframe hors processus sur Chrome de série. La mesure de [[cdp-attachment-scope]] force `--site-per-process` sur Chrome for Testing ; il faut vérifier le comportement par défaut du navigateur de l'utilisateur.
- Stop when : la fréquence est chiffrée sur un échantillon d'applications authentifiées, et le verdict tranche entre garder `Target.setAutoAttach` hors de l'architecture ou l'y faire entrer.
- Hors périmètre :
  - La politique d'attachement par onglet, tranchée par [[cdp-attachment-scope]] et non rouverte.
  - Le filtre de corps, le seuil de troncature et les tailles de buffer, chiffrés et non rouverts.
  - Le trafic en `tabId: -1` du service worker de la page, que [[cdp-webrequest-deduplication]] a laissé à `webRequest` et qui reste orphelin sous toute branche.

## Outcome

**Bloqué faute de terrain, pas faute de méthode.**
La question porte explicitement sur des applications métier authentifiées — widget de paiement, authentification déportée, support embarqué, tableau de bord tiers — et ce sont exactement les surfaces auxquelles aucun compte n'est disponible.
Les quatre applications publiques déjà parcourues par [[cdp-attachment-scope]] et [[cdp-body-capture-calibration]] ont livré le seul échantillon possible sans authentification : une iframe hors processus, un lecteur vidéo embarqué dont les types de ressource sont déjà écartés par le filtre de corps.
Rejouer ces mêmes tours ne produirait pas une mesure de plus, seulement le même chiffre.

Le débloquage tient à une seule chose : l'accès à un jeu d'applications métier authentifiées.
Jusque-là, `Target.setAutoAttach` reste hors de l'architecture comme le note `aidd_docs/memory/architecture.md:88`, et la quatrième cause de corps manquant reste documentée comme une dégradation propre — l'entrée survit par `webRequest`, seul le corps manque.
