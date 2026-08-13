---
type: spike
status: resolved
source: cdp-attachment-scope
depends_on:
  - cdp-session-boundaries
  - cdp-webrequest-deduplication
related_to:
  - contract-entry-provenance
---

# Spike: cdp-terminal-event-gap

## Question

Une réponse dont la page ne consomme jamais le corps produit-elle un événement terminal CDP — `Network.loadingFinished` ou `loadingFailed` —, et sinon, que devient la requête sous la règle d'attribution par événement terminal ?

## Decision

La règle d'attribution acquise par [[cdp-session-boundaries]] et déjà écrite en mémoire projet (`aidd_docs/memory/architecture.md:71`).

Le choix décide de trois choses. Si la règle tient telle quelle, ou si elle doit porter une clause de repli pour les requêtes que CDP possède sans jamais les conclure. Quel producteur écrit alors l'entrée, sachant que la règle actuelle efface `webRequest` dès que CDP a vu le `requestWillBeSent`. Et si l'assembleur de `capture/cdp/` a besoin d'un délai de garde, ce qu'aucune décision n'a prévu jusqu'ici.

Ce que la question n'est pas : un arbitrage sur la substitution elle-même, ni sur les corps de réponse. L'enjeu est l'entrée. Sous la règle actuelle, une requête que CDP possède et ne conclut jamais disparaît des deux couches — ce serait le seul trou d'entrée du modèle, alors que [[cdp-session-boundaries]] a conclu « une fois, toujours une fois ».

## Bounds

- Evidence needed :
  - Reproduction de l'observation incidente de [[cdp-attachment-scope]], attempt 2, sur un banc dédié : 0 `loadingFinished` sur 4 réponses jamais lues contre 20 sur 21 sur celles qui le sont. Échantillon de 4, aucune reproduction.
  - Les formes de non-consommation traitées séparément : `fetch()` dont la promesse de corps n'est jamais appelée, `response.body` non drainé, `Response` ignorée, requête abandonnée par `AbortController`, `XHR` dont `responseText` n'est jamais lu.
  - L'événement manque-t-il ou arrive-t-il tard ? L'observation initiale attend 3 s, ce qui n'est pas un plafond. Mesurer jusqu'à la navigation, la collecte mémoire et la fermeture de l'onglet.
  - Ce que `webRequest` émet pour ces mêmes requêtes : un `onCompleted` présent côté `webRequest` alors que CDP reste muet est exactement le cas que la règle actuelle traite mal.
  - Lecture de `InspectorNetworkAgent::DidFinishLoading` et de son appelant dans Blink, pour savoir si un corps non drainé retarde l'événement ou le supprime. Le fichier est déjà cité par [[cdp-session-boundaries]].
  - Fréquence sur trafic applicatif réel, mesurée sur les quatre cibles du tour de [[cdp-body-capture-calibration]] : part des réponses XHR et Fetch sans événement terminal CDP.
  - Effet de `enableDurableMessages`, qui déplace le stockage du corps hors du renderer et pourrait changer le moment où l'agent conclut.
- Stop when : verdict tranché sur prototype jetable. Soit l'événement terminal arrive toujours et l'observation était un artefact du banc, soit il manque, et alors la fréquence est chiffrée sur trafic applicatif et la clause de repli que la règle d'attribution doit porter est écrite.
- Hors périmètre :
  - La forme du champ de provenance au contrat, qui appartient à [[contract-entry-provenance]].
  - Le filtre, le seuil de troncature et les tailles de `Network.enable`, chiffrés par [[cdp-body-capture-calibration]] et non rouverts.
  - Le coût en CPU et en latence de la boucle de capture, écarté de tous les Spikes précédents et toujours ouvert ailleurs.
  - La reprise après une terminaison anormale du service worker, question distincte et non bloquée par celle-ci.

## Investigation

