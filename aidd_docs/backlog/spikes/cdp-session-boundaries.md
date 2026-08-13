---
type: spike
status: resolved
depends_on:
  - cdp-webrequest-deduplication
  - cdp-optin-usability
related_to:
  - contract-entry-provenance
  - contract-response-body-state
---

# Spike: cdp-session-boundaries

## Question

Aux deux bornes d'une session `chrome.debugger` — l'attachement et le détachement — quel producteur possède une requête déjà en vol, et le rapport la rend-il une seule fois, deux fois, ou pas du tout ?

## Decision

La règle de bascule entre `capture/network/` et `capture/cdp/`, seule pièce du cadrage de [[cdp-webrequest-deduplication]] laissée sans mesure et qui conditionne l'écriture de la couche.
Le choix décide de quatre choses : l'instant exact où la couche CDP prend la main sur un onglet et celui où elle la rend, la couche `webRequest` devant être neutralisée sur cet onglet pendant l'intervalle sans jamais l'être en dehors ; le sort d'une entrée ouverte au moment de la prise de main, côté `webRequest` comme côté CDP ; la taille de la fenêtre aveugle que la bascule crée, et si elle justifie un chevauchement délibéré des deux couches ; et si un `canceled_by_user` — le clic sur `Cancel` du bandeau, qui détache tous les onglets d'un coup — doit se traiter autrement qu'un arrêt demandé depuis l'interface.

## Bounds

- Evidence needed :
  - Ce que la couche CDP émet pour une requête commencée avant `Network.enable` : `requestWillBeSent` est-il rejoué, ou n'arrivent que des événements orphelins — `responseReceived`, `loadingFinished` — portant un `requestId` jamais annoncé ? Et `getResponseBody` réussit-il sur un tel `requestId` ?
  - Ce que la couche `webRequest` émet pour cette même requête pendant la fenêtre d'attachement, puisqu'elle continue de produire : la substitution devant se décider par entrée, il faut savoir laquelle des deux couches détient les événements de fin.
  - Sort d'une requête en vol au détachement, dans les deux modes : `detach()` explicite depuis l'interface, et `canceled_by_user` provoqué par le clic sur le bandeau. Les événements CDP s'arrêtent-ils net, et `webRequest` peut-il fournir la fin de ce que CDP a commencé ?
  - Fenêtre aveugle chiffrée aux deux bornes : écart entre `attach()`, `Network.enable` et le premier événement exploitable ; symétriquement, dernier événement reçu avant que le détachement ne prenne effet.
  - Effet d'un changement de processus de rendu pendant la session — navigation cross-origin, `about:blank`, crash d'onglet — sur la session attachée et sur les requêtes en cours : la session survit-elle, et les identifiants CDP repartant de zéro, la bascule se rejoue-t-elle en cours de session ?
  - Les requêtes réellement susceptibles de traverser une borne doivent être fabriquées : réponse lente, corps envoyé en morceaux, flux SSE, téléversement et téléchargement longs. Une requête courte ne traverse rien et ne mesure rien.
- Stop when : verdict tranché sur prototype jetable, sous la forme d'une règle qui dit pour chaque entrée ouverte à une borne quel producteur l'écrit et laquelle est jetée, assortie de la fenêtre aveugle chiffrée aux deux bornes.
- Hors périmètre :
  - Le seuil de troncature et la liste des types de ressource retenus, écartés par [[cdp-response-body-storage-cost]] et toujours non chiffrés.
  - Le coût en CPU et en latence de la boucle de capture, jamais mesuré et écarté de tous les Spikes précédents.
  - L'affordance de démarrage et d'arrêt dans l'interface (`aidd_docs/memory/design.md:22`), la forme de l'export et la redaction.
  - Le SDK, troisième producteur, non écrit à ce jour.
  - Le trafic hors onglet attaché, en `tabId: -1` compris : la substitution ne le concerne pas et [[cdp-webrequest-deduplication]] l'a déjà laissé à `webRequest`.

## Investigation

Prototype jetable hors dépôt : extension MV3 (`webRequest` + `debugger`) chargée dans Chrome for Testing 151.0.7922.47 sur un profil neuf, face à sept serveurs HTTP locaux — un port par famille de requête, la limite de six connexions par origine sérialisant sinon les requêtes longues et faussant les instants de borne. La page tire quatre lots (A à D) de trois réponses lentes, trois réponses envoyées en morceaux et deux réponses immédiates, plus un flux SSE ouvert au chargement et un battement toutes les 250 ms qui sert d'horloge. Le scénario attache à 3,7 s, détache à 15,2 s, ré-attache à 25,7 s, puis navigue vers `https://example.com/` à 33,4 s. Chaque lot est déclenché pour être en vol au moment d'une borne.

