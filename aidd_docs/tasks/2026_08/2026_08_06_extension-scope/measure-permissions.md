# Mesure — permissions d'hôte optionnelles

> Phase 2 du plan `extension-scope`. Ce document est le livrable de la phase : un verdict, ses
> chiffres, et ce qui n'a pas pu être mesuré.

## Verdict

**Un octroi de permission d'hôte à chaud atteint immédiatement un listener `webRequest` déjà
enregistré. Aucun ré-enregistrement n'est nécessaire, aucun redémarrage non plus.**

Chrome résout l'accès à l'hôte **au moment où l'événement est distribué**, pas au moment où le
listener est enregistré. Le même listener, jamais retouché, ne reçoit rien tant que l'accès est
retiré et reçoit tout dès qu'il est accordé.

Dans l'arbre de décision de la phase, c'est la branche `C -->|oui| D` : **l'enregistrement statique
suffit**. Ce n'est pas un repli sur des permissions larges — la clause d'escalade de la tâche 4.3
ne se déclenche pas.

Le code conserve malgré tout l'abonnement à `permissions.onAdded` / `onRemoved` prévu par la
tâche 3.2 : il coûte un `addListener` et il couvre le cas où une version ultérieure de Chrome
changerait ce comportement.

## Environnement mesuré

| Élément | Valeur |
| --- | --- |
| Mesure automatisée | Google Chrome for Testing **151.0.7922.34** (arm64, build Playwright `chromium-1234`) |
| Observation manuelle | **Brave Browser 151.1.93.129** — même socle Chromium 151, navigateur de travail du projet |
| Plateforme | macOS 25.6.0, Apple Silicon |
| Extension | build WXT `chrome-mv3`, manifeste V3, profil neuf à chaque lancement automatisé |
| Harnais | Playwright, contexte persistant, `--load-extension` |
| Date | 7 août 2026 |

## Les trois scénarios

### `1)` Sans rien faire — **capte**

Un listener `webRequest.onCompleted` est enregistré pendant que l'accès à l'hôte est retiré, puis
n'est plus jamais touché. Une visite dans cet état ne produit rien. L'accès est ensuite accordé, et
la visite suivante arrive sur ce même listener.

```txt
accès retiré,  après visite : 0 événement
accès accordé, après visite : 3 événements   (aucun ré-enregistrement entre les deux)
```

C'est la mesure décisive. Elle rend les scénarios 2 et 3 non nécessaires pour trancher — la
consigne de la phase était de ne les exécuter que si le précédent avait échoué. Ils ont quand même
été tentés, parce que le code les emprunte de toute façon.

### `2)` Avec ré-enregistrement — **capte, sans doubler**

Le service worker rappelle `apply()` à chaque `permissions.onAdded` et `onRemoved`. Après quatre
changements d'accès, donc quatre appels d'enregistrement sur le même événement, deux visites
identiques produisent le même nombre d'événements :

```txt
visite 1 après 4 enregistrements : N événements
visite 2                          : N événements   (et non 2N)
```

`registerOnce` retire avant d'ajouter ; l'empilement de listeners ne se produit pas. Mesuré deux
fois : en unitaire sur un événement factice, et ici dans le navigateur réel.

### `3)` Après terminaison — **capte**, observé à la main

Non automatisable (voir G2), donc exécuté manuellement sur Brave 151.1.93.129 :

1. Permission accordée sur **un seul domaine**, pas sur toutes les URL — ce point n'est pas un
   détail, voir la section suivante.
2. Service worker arrêté explicitement depuis `brave://serviceworker-internals`, sur la
   registration dont le scope est celui de l'extension.
3. Navigation sur le domaine autorisé, **sans ouvrir la popup** — pour que le réveil vienne de
   l'événement réseau et de rien d'autre.
4. Popup ouverte ensuite : le worker a bien redémarré et le compteur d'événements a progressé.

Le réveil par événement réseau restaure la capture. L'enregistrement au niveau supérieur de
`background.ts` est bien la condition de réveil, comme le contrat MV3 l'annonce.

