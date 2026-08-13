---
type: spike
status: resolved
source: cdp-response-body-storage-cost
depends_on:
  - cdp-body-capture-calibration
  - cdp-attachment-scope
---

# Spike: cdp-capture-loop-cost

## Question

Que coûte la boucle de capture CDP en CPU et en latence — sur le renderer de l'onglet attaché, sur le service worker, et sur la page que l'utilisateur manipule — aux valeurs retenues par [[cdp-body-capture-calibration]] et sur les onglets qu'attache [[cdp-attachment-scope]] ?

## Decision

Si la couche telle que calibrée est expédiable sans dégrader la page de l'utilisateur, et à défaut quel levier la borne : lot d'écriture, plafond de débit, échantillonnage, ou filtre plus étroit.

Le choix décide de trois choses. La forme du chemin d'écriture de `capture/cdp/`, qui lit chaque corps dans le gestionnaire de `Network.loadingFinished` et écrit dans IndexedDB, les deux sur le chemin du service worker (`aidd_docs/memory/architecture.md:67`). Le nombre d'onglets réellement attachables : [[cdp-attachment-scope]] a retiré la mémoire de la liste des arguments contre une politique large, sans que le CPU y entre jamais. Et si la couche reste utilisable sur une machine modeste, toutes les mesures du projet ayant été faites sur une seule machine.

Ce Spike a été écarté du périmètre de chacun des sept qui précèdent, à chaque fois pour la même raison et sans jamais être instruit.

## Bounds

- Evidence needed :
  - CPU du renderer attaché contre non attaché, à parcours identique et aux tailles `maxTotalBufferSize` 10 Mo et `maxResourceBufferSize` 2 Mo. Le contrôle A/B est le même que celui qui a servi à la rétention mémoire.
  - CPU du service worker sur un tour applicatif dense : lecture des corps, filtre, troncature et écriture IndexedDB sont tous sur son chemin.
  - Latence ajoutée à la page, mesurée côté page plutôt que côté extension — temps de réponse des requêtes applicatives, attaché contre non attaché.
  - Effet du nombre d'onglets attachés, jusqu'à six. La série d'attachement est déjà mesurée sous 10 ms ; c'est le régime permanent qui manque.
  - Débit d'écriture soutenable, rapporté au trafic mesuré : 1 856 réponses applicatives par tour de 240 s, dont 35 % passent le filtre.
  - Comportement sous charge dégradée, CPU bridé, pour savoir si le verdict tient hors d'une machine de développement.
  - Part du coût imputable à la lecture des corps contre celle imputable au seul volume d'événements. Les deux se règlent par des leviers différents et doivent donc être séparées.
  - Surcoût de l'appel `getResponseBody` que [[cdp-terminal-event-gap]] ajoute au chemin d'écriture : quand CDP possède une requête sans l'avoir conclue, le corps se réclame au signal terminal de `webRequest` au lieu d'arriver avec `loadingFinished`. Le motif n'a jamais été observé sur trafic applicatif — 0 sur 296 — mais il ajoute un appel et une attente au service worker chaque fois qu'il se produit, et la mesure doit dire ce que coûte une application qui l'emploie systématiquement.
- Stop when : verdict chiffré sur prototype jetable — la couche calibrée passe sans dégradation perceptible, ou elle demande un levier nommé et dimensionné.
- Hors périmètre :
  - Le filtre, le seuil de troncature et les tailles de `Network.enable`, chiffrés par [[cdp-body-capture-calibration]] et non rouverts. Ils ne sont ici que des paramètres d'entrée.
  - La mémoire retenue par le renderer, mesurée deux fois et close.
  - Le pipeline vidéo, dont le profil `MediaRecorder` porte sa propre mesure ouverte (`aidd_docs/memory/architecture.md:100`).
  - Le SDK et la couche `webRequest` existante, dont le coût est antérieur à CDP et indépendant de lui.

## Investigation

Un banc jetable hors dépôt, sur Chrome for Testing 148.0.7778.97 et un profil neuf par exécution.
Une extension MV3 charge une page qui émet 24 requêtes par seconde vers un serveur local, sur un mélange de tailles de 2 à 120 ko, dont 25 % en `application/json` passent le filtre de lecture — soit 24 réponses par seconde et 5 lectures par seconde, contre 23,4 et 8,2 pour le tour applicatif de [[cdp-body-capture-calibration]].
La page porte une charge de rendu constante, 120 boîtes transformées et environ 1 ms de script par frame, pour que la contention sur le fil principal soit observable plutôt que théorique.

