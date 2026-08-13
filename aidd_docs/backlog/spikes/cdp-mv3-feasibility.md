---
type: spike
status: resolved
---

# Spike: cdp-mv3-feasibility

## Question

Une session `chrome.debugger` attachée à un onglet surveillé peut-elle rester exploitable en continu sous MV3, c'est-à-dire se ré-attacher après chaque terminaison du service worker, sans perte d'événements ni geste de l'utilisateur ?

## Decision

La troisième couche de capture est-elle une capture permanente, du même ordre que `chrome.webRequest`, ou une session bornée par l'utilisateur, du même ordre que l'enregistrement vidéo ? Le choix décide de l'architecture de `capture/cdp/`, de la forme de l'opt-in, et de la valeur réelle de la couche.

## Bounds

- Evidence needed :
  - Documentation Chrome sur le couple `chrome.debugger` / cycle de vie du service worker MV3.
  - Comportement observé de la session quand le service worker est terminé : `onDetach` est-il émis, et avec quelle `reason` ?
  - Existence d'un chemin de ré-attachement automatique, sans geste utilisateur.
  - Les événements CDP réveillent-ils le service worker, comme `chrome.webRequest` le fait.
- Stop when : verdict tranché sur prototype jetable — la session survit à une terminaison forcée du service worker, ou un ré-attachement automatique est possible, ou aucun des deux.
- Hors périmètre : dédoublonnage avec `chrome.webRequest`, coût de stockage des corps de réponse, bandeau non masquable et éjection par DevTools. Trois questions séparées, que celle-ci précède.

## Investigation

