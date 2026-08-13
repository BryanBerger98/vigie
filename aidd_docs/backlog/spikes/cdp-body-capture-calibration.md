---
type: spike
status: resolved
depends_on:
  - cdp-response-body-storage-cost
  - cdp-session-boundaries
related_to:
  - contract-response-body-state
---

# Spike: cdp-body-capture-calibration

## Question

Quelles valeurs donner aux trois paramètres qui décident ce que `capture/cdp/` retient d'un corps de réponse — la liste des types de ressources conservés, le seuil de troncature par corps, et les tailles passées à `Network.enable` — pour couvrir le trafic d'une application métier réelle sans faire retenir au renderer de l'onglet attaché une mémoire qu'il n'utilise pas ?

Les trois se règlent sur une seule distribution et dans cet ordre : le filtre décide ce qu'on lira, le seuil décide ce qu'on garde de chaque corps retenu, les tailles de buffer décident si ces corps existent encore au moment de l'appel. Séparés en trois Spikes, chacun bloquerait le suivant.

## Decision

Le chemin d'écriture de `capture/cdp/`, seul endroit où le filtre s'applique — ce qui est écarté ne doit jamais atteindre le disque (`aidd_docs/memory/database.md:39`).

Le choix décide de trois choses à la fois : ce qui atteint le disque, donc la valeur résiduelle du rapport pour un diagnostic applicatif ; la taille au-delà de laquelle un corps est marqué tronqué, donc le sens réel de l'état que [[contract-response-body-state]] prépare, un état sans seuil ne disant rien au lecteur ; et la mémoire que Vigie fait retenir au renderer de l'onglet attaché, aujourd'hui `maxTotalBufferSize` à sa valeur par défaut de 200 Mo, coût qui tombe sur l'onglet de l'utilisateur et non sur notre stockage (`aidd_docs/memory/architecture.md`, section Gotchas).

Répondre ferme la section « Open measurement » de `aidd_docs/memory/architecture.md`.

## Bounds

- Evidence needed :
  - Distribution des tailles de corps par type de ressource sur une application métier réelle. L'échantillon de [[cdp-response-body-storage-cost]] ne compte que 14 réponses XHR ou Fetch, relevées sur des sites de contenu, et sa part de 7,6 % du volume lui est propre.
  - Quantile haut des corps XHR et Fetch. Le plus gros corps applicatif observé fait 856 Ko, mais ce n'est pas un plafond démontré : avec 14 échantillons la queue de distribution est inconnue.
  - Taille à partir de laquelle une réponse JSON tronquée cesse d'être exploitable pour un diagnostic, évaluée sur les corps effectivement capturés plutôt que posée a priori.
  - Taux d'échec de `getResponseBody` en fonction de `maxTotalBufferSize` et `maxResourceBufferSize`, filtre appliqué, les deux valeurs variées. Aucun corps n'a approché les 20 Mo par défaut de `maxResourceBufferSize` lors du tour précédent : le mécanisme d'éviction est établi, sa fréquence aux valeurs candidates ne l'est pas.
  - Mémoire réellement retenue par le renderer de l'onglet attaché aux valeurs candidates, relevée sur le processus et non déduite de la lecture de Blink.
- Stop when : les trois paramètres portent chacun une valeur chiffrée adossée à une distribution mesurée, et le taux d'échec de `getResponseBody` sur les types retenus est connu à la valeur de buffer choisie.
- Hors périmètre :
  - La forme du champ de troncature au contrat, qui appartient à [[contract-response-body-state]]. Ce Spike fournit le seuil, pas l'état.
  - La reprise après une terminaison anormale du service worker, et le périmètre d'attachement d'une session bornée. Deux questions distinctes, qui ne dépendent pas de celle-ci.
  - Le mécanisme d'éviction du buffer CDP, déjà établi par [[cdp-response-body-storage-cost]]. Seule sa valeur de réglage est ici en jeu.
  - La règle de lecture du corps dans le gestionnaire de `Network.loadingFinished`, acquise et non rediscutée. Réserve levée en cours d'investigation : `Network.enable` expose un paramètre que le Spike précédent ignorait et qui porte précisément sur la survie du corps à une navigation. Il est donc traité ici, comme réglage de `Network.enable` et non comme remise en cause de la règle.