Quatre bras séparent ce que la question demande de séparer : **A** chargé mais jamais attaché, **B** attaché sans lire aucun corps, **C** attaché avec lecture du corps sur `Network.loadingFinished`, troncature à 256 ko et écriture IndexedDB par lots de 50 ou 250 ms, **D** identique à C mais déclenché par `webRequest.onCompleted` sur des requêtes que la page ne pompe jamais.
`B − A` isole le volume d'événements, `C − B` isole la lecture des corps, `C − A` donne le coût total de la couche.
Le CPU est relevé par `ps` sur les processus du profil, ce qui donne les secondes réellement consommées par processus plutôt qu'un pourcentage instantané ; la latence est relevée côté page, jamais côté extension.

Aucun Playwright : un second client CDP s'attacherait aux pages mesurées et changerait l'objet de la mesure.
La charge dégradée est produite par six boucles Node symétriques appliquées identiquement à chaque bras, et non par `Emulation.setCPUThrottlingRate` qui n'atteindrait que l'onglet attaché.
Quatorze exécutions de 60 s après 12 s de chauffe, bras entrelacés pour que la dérive machine frappe tout le monde pareil.

| Attempt | Evidence | Result |
| ------- | -------- | ------ |
| Coût total de la couche, un onglet, trois exécutions par bras | Secondes CPU sur la fenêtre de 60 s : A 17,76 · B 18,33 · C 18,94. Écarts : `B − A` 0,57 s, `C − B` 0,62 s, `C − A` 1,18 s | **La couche calibrée coûte 1,97 % d'un cœur sur un onglet.** Le volume d'événements en vaut 0,94 %, la lecture des corps et l'écriture 1,03 % — les deux moitiés sont d'ordre égal, donc aucun levier unique ne suffirait à diviser le coût par deux |
| Où le coût atterrit, par processus | Décomposition de `C − A` : processus navigateur **+0,95 s**, renderer +0,37 s, processus d'extension +0,48 s, réseau +0,06 s, GPU −0,19 s | **Le coût ne tombe pas sur le renderer attaché mais sur le processus navigateur**, qui arbitre chaque événement `debugger`. Le renderer, seul objet du contrôle A/B hérité de la mesure de rétention mémoire, est le moins touché des trois. Le GPU baisse : bruit de mesure, l'écart est sous la dispersion inter-exécutions |
| Part du coût imputable au code du gestionnaire | `busyMs`, temps synchrone passé dans les gestionnaires d'événements CDP : 15,7 ms cumulés sur 60 s, contre 480 ms de CPU ajouté au processus d'extension | **Le code de capture pèse 3,3 % de ce que coûte la capture.** Les 96,7 % restants sont la réception et la désérialisation du flux d'événements. Optimiser le gestionnaire ne rendrait rien ; seul un filtre appliqué à la source, avant que l'événement ne traverse l'IPC, déplacerait le chiffre |
| Latence ajoutée à la page, un onglet | ttfb p50 1,30 → 1,53 ms, p95 2,30 → 2,37 ms, p99 5,30 → 3,97 ms. Total p95 2,50 → 2,63 ms. 1 439 requêtes abouties sur 1 439 dans les deux bras | **+0,23 ms sur la médiane, rien sur les queues.** Sur un serveur local sans latence réseau, c'est le plancher : la même valeur absolue disparaîtrait dans le bruit d'une requête réelle à 40 ms |
| Frames, un onglet | p50 13,3 ms et p95 13,4 ms identiques entre A, B et C. Une seule frame à 91,4 ms sur 4 495, dans une exécution de C sur trois ; les deux autres plafonnent à 13,5 ms comme le bras A | **Aucune dégradation perceptible du rendu.** L'incident isolé n'est pas reproductible et n'est pas attribuable en l'état |
| Six onglets attachés, régime permanent | CPU total A 29,69 s → C 35,27 s, soit `C − A` de 5,58 s = **9,3 % d'un cœur**. Processus d'extension 0,75 → 2,81 s. Événements 46 210 contre 7 238 à un onglet | Le coût suit le nombre d'onglets sans surcoût de coordination : 4,7× le delta d'un onglet pour 6× les onglets. **Six onglets attachés restent sous 10 % d'un cœur** |
| Six onglets, effet sur la page — onglet visible contre onglets cachés | Onglet visible : ttfb p50 1,0 → 1,5 ms, total p95 2,0 → 2,8 ms, frames inchangées à 13,3 ms, zéro jank. Onglets cachés : ttfb p50 1,1 → 1,84 ms, total p95 2,4 → **6,12 ms**, p99 9,78 → **17,02 ms**, requêtes abouties 1 438,8 → 1 435,4 sur 1 439 | **L'onglet que l'utilisateur regarde est épargné, les autres paient.** Le total p95 des onglets cachés est multiplié par 2,6 et trois requêtes sur mille n'aboutissent plus. Les onglets cachés ne reçoivent aucun `requestAnimationFrame`, donc leur rendu n'est pas mesurable — seule leur latence réseau l'est |
| Charge dégradée, six boucles CPU symétriques | `C − A` de 1,16 s sous charge, contre 1,18 s au repos. Les valeurs absolues baissent — A 12,61 s, C 13,77 s — parce que Chrome est déscheduled au profit des boucles | **Le surcoût de la couche ne se dégrade pas sous contention** : il reste constant en valeur absolue quand la machine est saturée. Le verdict ne dépend donc pas d'une machine de développement |
| Débit d'écriture soutenable | 299 corps lus et écrits par exécution de 60 s, 10,39 Mo, 162,7 lots IndexedDB, zéro échec de lecture, zéro perte. Par appel : `getResponseBody` 0,53 ms d'attente, lot IndexedDB 0,54 ms. À six onglets : 1 794 lectures, 0,69 ms et 1,09 ms | Le chemin d'écriture tient à 5 lectures par seconde et se dégrade doucement à 30 : les deux attentes augmentent de 30 % et 100 % pour un débit six fois supérieur. **Rien n'indique une saturation avant plusieurs fois le trafic calibré** |
| Bras D, motif de [[cdp-terminal-event-gap]], première exécution | `wrTriggered` 4, `wrUnmatched` 295 : le déclencheur `webRequest` trouvait presque toujours l'enregistrement CDP absent | Banc invalide, corrigé deux fois. La page consommait encore les corps, donc `loadingFinished` arrivait et libérait l'enregistrement ; et le profil réutilisé servait l'ancien `background.js` depuis le cache de code de Chrome. Les bras A, B et C, dont chaque profil est neuf, ne sont pas concernés |
| Bras D, quand arrive le signal `webRequest` par rapport à CDP | Échelle de reprise de recherche à 0, 50, 200, 1 000 et 5 000 ms. Résultat : `lookupStep {0: 7, 1: 352}` — 98 % des requêtes ne sont résolues qu'au barreau de 50 ms, attente moyenne **42,6 ms**. Avec reprise, `wrNoCdpRecord` tombe de 294 à 0 | **`webRequest.onCompleted` atteint le service worker avant que CDP ait annoncé la réponse.** Aucun Spike ne l'avait anticipé : au signal qui doit déclencher l'écriture, l'extension n'a pas encore d'enregistrement CDP à consulter. Le chemin d'écriture doit donc porter une file d'attente, pas une simple recherche |
| Bras D, le corps est-il lisible au signal terminal ? | Échelle de reprise de lecture à 0, 100, 500, 2 000, 5 000 et 10 000 ms, soit jusqu'à 17,6 s après le signal. **2 016 tentatives, zéro succès** (`grbStep` vide), toutes en `-32000 No data found for resource with given identifier` | **Le corps n'est jamais disponible.** C'est l'inverse de ce que [[cdp-terminal-event-gap]] a relevé — six succès sur six, corps entiers, à t+10 s — et de ce que son follow-up a inscrit dans la couche `capture/cdp/` |
| Deux causes candidates de la divergence, éliminées | À 1 requête par seconde au lieu de 24, soit 72 requêtes au total contre 1 439 : 0 succès sur 106. Avec `Network.enable` sans paramètres, tampons par défaut au lieu de 10 Mo et 2 Mo : 0 succès sur 106, `lookupStep {0: 2, 1: 17}` inchangé | Ni la pression de trafic sur le tampon CDP, ni les tailles retenues par [[cdp-body-capture-calibration]] n'expliquent l'écart. **Le motif de [[cdp-terminal-event-gap]] ne se reproduit pas sur ce banc**, sur 2 122 tentatives, deux cadences et deux configurations de tampon. La divergence reste non expliquée et n'appartient pas à ce Spike |