| Attempt | Evidence | Result |
| ------- | -------- | ------ |
| Lecture du code Blink avant toute mesure, pour savoir ce qu'il est vain de chercher | `InspectorNetworkAgent::Enable()` pose un drapeau et branche l'agent, sans rien rejouer — `inspector_network_agent.cc:2395-2402`. `DidFinishLoading()` appelle `loadingFinished` sans condition, même quand `resources_data_->Data(request_id)` est nul — `:1749-1787`. `disable()` appelle `resources_data_->Clear()` — `:2404-2414` | Une requête déjà en vol ne peut pas produire d'enregistrement CDP complet : pas de rejeu à l'attachement, événements de fin émis quand même, tampon vidé au détachement. Hypothèse à confirmer par la mesure |
| Exécution 1, jetée | Filtre `!url \|\| url.includes('/log')` sur les événements CDP ; tous les lots sur une seule origine | Deux défauts rédhibitoires : le filtre supprimait tout événement sans URL — `dataReceived`, `loadingFinished`, les `*ExtraInfo` — c'est-à-dire exactement les cas de borne ; et la limite de six connexions décalait le lot B de huit secondes. Mesures inexploitables |
| Exécutions 2 et 3, retenues | 2 078 puis 2 311 lignes de journal. Les enregistrements du puits de trace sont marqués par `requestId` au lieu d'être filtrés par URL, ce qui évite de prendre leur queue sans URL pour un orphelin de borne | Résultats identiques sur les deux exécutions et sur les deux attachements. Les chiffres ci-dessous viennent de l'exécution 3 |
| Ce que CDP émet pour une requête ouverte à l'attachement | Réponse entière arrivée après l'attachement (`A-slow`, `C-slow`) : `responseReceived` + `dataReceived` + `loadingFinished`, jamais de `requestWillBeSent`. En-têtes reçus avant, corps encore en cours (`A-drip`, `C-drip`) : `dataReceived×5` + `loadingFinished`. Flux SSE ouvert avant (`A-sse`) : `dataReceived×19` + `eventSourceMessageReceived×19`, sans fin | Trois formes d'orphelin, six enregistrements portant une URL et sept n'en portant aucune. Un orphelin sans URL n'est rattachable à rien : ni au trafic, ni à une entrée `webRequest` |
| `getResponseBody` sur ces `requestId` | 81 succès sur 82 pour les requêtes annoncées ; 0 succès sur 12 pour les orphelins, tous en `-32000 No resource with given identifier found` — y compris les six orphelins dont l'URL est pourtant connue. L'unique échec côté annoncé survient pendant la navigation, le rendu étant déjà détruit | Un corps n'est récupérable que si `requestWillBeSent` a été vu pendant la session. L'URL présente dans un orphelin ne rachète rien |
| Ce que `webRequest` émet en parallèle | Les deux couches émettent en même temps sur l'onglet attaché : le lot B porte `beforeReq sendHdrs hdrsRecv completed` côté `webRequest` et la chaîne CDP complète. Pour les lots ouverts à une borne, `webRequest` est complet de bout en bout : `A-slow-0` 209→8225, `C-drip-0` 22231→30252, `B-slow-0` 12210→20212 | `webRequest` détient toujours les événements de fin, borne ou pas. C'est la seule couche jamais interrompue |
| Sort d'une requête en vol au détachement | Zéro événement CDP entre le détachement (15 179) et le ré-attachement, contre 200 événements `webRequest`. `B-slow` s'arrête sur `willBeSent`, `B-drip` au milieu du corps après trois `dataReceived` ; `webRequest` les termine à 20 212 et 20 216 | Le silence est net et sans préavis : aucun `loadingFailed`, aucun événement terminal. Un enregistrement CDP ouvert à cet instant reste tronqué pour toujours |
| Fenêtre aveugle chiffrée | Attachement 1 : dernier battement manqué à −212 ms, premier vu à +39 ms, `Network.enable` acquitté à +6 ms. Attachement 2 : −230 ms / +21 ms, acquittement à +1 ms. Zéro battement démarré avant la marque d'attachement n'a été vu par CDP, sur 132. Détachement : dernier vu à 14 959, premier manqué à 15 206 | Il n'y a pas de fenêtre aveugle temporelle : la bascule est nette à l'acquittement de `Network.enable`. Ce que la borne coûte n'est pas une durée, c'est un ensemble — les requêtes en vol à cet instant |
| Changement de processus de rendu | `getTargets()` après la navigation cross-origin : `[{"attached":true,"url":"https://example.com/"}]`. La requête de navigation porte un `requestId` de 32 caractères hexadécimaux, `DB03BB1F0EA34B557BF4232C23905627`, là où le trafic de l'onglet porte la forme `6899.<n>`. Les requêtes du rendu détruit n'obtiennent aucun événement CDP terminal ; `webRequest` les clôt en `error` | La session survit à la navigation, aucune bascule à rejouer. Mais un changement de rendu se comporte comme un détachement pour les requêtes en cours, et la forme du `requestId` n'est pas uniforme |