## L'étendue de la permission décide de la durée de vie du worker

C'est l'enseignement inattendu de la mesure, et il ne concerne pas que cette phase.

Avec une permission sur **toutes les URL**, le service worker ne s'endort **jamais**. Le trafic de
fond d'un navigateur au repos — listes de filtres, télémétrie, onglets qui interrogent en boucle —
suffit à produire un `onCompleted` avant l'expiration du minuteur de 30 secondes, qui se réarme à
chaque événement. Première tentative d'observation : compteur à 268 événements, `Worker starts`
figé à 1, worker toujours listé comme actif après une minute d'attente.

Avec une permission **scopée à un domaine**, le worker s'endort normalement et se réveille sur la
première requête de ce domaine.

| Étendue accordée | Durée de vie du worker | Conséquence |
| --- | --- | --- |
| Toutes les URL | Quasi permanent | Le tampon de capture vit longtemps en mémoire — dimensionnement à traiter en phase 4 |
| Un domaine | Cycles arrêt/réveil normaux | Le chemin de réveil est réellement emprunté, donc réellement exposé aux régressions |

La phase 3 demande des permissions par domaine ; cette mesure confirme que c'est aussi le bon choix
du point de vue du cycle de vie, pas seulement de la vie privée.

## Ce qui a aussi été mesuré

| Question | Résultat |
| --- | --- |
| Révocation à chaud | Coupe la réception sur le même listener, sans ré-enregistrement |
| Domaine jamais autorisé | Aucun événement — le compteur reste à zéro |
| Lecture sans DevTools | La popup expose le compteur, il progresse pendant la navigation |
| Requêtes propres à l'extension | Visibles **sans** accès à l'hôte — voir la déviation ci-dessous |
| `permissions.onAdded` sur le chemin **optionnel** | Se déclenche, confirmé à la main : le compteur de changements bouge après un octroi et après une révocation depuis la popup |
| Permission optionnelle une fois accordée | Apparaît dans « Accès aux sites » de la page extensions, avec son menu de révocation |

## Lacunes de mesure

Deux choses que le plan supposait mesurables ne le sont pas. Elles sont consignées ici parce
qu'elles conditionnent les phases suivantes, pas seulement celle-ci.

### G1 — aucun octroi scriptable pour `optional_host_permissions`

`permissions.request()` ouvre une bulle native Views. Aucune surface d'automatisation ne l'atteint :
appelée depuis un vrai clic, la promesse reste `pending` indéfiniment.

L'API interne `chrome.developerPrivate`, accessible depuis `chrome://extensions`, ne contourne pas
le problème : les permissions d'hôte **optionnelles** sont absentes de son modèle d'accès runtime.

```txt
developerPrivate.getExtensionInfo -> runtimeHostPermissions:
  {"hasAllHosts":false,"hostAccess":"ON_ALL_SITES","hosts":[]}
```

`addHostPermission` et `updateExtensionConfiguration` répondent `ok` et n'accordent rien.
`chrome://extensions/sitePermissions` redirige. Aucun commutateur de ligne de commande n'existe
dans le binaire pour auto-accepter la bulle.

**Contournement retenu pour la mesure** : la spécification charge une **variante du build** dont le
manifeste ajoute une permission d'hôte *requise* couvrant toutes les URL. L'état runtime est le
même — un listener enregistré alors que l'extension n'a pas l'accès — et il est pilotable par
`developerPrivate.updateExtensionConfiguration`.

Ce que la substitution coûte en fidélité : le **chemin d'octroi** diffère (réglage d'accès aux
sites plutôt que bulle de permission optionnelle). Le code de l'extension, le listener et les
règles de distribution, eux, sont identiques. Le verdict porte sur la distribution, pas sur la
manière dont l'origine a été accordée.

**Décision, prise en phase 3** : cette variante devient le harnais commun des phases 3 à 11. Elle
est extraite dans `e2e/fixtures/build-variant.ts`, avec les helpers qui la pilotent
(`openSiteAccessControl`, `setHostAccess`). Deux conséquences que toute spécification suivante
doit connaître :