Limites du banc, à ne pas lire au-delà de ce qu'elles portent :

- `truncated` vaut zéro partout : le plus gros corps du banc fait 120 ko, le chemin de troncature à 256 ko n'a jamais été emprunté. Il est hors périmètre, déjà chiffré par [[cdp-body-capture-calibration]].
- Serveur local, sans latence réseau : les latences absolues sont un plancher, et les écarts relatifs y sont donc maximisés.
- Les onglets cachés ne reçoivent aucun `requestAnimationFrame` ; leur rendu n'est pas mesuré, seule leur latence réseau l'est.
- Le bras D n'a écrit aucune entrée, faute de corps lisible : son coût d'écriture reste non chiffré.
- Une seule machine, comme toutes les mesures du projet. La charge symétrique en est le seul contrôle.

## Outcome

**La couche calibrée est expédiable telle quelle, sans levier.**
Un onglet attaché coûte 1,97 % d'un cœur, six en coûtent 9,3 %, et l'onglet que l'utilisateur regarde ne perd ni frame ni requête : sa médiane de ttfb prend 0,23 ms sur un serveur local sans latence réseau, c'est-à-dire dans le régime où l'écart relatif est le plus grand qu'il puisse être.
Sous CPU saturé le surcoût reste à 1,16 s contre 1,18 s au repos, donc le verdict ne dépend pas de la machine de développement.
Aucun des quatre leviers envisagés par la Decision — lot d'écriture, plafond de débit, échantillonnage, filtre plus étroit — n'a lieu d'être armé au trafic calibré.

