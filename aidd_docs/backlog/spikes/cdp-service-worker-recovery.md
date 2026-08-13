---
type: spike
status: resolved
source: cdp-body-capture-calibration
depends_on:
  - cdp-mv3-feasibility
  - cdp-attachment-scope
  - cdp-session-boundaries
---

# Spike: cdp-service-worker-recovery

## Question

Quand le service worker meurt anormalement — plantage, mise à jour de l'extension, rechargement — que devient la session `chrome.debugger` attachée, et la capture peut-elle reprendre sans geste de l'utilisateur ni entrée perdue ?

## Decision

L'existence et la forme d'un mécanisme de reprise dans `capture/cdp/`, et l'état qu'il doit persister pour fonctionner.

Le choix décide de quatre choses. Si `chrome.storage.session` suffit comme support de reprise ou s'il en faut un qui survive au redémarrage du navigateur. Si `onDetach` est un signal exploitable, alors que `DetachReason` ne connaît que `target_closed` et `canceled_by_user` et n'a donc aucune valeur pour ce cas ([[cdp-mv3-feasibility]]). Si une reprise doit se distinguer d'un `canceled_by_user`, qu'il est formellement interdit de faire suivre d'un ré-attachement (`aidd_docs/memory/architecture.md:83`). Et si `enableDurableMessages` permet de rattraper les corps des requêtes en vol au moment de la mort, piste ouverte par [[cdp-body-capture-calibration]] et jamais essayée sur ce cas.

En fonctionnement normal la question ne se pose pas : une session attachée maintient le service worker en vie, ce que [[cdp-mv3-feasibility]] a mesuré. Ce Spike ne porte que sur les morts que ce keepalive n'empêche pas.

## Bounds

- Evidence needed :
  - Les trois morts provoquées séparément : plantage du service worker, mise à jour de l'extension, et arrêt manuel depuis `chrome://extensions`. Rien ne garantit qu'elles se comportent pareil.
  - `onDetach` est-il émis pour chacune, et avec quelle `reason` ? Et son gestionnaire s'exécute-t-il, sachant que le contexte qui le porte est précisément celui qui meurt.
  - État minimal à persister pour reconstituer la session : `tabId` attachés, marque de session par onglet côté `webRequest`, et l'ensemble des `requestId` annoncés côté CDP dont dépend la règle d'attribution (`aidd_docs/memory/architecture.md:71`). Ce dernier est le plus volumineux et le plus volatil des trois.
  - Survie de `chrome.storage.session` à chacune des trois morts, mesurée et non déduite de sa documentation.
  - Sort des requêtes en vol : la mort du service worker se comporte-t-elle comme le détachement mesuré par [[cdp-session-boundaries]], donc rendu intégral à `webRequest`, ou la couche `webRequest` meurt-elle en même temps et laisse-t-elle un trou d'entrée ?
  - Ce que `enableDurableMessages` change ici. [[cdp-body-capture-calibration]] l'a mesuré faisant survivre un corps à une navigation croisée ; rien ne dit qu'il le fasse survivre à la mort du client CDP.
  - Un `canceled_by_user` antérieur doit interdire la reprise. Cette interdiction survit-elle à la mort, ou la reprise ressuscite-t-elle une session que l'utilisateur venait de refuser ?
- Stop when : verdict tranché sur prototype jetable, sous la forme d'une règle qui dit si la reprise a lieu, sur quel état persisté elle s'appuie, et ce que chaque type de mort coûte en entrées et en corps.
- Hors périmètre :
  - La fenêtre aveugle à l'attachement, chiffrée à 82 ms par [[cdp-attachment-scope]] et non rouverte.
  - Le coût en CPU et en latence de la boucle de capture, qui appartient à [[cdp-capture-loop-cost]].
  - La reprise du pipeline vidéo, indépendante et déjà résolue autrement : le document offscreen survit à la terminaison du service worker.
  - L'affordance de reprise dans l'interface, et ce que l'utilisateur en voit.

## Investigation