## Investigation

| Attempt | Evidence | Result |
| ------- | -------- | ------ |
| Relecture de la référence CDP du domaine `Network`, pour fixer le vocabulaire du filtre et la liste complète des réglages de `Network.enable` | [Chrome DevTools Protocol — Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/), version `tot` | `ResourceType` compte 19 valeurs : `Document`, `Stylesheet`, `Image`, `Media`, `Font`, `Script`, `TextTrack`, `XHR`, `Fetch`, `Prefetch`, `EventSource`, `WebSocket`, `Manifest`, `SignedExchange`, `Ping`, `CSPViolationReport`, `Preflight`, `FedCM`, `Other`. Le filtre a donc 19 positions et non les 6 que la répartition mesurée par [[cdp-response-body-storage-cost]] nommait. `Network.responseReceived` porte `type` de ce type, `Network.loadingFinished` porte `encodedDataLength` — la taille sur le fil est donc lisible sans peser le corps. **`Network.enable` accepte cinq paramètres et non deux** : outre `maxTotalBufferSize` et `maxResourceBufferSize`, un `maxPostDataSize` et surtout un `enableDurableMessages` expérimental, cité mot pour mot : « Enable storing response bodies outside of renderer, so that these survive a cross-process navigation. » Le Spike précédent a mesuré 60 échecs sur 60 en récupération différée sans connaître ce paramètre. |
| Construction d'un banc de mesure : une extension MV3 jetable qui attache `chrome.debugger` à chaque onglet, appelle `Network.enable` avec les paramètres du tour et lit chaque corps dans le gestionnaire de `Network.loadingFinished`, pilotée par un runner Playwright qui déroule un parcours scripté et collecte tout dans un puits HTTP local | `probe/background.js` et `run.mjs` dans le bac à sable de session ; trois configurations : **A** sans paramètre, **B** avec `enableDurableMessages`, **C** avec `maxTotalBufferSize` 10 Mo et `maxResourceBufferSize` 2 Mo | Le banc tient. `chrome.debugger` s'attache sans conflit à un onglet déjà piloté par Playwright en CDP — troisième client simultané, ce qui confirme au passage la coexistence mesurée par [[cdp-optin-usability]]. Le tour porte sur quatre applications métier publiques sans compte : Grafana Play, Discourse meta, GitLab et la démo Home Assistant, cibles résolues par les API des produits eux-mêmes plutôt que par des sélecteurs sur le balisage. Un premier tour où Grafana n'avait fourni que 47 réponses a été écarté pour cette raison. |
| Tour A, paramètres par défaut, 239 s de navigation | 5 597 réponses relevées, 41 corps synthétiques de rétention exclus de la distribution — `out/records-A.jsonl` | **La distribution est massivement déséquilibrée en faveur d'un seul type.** `Script` : 2 648 réponses (47,3 %) et **425 Mo de corps décodés, soit 89,4 % du volume**, pour seulement 392 URL distinctes totalisant 40,7 Mo — les mêmes bundles rechargés à chaque navigation. `Stylesheet` : 26,5 Mo (5,6 %). `XHR` + `Fetch` réunis : 1 856 réponses (33,1 %) pour **14,5 Mo, soit 3,1 % du volume**. Lire les corps `Script` coûterait donc trente fois le trafic applicatif pour du contenu redondant et déjà versionné côté serveur. Quantiles applicatifs sur 1 850 corps : p50 0,4 ko, p90 7,4 ko, p95 51,5 ko, p99 185 ko, p99,9 320 ko, **max 541,5 ko** (`gitlab.com/-/emojis/4/emojis.json`). Le plafond de 856 ko hérité de [[cdp-response-body-storage-cost]] n'est pas dépassé sur un échantillon 130 fois plus grand. Échecs de `getResponseBody` en lecture immédiate : 94 sur 5 597 (1,7 %), **dont zéro sur XHR et Fetch** ; ils tombent tous sur des types sans corps par nature — `Font` 59, `Preflight` 29 sur 29, `Ping` 6 sur 6. Lecture différée après navigation : 59 échecs sur 60, message `No resource with given identifier found`, ce qui reproduit exactement le résultat du Spike précédent. |
| Seuil de troncature évalué sur les corps JSON réellement capturés, et non posé a priori | 1 129 corps `application/json` échantillonnés en entier pendant le tour A ; critère : un corps coupé est dit exploitable si le préfixe referme au moins un élément complet de la structure de premier niveau | 64 ko laisse 93,6 % des corps entiers mais n'en sauve que 18 des 72 coupés. **256 ko laisse 98,4 % des corps entiers, et les 18 coupés restants sont tous exploitables** — le préfixe contient au moins un élément complet. 512 ko monte à 99,9 % pour 9,4 points de volume supplémentaires. Au-delà de 1 Mo plus rien n'est coupé, le seuil ne sert plus. |
| Rétention mémoire du renderer, relevée sur le processus et non déduite | Page synthétique tirant 40 corps de 5 Mo, soit 200 Mo, exactement la valeur par défaut de `maxTotalBufferSize` ; `ps` restreint aux renderers enfants du navigateur lancé | Le renderer de l'onglet attaché passe de **124 Mo au repos à 330 Mo**, soit **+201 Mo retenus**, ce qui matérialise la valeur par défaut au mégaoctet près. Le coût n'est donc pas théorique : à paramètres par défaut, Vigie fait porter à l'onglet de l'utilisateur jusqu'à 200 Mo qu'il n'utilise pas. Un premier relevé, qui ramassait les 58 processus renderer de la machine dont ceux du navigateur personnel, a été écarté. |
| Essai du paramètre expérimental `enableDurableMessages`, seul puis avec les tailles de buffer explicitées | Tour B, `out-B.log` | **Le paramètre seul est refusé** : `{"code":-32602,"message":"maxTotalBufferSize is required with enableDurableMessages"}`. La documentation ne le dit pas. Passé avec ses deux tailles, il tient : **la lecture différée après navigation croisée réussit 60 fois sur 60**, contre 1 sur 60 sans lui, à parcours et volumes identiques. La conclusion de [[cdp-response-body-storage-cost]] — le corps ne survit pas à la navigation — est vraie à paramètres par défaut, et fausse avec ce drapeau. Défaut de banc corrigé au passage : un `Network.enable` refusé laissait la session attachée mais retirée du registre, d'où 106 tentatives de rattachement sur soi-même. |
| Banc de rétention dédié, pour séparer ce que le protocole retient de ce que la page alloue : la page lit chaque corps en flux et jette chaque bloc, et le relevé porte sur tout l'arbre de processus du navigateur, pas seulement ses renderers | `retention.mjs`, cinq configurations, volumes 50, 200 et 400 Mo | **Sans debugger attaché, aucune croissance.** Aux valeurs par défaut, le renderer de l'onglet attaché grossit de **174 Mo pour 50 Mo transférés** et de **605 Mo pour 200 Mo**. Aux valeurs candidates 10 Mo / 2 Mo, **aucune croissance mesurable aux trois volumes**. Avec `enableDurableMessages` aux tailles par défaut, aucune croissance non plus, ni dans le renderer ni dans le processus navigateur ni dans le service réseau. Le rapport entre volume transféré et RSS n'est pas linéaire — 605 Mo à 200 Mo transférés, 153 Mo à 400 Mo — donc le RSS reste un instrument grossier : c'est l'écart entre configurations qui porte la conclusion, pas le chiffre absolu. |
| Tours C et D aux tailles candidates, pour mesurer le taux d'échec que ces tailles provoquent réellement | `out/records-C.jsonl` et `out/records-D.jsonl`, mêmes cibles et même parcours | **Zéro échec de `getResponseBody` sur XHR et Fetch, dans les quatre configurations**, y compris à 10 Mo / 2 Mo. La lecture dans le gestionnaire de `Network.loadingFinished` intervient avant toute éviction : la taille du buffer ne conditionne pas le succès de la lecture, seulement la mémoire retenue en attendant. La lecture différée suit exactement le drapeau — A 1/60, B 60/60, C 1/60, D 60/60 — et non les tailles. |
| Consolidation des quatre tours, pour ne pas conclure sur un échantillon unique | 22 422 réponses, dont 7 395 XHR ou Fetch et 4 547 corps JSON échantillonnés | Les quatre tours sont reproductibles à moins de 0,2 % près sur le nombre de réponses applicatives (1 854 à 1 856) et sur leur volume (14,4 à 14,5 Mo). Part du volume de corps : `Script` 89,55 %, `Stylesheet` 5,47 %, `Fetch` 2,83 %, `Document` 0,75 %, `XHR` 0,16 %. Quantiles applicatifs poolés : p95 51,5 ko, p99 185 ko, p99,9 320 ko, p99,99 et max 541,5 ko. Au-dessus de 256 ko il ne reste que 72 corps sur 7 395, soit 0,97 %. Le type `Other` est intégralement composé d'images — sprites SVG, PNG, favicons — et non de charge applicative. Huit des dix-neuf types n'apparaissent jamais : `Media`, `TextTrack`, `Prefetch`, `EventSource`, `WebSocket`, `SignedExchange`, `CSPViolationReport`, `FedCM`. |

