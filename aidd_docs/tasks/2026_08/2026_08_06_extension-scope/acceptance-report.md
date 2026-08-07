# Recette — Vigie 0.1.0

> Un critère de `spec.md:38-46` par ligne, avec ce qui a été **observé** et non ce qui a été déduit.
> Recette exécutée le 2026-08-07 sur le paquet `vigieextension-0.1.0-chrome.zip`.

## Verdict

**5 critères sur 7 sont tenus. Les 2 autres ne sont pas automatisables et attendent une main
humaine** — un agent qui lit un rapport brut, et une observation du trafic sortant sur une session
complète. Deux des cinq tenus le sont sur harnais et non sur application réelle : c'est dit ligne
par ligne plus bas.

Aucun écart n'a été trouvé entre ce que le produit annonce et ce qu'il fait.

## Ce qui a été exécuté

| Vérification | Résultat |
| --- | --- |
| `pnpm turbo build test lint typecheck` | 9/9 tâches, **307 tests unitaires** sur 20 fichiers, oxlint 0 avertissement |
| `pnpm turbo e2e` | **72 tests Playwright**, 2 min 19 s, sur profil Chrome neuf à chaque test |
| `pnpm turbo zip` | `vigieextension-0.1.0-chrome.zip`, 223 ko |
| Chargement du paquet sur profil neuf | service worker démarré, 4 surfaces montées, `origins: []` |

La suite d'acceptation elle-même — `e2e/specs/acceptance.spec.ts`, 5 tests — porte les critères
mécaniques et rien d'autre. Elle passe sans intervention manuelle.

## Critère par critère

### ✅ `spec.md:41` — profondeur, clic, presse-papier

Observé sur `acceptance.spec.ts:215`. Les quatre paliers — 5, 15, 30, 60 — sont visibles sur la même
surface. La popup ne contient **aucun** `input`, `textarea` ni `select` : l'assertion porte sur le
DOM entier, pas sur l'absence d'un champ nommé. Un clic sur `export-5`, et l'accusé affiche `Copied`.

Le presse-papier n'est jamais relu : CDP refuse d'accorder la permission presse-papier à une origine
`chrome-extension://`. L'accusé rendu est la preuve, et `popup-export.spec.ts:223` est ce qui montre
qu'il n'est pas imprimé inconditionnellement — un presse-papier refusé s'affiche comme refusé.

### ✅ `spec.md:42` — ce que le rapport contient et ce qu'il déclare

Observé sur `acceptance.spec.ts:242`. Sur une fenêtre de 15 minutes :

- **Trois natures mêlées** : au moins deux genres présents, dont `network` — la page de test écrit
  dans la console pendant son chargement et lève une exception un tour plus tard.
- **Ordre croissant** : les horodatages du bundle sont égaux à leur propre tri.
- **Fenêtre, domaine, onglet** : `# Vigie report — 127.0.0.1`, `Subject: 127.0.0.1, tab <id>`,
  `URL: …/noisy`, `Window: 15 min requested,`.
- **Manques déclarés** : la section `## What this report does not contain` précède le corps, et
  `response body: not available` apparaît **une fois par requête** — jamais une fois pour le rapport.

### ✅ `spec.md:44` — domaine jamais désigné, et retrait d'un domaine

Deux tests, `acceptance.spec.ts:152` et `:188`.

**Jamais désigné** : la page bruyante est parcourue avant toute désignation, le worker est vidé, la
base est vide. La popup annonce `out-of-scope` et n'offre **aucun** palier. Un export demandé
directement au worker revient à zéro entrée. Puis — et c'est là que le test devient concluant — le
domaine est désigné et le même trafic est rejoué : des entrées apparaissent. La base vide de la
première moitié est donc la portée qui refuse d'écrire, pas une capture qui n'aurait jamais démarré.

**Retrait** : après capture, `watched-domain-remove` puis `remove-confirm`. La base est vide
immédiatement. Une requête émise ensuite depuis l'onglet même qui était capté ne laisse rien.

⚖️ Le variant de build tient sa permission d'hôte comme requise, donc Chrome continue de livrer les
événements après le retrait. C'est délibéré : ce qui arrête la capture est la portée applicative, la
barrière que le produit revendique, et non l'absence de livraison.

### ✅ `spec.md:45` — consentement au premier lancement, puis état du stockage

Observé en deux endroits.

**Le paquet, sur un profil neuf**, ouvre `chrome-extension://<id>/consent.html` de lui-même. Aucun
autre onglet que celui-là et la page vide de démarrage.

**Le verrou est en amont de la surface**, pas dessus : un domaine surveillé et parcouru avant
l'accord laisse la base vide (`consent-flow.spec.ts:121`). Popup et réglages montrent la porte au
lieu d'eux-mêmes tant que l'accord manque (`:136`, `:153`). Après accord, les réglages énoncent le
volume, l'entrée la plus ancienne et la répartition par domaine, et le bouton d'effacement vide le
magasin sans interrompre la capture (`:203`, `:229`). Un texte de divulgation plus récent que celui
accepté redemande l'accord (`:252`).

### ⚠️ `spec.md:40` — un export sur un bug déjà survenu, sans action préalable

**Le mécanisme est observé ; l'application réelle ne l'est pas.**

Ce qui est tenu : la page de test lève une exception non rattrapée que personne n'a armé quoi que ce
soit pour attraper, et l'export postérieur la remet dans la fenêtre demandée
(`acceptance.spec.ts:242`, `export-report.spec.ts:278` pour la profondeur annoncée).

Ce qui manque : un bug **non anticipé**, sur une application nommée, après une heure de navigation
ordinaire. Un harnais qui provoque son propre bug ne teste pas la promesse — il teste le harnais.
C'est la recette manuelle de `phase-11.md:96`, et c'est la même dépendance que `spec.md:60` pose.