**Si un levier devient nécessaire un jour, ce n'est aucun de ceux-là.**
Le temps synchrone passé dans les gestionnaires vaut 3,3 % du CPU que la capture ajoute au processus d'extension, et le gros du coût atterrit sur le processus navigateur, qui arbitre le flux d'événements `debugger`.
Le coût est donc dans le transport, pas dans le traitement : le seul levier qui déplacerait le chiffre est un filtre appliqué avant que l'événement ne traverse l'IPC, et non une optimisation du chemin d'écriture.
Cela infirme la prémisse de la Decision, qui cherchait le levier du côté du chemin d'écriture.

**Deux réserves bornent ce verdict.**
Les onglets cachés paient ce que l'onglet visible est épargné : leur total p95 est multiplié par 2,6 et trois requêtes sur mille cessent d'aboutir. Rien ne le rend visible à l'utilisateur, mais une application qui dépend de ses onglets d'arrière-plan le sentirait.
Et le motif d'écriture décrit par [[cdp-terminal-event-gap]] n'a pas pu être chiffré : `getResponseBody` au signal terminal de `webRequest` n'a jamais rendu de corps sur ce banc, sur 2 122 tentatives, deux cadences et deux configurations de tampon. Le coût de ce chemin reste donc inconnu, et la contradiction avec le Spike source n'appartient pas à celui-ci.

## Follow-up

- Inscrire dans `aidd_docs/memory/architecture.md` que le déclencheur `webRequest` précède l'annonce CDP de la réponse : 98 % des requêtes ne sont résolues qu'après 50 ms d'attente, moyenne 42,6 ms, et une recherche immédiate en perd 294 sur 299. Le chemin d'écriture de `capture/cdp/` doit porter une file d'attente, pas une simple consultation.
- Inscrire que le coût de la capture CDP est dans la réception du flux d'événements et non dans le code de capture, et que le seul levier de réduction est le filtrage à la source. Sans cela, une optimisation future viserait le gestionnaire, qui ne pèse rien.
- Trancher la contradiction avec [[cdp-terminal-event-gap]], dont le follow-up « le corps se réclame par `getResponseBody` au signal terminal de `webRequest` » est déjà propagé dans `architecture.md` alors qu'il ne se reproduit pas ici. Réouverture de ce Spike ou nouveau Spike : décision de cycle de vie.
- Chiffrer le coût d'écriture du motif de [[cdp-terminal-event-gap]] une fois la contradiction levée. Le bras D n'ayant obtenu aucun corps, sa part IndexedDB reste non mesurée.