Le banc est jetable et vit dans le bac à sable de session : les chiffres de ce tableau sont la trace, pas les fichiers.

## Outcome

- Result : les trois paramètres sont fixés.

  **Filtre — lecture du corps restreinte à six types.** `XHR`, `Fetch`, `Document`, `Manifest`, `EventSource`, `WebSocket`. Les treize autres types ne donnent lieu qu'aux métadonnées — URL, méthode, statut, en-têtes, type, `encodedDataLength`, qui sont gratuites puisque portées par les événements. Justification mesurée : `Script` et `Stylesheet` pèsent **95 % du volume des corps** pour aucune valeur de diagnostic applicatif, et les mêmes bundles reviennent à chaque navigation — 392 URL distinctes pour 425 Mo décodés sur un seul tour. `Preflight` et `Ping` échouent systématiquement, 116 sur 116 et 12 sur 24 : ils n'ont pas de corps, les lire ne produit que des erreurs. `Other` est intégralement de l'image. `EventSource` et `WebSocket` sont retenus par raisonnement, pas par mesure : le tour n'en a produit aucun, mais ils transportent de la charge applicative par définition. Ce filtre garde 35 % des réponses et **4,2 % du volume des corps**.

  **Seuil de troncature — 256 ko par corps.** Il laisse passer entiers **98,4 % des corps JSON**, et les 0,97 % coupés restants sont **tous exploitables** au sens strict : leur préfixe referme au moins un élément complet de la structure de premier niveau. 64 ko est trop bas — 288 corps coupés dont 216 inexploitables. 512 ko gagne 1,5 point pour deux fois le stockage sur la queue. Le seuil est à 4 ko au-dessus du p99,9 et sous le maximum observé de 541,5 ko, ce qui est le comportement voulu : la queue est tronquée, pas perdue.

  **Tailles de `Network.enable` — `maxTotalBufferSize` 10 Mo, `maxResourceBufferSize` 2 Mo.** Elles ne coûtent rien en fiabilité : **zéro échec sur 7 395 corps applicatifs**, identique aux valeurs par défaut, parce que la lecture dans le gestionnaire de `Network.loadingFinished` précède toute éviction. Elles évitent en revanche une rétention mesurée de plusieurs centaines de mégaoctets dans le renderer de l'onglet de l'utilisateur. 2 Mo par ressource représente près de quatre fois le plus gros corps applicatif observé.

  **Conséquence non anticipée par le cadrage : le filtre n'est pas un choix de pertinence, c'est ce qui rend la fenêtre d'une heure tenable.** Les quatre tours produisent **6,8 à 7,2 Go/h de corps décodés** avant filtre. Après filtre et troncature à 256 ko : **222 à 225 Mo/h**, à moins de 1,5 % d'écart entre tours. Le facteur est de 31. Sans filtre, une heure de navigation dense sur une application métier consommerait **environ 64 % du quota de 10,7 Go** mesuré par [[cdp-response-body-storage-cost]] — la mémoire projet affirme aujourd'hui l'inverse, sur la foi d'un tour de sites de contenu qui coûtait 304 Mo/h.

