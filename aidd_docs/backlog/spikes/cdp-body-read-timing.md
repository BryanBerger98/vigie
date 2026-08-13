---
type: spike
status: resolved
source: cdp-capture-loop-cost
depends_on:
  - cdp-terminal-event-gap
  - cdp-capture-loop-cost
---

# Spike: cdp-body-read-timing

## Question

Pourquoi `getResponseBody` appelé au signal terminal de `webRequest` rend six corps sur six dans [[cdp-terminal-event-gap]] et aucun sur 2 122 tentatives dans [[cdp-capture-loop-cost]], et laquelle des deux mesures décrit le comportement réel ?

## Decision

La validité du motif d'écriture déjà propagé dans `aidd_docs/memory/architecture.md`, qui affirme que le corps d'une réponse jamais lue par la page reste joignable par `getResponseBody` au moment où `webRequest` conclut la requête, et qu'aucun délai de garde n'est nécessaire.

Le choix décide de trois choses. Si ce motif reste dans l'architecture ou en sort. Si le chemin d'écriture de `capture/cdp/` doit porter un délai de garde, et lequel. Et si la sixième cause d'absence de corps — une requête que CDP possède mais ne conclut jamais — est récupérable ou doit rejoindre les cas documentés comme dégradation propre.

C'est le seul endroit de l'architecture où deux Spikes mesurés se contredisent frontalement. Tant que ce n'est pas tranché, une ligne d'architecture est affirmée sans que l'évidence la soutienne.

## Bounds

- Evidence needed :
  - Ce qui diffère entre les deux bancs. [[cdp-terminal-event-gap]] mesure six scénarios artificiels sur une page qui retient délibérément ses réponses sans les lire ; [[cdp-capture-loop-cost]] mesure du trafic dense où la page consomme normalement ses réponses. La différence de motif applicatif est le premier suspect, avant toute différence de banc.
  - Ce que signifie réellement `No data found for resource with given identifier`, rendu aux 2 122 échecs du bras D. `aidd_docs/memory/architecture.md` le lit comme « requête encore ouverte sur le réseau », alors que `webRequest` a conclu la requête et que l'échelle de reprise est allée jusqu'à 17,6 s après le signal. Cette lecture est le premier candidat à la révision : le même message pourrait recouvrir deux états distincts.
  - Un délai de garde est déjà écarté et n'a pas à être remesuré : l'échelle 0 / 100 / 500 / 2 000 / 5 000 / 10 000 ms du bras D donne zéro succès à tous les crans. Ce qui reste à trouver est ce qui rend le corps lisible dans un banc et pas dans l'autre, pas le moment où il le devient.
  - État du `Response` côté page dans chacun des deux bancs. C'est la seule variable connue qui les sépare : la page de [[cdp-terminal-event-gap]] retient sa réponse sans jamais la lire, celle du bras D la consomme normalement. Si le corps n'est lisible que tant que personne ne l'a drainé, le motif ne vaut que pour les réponses jamais lues — c'est-à-dire exactement le cas pour lequel il a été inscrit, et l'architecture serait juste mais sur-généralisée.
  - Le coût d'écriture du motif une fois qu'il rend des corps, laissé non mesuré par [[cdp-capture-loop-cost]] faute d'avoir obtenu le moindre corps.
- Stop when : la contradiction est expliquée, et la ligne de `aidd_docs/memory/architecture.md` est soit confirmée, soit corrigée avec le délai de garde chiffré.
- Hors périmètre :
  - Le motif applicatif lui-même — réponse retenue, corps jamais drainé, promesse ignorée — mesuré et clos par [[cdp-terminal-event-gap]]. Ce Spike ne remesure pas le silence de CDP, seulement la joignabilité du corps.
  - La règle de propriété par requête, qui ne dépend pas de la joignabilité du corps.
  - Le seuil de troncature et le filtre de types, chiffrés et non rouverts.

## Investigation

Un seul banc jetable hors dépôt, sur Chrome for Testing 148.0.7778.97, profil neuf à chaque exécution.
Une extension MV3 (`webRequest` + `debugger`) attache un onglet servi par un serveur local, appelle `Network.enable` avec les cinq paramètres calibrés, puis appelle `Network.getResponseBody` **une seule fois par requête, au signal terminal de `webRequest`** — c'est-à-dire exactement le motif d'écriture que `aidd_docs/memory/architecture.md:72` affirme.
Aucune échelle de reprise : les Bounds l'écartent, le bras D l'ayant déjà mesurée à zéro succès sur six crans.
Le régime clairsemé relit en plus à t+10 s, l'instant où [[cdp-terminal-event-gap]] a relevé ses six succès.