Deux bancs jetables hors dépôt, tous deux sur Chrome for Testing 148.0.7778.97 et un profil neuf.
Le premier isole le mécanisme : une extension MV3 (`webRequest` + `debugger`) attache un onglet servi par un serveur local, déclenche huit scénarios de consommation, chacun à deux tailles de corps — 1 kB et 512 kB, seize requêtes au total — et relève ce que chaque couche émet, puis relance la mesure à 5, 10, 20 et 30 s, après une tentative de collecte mémoire et après navigation vers `about:blank`.
Chaque scénario porte une URL propre, ce qui permet de joindre les deux couches sans clé partagée.
Le second chiffre la fréquence sur trafic réel : la même extension, sans serveur local, pilote elle-même le parcours par CDP sur les quatre cibles de [[cdp-body-capture-calibration]].

| Attempt | Evidence | Result |
| ------- | -------- | ------ |
| Lecture du code Blink avant toute mesure, pour savoir si l'événement manque ou tarde | `ResourceLoader::DidFinishLoading` diffère sa propre exécution tant que `response_body_loader_ && !has_seen_end_of_body_`, en rangeant l'instant de fin dans `deferred_finish_loading_info_` — `resource_loader.cc:1105-1118`. Or quand le corps est drainé en `BytesConsumer`, ce qui est le cas de `fetch()`, `ResponseBodyLoader::Start()` n'est jamais appelé — `resource_loader.cc:341-347`. En aval, `InspectorNetworkAgent::DidFinishLoading` émet `loadingFinished` sans condition — `inspector_network_agent.cc:1749-1787`, via `probe::DidFinishLoading` — `resource_load_observer_for_frame.cc:322-331` | L'agent d'inspection n'est pas en cause : il émet fidèlement ce qu'on lui donne. C'est le chargeur de ressource qui ne lui donne rien, parce qu'il attend une fin de corps que seul le consommateur JavaScript peut déclencher. L'événement ne tarde pas, il n'est jamais produit. Hypothèse à confirmer par la mesure |
| Banc de mécanisme, huit scénarios × deux tailles | Trois scénarios n'obtiennent aucun événement terminal CDP, aux deux tailles : `fetch()` dont la `Response` est gardée sans être lue, `response.body` retenu sans être drainé, et `fetch()` dont la promesse est ignorée. Les cinq autres concluent : `fetch()` + `.text()` et `XHR` lu donnent `loadingFinished` ; `AbortController` après en-têtes et `body.cancel()` donnent `loadingFailed` `net::ERR_ABORTED` ; `XHR` dont `responseText` n'est jamais lu donne `loadingFinished` | **6 requêtes sur 16 sans événement terminal.** Le trou est propre à `fetch()` dont le flux n'est jamais pompé — `XHR` tamponne toujours, donc conclut toujours. La taille n'y change rien : 1 kB se comporte comme 512 kB. Un abandon explicite n'est pas un trou : il produit `loadingFailed` |
| Ce que `webRequest` émet pour ces mêmes six requêtes | `onCompleted` avec `statusCode: 200` sur les six, à quelques millisecondes du `responseReceived` CDP correspondant | Exactement le cas que la règle d'attribution traite mal. CDP possède la requête, ne la conclut jamais, et `webRequest` la tient complète — sous `architecture.md:71` l'entrée disparaît des deux couches |
| L'événement manque-t-il ou arrive-t-il tard ? | Relevés à 5, 10, 20 et 30 s : rien. Tentative de collecte mémoire par `HeapProfiler.collectGarbage` : `-32601`, le domaine n'est pas exposé aux extensions. Navigation vers `about:blank` à 37 136 ms, dernier relevé à 42 137 ms : aucun événement terminal entre les deux | Le trou est définitif, pas différé. Il survit à la destruction du document, ce qui est plus fort que la collecte mémoire que l'API refuse de déclencher |
| Effet de `enableDurableMessages` | Exécution identique avec `Network.enable` portant `enableDurableMessages: true`, sur profil neuf pour écarter un service worker en cache | Aucun effet : les mêmes 6 requêtes sur 16 restent sans événement terminal. Déplacer le stockage du corps hors du renderer ne change pas qui décide de la fin |
| `getResponseBody` sur les six requêtes muettes | Appelé à t+10 s, il réussit sur les six et rend le corps entier : 1 063 caractères pour les 1 kB, 524 329 pour les 512 kB | Le corps est là, complet, alors que l'événement terminal ne viendra jamais. La couche CDP n'a donc pas besoin de renoncer à ces requêtes : elle a de quoi les écrire, il lui manque seulement le signal qui déclenche l'écriture |
| Tour applicatif, exécution 1, jetée | Parcours piloté par Playwright pendant que l'extension attachait la même page : `Frame was detached` sur les quatre cibles, aucun clic ne s'exécute, 350 requêtes seulement | `chrome.debugger.attach` sur une page pilotée par un second client d'automatisation détache la frame côté client. Le parcours n'a jamais eu lieu, l'échantillon ne vaut rien. Le tour est refait avec l'extension pilotant elle-même la navigation par CDP |
| Tour applicatif, exécution 2, retenue | Quatre cibles de [[cdp-body-capture-calibration]], 17 pages, 19 s par page, 2 163 réponses retenues hors période de grâce. Sans événement terminal : 5 XHR sur 296 XHR et Fetch (1,7 %), toutes des `message-bus/*/poll` de `meta.discourse.org`, une par page visitée. Grafana 0 sur 237, Home Assistant 0 | Le motif existe sur trafic réel à une fréquence faible, mais la signature du long polling — un poll par page, en-têtes à +145 ms, silence de 16 à 18 s jusqu'à la navigation suivante — impose de vérifier qu'il s'agit bien de corps non consommés et non de requêtes encore ouvertes |
| Sonde dédiée sur le poll Discourse, pour séparer les deux causes | Attachement, navigation vers `meta.discourse.org`, attente de 25 s, puis `getResponseBody` sur toute XHR ou Fetch sans événement terminal. Un seul candidat, le poll : `dataReceived` unique de 828 octets à +1 ms du `responseReceived`, aucun événement terminal 24 s plus tard, et `getResponseBody` qui échoue en `-32000 No data found for resource with given identifier` | **Ce n'est pas le trou.** L'erreur diffère de celle de l'orphelin de [[cdp-session-boundaries]] — `No resource with given identifier found` : la ressource est connue, mais rien n'est encore commité. La requête est réellement en vol côté réseau, le premier morceau étant la réponse immédiate du long polling. Ces cinq requêtes relèvent du cas déjà tranché, celui de la requête tuée par la navigation. **Sur trafic applicatif réel, le motif mesuré est donc 0 sur 296.** L'échec de `getResponseBody` sépare les deux causes de façon exploitable à l'écriture |

