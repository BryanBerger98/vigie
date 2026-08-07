# Mesure — volume d'une heure et sobriété

> Phase 6 du plan `extension-scope`. Ce document est le livrable de la phase : un verdict, ses
> chiffres bruts, et ce qui n'a pas pu être mesuré.

## Verdict

**Le plafond de soixante minutes tient, avec trois ordres de grandeur de marge.**

Une entrée coûte environ **800 octets stockés**. À mille entrées par minute — une application web
bavarde —, une heure de contexte pèse **48 Mo** contre un quota de **10,7 Go**, soit **0,45 %**.
La capture coûte à la page **0,23 à 0,37 ms par requête**, mesuré sur une page qui ne fait rien
d'autre qu'émettre des requêtes en rafale.

Dans l'arbre de décision de la phase, c'est la branche `D -->|oui| E -->|oui| H` : **le seuil 1
s'applique, rien ne bouge**. Ni `RETENTION_MS`, ni `BATCH_SIZE`, ni ce qui est stocké. La clause
d'escalade de la tâche 3.4 ne se déclenche pas — le plafond n'est pas remis en cause.

**Ce verdict est incomplet sur un point, et il est signalé comme tel** : l'heure pleine sur une
application réelle nommée, exigée par la tâche 2, n'a pas encore été jouée. Voir
[Ce qui reste à mesurer](#ce-qui-reste-à-mesurer). Ce qui est tranché ci-dessous l'est sur des
mesures automatisées reproductibles ; l'heure réelle sert à confirmer la **cadence**, pas les
coûts unitaires.

## Environnement mesuré

| Élément | Valeur |
| --- | --- |
| Mesure automatisée | Chromium **151.0.7922.34** (build Playwright 1.62.1, arm64) |
| Navigateur d'observation | **Brave Browser 151.1.93.129** — même socle Chromium 151 |
| Plateforme | macOS 26.6 (Darwin 25.6.0), Apple **M3**, 8 cœurs, 16 Go de RAM |
| Extension | build WXT `chrome-mv3`, manifeste V3, profil neuf à chaque lancement |
| Magasin | IndexedDB via Dexie 4.4.4, une table `entries` |
| Quota annoncé par l'origine | **10 742 191 016 octets** (~10,7 Go) |
| Origine avec magasin vide | **105 176 octets** (les fichiers de l'extension eux-mêmes) |
| Harnais | `e2e/specs/storage-metrics.spec.ts`, contexte persistant, serveur local |
| Date | 7 août 2026 |

## Ce que coûte une entrée

C'est le chiffre transférable : il ne dépend ni de la machine ni de la cadence, seulement de la
forme de ce qui est capturé. Deux profils de trafic ont été mesurés, sur le vrai chemin d'écriture
des phases 4 et 5.

| Nature | Trafic léger | Trafic lourd | Ce qui fait la différence |
| --- | --- | --- | --- |
| Entrée réseau | **1 259 o** | **3 276 o** | En-têtes : jeton porteur, corrélation, cookies en retour, URL longue |
| Entrée console | **213 o** | **514 o** | Taille de l'objet journalisé |
| Moyenne sur disque | **754 o** | **801 o** | Mélange moitié réseau, moitié console |

**Trafic léger** : `fetch` nu vers une route JSON, une ligne de console par requête.
**Trafic lourd** : ce qu'envoie une application authentifiée — `Bearer` de 720 caractères,
`x-correlation-id`, `content-type`, URL avec filtre encodé ; en retour `set-cookie`,
`cache-control`, `x-request-id`, `x-served-by`, `strict-transport-security`.

### L'octet stocké vaut l'octet de JSON

Le rapport mesuré entre ce que l'origine consomme et la longueur du JSON correspondant est de
**×1,00 à ×1,02**. Autrement dit : **IndexedDB et ses index ne coûtent rien de perceptible**, et
la taille d'une entrée peut se calculer sur le JSON sans passer par le navigateur.

C'est ce qui rend la mesure rejouable ailleurs : il suffit de sérialiser une entrée type de
l'application visée.

### Deux échelles, et pourquoi les deux

| Échelle | Précision | Attribuable par nature | Usage |
| --- | --- | --- | --- |
| Longueur du JSON | Exacte | Oui | Le chiffre qu'on transporte d'une application à l'autre |
| `navigator.storage.estimate()` | Par blocs, bruitée | Non | La vérité sur le disque, quota compris |

L'estimation d'origine bouge par paliers : mesurée par différence entre deux relevés, elle a donné
801, 811 et 1 594 o/entrée sur trois exécutions du même test. **Le chiffre de 800 o est la
moyenne stable sur le magasin entier ; la différence entre deux relevés successifs, non.** Les
projections ci-dessous utilisent la moyenne, jamais la différence.

## Ce que coûte une heure

| Cadence | Heure, trafic léger | Heure, trafic lourd | Part du quota |
| --- | --- | --- | --- |
| 100 entrées/min | 4,5 Mo | **4,8 Mo** | **0,045 %** |
| 1 000 entrées/min | 45 Mo | **48 Mo** | **0,45 %** |
| ~125 000 entrées/min *(plafond machine)* | 5,7 Go | **6,0 Go** | **56 %** |

Le plafond machine est la cadence maximale que la machine atteint : 2 000 entrées produites en
959 ms sur une page qui n'attend rien. Aucune navigation humaine ne s'en approche — c'est la borne
haute, pas un scénario.

**Conséquence** : le quota n'est pas la contrainte du produit. Il faudrait qu'une application
produise plus de deux mille entrées par seconde pendant soixante minutes pour approcher le seuil
de pression.

## Ce que coûte la navigation

Même page, mêmes mille requêtes lourdes, trois tours dans chaque état, un tour de chauffe jeté.
Le domaine est d'abord non surveillé — donc rien n'est capturé — puis surveillé, sans jamais vider
le magasin entre les deux : les tours capturés tournent contre un magasin qui grossit, ce qui est
l'état réel après une heure.

```txt
capture éteinte : 711, 744, 727 ms   (moyenne 727)
capture allumée : 940, 993, 943 ms   (moyenne 959)

surcoût : 231 ms par tour de 1 000 requêtes → 0,23 ms par requête capturée, ×1,32
```

Trois exécutions de la suite ont donné 0,23, 0,26 et 0,37 ms par requête, soit ×1,32 à ×1,47.

**Comment lire ce ×1,32** : la page de test ne fait *que* des requêtes, en vagues de vingt, sans
rendu ni calcul. Le facteur multiplicatif porte donc sur un temps qui n'est composé que de ce que
la capture ralentit. Sur une navigation réelle, où une page passe l'essentiel de son temps à
peindre et à exécuter du script, le chiffre pertinent est le **0,23 ms par requête** — soit
23 ms pour une page qui en émet cent. Sous le seuil de perception.

## Le rétrécissement de la fenêtre

`prune.ts` promet que si le quota sature, la fenêtre rétrécit **et le signale**. Cette branche a
été exercée pour de vrai, pas seulement en unitaire.

Le quota du navigateur ne se réduit pas de l'extérieur. Mais la purge le lit à travers
`navigator.storage.estimate()` **dans le service worker**, et Playwright sait évaluer du code dans
cette cible. La saturation est donc annoncée au code qui en décide — la partie sous test — sans
que le vrai plafond du navigateur ait à bouger.

```txt
avant  : 802 entrées, shrunkAt = null
estimate() répond usage 99 / quota 100   (au-dessus de QUOTA_PRESSURE_RATIO = 0.9)
après  : 601 entrées, shrunkAt renseigné
```

201 entrées supprimées, les plus anciennes : exactement le `RELIEF_RATIO` de 25 %. Le rétrécissement
est reporté dans `vigie:storage-state`, d'où la phase 7 le lira pour annoncer la profondeur réelle
plutôt que l'heure promise.

## Les décisions

| Seuil de la tâche 3 | Franchi ? | Décision |
| --- | --- | --- |
| 1 — le volume tient et la navigation est fluide | **Oui** | Plafond de soixante minutes confirmé, rien ne bouge |
| 2 — le volume déborde | Non | Aucune troncature de corps ou d'en-têtes appliquée |
| 3 — la navigation se dégrade | Non | `BATCH_SIZE` et la sérialisation console restent inchangés |
| 4 — le plafond doit tomber | Non | Rien à remonter |

### Ce qui a été confirmé plutôt que changé

Deux constantes que la phase avait le droit d'ajuster ne bougent pas, et portent désormais leur
mesure en commentaire pour qu'on ne les redécouvre pas plus tard sans preuve :

| Constante | Valeur | Ce que la mesure dit |
| --- | --- | --- |
| `write.ts` · `BATCH_SIZE` | 50 | Sous trafic ordinaire le seuil de taille n'est jamais atteint, c'est le délai qui vide la file ; sous rafale le coût est de 0,23 ms/requête. Aucun des deux régimes n'appelle un autre nombre |
| `write.ts` · `BATCH_DELAY_MS` | 250 | Idem : c'est lui qui gouverne le régime réel |
| `prune.ts` · `RETENTION_MS` | 1 h | 48 Mo pour une heure bavarde contre 10,7 Go de quota |
| `prune.ts` · `QUOTA_PRESSURE_RATIO` | 0,9 | Inatteignable par un humain, gardé parce que le quota est partagé avec tout ce que le profil stocke et qu'un disque plein le déplace sans prévenir |

## Rejouer la mesure sur une autre application

### Automatisé — les coûts unitaires

```sh
cd e2e && pnpm exec playwright test specs/storage-metrics.spec.ts
```

Les lignes `[measure]` de la sortie sont les chiffres de ce document. Pour changer le profil de
trafic, `e2e/fixtures/test-site.ts` expose `openBurst(context, requests, weight)` ; les en-têtes
du profil lourd se règlent dans `burstPage()` et `HEAVY_RESPONSE_HEADERS`.

### Manuel — la cadence réelle

Les coûts unitaires ne dépendent pas de l'application ; **la cadence, si**. C'est la seule chose
qu'une application réelle apporte, et elle se relève sans DevTools :

1. Charger le build non empaqueté dans Brave, surveiller le domaine de l'application.
2. Ouvrir la popup : la section **Capture store** donne entrées, répartition réseau / console /
   erreur, fenêtre couverte, entrées par minute, octets stockés, projection sur une heure.
3. Cliquer **Take reading** à intervalle régulier — toutes les cinq minutes suffit. Chaque clic
   vide d'abord la file d'écriture du worker, donc le relevé porte sur toute la capture.
4. Cliquer **Copy** : le presse-papier reçoit un tableau Markdown horodaté, prêt à coller.

```txt
| Relevé | Entrées | Réseau | Console | Erreur | Fenêtre (min) | Entrées/min | Octets stockés | Heure projetée |
```

Les octets y sont bruts, non arrondis : un relevé destiné à être recalculé ne doit pas arrondir.
**Clear** remet la série à zéro entre deux campagnes. La série est plafonnée à 240 relevés et vit
dans `chrome.storage.local`, hors du quota mesuré — vérifié, voir la lacune L2.

## Ce qui reste à mesurer

**L'heure pleine sur une application réelle nommée n'a pas été jouée.** La tâche 2 l'exige, et le
critère d'acceptation 2 refuse explicitement l'extrapolation. Ce document ne la remplace pas.

Ce qu'elle apportera, et rien d'autre :

| Question | Répondue ici ? |
| --- | --- |
| Combien coûte une entrée | Oui, mesuré, transférable |
| Combien coûte une heure à une cadence donnée | Oui, pour toute cadence |
| Quelle cadence produit une vraie application | **Non** — c'est ce que l'heure apporte |
| La latence est-elle perceptible à l'usage | **Non** — mesurée en synthétique, pas perçue |
| La fenêtre couvre-t-elle bien soixante minutes après une heure | **Non** — jamais observé sur une heure continue |

Le protocole est la section [Manuel](#manuel--la-cadence-réelle) ci-dessus. Un ordre de grandeur
pour se situer : à 0,45 % du quota pour mille entrées par minute, il faudrait que la mesure réelle
soit deux cents fois plus élevée que prévu pour changer une seule des décisions ci-dessus.

## Lacunes de mesure

### L1 — un profil de trafic synthétique n'est pas une application

Le serveur de test répond en microsecondes, sur `127.0.0.1`, sans TLS ni latence réseau. Il
mesure correctement le **coût unitaire** d'une entrée, qui ne dépend que de sa forme. Il ne dit
rien du comportement sous latence réelle, où les requêtes s'étalent et où la file d'écriture ne
se remplit jamais — un régime plus favorable, jamais moins.

Le profil lourd a été calibré sur ce qu'envoie une application authentifiée classique. Une
application qui journalise des objets volumineux, ou dont les URL portent des jetons, sortira de
la fourchette 213–3 276 octets. La règle de recalcul est simple : **la taille du JSON est la
taille stockée**.

### L2 — l'estimation d'origine ne se lit que globalement

`navigator.storage.estimate()` répond pour toute l'origine `chrome-extension://`, fichiers de
l'extension compris. D'où la soustraction d'une ligne de base, prise quand le magasin est vide
(`storage/metrics.ts`).

Cette arithmétique suppose que `chrome.storage.local` **n'entre pas** dans le quota de l'API
Storage — sans quoi la série de relevés se compterait elle-même. Supposé n'est pas mesuré :
2 Mo écrits dans `chrome.storage.local` déplacent l'usage de l'origine de moins de 1 Mo. Vérifié,
la soustraction tient.

### L3 — l'instrument ne tourne que sur demande

Un relevé parcourt toute la table. Un sondage périodique mettrait donc l'appareil de mesure à
l'intérieur de ce qu'il mesure — c'est exactement la perte subie en phase 2
(`measure-permissions.md:178`). La popup relève à l'ouverture et sur clic, jamais en boucle.

Ce que ça coûte : **il n'y a pas de courbe continue**, seulement les points que quelqu'un a
demandés. Une pointe de trafic entre deux relevés est invisible.

### L4 — aucun index sur `kind`

Compter par nature parcourt la table plutôt que d'interroger trois index. Un index se paie sur le
chemin d'**écriture**, et le chemin d'écriture est précisément ce que cette phase mesure : payer
l'instrument avec la chose sous test fausserait le résultat. Le coût est reporté sur la lecture,
qui n'est demandée que par un humain.

## Déviations assumées par rapport à l'instruction

### L'arbre de fichiers ne prévoyait aucun fichier de test

La projection d'architecture liste `background.ts`, `metrics.ts`, `write.ts`, `prune.ts` et ce
document. La mesure a en plus demandé :

| Fichier | Pourquoi |
| --- | --- |
| `apps/extension/src/storage/metrics.test.ts` | 23 tests : une valeur inconnue doit rester inconnue jusqu'au relevé, une fenêtre trop courte ne doit pas porter de débit |
| `e2e/specs/storage-metrics.spec.ts` | Les chiffres de ce document viennent de là. Aucun ne peut être produit hors d'un vrai navigateur |
| `e2e/fixtures/test-site.ts` | Routes `/burst` et `/burst-asset`, profils léger et lourd |
| `apps/extension/src/entrypoints/popup/App.tsx` | Le critère 1 exige une lecture sans DevTools ; la popup est la seule surface qui existe à ce stade |

### Deux constantes ont changé de fichier

`estimateQuota()` est passée de `prune.ts` à `metrics.ts` : la purge et l'instrument la lisent
tous les deux, et c'est l'instrument qui la possède. `FLUSH_MESSAGE` est passée de
`capture/network/listeners.ts` à `storage/write.ts` : la popup a besoin de vider la file avant de
relever, et une surface d'interface ne doit pas importer la couche de capture pour ça.

### Le cas limite « quota atteint » a été couvert autrement que prévu

Le *Test Scope* dit « réduire artificiellement le quota disponible ». Le quota du navigateur ne se
réduit pas. La saturation est annoncée à `estimate()` dans le service worker. Ce qui est testé est
la décision de purger et le signalement, pas la réaction de Chrome à un disque plein.

## Portée de la décision

| Ce qui est tranché | Ce qui ne l'est pas |
| --- | --- |
| Une entrée coûte 200 à 3 300 octets selon sa forme, et l'octet stocké vaut l'octet de JSON | La cadence d'une application réelle (heure à jouer) |
| Le quota n'est pas la contrainte : 0,45 % pour une heure bavarde | La latence **perçue** à l'usage |
| La capture coûte 0,23 ms par requête | Le coût sur une machine lente ou un profil chargé |
| `RETENTION_MS` reste à une heure, `BATCH_SIZE` à 50 | Ce que le rapport embarque réellement (phase 7) |
| La fenêtre rétrécit et le signale quand le quota sature | Le rendu de ce signalement à l'utilisateur (phases 7 et 8) |
| La popup suffit à relever sans DevTools | La popup définitive (phase 8 la remplace) |

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/extension/src/storage/metrics.ts` | L'instrument : volume, comptes par nature, débit, âge, projection, série de relevés |
| `apps/extension/src/storage/metrics.test.ts` | 23 tests unitaires sur l'arithmétique et ses refus |
| `apps/extension/src/storage/prune.ts` | La fenêtre roulante et le seuil de pression, mesure à l'appui |
| `apps/extension/src/storage/write.ts` | Le seuil de lot, confirmé plutôt qu'ajusté |
| `apps/extension/src/entrypoints/popup/App.tsx` | La lecture sans DevTools et les boutons de relevé |
| `e2e/specs/storage-metrics.spec.ts` | 7 spécifications, dont les trois mesures de ce document |
| `e2e/fixtures/test-site.ts` | Les routes de rafale, profils léger et lourd |