- Confidence : haute sur les trois valeurs. Quatre tours indépendants de 240 s sur quatre applications métier publiques, 22 422 réponses, dont 7 395 applicatives, reproductibles à moins de 0,2 % près entre tours. Le seuil et le filtre reposent sur une distribution poolée ; les tailles de buffer reposent sur une comparaison A contre C à parcours identique, plus un banc de rétention à trois volumes qui isole la page de la mesure.

  Confiance moindre sur un point : le rapport entre volume transféré et RSS retenu n'est pas linéaire, donc la rétention aux valeurs par défaut est établie dans son ordre de grandeur — des centaines de mégaoctets — et non au mégaoctet.

- Remaining uncertainty :
  - `EventSource` et `WebSocket` sont dans le filtre sans mesure : aucun n'est apparu sur les quatre applications du tour. `Media` non plus, ce qui laisse non vérifiée l'hypothèse qu'un flux vidéo ne fait pas exploser le buffer.
  - Le tour est sans compte. Une application authentifiée peut porter des corps plus gros, en particulier des exports et des tableaux paginés larges. Le maximum de 541,5 ko n'est pas un plafond démontré au-delà du périmètre mesuré.
  - `enableDurableMessages` est marqué expérimental dans la référence CDP. Rien ne garantit sa stabilité entre versions de Chrome.

