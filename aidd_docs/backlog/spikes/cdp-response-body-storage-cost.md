---
type: spike
status: resolved
depends_on:
  - cdp-optin-usability
---

# Spike: cdp-response-body-storage-cost

## Question

Quel volume les corps de réponse récupérés via `Network.getResponseBody` ajoutent-ils au store de contexte pendant une session CDP bornée, et ce volume tient-il dans le quota que Chrome accorde à l'extension ?

## Decision

Les corps de réponse sont-ils stockés intégralement, tronqués à un seuil chiffré, filtrés par type MIME, ou pas stockés du tout ?
Le choix décide de trois choses à la fois : la forme du champ `responseBody` au contrat, aujourd'hui figé sur `unavailable` (`packages/contract/src/events.ts:30`) et dont tout changement est une migration de schéma (`aidd_docs/memory/database.md:43`) ; la déclaration ou non de `unlimitedStorage` au manifeste, absente à ce jour (`apps/extension/wxt.config.ts:36`) ; et la valeur résiduelle de la couche CDP, les corps étant la seule capacité qu'elle apporte face au SDK sur ce point (`aidd_docs/INSTALL.md:209`).

## Bounds

- Evidence needed :
  - Quota réellement offert à IndexedDB pour une extension sans `unlimitedStorage`, mesuré via `navigator.storage.estimate()`, et ce que la déclaration change — quota obtenu et écran de consentement à l'installation.
  - Distribution des tailles de corps par type MIME sur du trafic représentatif d'applications réelles, pas sur une page de test.
  - Comportement de `Network.getResponseBody` : cas d'échec, réponse pour du binaire (`base64Encoded`), et surcoût du base64 sur le volume stocké.
  - Volume cumulé sur une durée de session CDP plausible, le bornage par l'utilisateur étant acquis de [[cdp-optin-usability]].
- Stop when : verdict tranché sur prototype jetable entre les quatre branches — intégral, tronqué à un seuil chiffré, filtré par type MIME, ou non stocké.
- Hors périmètre : dédoublonnage avec `chrome.webRequest`, l'autre question laissée ouverte par [[cdp-mv3-feasibility]] et indépendante de celle-ci. Coût en CPU et en latence de la boucle de capture. Redaction des données sensibles contenues dans les corps. Forme de l'export.

## Investigation