Banc jetable, jamais versé au dépôt.
`capture/cdp/` n'existe pas encore : la mesure porte sur un prototype qui reproduit la boucle, pas sur le code du produit.

Chrome for Testing 148.0.7778.97 lancé en `--headless=new`, profil neuf détruit et recréé à chaque exécution.
Un profil réutilisé sert l'extension depuis le cache de code de Chrome et ferait tourner silencieusement le `background.js` de l'exécution précédente ; `chrome.storage.session` étant de toute façon vidé au redémarrage du navigateur, rien de mesuré n'y est perdu.

La page du banc entretient deux trafics.
Une requête courte toutes les 500 ms, qui donne aux deux couches de quoi produire des événements en continu, et un lot de trois requêtes de 8 000 ms réémis toutes les 4 000 ms, qui garantit six requêtes ouvertes à l'instant de la mort.
Le service worker numérote chaque ligne qu'il écrit d'un numéro de génération, ce qui permet de distinguer après coup une vie du worker de la suivante, et persiste toutes les 500 ms dans `chrome.storage.session` l'état sous surveillance : onglets attachés, carte `requestId → url` des requêtes en vol, marque d'annulation.

Six morts, provoquées séparément.
Le plantage épuise le tas V8 plutôt qu'il n'alloue des `ArrayBuffer` : le tas a son propre plafond et l'atteindre avorte le processus, là où des tampons externes grandiraient contre la mémoire système sans jamais tuer personne.
L'arrêt manuel est rendu par un `Target.closeTarget` sur la cible du worker, la mise à jour par `chrome.runtime.reload()`, le refus utilisateur par un `chrome.debugger.detach()` suivi d'un drapeau persisté.
Le driver ne s'attache jamais à la page, seulement à la cible navigateur : un second client CDP sur l'onglet détacherait la session de l'extension et détruirait ce qui est mesuré.

La perte se compte sur l'instant où tombe l'événement terminal d'une requête, non sur celui où elle commence — c'est le seul instant où une couche devait être vivante pour l'enregistrer.
Tout ce qui suit la fermeture du navigateur est écarté : tuer Chrome avorte les requêtes ouvertes et produit une salve d'erreurs qui appartiennent au démontage du banc, pas à la mort mesurée.
La durée de panne est mesurée entre la dernière persistance connue et le démarrage de la génération suivante, plus juste que l'instant du déclenchement puisque le worker vit encore un moment après avoir reçu l'ordre.

