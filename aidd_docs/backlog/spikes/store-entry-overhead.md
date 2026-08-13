---
type: spike
status: resolved
source: cdp-body-capture-calibration
related_to:
  - contract-entry-provenance
  - contract-response-body-state
---

# Spike: store-entry-overhead

## Question

Que pèse une entrée du store de contexte hors corps de réponse — en-têtes, timings, entrées console — et la fenêtre glissante d'une heure tient-elle dans le quota une fois ce poids ajouté aux 224 Mo/h de corps déjà mesurés ?

## Decision

Le dimensionnement de la fenêtre glissante d'une heure, dernier point resté ouvert de la section « Open measurement » (`aidd_docs/memory/architecture.md:99`).

Le choix décide de trois choses. Si la fenêtre d'une heure tient telle quelle, ou si elle doit être bornée autrement qu'en durée. Si des champs doivent être écartés au chemin d'écriture, au même titre que les corps filtrés et pour la même raison — ce qui est écarté ne doit jamais atteindre le disque (`aidd_docs/memory/database.md:39`). Et si la conclusion de `aidd_docs/memory/database.md:41`, deux ordres de grandeur entre le quota et la fenêtre, reste vraie une fois l'entrée entière pesée et non ses seuls corps.

## Bounds

- Evidence needed :
  - Poids d'une entrée réseau écrite, hors corps, relevé dans IndexedDB et non estimé à partir de la taille des chaînes. Le facteur de compression de ×0,49 mesuré par [[cdp-response-body-storage-cost]] ne vaut que pour l'enregistrement de son prototype, `{url, mimeType, base64, body}`, et non pour la forme définitive de `NetworkEntry`.
  - Répartition de ce poids entre en-têtes de requête, en-têtes de réponse, timings et URL. Les en-têtes sont le candidat évident : [[cdp-webrequest-deduplication]] a mesuré que CDP en livre davantage que `webRequest`, pseudo-en-têtes HTTP/2 compris.
  - Poids des entrées console sur un tour applicatif. Jamais compté nulle part, alors que la console est la seconde source du store.
  - Nombre d'entrées par heure sur trafic applicatif dense. Les 22 422 réponses des quatre tours de 240 s de [[cdp-body-capture-calibration]] donnent l'ordre de grandeur à convertir en régime horaire.
  - Effet sur le poids par entrée des champs que les deux tâches de contrat ajoutent : la provenance et les états de corps.
  - Total horaire, corps compris, comparé au quota de 10,7 Go mesuré sans `unlimitedStorage`.
- Stop when : le poids par entrée est chiffré sur une base réellement écrite, et le total horaire de la fenêtre est comparé au quota. Si le total ne tient pas, les champs à écarter sont nommés.
- Hors périmètre :
  - Le corps de réponse, pesé et chiffré par [[cdp-body-capture-calibration]]. Ce Spike ne pèse que le reste.
  - Le store vidéo, borné par l'utilisateur et logé en OPFS, dont le dimensionnement ne dépend pas de celui-ci.
  - La forme de l'export, et la tranche d'une heure qu'il découpe.
  - Le choix des champs au contrat, qui appartient aux tâches `contract-entry-provenance` et `contract-response-body-state`. Ce Spike fournit un poids, pas une forme.

## Investigation

Harnais jetable posé hors du dépôt, qui importe les fixtures du dossier `e2e/` par chemin absolu sans rien y écrire.
Il fait tourner l'extension réelle, pas un prototype : le poids relevé est celui de `NetworkEntry` telle qu'elle est écrite aujourd'hui.

Deux régimes de trafic, 400 requêtes chacun, sur le site de test du dépôt.
Le régime léger porte les en-têtes qu'un navigateur ajoute de lui-même ; le régime dense y ajoute ce qu'une application métier envoie réellement — jeton `Bearer`, cookie de session, identifiant de corrélation, en-têtes de quota et de cache côté réponse.

Le poids est lu deux fois par deux chemins indépendants.
`navigator.storage.estimate()` donne l'occupation réelle du disque avant et après l'écriture, ce qui inclut tout ce qu'IndexedDB ajoute autour de l'enregistrement ; `JSON.stringify` sur chaque entrée relue donne la taille de la donnée seule.
L'écart entre les deux est le surcoût du moteur de stockage, qu'aucune estimation faite à partir des chaînes n'aurait donné.
La ventilation par champ est mesurée en sérialisant chaque champ isolément avec sa clé, ce qui rend les parts additives.