| Attempt | Evidence | Result |
| ------- | -------- | ------ |
| Lecture de la référence CDP du domaine `Network` | [Chrome DevTools Protocol — Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/) | `getResponseBody` prend un `requestId` et renvoie `body` plus `base64Encoded`. Un corps binaire arrive donc en base64, soit un tiers de volume en plus. Surtout, la rétention n'est pas illimitée : `Network.enable` accepte `maxTotalBufferSize` et `maxResourceBufferSize`, décrits comme « the maximum number of bytes that will be collected by this DevTools session ». Ce plafond borne ce que `getResponseBody` peut encore rendre, indépendamment de notre stockage. |
| Lecture des constantes de tampon dans Blink | [`inspector_network_agent.cc`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/inspector/inspector_network_agent.cc), branche `main` | Valeurs par défaut appliquées quand `Network.enable` est appelé sans paramètre : `kDefaultTotalBufferSize = 200 * 1000 * 1000` et `kDefaultResourceBufferSize = 20 * 1000 * 1000` hors Android. Deux conséquences : un corps de plus de 20 Mo n'est jamais récupérable, et activer le domaine `Network` fait porter au renderer de l'onglet surveillé une rétention pouvant aller jusqu'à 200 Mo en mémoire — un coût qui n'est pas du stockage mais qui pèse sur l'onglet de l'utilisateur. |
| Lecture de la liste des permissions Chrome | [Permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list) et [Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies) | `unlimitedStorage` est cité mot pour mot : « Provides an unlimited quota for `chrome.storage.local`, `IndexedDB`, `Cache Storage`, and `Origin Private File System`. » La page ne lui associe **aucun avertissement à l'installation** — la déclarer ne change donc pas l'écran de consentement. Le guide ne chiffre aucun quota par défaut et renvoie à `navigator.storage.estimate()` : la valeur sans la permission doit être mesurée. |
| Prototype jetable, exécution A — capture de tous les corps, **sans** `unlimitedStorage` | Chrome for Testing 151.0.7922.47, build expédié recopié hors dépôt, `debugger` et `tabs` passés en permissions requises, sonde ajoutée à `background.js`. Tour de 142 s sur six sites publics : github.com, react.dev, developer.chrome.com, lemonde.fr, news.ycombinator.com, amazon.fr. Chaque corps est réellement écrit dans IndexedDB, et `navigator.storage.estimate()` échantillonné à chaque étape. Journal `journal-a.jsonl`, 401 corps | Quota au démarrage : **10 737 418 240 octets, soit 10,7 Go**, pour 176 Gio libres sur le disque — ce n'est donc pas une fraction de l'espace libre mais un plafond propre à l'extension. `getResponseBody` a réussi **401 fois sur 401**. Les corps pèsent 24,18 Mo en UTF-8 pour 7,40 Mo sur le fil, soit **×3,27** — effet cumulé de la décompression et du base64, ce dernier concernant 42,8 % des réponses. Médiane 14 027 o, p90 127 662 o, p99 856 220 o, maximum 1 251 217 o. Une fois écrits, ces 24,18 Mo n'occupent que **11,95 Mo dans IndexedDB, soit ×0,49** : le moteur compresse. Ramené à l'heure, ce rythme de navigation dense donne 615 Mo/h de charge utile et **304 Mo/h réellement stockés — 3 % du quota**, et 35 h pour le remplir. Répartition : Script 44,7 %, Stylesheet 21,8 %, Document 11,1 %, Font 8,8 %, Image 5,6 %, et **XHR plus Fetch 7,6 % seulement**. |
| Prototype jetable, exécution B — même tour, **avec** `unlimitedStorage` | Même build, même tour, seule la permission diffère. Journal `journal-b.jsonl`, 399 corps | Quota au démarrage : **188 504 Mo**, soit l'espace disque disponible mesuré par `df` — la permission ne rend pas le quota infini, elle l'aligne sur le disque. Tout le reste est reproduit à l'identique : 613 Mo/h de charge utile, ×0,48 en base, 7,6 % de XHR plus Fetch, même corps maximal à 1 251 217 o. L'écart entre les deux exécutions porte donc sur le seul quota, ce qui isole proprement l'effet de la permission. |
| Prototype jetable, exécution C — provoquer les échecs de `getResponseBody` | Même build, `Network.enable` appelé avec `maxTotalBufferSize: 1 000 000` et `maxResourceBufferSize: 100 000`, très en deçà des valeurs par défaut lues dans Blink, pour déclencher l'éviction sur un tour court plutôt qu'avec un téléchargement de 200 Mo. Tour de trois sites, puis nouvelle tentative sur 60 `requestId` conservés. Journal `journal-c.jsonl` | Deux modes d'échec, tous deux `code: -32000`. **1.** Récupération immédiate : 187 succès sur 195, les 8 échecs portant le message `Request content was evicted from inspector cache`, dont 6 des 14 réponses dépassant le plafond par ressource. **2.** Récupération différée après navigation : **60 échecs sur 60**, message `No resource with given identifier found`. Le corps n'est donc récupérable que dans la fenêtre où sa page vit ; toute conception qui diffère l'appel perd tout. |

### Méthode du prototype

Travail isolé et jetable, hors dépôt, non conservé. Reproductible ainsi :

1. Copier `apps/extension/.output/chrome-mv3` vers un répertoire temporaire.
2. Dans le manifeste de la copie, ajouter `debugger` et `tabs` à `permissions`, et `http://127.0.0.1:8787/*` à `host_permissions` pour le puits de journal. La permission est rendue **requise** plutôt qu'optionnelle pour la même raison que dans `e2e/fixtures/build-variant.ts` : `permissions.request()` ouvre une bulle native qu'aucune surface d'automatisation ne sait franchir. L'exécution B ajoute en plus `unlimitedStorage`.
3. Ajouter en fin de `background.js` une sonde qui crée son propre onglet, y attache `chrome.debugger`, active le domaine `Network`, appelle `getResponseBody` dans le gestionnaire de `Network.loadingFinished`, écrit chaque corps dans une base IndexedDB dédiée, et poste vers un serveur HTTP local une ligne par réponse plus un relevé de `navigator.storage.estimate()` à chaque étape du tour.
4. Lancer Chrome for Testing avec `--user-data-dir`, `--load-extension`, `--disable-extensions-except` et `--disable-background-timer-throttling`, sur un profil neuf par exécution.

Les trois exécutions partagent le même build et le même profil de lancement. L'exécution B ne diffère de A que par `unlimitedStorage` ; l'exécution C ne diffère que par les tailles passées à `Network.enable` et par la phase de récupération différée.

## Outcome