Huit exécutions, 3 400 requêtes. Chaque enregistrement porte les événements CDP reçus, le signal `webRequest`, l'instant de lecture et le retour de `getResponseBody`.

| Attempt | Evidence | Result |
| ------- | -------- | ------ |
| Rejeu du banc clairsemé de [[cdp-terminal-event-gap]] : 8 scénarios × 2 tailles | 16 requêtes, 16 signaux terminaux `webRequest`, 6 corps lus. Mais ce sont `fetch-text`, `xhr-read` et `xhr-unread` — les trois scénarios que CDP conclut. Les trois `fetch()` jamais pompés et les deux abandons échouent, au signal comme à t+10 s, en `-32000 No data found for resource with given identifier` | **La mesure d'origine ne se reproduit pas : elle s'inverse.** Le compte de six est le même, l'identité des six est l'exact complément. Sur les requêtes muettes le corps est hors d'atteinte, y compris dix secondes plus tard |
| Rejeu du bras D de [[cdp-capture-loop-cost]] : 240 s de `fetch()` jamais pompés à 24 req/s | 2 411 requêtes, 2 411 signaux terminaux `webRequest`, 0 corps, toutes en `No data found for resource with given identifier` | Le bras D se reproduit à l'identique, sur un échantillon supérieur au sien |
| Hypothèse de tête : le drainage. Même cadence, même volume, page qui lit son corps par `.text()` | 135 requêtes, 133 corps lus | Ce qui sépare les deux bancs n'est pas le banc, c'est la consommation de la réponse |
| Concurrence seule, drainage constant : `fetch()` jamais pompé à 1 req/s, puis à 24 req/s sur les tailles du banc clairsemé | 60 requêtes et 255 requêtes, 0 corps dans les deux cas | La concurrence n'explique rien. La cadence du bras D n'était pas la cause |
| Tailles de `Network.enable` seules : appel sans aucun paramètre, même scénario jamais pompé | 321 requêtes, 0 corps | L'éviction n'explique rien. Les buffers calibrés ne sont pas la cause |
| `XHR` jamais lu, à cadence dense | 186 requêtes, 185 corps lus | Le prédicteur n'est pas « la page a lu la réponse ». `XHR` tamponne toujours, donc conclut toujours, et son corps est lisible sans que personne n'y touche |
| Politique de cache seule : banc clairsemé servi en `cache-control: public, max-age=300` | Les trois `fetch()` jamais pompés obtiennent cette fois `loadingFinished` — le cache draine le corps à la place du consommateur. Leur lecture échoue au signal `webRequest` et réussit 2 sur 2 à t+10 s | Le prédicteur n'est pas le scénario applicatif non plus. Le même code produit un corps joignable ou non selon qu'un tiers a drainé le flux |
| Croisement des 3 400 requêtes des huit exécutions, classées par état terminal CDP au moment de la lecture | `loadingFinished` déjà reçu : 330 corps sur 333 (99,1 %). `loadingFinished` reçu après la lecture : 0 sur 6. Aucun événement terminal : 0 sur 3 053, toutes porteuses d'un `dataReceived` complet, médiane 24 kB. `loadingFailed` : 0 sur 8 | **La variable est `Network.loadingFinished`, et elle est sans exception.** L'arrivée des octets ne rend pas le corps lisible : les 3 053 requêtes muettes ont reçu leurs octets et n'ont jamais eu de corps |
| Persistance après coup, relectures à t+10 s | 18 sur 18 pour les requêtes conclues par `loadingFinished`, 0 sur 8 pour `loadingFailed`, 0 sur 6 pour celles sans événement terminal | Le corps ne s'évapore pas une fois commité : ce qui manque aux autres n'est pas du temps, c'est l'événement |
| Décalage `loadingFinished` − signal terminal `webRequest`, sur les 339 requêtes conclues par CDP | min 0 ms, p50 1 ms, p90 2 ms, p99 et max 52 ms. 333 sur 339 sous 50 ms | Les 6 échecs de la ligne précédente sont exactement les 6 requêtes du banc caché, dont le `loadingFinished` est arrivé 52 ms après le signal — juste au-delà du cran de 50 ms |

## Outcome