## Follow-up

**Ce qui est acquis et va en mémoire projet** — la section « Open measurement » de `aidd_docs/memory/architecture.md:97` est close par les trois valeurs ci-dessus. Quatre corrections y sont dues :

| Ligne | Affirmation actuelle | Ce que la mesure impose |
| --- | --- | --- |
| `architecture.md:67` | « Storage is not the constraint […] Filtering by resource type is a relevance call, not a survival one » | Faux sur une application métier : 6,9 Go/h sans filtre contre 224 Mo/h avec. Le filtre est une condition de survie du magasin, et les trois valeurs remplacent la formule « filtered, truncated ». |
| `architecture.md:88` | « it drops everything the moment the page navigates » | Vrai aux paramètres par défaut seulement. Avec `enableDurableMessages`, la lecture différée après navigation réussit 60 fois sur 60. |
| `architecture.md:92` | « makes the watched tab's renderer retain up to `maxTotalBufferSize`, 200 MB by default » — lecture de la documentation | Fait mesuré : +605 Mo de RSS pour 200 Mo transférés, +174 Mo pour 50 Mo, et rien de mesurable aux valeurs candidates. |
| `database.md:41` | Le quota de 10,7 Go est « deux ordres de grandeur au-dessus » de ce que consomme la fenêtre glissante | Vrai après filtre (224 Mo/h, soit 2 %), faux sans lui (6,9 Go/h, soit 64 %). La conclusion tient, sa raison change. |

Un ajout est également dû aux Gotchas : `enableDurableMessages` est refusé s'il n'est pas accompagné d'un `maxTotalBufferSize` explicite, ce que la référence CDP ne mentionne pas.

**Ce que ce Spike fournit à ses voisins** — [[contract-response-body-state]] reçoit son seuil : 256 ko, avec une queue de 0,97 % effectivement tronquée, ce qui donne à l'état une fréquence attendue et non seulement une forme.

**Ce qu'il ouvre** — `enableDurableMessages` fait passer la récupération différée de 1 sur 60 à 60 sur 60. Cela ne change pas la règle de lecture immédiate, qui reste la plus sûre et ne coûte rien, mais cela ouvre une question que ce Spike ne tranche pas : ce drapeau permet-il de rattraper les corps perdus lors d'une terminaison anormale du service worker ? C'est le périmètre du Spike de reprise, écarté du cadrage initial, qui gagne ici une piste concrète.

**Constat hors périmètre relevé en chemin** — le manifeste ne déclare aucun `optional_permissions` : `apps/extension/wxt.config.ts:40` ne porte que `optional_host_permissions`. La décision existe pourtant en mémoire (`aidd_docs/memory/architecture.md:78`) et l'étape est écrite dans `aidd_docs/INSTALL.md:170`. Ce n'est pas une divergence entre code et documentation, seulement une décision non encore appliquée — normale tant que `capture/cdp/` n'existe pas, mais à traiter dans la tâche qui créera ce dossier, pas plus tard.