| Attempt | Evidence | Result |
| --- | --- | --- |
| Provoquer une mort de processus réelle et non une exception rattrapée | Épuisement du tas V8 ; le journal reprend en génération 2 | Le worker meurt et redémarre : les deux vies sont séparables dans un journal unique |
| Dater la reprise après plantage | Génération 2 démarrée 8 880 ms après le déclenchement, 8 978 ms après la dernière persistance | La reprise a lieu, automatique, sans geste de l'utilisateur |
| Vérifier si `onDetach` signale la mort | 0 émission sur les six morts, y compris le détachement volontaire | Inutilisable comme signal : le gestionnaire ne s'exécute jamais, même quand c'est l'extension elle-même qui détache |
| Vérifier si le ré-attachement suit la reprise | `attached` en génération 2, sans erreur, sur plantage et sur arrêt du target | Le ré-attachement réussit dès que le worker redémarre |
| Mesurer la survie de `chrome.storage.session` | `sessionSurvived: true` sur les quatre morts qui connaissent une reprise ; `priorState` porte les 6 requêtes en vol | La session survit à la mort du worker et suffit comme support de reprise |
| Peser l'état minimal à persister | 449 octets pour 1 onglet attaché et 6 requêtes en vol ; 79 octets quand le ré-attachement est refusé et que les deux cartes sont vides | Le coût de persistance est porté par la carte `requestId → url`, pas par la liste d'onglets |
| Mesurer ce que change `enableDurableMessages` | Tally identique au plantage nu sur les cinq compartiments ; reprise 8 161 ms contre 8 880 ms | Ne rattrape aucun corps et ne déplace aucune entrée : sans effet sur ce cas |
| Provoquer un arrêt manuel du worker | `Target.closeTarget` ; reprise en 296 ms, panne de 472 ms | La mort la plus brève, et la seule sans perte |
| Provoquer une mise à jour d'extension | `chrome.runtime.reload()` ; aucune génération 2 après 63 s, 57 requêtes traversées | Aucune reprise : le worker ne redémarre jamais de lui-même |
| Distinguer extension désactivée et worker non démarré | `serviceWorkers: []`, mais l'origine `chrome-extension://` sert toujours `manifest.json` | L'extension reste activée ; c'est son worker qui n'est plus démarré |
| Chercher un autre signal de réveil après `reload` | Onglet neuf ouvert sur l'origine surveillée, 20 s d'attente : `wokeOnNav: false` | Ni le trafic en cours ni une navigation neuve ne réveillent le worker |
| Tester si un gestionnaire d'installation réveille le worker après `reload` | `chrome.runtime.onInstalled` ajouté à la sonde : une émission à la génération 0 avec `reason: "install"`, aucune après le `reload` | Hypothèse écartée : le registre de gestionnaires n'est pas en cause, le verdict `reload` tient |
| Mesurer le détachement volontaire seul | `webRequest` 54/54, CDP 0/54, aucun `onDetach` | Le refus ne coûte aucune entrée : `webRequest` continue seul, seuls les corps disparaissent |
| Vérifier qu'un refus survit à une mort ultérieure | `canceled: true` retrouvé au démarrage de la génération 2, deux `attach-refused` consécutifs | L'interdiction de ré-attacher survit et tient, y compris à l'ouverture d'un nouvel onglet |
| Situer la perte dans la fenêtre de panne | Plantage : `before→outage` 6 requêtes, 0 enregistrée par l'une ou l'autre couche | La perte est exactement l'ensemble des requêtes dont l'événement terminal tombe pendant la panne |
| Mesurer le sort des requêtes commencées pendant la panne | `outage→after` 6 requêtes : `webRequest` 6/6, CDP 0/6 | `webRequest` rattrape l'entrée après la reprise ; CDP ne rattrape jamais le corps |
| Vérifier que l'absence de fenêtre ne fausse pas la mesure | Plantage rejoué en headless contre le run headful : mêmes générations, `onDetach` 0, tally identique sur les cinq compartiments | Le headless mesure la même chose |

Six limites tiennent à la forme du banc et bornent ce que ces chiffres autorisent à conclure.

L'extension est chargée en `--load-extension`, non installée depuis le Web Store, et `chrome.runtime.reload()` n'est qu'un substitut de mise à jour.
Le verdict le plus dur du Spike est aussi celui dont le chemin de chargement pourrait porter la responsabilité.

Le zéro perte de l'arrêt du target reflète une panne de 472 ms contre des requêtes de 8 000 ms, soit environ 6 % de chances qu'une requête soit prise dedans.
C'est une panne trop brève pour toucher quoi que ce soit, pas une absence structurelle de perte.

Le compartiment `before→before` affiche `cdp: 0` parce que ces requêtes précèdent l'attachement.
C'est la fenêtre aveugle de [[cdp-attachment-scope]], hors périmètre ici.

La sonde de réveil par navigation ouvre un onglet neuf, dont le compteur d'identifiants de la page repart à zéro.
Les 3 requêtes classées `outage→before` sur les deux morts sans reprise sont des collisions d'identifiants, et la génération `0` de `cancel-then-crash` est une ligne écrite avant que le numéro de génération ne soit affecté au démarrage.

Une seule machine, un seul onglet suivi, six requêtes en vol au moment de la mort.
Les 449 octets d'état persisté ne disent rien de ce que pèserait la même carte sous le trafic calibré par [[cdp-body-capture-calibration]].

Le trafic du banc est fait de requêtes longues tenues ouvertes par le serveur, choisies pour être en vol à coup sûr au moment de la mort.
Il maximise donc la population exposée à la panne, et ne représente pas la distribution réelle des durées de requête.