| Attempt | Evidence | Result |
| --- | --- | --- |
| Peser une entrée réseau réellement écrite, régime léger | 402 entrées, 1 257,6 octets de JSON en moyenne, p50 1 258, max 1 395 | L'entrée est très régulière : la moyenne et la médiane se confondent |
| Peser la même entrée en régime dense | 3 257,5 octets en moyenne, p50 3 278 | Les en-têtes applicatifs multiplient l'entrée par 2,6 |
| Isoler le surcoût d'IndexedDB | Léger : 1 384 octets stockés pour 735,7 de JSON par entrée. Dense : 2 530 pour 1 887,7 | Surcoût constant de 645 octets par enregistrement, indépendant de sa taille |
| Situer le poids dans l'entrée, régime léger | En-têtes de requête 691,5, en-têtes de réponse 258, URL 47,7, tout le reste sous 32 | Les en-têtes font 75,5 % de l'entrée |
| Situer le poids dans l'entrée, régime dense | En-têtes de requête 1 858,4, en-têtes de réponse 951,5, URL 187 | Les en-têtes font 86,3 % : la part grandit avec la densité |
| Vérifier que la ventilation est complète | 6 432 octets non attribués sur 402 entrées dans les deux régimes | 16 octets par entrée, soit les accolades et les virgules de la sérialisation |
| Peser une entrée console | 211,3 octets en régime léger, 511 en régime dense | Une entrée console pèse un sixième d'une entrée réseau |
| Mesurer ce que les deux tâches de contrat ajoutent | Provenance 25 octets, état de corps élargi 17 | 42 octets par entrée réseau, 3,34 % en régime léger et 1,29 % en régime dense |
| Relever le quota effectif | `navigator.storage.estimate().quota` à 10 737 545 516 octets | Confirme les 10,7 Go mesurés sans `unlimitedStorage` |
| Convertir en régime horaire | 22 422 réponses sur quatre tours de 240 s, soit 5 605,5 par tour et 84 082 par heure | Le débit d'entrées réseau est celui des réponses, filtre de corps compris |

Quatre limites bornent ces chiffres.

Le harnais génère une entrée console par requête, ce qui est une proportion inventée.
Le poids unitaire d'une entrée console est mesuré, son débit horaire ne l'est pas : aucun tour applicatif n'a jamais compté les lignes de console.

Le régime dense reproduit les en-têtes d'une application métier telle que je les ai vus, il ne les échantillonne pas.
Le poids d'une entrée réelle se situe entre les deux régimes sans qu'on sache où.

Les 84 082 entrées par heure supposent que le trafic des quatre tours de 240 s se prolonge une heure durant au même rythme.
Une heure de navigation réelle comporte des pauses que le tour n'a pas.

Enfin les entrées viennent ici de `webRequest`, dont [[cdp-webrequest-deduplication]] a mesuré qu'il livre moins d'en-têtes que CDP, pseudo-en-têtes HTTP/2 compris.
Sur un onglet attaché, la part des en-têtes ne peut donc que monter.

## Outcome

**Une entrée pèse 1,9 ko en régime léger et 3,9 ko en régime dense, stockage compris, et ce sont les en-têtes.**
IndexedDB ajoute 645 octets par enregistrement, constants d'un régime à l'autre, qu'aucune estimation faite sur la longueur des chaînes n'aurait donnés — c'est la raison pour laquelle ce Spike mesurait plutôt qu'il n'extrapolait.
Les en-têtes de requête à eux seuls font 55 à 57 % de l'entrée, les deux jeux d'en-têtes ensemble 75 à 86 %.
Tout le reste — méthode, domaine, horodatage, identifiants, type de ressource, issue, code, durée — tient sous 250 octets cumulés et ne se discute pas.

**La fenêtre d'une heure tient, mais l'écart au quota n'est plus de deux ordres de grandeur.**
84 082 entrées réseau par heure font 160 Mo en régime léger et 328 Mo en régime dense, auxquels s'ajoutent les 224 Mo/h de corps de [[cdp-body-capture-calibration]], soit 384 à 552 Mo/h contre un quota de 10,7 Go.
La fenêtre tient donc telle quelle, avec un facteur de 19 à 28, et n'a pas à être bornée autrement qu'en durée.
Mais la conclusion de `aidd_docs/memory/database.md:41` doit être corrigée : le rapport tombe à environ 1,3 ordre de grandeur, et le poids hors corps dépasse celui des corps en régime dense.

**Aucun champ n'est à écarter du chemin d'écriture, et le levier est nommé si cela change.**
Rien ne justifie de retirer un champ tant que la marge est de 19×, et les deux tâches de contrat peuvent ajouter leurs 42 octets sans que la question se repose : c'est 1,3 % de l'entrée dense.
Si la marge se réduisait, le seul geste qui compte est de ne garder qu'une liste blanche d'en-têtes de requête, et il rendrait la moitié de l'entrée.
Retirer l'URL, les timings ou les identifiants ne rendrait rien et abîmerait le rapport d'incident.

## Follow-up

- Corriger `aidd_docs/memory/database.md:41` : l'écart entre le quota et la fenêtre d'une heure est de 19 à 28, pas de deux ordres de grandeur, et le poids hors corps dépasse celui des corps en régime dense.
- Fermer le dernier point de la section « Open measurement » de `aidd_docs/memory/architecture.md` avec le poids par entrée et le total horaire.
- Consigner que les en-têtes sont l'unique levier de réduction du store de contexte, et que la liste blanche d'en-têtes de requête est le geste à faire si la marge se réduit un jour.
- Compter les entrées console sur un tour applicatif réel : leur poids unitaire est mesuré, leur débit ne l'est pas, et c'est la seule inconnue qui reste au total horaire.
- Repeser une entrée produite par CDP plutôt que par `webRequest` sur un onglet attaché, puisque [[cdp-webrequest-deduplication]] a mesuré que CDP livre davantage d'en-têtes.
