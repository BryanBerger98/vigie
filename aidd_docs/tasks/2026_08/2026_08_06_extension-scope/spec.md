# Vigie — extension navigateur, première version

## Cible

Permettre à un utilisateur de télécharger, en un clic et sans avoir reproduit le bug, un rapport Markdown du contexte technique de l'onglet actif — trafic réseau, sorties console, erreurs JS — sur une fenêtre de temps qu'il choisit jusqu'à 60 minutes, pour les seuls domaines qu'il a désignés.

## Contraintes fermes

- La capture ne s'exerce que sur les domaines désignés explicitement par l'utilisateur. Partout ailleurs, rien n'est observé, rien n'est stocké.
- Aucune requête sortante n'est émise par l'extension : pas de backend, pas de compte, pas de télémétrie. Toute donnée reste sur la machine.
- La profondeur d'export est bornée à 60 minutes, offerte en quatre paliers — 5, 15, 30, 60 minutes — tous atteignables depuis la même surface, sans écran intermédiaire.
- Ce qui date de plus d'une heure n'est ni exportable ni conservé : le stockage ne croît pas sans borne.
- Un export porte sur l'onglet actif seul et n'exige aucune saisie humaine : choisir une profondeur, cliquer, rien d'autre.
- Le bundle est figé à l'instant du clic ; ce qui survient après n'y entre pas. Tout ce qui tombe dans la fenêtre part sans tri ni filtrage.
- Un seul format de sortie, identique quel que soit le destinataire, écrit dans un fichier téléchargé.
- Un écran de consentement précède toute capture au premier lancement et énonce ce qui est capté, payloads réseau bruts et contenu console compris. C'est une condition de publication sur le Chrome Web Store, pas un choix d'ergonomie.
- L'utilisateur peut à tout moment consulter ce qui est stocké, le purger, et retirer un domaine — ce qui arrête sa capture et supprime ce qui avait été capté pour lui.
- Une heure de capture sur une application réelle ne dégrade pas la navigation de façon perceptible.
- `TBD: quel mécanisme d'autorisation pour les domaines désignés — demande au moment de l'ajout d'un domaine, ou autorisation large accordée à l'installation ? La réponse change ce que l'écran de consentement doit annoncer.`
- `TBD: quelle structure pour le rapport exporté — ordre des sections, forme d'une requête, traitement d'un corps de réponse absent ? Elle décide de l'exploitabilité par un agent.`
- `TBD: un palier de profondeur est-il présélectionné par défaut (hypothèse de travail : 5 minutes), ou les quatre sont-ils strictement à égalité au moment du clic ?`
- `TBD: lorsque plusieurs onglets d'un même domaine surveillé sont ouverts, chacun tient-il son propre fil, et que couvre un export lancé depuis l'un d'eux ?`
- `TBD: si le quota de stockage du navigateur est atteint avant 60 minutes, la fenêtre rétrécit-elle en silence ou l'utilisateur en est-il averti ?`
- `TBD: le rapport doit-il signaler que la capture a commencé après le chargement de la page, le contexte antérieur étant perdu ?`

## Hors périmètre

- Le SDK applicatif Vigie et tout contexte métier qu'il apporterait — environnement, utilisateur, version backend.
- L'enregistrement vidéo, sous toute forme. La promesse de cette version est textuelle.
- La couche de capture avancée qui donnerait accès aux corps de réponse sans SDK.
- Toute rédaction humaine à l'export : ni champ de description, ni formulaire, ni catégorisation.
- Tout tri ou filtrage à l'intérieur de la fenêtre choisie.
- Plusieurs formats de sortie selon le destinataire.
- Le masquage des secrets dans le rapport : l'export est brut. Risque accepté pour cette version, à revoir avant tout usage en secteur régulé.
- Toute capture hors des domaines désignés. La navigation personnelle n'est jamais observée.
- Toute remontée d'export au-delà d'une heure.

## Terminé quand

- Un export lancé sur un bug déjà survenu, sans qu'aucune action n'ait précédé, produit un rapport couvrant la période demandée.
- Choisir une profondeur puis cliquer écrit le rapport dans le dossier de téléchargements ; aucun champ n'est demandé, aucune étape ne s'intercale.
- Le rapport contient le trafic réseau, les sorties console et les erreurs JS de la fenêtre, horodatés et ordonnés, indique la fenêtre couverte, le domaine et l'onglet concernés, et signale explicitement tout corps de réponse indisponible plutôt que de l'omettre.
- Un agent IA répond à « que s'est-il passé ? » à partir du seul rapport collé, sans reformatage préalable.
- Un domaine jamais désigné ne laisse aucune donnée stockée ni exportable ; retirer un domaine arrête sa capture et efface ce qui le concernait.
- Au premier lancement, l'écran de consentement s'affiche avant toute capture ; ensuite, l'utilisateur peut voir l'état du stockage et le vider.
- Après une heure de navigation réelle sur une application cible : aucune dégradation perceptible, aucune donnée antérieure à une heure encore présente, aucune requête sortante émise.

## Parties prenantes

- Décideur : Bryan Berger, porteur du produit.
- Propriétaire : Bryan Berger.
- Consommateurs : le product owner, le QA et le développeur qui débuggent leur propre application ; en second lieu, l'agent IA qui reçoit le rapport.

## Contexte

- Origine : [prd.md](./prd.md) et [brainstorm.md](./brainstorm.md) du même dossier.
- Cette version existe pour prouver qu'un rapport porte de la valeur avant d'engager les surfaces coûteuses — SDK, vidéo, capture avancée.
- La mémoire projet décrit encore un produit différent : le ring buffer vidéo et le rewind 60 secondes y figurent comme cœur du produit (`project-brief.md:13,22,23,32`, `architecture.md:63`, `database.md:39`). Elle doit être corrigée avant que quoi que ce soit ne s'appuie dessus.
- Le positionnement commercial « les 60 dernières secondes sont déjà capturées » promet de l'image et doit être réécrit.
- Deux mesures manquent et conditionnent la validation : le volume qu'occupe une heure de trafic en stockage local, et une application réelle et bugguée sur laquelle recetter la sobriété et l'exploitabilité par une IA.