## Outcome

> **Révisé par [[cdp-body-read-timing]].** Le mécanisme et la règle d'attribution tiennent. Ce qui tombe est la joignabilité du corps : les six succès de `getResponseBody` à t+10 s ne se reproduisent pas, et une requête sans événement terminal CDP n'a de corps à aucun instant. Lire les points 3 du Result et les deux derniers paragraphes de la section avec cette correction.

- Result : **l'événement terminal manque bel et bien, et la règle d'attribution doit changer de signal.** Une réponse dont le corps n'est jamais pompé ne produit ni `loadingFinished` ni `loadingFailed`, jamais, pour la raison que dit le code : `ResourceLoader::DidFinishLoading` attend une fin de corps que seul le consommateur JavaScript peut déclencher, et pour `fetch()` ce consommateur est le seul à pouvoir démarrer le flux. Ce n'est ni un retard, ni un artefact du banc, ni un effet de taille ou de configuration.

  La correction tient en une phrase : **le signal qui déclenche l'écriture d'une entrée n'est pas l'événement terminal CDP, c'est l'événement terminal de la requête, quelle que soit la couche qui l'observe.** `webRequest` produit `onCompleted` ou `onErrorOccurred` sur toutes les requêtes, y compris les six que CDP laisse muettes. La règle de [[cdp-session-boundaries]] se lit donc ainsi, sans rien perdre de ce qu'elle établissait :

  1. Le signal terminal est le premier des deux à arriver — en pratique celui de `webRequest`, seule couche jamais interrompue.
  2. À ce signal, si CDP possède la requête et que la session est vivante, c'est l'enregistrement CDP qui est écrit ; sinon c'est celui de `webRequest`. Inchangé.
  3. Quand CDP possède la requête sans l'avoir conclue, le corps se réclame par `getResponseBody` au lieu d'être attendu. Il est disponible : six succès sur six, corps entiers.

  Le troisième point de la Decision se tranche par la négative : **l'assembleur n'a besoin d'aucun délai de garde.** Un délai n'aurait fait qu'attendre un événement qui ne vient jamais. Ce qui manquait n'était pas du temps, c'était un signal — et il existait déjà, dans l'autre couche.

  Le retour de `getResponseBody` n'est pas seulement une source, c'est le test qui sépare les deux causes de silence. `No data found for resource with given identifier` signifie que la requête est encore ouverte côté réseau, et non que son corps dort sans lecteur. Un succès signifie que l'entrée est écrivable immédiatement. Cette distinction est ce qui a fait tomber les cinq gaps du tour applicatif de 1,7 % à zéro.

  Le trou d'entrée redouté n'existe donc pas dans le modèle corrigé, et il n'a jamais été observé sur les quatre applications du tour. Ce qui reste vrai est plus petit et plus précis : sous la règle telle qu'elle est écrite aujourd'hui en `aidd_docs/memory/architecture.md:71`, une requête que CDP possède et ne conclut pas disparaît des deux couches. C'est une ligne de mémoire projet à corriger, pas une architecture à revoir.