## Outcome

> **Révisé par la phase 6 de `2026_08_12_cdp-capture`.**
> La reprise a bien lieu et le chemin de démarrage tient, mais il lui manque un geste avant les trois autres : la session `chrome.debugger` survit au worker qui l'a ouverte.
> Mesuré après un `Target.closeTarget` sur le worker, `chrome.debugger.attach` sur un onglet que la génération précédente tenait revient `Another debugger is already attached to the tab with id: N` — le bandeau est resté levé, la session est restée ouverte, et la génération neuve ne peut pas la piloter puisque les fenêtres de requête qui décident de l'appartenance d'un événement CDP sont mortes avec la mémoire qui les portait.
> Le démarrage détache donc les onglets listés avant de les ré-attacher, et `onDetach` ne dit rien de tout cela, ce que la ligne au-dessus établissait déjà.
> Pourquoi le banc voyait un `attached` sans erreur en génération 2 n'est pas tranché : sa sonde n'a pas été rejouée.
> Lire la ligne « Vérifier si le ré-attachement suit la reprise » et le premier point de l'Outcome avec cette correction.

**Il n'y a pas de mécanisme de reprise à écrire, seulement un ré-attachement au démarrage.**
Chrome redémarre le service worker de lui-même sur le premier événement pour lequel il a un gestionnaire, et `webRequest` suffit à le déclencher : la reprise n'a pas à être provoquée, elle a lieu.
Ce que `capture/cdp/` doit porter tient en trois gestes au démarrage — relire l'état persisté, ré-attacher les onglets qui y figurent, refuser de le faire si la marque d'annulation est présente.
La Decision demandait la forme d'un mécanisme de reprise ; l'évidence répond qu'il s'agit d'un chemin de démarrage, pas d'un mécanisme.

**`chrome.storage.session` suffit, et un support survivant au redémarrage du navigateur serait sans objet.**
La session survit aux quatre morts qui connaissent une reprise et rend intacte la carte des requêtes en vol, pour 449 octets sur un onglet.
Un redémarrage du navigateur ferme tous les onglets : il ne reste alors aucune requête en vol à réattribuer ni aucune session à reprendre, donc l'état à faire survivre n'a plus de destinataire.
Ce raisonnement n'est pas mesuré ici, à la différence de tout le reste de ce Spike.

**`onDetach` est à écarter, et `enableDurableMessages` avec lui.**
`onDetach` n'est émis dans aucune des six morts, pas même quand c'est l'extension elle-même qui appelle `chrome.debugger.detach()` : le gestionnaire n'est pas un signal de mort dégradé, il est muet.
Le code ne peut donc apprendre qu'il a été détaché qu'en le constatant au démarrage suivant, ce qui fait de l'état persisté la seule source de vérité.
`enableDurableMessages`, piste ouverte par [[cdp-body-capture-calibration]], ne rattrape aucun corps en vol et ne déplace pas une entrée : la piste se ferme.

**Un `canceled_by_user` antérieur survit et tient.**
La marque persistée est retrouvée au démarrage de la génération suivante et bloque deux tentatives de ré-attachement consécutives, y compris celle déclenchée par l'ouverture d'un onglet neuf.
L'interdiction de `aidd_docs/memory/architecture.md:83` n'a donc pas besoin d'un garde-fou supplémentaire, à condition que le refus soit écrit dans `chrome.storage.session` et non tenu en mémoire.
La même ligne note que Chrome, lui, ne garde aucune mémoire du refus : la marque persistée est bien la seule chose qui l'empêche de revenir.

**Le coût de chaque mort, en entrées et en corps.**

| Mort | Entrées perdues | Corps perdus | Reprise |
| --- | --- | --- | --- |
| Arrêt du worker | 0 | 6 | Automatique, 296 ms |
| Plantage | 6 | 12 | Automatique, ~8,5 s |
| Plantage `--durable` | 6 | 12 | Identique, le drapeau ne change rien |
| Refus utilisateur | 0 | tous les suivants | Aucune, et c'est l'intention |
| Refus puis plantage | 6 | tous les suivants | Le worker revient, le ré-attachement reste refusé |
| Mise à jour d'extension | tout | tout | Aucune |

