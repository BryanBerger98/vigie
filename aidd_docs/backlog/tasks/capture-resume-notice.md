---
type: task
status: proposed
source: cdp-service-worker-recovery
related_to:
  - cdp-session-boundaries
---

# Task: reprendre la capture d'elle-même et le dire

## Outcome

Après n'importe quelle mort du service worker, mise à jour d'extension comprise, la capture repart au démarrage suivant sans que l'utilisateur ait un geste à faire, et un message lui apprend que l'extension a été mise à jour et la capture interrompue.

## Scope

- Includes : le chemin de démarrage du service worker — relecture de l'état persisté, ré-attachement des onglets qu'il liste, refus de ré-attacher si la marque d'annulation est présente ; les trois clés de `chrome.storage.session` que cet état recouvre ; le message affiché au démarrage qui suit une mise à jour ; et la règle qui veut que toute capacité nouvelle passe par `optional_permissions` ou `optional_host_permissions` plutôt que d'agrandir le tableau `permissions` d'une version publiée — `debugger` excepté, Chrome le refusant en optionnel (`aidd_docs/memory/architecture.md:78`).
- Excludes : la couche `capture/cdp/` elle-même, dont ce chemin n'est qu'une entrée ; la politique d'attachement par domaine surveillé ; la forme du message dans l'interface, qui appartient au design ; et la récupération des requêtes perdues pendant la panne, qui n'existe pas.

## Done When

- Le worker qui redémarre après un plantage ré-attache les onglets de l'état persisté et ne demande rien à l'utilisateur.
- Un `canceled_by_user` antérieur bloque ce ré-attachement, y compris à l'ouverture d'un onglet neuf.
- Le démarrage qui suit une mise à jour affiche le message une fois, et une seule.
- Le tableau `permissions` de `apps/extension/wxt.config.ts` ne gagne aucune entrée d'une version publiée à la suivante ; `offscreen` et `tabCapture` arrivent en optionnels, chacun après vérification que Chrome les y accepte.

## Completion Evidence

- Un test qui tue le worker, le laisse revenir et vérifie que les onglets sont ré-attachés sans interaction.
- Un test qui pose la marque d'annulation avant la mort et vérifie qu'aucun ré-attachement n'a lieu après.
- Le comportement d'une vraie mise à jour publiée reste à mesurer : `chrome.runtime.reload()` sur une extension chargée en `--load-extension` ne réveille aucun worker, et rien ne dit encore qu'une mise à jour du Web Store se comporte pareil. Tant que ce point n'est pas levé, la reprise après mise à jour n'est garantie qu'au prochain démarrage du navigateur.

## Why

Le Spike `cdp-service-worker-recovery` a mesuré six morts du service worker. Quatre connaissent une reprise automatique — Chrome redémarre le worker sur le premier événement pour lequel il a un gestionnaire, et le trafic `webRequest` suffit — et `chrome.storage.session` rend la carte des requêtes en vol intacte pour 449 octets. Il n'y a donc pas de mécanisme de reprise à écrire, seulement trois gestes au démarrage.

La mise à jour est le seul cas qui ne se répare pas de lui-même : après `chrome.runtime.reload()`, l'extension reste activée mais son worker ne redémarre jamais, ni sur le trafic en cours, ni sur une navigation neuve, ni sur un gestionnaire `chrome.runtime.onInstalled`. La décision produit est que ce cas ne se distingue pas des autres du point de vue de l'utilisateur : la capture reprend et un message l'informe. `chrome.debugger.attach` rouvre son bandeau sans redemander d'autorisation, donc la reprise ne coûte aucun geste.

La seule chose qu'un utilisateur ne pourrait pas éviter est l'acceptation d'une nouvelle permission : « when a new permission that triggers a warning is added, the extension will be disabled until the user accepts the new permission », dit le guide Chrome sur les avertissements de permission. Elle s'évite au lieu de se traiter, et pas en gelant les capacités du produit : les capacités nouvelles arrivent en `optional_permissions` et `optional_host_permissions`, accordées à l'usage, ce que `apps/extension/wxt.config.ts:40` fait déjà pour les hôtes. Ce qui ne doit pas grandir est le tableau `permissions` d'une version publiée.

La règle a une limite mesurée depuis : Chrome refuse silencieusement certaines permissions en optionnel. `debugger` est la première rencontrée — la clé est retirée du manifeste au chargement et toute demande à l'exécution échoue, ce qui l'a fait passer en permission requise (`aidd_docs/memory/architecture.md:78`). Une capacité candidate à l'optionnel se teste donc avant qu'une version ne s'y fie.