- Result : **le corps d'une réponse n'existe pour `getResponseBody` qu'après `Network.loadingFinished`, et il persiste ensuite tant que la page vit.** C'est le seul prédicteur, il est binaire, et il ne souffre aucune exception sur 3 400 requêtes. Ni la cadence, ni les tailles de `Network.enable`, ni la politique de cache, ni le scénario applicatif ne séparent les deux régimes une fois cet événement pris en compte — chacun n'agissait que par lui.

  Les deux mesures d'origine se départagent ainsi. **Le bras D de [[cdp-capture-loop-cost]] avait raison sur le fait et faux sur la cause** : ses 2 122 échecs sont reproduits, mais il les attribuait à un délai, alors qu'il mesurait 2 122 requêtes que CDP n'a jamais conclues. **Les six succès de [[cdp-terminal-event-gap]] ne se reproduisent pas** : sur le même banc, les six requêtes muettes échouent au signal comme à t+10 s, tandis que six autres réussissent. L'inversion exacte du compte suggère une erreur d'appariement entre les scénarios et leurs `requestId` dans le harnais d'origine, mais ce harnais n'est plus disponible et cela reste une hypothèse.

  Trois conséquences se tranchent.

  1. **Le motif d'écriture de `aidd_docs/memory/architecture.md:72` est renversé.** Lire au signal terminal de `webRequest` ne rend pas le corps d'une requête que CDP n'a pas conclue — jamais, à aucun instant. Le déclencheur d'écriture d'une entrée et le déclencheur de lecture d'un corps sont deux signaux distincts : `webRequest` pour l'entrée, `loadingFinished` pour le corps. C'est la règle que [[cdp-body-capture-calibration]] avait déjà écrite et que ce Spike généralise.
  2. **Aucun délai de garde, pour une raison nouvelle.** Il restait écarté faute de succès à six crans ; il l'est désormais parce qu'attendre n'a rien à faire arriver : 0 corps sur 3 053 requêtes sans événement terminal, y compris dix secondes après. Le chemin d'écriture n'en porte pas.
  3. **`No data found for resource with given identifier` ne signifie pas « requête encore ouverte sur le réseau ».** Il recouvre trois états que le message ne distingue pas : une requête que CDP ne conclura jamais, une requête conclue en échec, et la fenêtre de course avant `loadingFinished`. Il reste vrai qu'il diffère de `No resource with given identifier found`, qui désigne l'orphelin de [[cdp-session-boundaries]] ; il est faux d'en déduire que le corps arrivera plus tard.

  Ce qui subsiste du sixième état d'absence de corps subsiste sous une autre forme. Une requête que CDP possède sans jamais la conclure est bien un cas distinct — l'entrée est complète, le corps est définitivement hors d'atteinte — mais il ne se lit pas dans le message d'erreur. Il se lit dans l'absence de `loadingFinished` au moment où l'entrée est écrite, ce qui est une observation que la couche de capture fait déjà.

- Confidence : haute. Le prédicteur est binaire et sans contre-exemple sur 3 400 requêtes réparties en huit exécutions, chaque variable candidate ayant été variée seule, toutes choses égales par ailleurs. Il concorde avec le mécanisme Blink déjà lu par [[cdp-terminal-event-gap]] : `ResourceLoader::DidFinishLoading` diffère tant que la fin du corps n'a pas été vue, et c'est ce même appel qui alimente `InspectorNetworkAgent`. Le seul écart au prédicteur est une course de moins d'une milliseconde, dont la mesure du décalage explique l'origine.

- Remaining uncertainty :
  - Les trois échecs résiduels sur 333 lectures faites après `loadingFinished` ont tous un décalage nul : la lecture partait dans la même milliseconde que l'événement. Une lecture faite depuis le handler `loadingFinished` lui-même ne peut pas se trouver dans cette fenêtre, mais aucune mesure de ce Spike ne l'a vérifié directement.
  - Le banc n'a servi que du `fetch()` et du `XHR` sur un serveur local. `Document`, `Manifest`, `EventSource` et `WebSocket` — quatre des six types du filtre de corps — n'ont pas été mesurés ici. Les deux derniers sont des flux sans fin, dont [[cdp-terminal-event-gap]] a déjà noté qu'aucune mesure ne dit comment ils concluent.
  - Le coût de la lecture depuis `loadingFinished` sur trafic dense n'est pas chiffré : [[cdp-capture-loop-cost]] a mesuré une boucle qui n'obtenait aucun corps, donc jamais le coût de la copie du corps hors du renderer.

## Follow-up

- Corriger `aidd_docs/memory/architecture.md:72` : le corps se réclame dans le handler `Network.loadingFinished`, jamais au signal terminal de `webRequest`. Une requête que CDP possède sans la conclure garde son entrée et n'a pas de corps.
- Corriger `aidd_docs/memory/architecture.md:88` : `No data found for resource with given identifier` ne désigne pas une requête encore en vol. La distinction utile à l'écriture est l'absence d'événement terminal CDP, pas le message.
- Trancher [[contract-response-body-state]] à six états : le sixième existe, désigné par l'absence de `loadingFinished` et non par le message d'erreur.
- Verser à [[cdp-capture-loop-cost]] le coût de la lecture depuis `loadingFinished`, que son bras D n'a jamais pu mesurer faute d'obtenir un corps.