| Attempt | Evidence | Result |
| ------- | -------- | ------ |
| Lecture de la documentation Chrome sur le cycle de vie du service worker | [The extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) | Cité mot pour mot : « Active debugger sessions created using the `chrome.debugger` API now keep the service worker alive. » Attribué à Chrome 118 dans le tableau des versions de la même page. Le délai d'inactivité par défaut reste 30 s. |
| Lecture de la référence `chrome.debugger` | [chrome.debugger API reference](https://developer.chrome.com/docs/extensions/reference/api/debugger) | La page ne dit rien du cycle de vie du service worker. `DetachReason` ne contient que `target_closed` et `canceled_by_user` : aucune raison ne correspond à une terminaison du service worker. `getTargets()` renvoie un `TargetInfo.attached` booléen, exploitable pour une reprise. |
| Prototype jetable, exécution 1 — contrôle sans attach | Chrome for Testing 151.0.7922.34, build expédié copié hors dépôt, sonde ajoutée en fin de `background.js`, journal posté vers un serveur local. Détail de la méthode plus bas. | `boot` posté à 8 ms, puis silence. Aucun des deux relevés programmés (45 s, 90 s) n'est arrivé : le service worker a été terminé au délai d'inactivité. Un `setTimeout` ne prolonge pas sa vie, donc son non-déclenchement vaut constat de terminaison. |
| Prototype jetable, exécution 2 — attach au démarrage du service worker | Même build, même profil de lancement, seul le mode diffère | `attach-ok` à 56 ms **sans geste utilisateur**, `Network.enable` accepté à 60 ms. Relevés `still-running` à 45 s **et** à 90 s, tous deux avec `attached: true`. `detach` avec `reason: target_closed` à 108,8 s, à la fermeture du navigateur. |
| Prototype jetable, exécution 3 — redémarrage du navigateur sur le profil de l'exécution 2 | Même build, profil réutilisé | `boot` à 3 ms, `attach-ok` à 58 ms, `Network.enable` à 65 ms. Le ré-attachement après redémarrage est automatique et ne demande aucun geste. |

### Méthode du prototype

Travail isolé et jetable, hors dépôt. Reproductible ainsi :

1. Copier `apps/extension/.output/chrome-mv3` vers un répertoire temporaire.
2. Dans le manifeste de la copie, ajouter `debugger` et `tabs` à `permissions`. La permission est rendue **requise** plutôt qu'optionnelle pour la même raison que dans `e2e/fixtures/build-variant.ts` : `permissions.request()` ouvre une bulle native qu'aucune surface d'automatisation ne sait franchir.
3. Ajouter en fin de `background.js` une sonde qui, à chaque démarrage du service worker, poste un événement vers un serveur HTTP local, cherche l'onglet cible, attache `chrome.debugger` en mode `attach`, puis programme deux `setTimeout` (45 s, 90 s) qui postent l'état de `getTargets()`.
4. Lancer Chrome for Testing avec `--user-data-dir`, `--load-extension`, `--disable-extensions-except` et l'URL cible, une fois par mode.

Les trois exécutions partagent le même profil de lancement, `--disable-background-timer-throttling` compris. Seul l'attach distingue l'exécution 1 de l'exécution 2.

## Outcome

- Result : **la couche CDP peut être permanente.** Une session `chrome.debugger` attachée empêche la terminaison du service worker par le délai d'inactivité de 30 s — mesuré à 45 s et à 90 s, là où le contrôle sans attach était déjà mort. L'attachement ne demande aucun geste utilisateur et peut donc se faire au démarrage du service worker, y compris après un redémarrage complet du navigateur. La question du ré-attachement après terminaison ne se pose pas en fonctionnement normal : tant que la session est attachée, le service worker ne meurt pas.
- Confidence : élevée sur l'horizon mesuré. Mesure directe corroborée par la documentation Chrome, contrôle A/B sur le même build et le même profil, et l'observable retenu — le non-déclenchement d'un `setTimeout` — ne peut pas être confondu avec autre chose.
- Remaining uncertainty :
  - Aucune mesure au-delà de 90 s d'inactivité. La page cible n'émettait aucun trafic pendant ces 90 s, mais une inactivité de plusieurs heures n'a pas été testée.
  - Le chemin d'octroi de la permission diffère : le prototype rend `debugger` requise, le modèle expédié la veut optionnelle. La bulle native reste inautomatisable, même angle mort que le constat G1 de `aidd_docs/tasks/2026_08/2026_08_06_extension-scope/measure-permissions.md`.
  - Les événements survenus entre le démarrage du navigateur et l'attach — environ 60 ms mesurés — sont perdus par construction. `chrome.webRequest` a la même limite.
  - Une terminaison anormale du service worker, plantage ou mise à jour de l'extension, n'a pas été provoquée. `DetachReason` n'ayant aucune valeur pour ce cas, la reprise devrait reposer sur un état persisté plutôt que sur `onDetach` — hypothèse de conception, non mesurée.

## Follow-up

- La couche s'écrit comme un pair de `capture/network/`, pas comme l'enregistrement vidéo : attach au démarrage du service worker sur les onglets des domaines surveillés, pas de session bornée par l'utilisateur.
- `minimum_chrome_version` vaut `114` dans le manifeste expédié, antérieur au maintien en vie apparu en Chrome 118. À relever à `118` le jour où la couche part.
- `TargetInfo.attached` est un booléen sans propriétaire : il ne distingue pas « attaché par nous » de « attaché par DevTools ». Une reprise ne peut pas s'y fier seule et doit persister les `tabId` attachés, `chrome.storage.session` étant le support qui survit au redémarrage du service worker.
- Les trois questions écartées du périmètre sont désormais tranchées, dont la plus bloquante en premier. [[cdp-optin-usability]] : le bandeau est global à tous les onglets et son bouton Annuler détache tout, donc la couche est **bornée par l'utilisateur** et non permanente — ce qui contredit le point ci-dessus. [[cdp-response-body-storage-cost]] : les corps tiennent largement dans le quota, le filtre est un choix de pertinence, et l'appel doit se faire dans le gestionnaire de `Network.loadingFinished`. [[cdp-webrequest-deduplication]] : aucune clé commune n'existe entre les deux couches, et CDP se **substitue** à `webRequest` sur l'onglet attaché au lieu de fusionner avec elle.