- `permissions.request()` répond `true` sans bulle, puisque l'origine est déjà accordée. Les
  spécifications couvrent donc la branche **accordée** de l'ajout ; le **refus** se teste en
  unitaire, où la réponse du navigateur se dicte (`watched-domains.test.ts`).
- `permissions.remove()` échoue sur une permission requise. Le retrait d'un domaine tolère cet
  échec, journalise, et poursuit la radiation — sans quoi la variante bloquerait un chemin que le
  build livré emprunte sans problème.

Le chemin d'octroi réel reste couvert par la recette manuelle de la phase 11.

### G2 — le service worker ne s'arrête jamais sous Playwright

| Tentative | Résultat |
| --- | --- |
| 90 s d'inactivité réelle, vérifications passives seulement | `serviceWorkers = 1` tout du long, `workerStarts` reste à 1 |
| `ServiceWorker.stopAllWorkers` (session CDP de contexte) | Sans effet |
| `Target.closeTarget` sur la cible `service_worker` | Sans effet, la cible existe pourtant |

La première tentative avait d'abord été faussée par la boucle d'attente elle-même, qui interrogeait
le worker toutes les 10 secondes — cette activité réarme le minuteur d'inactivité. Reprise avec des
vérifications purement locales, le résultat est le même.

Chrome maintient un service worker d'extension en vie tant qu'un débogueur y est attaché, et
Playwright s'attache à toutes les cibles worker qu'il voit. **La lacune porte donc sur
l'automatisation, pas sur le comportement** : le scénario 3 a été observé à la main et il passe.

Ce que ça coûte : aucune spécification de non-régression ne couvre le cycle arrêt/réveil. Une
régression sur ce chemin ne se verra qu'en test manuel. À reprendre si un jour Playwright expose
un moyen d'arrêter un worker d'extension.

## Déviation assumée par rapport à l'instruction

La tâche 1.1 demandait un filtre `{ urls: ["<all_urls>"] }`. Le listener utilise
`{ urls: ["http://*/*", "https://*/*"] }`.

**Pourquoi** : une extension voit toujours les requêtes vers ses propres ressources
`chrome-extension://`, avec ou sans accès à l'hôte. Or la mesure lit son compteur en ouvrant la
popup, dont le chargement produit précisément ce genre de requêtes. Le premier passage a compté 4
événements dans un état où l'accès était retiré — du bruit produit par l'instrument lui-même.

Restreindre au trafic web isole le signal. Le verdict ne dépend pas de ce choix ; la lisibilité de
la mesure, si. Le filtre définitif de la capture est de toute façon décidé en phase 4.

## Portée de la décision

| Ce qui est tranché | Ce qui ne l'est pas |
| --- | --- |
| Le manifeste garde `optional_host_permissions`, sans `host_permissions` statiques | — (le harnais des phases 3 à 11 est tranché depuis, voir G1) |
| Un domaine ajouté capture immédiatement, sans redémarrage | Le filtre de capture définitif (phase 4) |
| Le réveil du worker restaure la capture | Le dimensionnement du tampon quand le worker ne s'endort pas (phase 4) |
| `registerOnce` sur `onAdded` / `onRemoved` reste, par précaution | L'écran de consentement (phase 9), inchangé par cette mesure |
| Les permissions se demandent **par domaine**, jamais sur toutes les URL | — |

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/extension/src/capture/network/listener-lifecycle.ts` | Enregistrement idempotent, abonnement aux changements de permission |
| `apps/extension/src/capture/network/listener-lifecycle.test.ts` | 12 tests unitaires, dont l'idempotence |
| `apps/extension/src/entrypoints/background.ts` | Les sondes de mesure |
| `apps/extension/src/entrypoints/popup/App.tsx` | Lecture du compteur sans DevTools — provisoire, remplacé en phase 8 |
| `e2e/specs/optional-host-permission.spec.ts` | Les scénarios 1 et 2, la révocation, le compteur de la popup |