- Confidence : haute sur le mécanisme — confirmé dans le code de Blink avant la mesure, puis reproduit à deux tailles de corps, sur deux variantes de `Network.enable`, avec quatre relevés échelonnés et un contrôle après destruction du document. Moyenne sur la fréquence : zéro sur 296 requêtes XHR et Fetch est un résultat d'échantillon, tiré de quatre applications, dix-sept pages et aucun compte connecté. Le motif est un motif de code applicatif, pas un comportement du navigateur : sa fréquence dépend de qui écrit la page, et rien ne garantit qu'une application authentifiée se comporte comme sa vitrine publique.

- Remaining uncertainty :
  - Le coût de l'appel `getResponseBody` désormais déclenché par le signal `webRequest` sur toute requête que CDP n'a pas conclue. Non chiffré, et il appartient à [[cdp-capture-loop-cost]].
  - Les flux sans fin par nature — `EventSource` et `WebSocket`, deux des six types du filtre de corps de [[cdp-body-capture-calibration]]. Le flux SSE de [[cdp-session-boundaries]] ne s'est jamais terminé non plus, mais pour une raison différente, et aucune des deux mesures ne dit quel signal terminal `webRequest` produit pour eux.
  - Le cas symétrique — une requête conclue par CDP et muette côté `webRequest` — n'a été ni observé ni cherché. Si le signal d'écriture devient celui de `webRequest`, ce cas devient le nouveau point de rupture possible.
  - Le comportement sur applications authentifiées, écarté du tour comme il l'avait été de la calibration.

## Follow-up

- Corriger `aidd_docs/memory/architecture.md:71` : le signal qui déclenche l'écriture est l'événement terminal de la requête observé par n'importe laquelle des deux couches, non celui de la couche propriétaire. La propriété, elle, ne change pas.
- Inscrire dans la couche `capture/cdp/` que le corps d'une requête possédée mais non conclue se réclame par `getResponseBody` au signal terminal de `webRequest`, et que l'échec `No data found for resource with given identifier` veut dire « encore en vol », donc « ne pas écrire maintenant ».
- Reprendre [[contract-entry-provenance]] : aux deux causes d'absence de corps déjà identifiées — traversée de borne, type ou taille écartés — s'ajoute « requête encore ouverte à la fin de la session ». Trois causes distinctes, à ne pas confondre dans un champ unique.
- Verser à [[cdp-capture-loop-cost]] le coût du `getResponseBody` supplémentaire, qui n'était pas dans son périmètre initial.
- Décider s'il faut ouvrir un Spike sur les flux sans fin, `EventSource` et `WebSocket` : ils sont dans le filtre de corps retenu et aucune mesure ne dit comment ils se terminent des deux côtés.