## Outcome

- Result : **une fois, toujours une fois** — à condition de décider la propriété par requête et à l'événement terminal, non par onglet et non à l'instant de la borne. La règle tient en trois lignes :
  1. `capture/network/` observe tout, onglet attaché compris, et garde un enregistrement en mémoire pour chaque requête en vol. Rien n'est neutralisé à la capture.
  2. `capture/cdp/` ne possède une requête que s'il a vu son `requestWillBeSent` pendant la session. Tout `requestId` jamais annoncé est jeté en entier, sans exception et sans tentative de rattachement.
  3. À l'événement terminal de la requête, l'enregistrement CDP est écrit si et seulement si CDP la possède **et** que la session est toujours vivante à cet instant. Sinon c'est l'enregistrement `webRequest` qui est écrit. Le détachement, quelle qu'en soit la cause, rend donc à `webRequest` toutes les requêtes que CDP avait commencées.

  Appliquée aux mesures, la règle donne exactement une entrée par requête dans les six cas de borne rencontrés : requête ouverte à l'attachement puis terminée pendant la session (`A-slow`, `C-slow`) → `webRequest`, orphelin CDP jeté ; requête sans URL côté CDP (`A-drip`, `C-drip`, `A-sse`) → `webRequest`, orphelin jeté ; requête entièrement contenue dans la session (`B-fast`, `D-fast`) → CDP, avec son corps ; requête ouverte au détachement (`B-slow`, `B-drip`) → `webRequest`, enregistrement CDP partiel jeté ; requête tuée par la destruction du rendu (`D-slow`) → `webRequest`, en `error`.

  Le prix est unique et se nomme : **aucun corps de réponse pour une requête qui traverse une borne.** Ce n'est pas un choix d'implémentation, c'est ce que Chrome permet — `getResponseBody` échoue sur 12 orphelins sur 12. La bascule ne crée donc ni doublon ni trou d'entrée ; elle crée un trou de corps, dont la taille est le nombre de requêtes en vol à chaque borne — sept à neuf par borne dans ce scénario.

  Deux conséquences pour l'écriture de la couche : la substitution n'a toujours besoin d'aucune clé partagée entre les deux producteurs, seulement d'un ensemble des `requestId` annoncés côté CDP et d'une marque de session par onglet côté `webRequest` — ce qui confirme le refus de construire l'appariement acté par [[cdp-webrequest-deduplication]] ; et un `requestId` CDP n'est pas d'une forme unique, la requête de navigation portant un identifiant émis par le processus navigateur au lieu de la forme `<pid>.<compteur>`, ce qui interdit d'en dériver quoi que ce soit.

- Confidence : haute sur l'attachement, le détachement demandé et le changement de rendu — mesuré deux fois, sur les deux attachements du même scénario, avec confirmation préalable dans le code de Blink. Moyenne sur `canceled_by_user` : la règle s'y applique par composition — [[cdp-optin-usability]] a mesuré que le clic sur `Cancel` déclenche `onDetach` sur tous les onglets, et le présent Spike mesure que la fin de session interrompt le flux d'événements — mais la chaîne complète n'a pas été observée en une seule exécution, le clic sur le bandeau n'étant pas automatisable depuis l'extension.

- Remaining uncertainty :
  - Le coût mémoire de la règle : garder un enregistrement `webRequest` en vol pour chaque requête de l'onglet attaché pendant toute la session. Borné par l'ensemble des requêtes en vol, donc petit, mais jamais mesuré sur une page réelle et lourde.
  - Le comportement d'un téléversement long, écarté du prototype au profit du téléchargement long. Rien ne laisse penser qu'il diffère, la règle ne dépendant pas du sens du transfert, mais ce n'est pas mesuré.
  - Le sort d'une requête ouverte lors d'un crash d'onglet, distinct de la navigation : non provoqué.

## Follow-up

- Écrire la règle de propriété dans `aidd_docs/memory/architecture.md`, à côté du modèle de substitution déjà acté : la bascule se décide par requête à l'événement terminal, pas par onglet.
- Reprendre [[contract-entry-provenance]] : le contrat doit porter le producteur effectif de chaque entrée, et l'information « corps absent parce que la requête traversait une borne » doit se distinguer d'un corps absent pour cause de troncature ou de type écarté. Deux causes, deux états, un seul champ ne suffit pas.
- Fermer le point resté ouvert dans [[cdp-webrequest-deduplication]] : les bornes de session sont tranchées, l'écriture de `capture/cdp/` n'est plus bloquée par ce cadrage.
- Mesurer le clic sur `Cancel` de bout en bout le jour où l'interface existe, pour remplacer la composition par une observation.