### ⚠️ `spec.md:46` — une heure réelle : sobriété, rétention, silence réseau

Trois affirmations, trois états différents.

| Affirmation | Statut | Ce qui a été observé |
| --- | --- | --- |
| Rien d'antérieur à une heure ne subsiste | ✅ | `acceptance.spec.ts:287` |
| Aucune dégradation perceptible | ⚠️ harnais | `storage-metrics.spec.ts:310` |
| Aucune requête sortante émise | ⏳ | rien — voir plus bas |

**Rétention.** Une entrée à −61 minutes et une à −30 sont semées, puis une requête ordinaire est
émise. Le vidage qui suit toute écriture suffit : la première a disparu, la seconde est là, et plus
rien dans la base n'est antérieur à l'heure. Un export à 60 minutes ne la retrouve pas non plus.
Rien n'appelle la purge directement — ce qui est testé, c'est qu'une écriture banale suffit, puisque
MV3 n'offre aucun minuteur qui survive au worker.

**Sobriété.** Mesurée sur 1000 requêtes lourdes, trois tours dans chaque sens : 1464 ms de moyenne
sans capture, 1002 ms avec. Le surcoût mesuré est **négatif** — autrement dit il est sous le plancher
de bruit du harnais, que le premier tour à froid (2433 ms) domine largement. Phase 6 avait borné le
coût réel à 0,26–0,37 ms par requête (`storage/write.ts:47-50`) et le stockage à ~800 octets par
entrée, soit ~49 Mo pour une heure à mille entrées par minute contre un quota en gigaoctets
(`storage/prune.ts:17-20`). Rien de tout cela ne remplace une heure sur une application réelle : un
navigateur qui rame se juge à la main.

### ⏳ `spec.md:43` — un agent IA répond à « que s'est-il passé ? »

**Non observé.** Ce critère se vérifie en le faisant : coller le rapport tel quel, sans reformatage,
poser la question, consigner la réponse. Le format est verrouillé sur instantanés
(`export/markdown.test.ts`), ce qui garantit qu'il ne dérive pas — pas qu'il est exploitable.

Si un reformatage s'avère nécessaire, c'est la phase 7 qui est en cause, pas la recette.

### ⏳ `spec.md:46`, troisième affirmation — aucune requête sortante

**Non observé, et ce n'est pas une omission.** L'absence de trafic sortant est une revendication
produit : elle se prouve par observation du réseau sur une session complète, depuis
`chrome://extensions` ou un proxy, et non en relisant le code. Ce que la relecture donne — aucun
`fetch` vers un hôte tiers, aucune permission réseau au-delà de l'observation — est un argument, pas
une preuve.

## Écarts

Aucun écart entre le comportement observé et ce que la spécification annonce.

Un seul point de friction, sans conséquence sur un critère : la suite d'acceptation charge un
variant du build dont la permission d'hôte est **requise** plutôt qu'optionnelle. Aucune surface
d'automatisation ne peut répondre à la bulle native d'autorisation de Chrome (mesuré en phase 2,
`measure-permissions.md`, écart G1). Le chemin d'octroi réel — la bulle, son refus, sa révocation —
reste donc à la charge de la recette manuelle.

## Ce qui reste connu comme incomplet

Ces trois manques sont **assumés pour cette version** et écrits dans le rapport lui-même ou dans le
hors-périmètre. Ils ne sont pas des défauts découverts en recette.

| Manque | Où c'est dit | Conséquence |
| --- | --- | --- |
| **Corps de réponse** jamais captés | Déclaré dans chaque rapport, une fois par requête | Une erreur dont l'explication est dans le corps reste illisible sans le SDK |
| **Messages générés par le navigateur** hors de portée — violations CSP, avertissements de mixed content, erreurs CORS émises par Chrome lui-même | `STRUCTURAL_GAPS` dans `packages/contract/src/report.ts:83` | Le patch porte sur `console.*` de la page ; ce que le navigateur écrit directement dans la console n'y passe pas |
| **Aucun masquage des secrets** | `spec.md:34` | Le rapport porte les en-têtes bruts : jetons d'authentification, cookies de session, clés d'API. À revoir avant tout usage en secteur régulé |

## Ce qu'il reste à faire, et par qui

| # | Action | Critère débloqué |
| --- | --- | --- |
| 1 | Recetter à la main une heure sur l'application de la phase 6, provoquer un bug non anticipé, exporter la profondeur couvrant le déclencheur, consigner les gestes | `spec.md:40`, `:46` (sobriété) |
| 2 | Coller le rapport brut à un agent, poser « que s'est-il passé ? », consigner la réponse | `spec.md:43` |
| 3 | Observer le trafic de l'extension sur toute la session, depuis `chrome://extensions` ou un proxy | `spec.md:46` (silence réseau) |
| 4 | Publier la politique de confidentialité, créer le compte développeur | soumission — voir `cws-submission.md` |
| 5 | Retirer l'instrumentation de la popup — compteurs de phase 2, relevés de stockage de phase 6 | après 1 |

🔒 **L'instrumentation reste en place jusqu'à ce que la recette manuelle soit jouée.** Les relevés
de la popup (`popup/App.tsx:371`) sont l'instrument par lequel `measure-storage.md` consigne ses
mesures, et la recette manuelle doit produire des chiffres comparables à ceux de la phase 6
(`phase-11.md:100`). La retirer maintenant emporterait le protocole documenté avec elle.

Tant que 1 à 3 ne sont pas faits, la phase 11 reste ouverte. Rien n'est soumis au Chrome Web Store
sans accord explicite.