Les corps perdus dépassent les entrées perdues parce qu'une requête commencée pendant la panne et conclue après voit son entrée rattrapée par `webRequest`, jamais son corps par CDP.
La règle d'attribution de `aidd_docs/memory/architecture.md:71` n'est pas en cause : ces requêtes sont bien attribuées, elles arrivent seulement amputées.

**La mise à jour d'extension est le seul cas qui ne se répare pas tout seul, et la décision produit est prise : prévenir et reprendre.**
Après `chrome.runtime.reload()`, l'extension reste activée mais son worker ne redémarre jamais : ni le trafic en cours, ni une navigation neuve sur l'onglet suivi ne le réveillent, et le gestionnaire `chrome.runtime.onInstalled` ajouté pour tester l'hypothèse d'un registre de gestionnaires vidé n'y change rien.
La décision retenue est que la capture reprend d'elle-même et que l'utilisateur en est informé sans avoir rien à faire : au démarrage, le worker relit l'état persisté, ré-attache les onglets qui y figurent et affiche un message disant que l'extension a été mise à jour et la capture interrompue.
Le ré-attachement n'exige aucun geste — `chrome.debugger.attach` rouvre son bandeau sans redemander d'autorisation — donc la reprise est bien transparente ; la seule chose que l'utilisateur ne pourrait pas éviter serait une mise à jour ajoutant une permission porteuse d'avertissement, cas où Chrome désactive l'extension jusqu'à acceptation manuelle, et le geste correspondant est de faire passer toute capacité nouvelle par `optional_permissions` plutôt que d'agrandir le tableau `permissions` d'une version publiée.
Reste que le chemin par lequel ce démarrage a lieu après une vraie mise à jour n'est pas mesuré ici : `chrome.runtime.reload()` sur une extension en `--load-extension` n'en réveille aucun, et rien ne dit encore qu'une mise à jour publiée se comporte pareil.

## Follow-up

- Consigner la règle de reprise dans `aidd_docs/memory/architecture.md` : la reprise est un chemin de démarrage, pas un mécanisme, et elle s'appuie sur trois entrées de `chrome.storage.session` — onglets attachés, carte `requestId → url`, marque d'annulation.
- Consigner que `onDetach` n'est émis pour aucune mort ni pour un détachement volontaire, ce qui l'écarte comme signal et fait de l'état persisté la seule source de vérité. Les notes sur `DetachReason` (`aidd_docs/memory/architecture.md:66` et `:83`) ne disaient pas qu'il peut ne jamais se déclencher.
- Fermer la piste `enableDurableMessages` ouverte par [[cdp-body-capture-calibration]] : sans effet sur la mort du client CDP.
- Consigner la décision produit : sur mise à jour, la capture reprend d'elle-même au démarrage suivant et un message informe que l'extension a été mise à jour et la capture interrompue. Aucun geste demandé à l'utilisateur.
- Faire passer toute capacité nouvelle par `optional_permissions` et `optional_host_permissions` plutôt que d'agrandir le tableau `permissions` d'une version publiée : une permission ajoutée qui porte un avertissement désactive l'extension jusqu'à acceptation manuelle. C'est le seul cas où l'utilisateur serait obligé d'agir, et il s'évite au lieu de se traiter.
- Rejouer le seul cas `reload` sur une extension installée depuis le Web Store plutôt que chargée en `--load-extension`, pour savoir si l'absence de reprise tient au chemin de chargement. C'est ce qui décide si la reprise après mise à jour a lieu tout de suite, sur `chrome.runtime.onInstalled` avec `reason: "update"`, ou seulement au prochain démarrage du navigateur.
- Peser l'état persisté sous le trafic calibré par [[cdp-body-capture-calibration]] : 449 octets valent pour un onglet et six requêtes en vol, et la carte `requestId → url` est la part qui grandit.