- Result : **les corps de réponse sont stockables, et le stockage n'est pas ce qui menace la couche.** Le pire cas mesuré — tout capturer, sans aucun filtre — plafonne à **304 Mo stockés par heure, soit 3 % du quota de 10,7 Go** déjà accordé sans permission supplémentaire, et la fenêtre roulante d'une heure interdit toute accumulation au-delà. `unlimitedStorage` n'apporte rien ici : il aligne le quota sur l'espace disque, dont on est à deux ordres de grandeur. La branche « ne pas stocker » est donc écartée par la mesure, et la branche « intégral » tient techniquement. Ce qui justifie quand même un filtre, c'est la pertinence et non la survie : **92,4 % du volume est du Script, Stylesheet, Font, Image et Document**, dont le corps n'apprend rien sur un incident applicatif, contre 7,6 % pour XHR et Fetch. Les contraintes réellement dures sont ailleurs : le corps n'existe que dans la fenêtre où sa page vit — 60 échecs sur 60 dès qu'on diffère l'appel — et l'éviction du buffer CDP est un fonctionnement normal, pas une anomalie. Branche retenue : **stocker, filtré par type de ressource, avec une troncature par corps, et sans déclarer `unlimitedStorage`.**
- Confidence : haute sur le volume, le quota et les modes d'échec. Deux exécutions indépendantes concordent au dixième de point sur tous les ratios, le coût IndexedDB est relevé sur le moteur lui-même plutôt qu'estimé à partir de la taille des chaînes, et le contrôle A/B isole la seule permission. Moyenne en revanche sur la composition du trafic, pour la raison dite ci-dessous.
- Remaining uncertainty :
  - Le tour porte sur des sites de contenu, pas sur une application métier : **14 réponses XHR ou Fetch seulement**. La part de 7,6 % leur est propre et monterait sur une application riche en appels. Le plafond absolu, lui, reste valable puisqu'il est mesuré tous types confondus.
  - Le seuil de troncature n'est pas tranché par la mesure. Le plus gros corps applicatif observé fait 856 Ko, mais avec un échantillon de 14 la queue de distribution est inconnue.
  - Aucun corps n'a approché `maxResourceBufferSize` à sa valeur par défaut de 20 Mo. Le mécanisme d'éviction est établi, sa fréquence en conditions réelles ne l'est pas.
  - La rétention CDP dans le renderer de l'onglet attaché, jusqu'à 200 Mo, est lue dans le code de Blink et n'a jamais été mesurée.
  - Le quota de 10,7 Go est relevé sur un profil neuf avec cette seule extension. L'effet d'un disque saturé ou d'un profil chargé n'est pas testé. macOS et Chrome 151 uniquement.
  - Le facteur ×0,49 vaut pour l'enregistrement du prototype, `{url, mimeType, base64, body}`, et non pour le schéma définitif.

**Addendum — quatre de ces incertitudes sont levées, et deux conclusions bornées, par [[cdp-body-capture-calibration]].** Sur quatre tours d'applications métier totalisant 22 422 réponses : XHR et Fetch pèsent 33 % des réponses et non 7,6 % ; le plus gros corps applicatif fait 541,5 ko, sous le plafond de 856 ko supposé ici ; l'éviction ne coûte aucun corps applicatif, zéro échec sur 7 395 lectures, y compris à `maxResourceBufferSize` réduit à 2 Mo ; la rétention dans le renderer est désormais mesurée sur le processus, +605 Mo pour 200 Mo transférés aux valeurs par défaut. Deux affirmations ci-dessus sont fausses hors du périmètre mesuré ici : le filtre **est** une condition de survie sur une application métier — 6,9 Go/h sans lui contre 224 Mo/h avec — et les 60 échecs sur 60 en lecture différée ne valent qu'aux paramètres par défaut, le drapeau `enableDurableMessages` faisant passer ce même essai à 60 réussites sur 60.

## Follow-up

- **Forme retenue pour `capture/cdp/`** : filtre par type de ressource au chemin d'écriture, au même endroit que le filtre de domaine et pour la même raison — ce qui est écarté ne doit jamais atteindre le disque (`aidd_docs/memory/database.md:39`) —, complété d'une troncature par corps.
- **Ne pas déclarer `unlimitedStorage`.** Mesuré sans effet utile à cette échelle, et c'est une permission de moins à justifier au regard de la clause « Minimum Permission » du Chrome Web Store.
- **Le contrat doit rendre l'échec exprimable.** `ResponseBodyState` ne connaît que `unavailable` (`packages/contract/src/events.ts:30`). L'éviction et la troncature sont des fonctionnements normaux et méritent leurs propres états ; un corps absent ne doit pas être indiscernable d'un corps jamais demandé.
- **Règle de conception imposée par la mesure : lire le corps dans le gestionnaire de `Network.loadingFinished`, jamais plus tard.** Une file d'attente, un traitement par lots ou une reprise après redémarrage du service worker perdent tout.
- **Contradiction relevée en passant, hors périmètre.** `aidd_docs/memory/database.md:40` affirme que `unlimitedStorage` ne couvre pas OPFS ; la liste des permissions Chrome le cite explicitement parmi les quatre supports couverts. Non mesuré ici — cela touche le pipeline vidéo, pas celui-ci.
- La question du dédoublonnage avec `chrome.webRequest`, laissée ouverte par [[cdp-mv3-feasibility]], reste ouverte.
