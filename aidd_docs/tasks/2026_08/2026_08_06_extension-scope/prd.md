# Vigie — première version de l'extension

Vigie capture en continu le contexte technique du navigateur sur les domaines que l'utilisateur a désignés, et le restitue en un clic sous forme de rapport Markdown qu'un agent IA consomme directement. Cette première version couvre le contexte navigateur seul : trafic réseau, console, erreurs JS, stockage roulant d'une heure, export texte.

## Contexte

Un rapport de bug se rédige normalement après coup, de mémoire, et il manque précisément la preuve nécessaire pour reproduire. Vigie supprime l'étape « rejoue le bug pendant que j'enregistre » pour tout ce qui est textuel : quand le bug apparaît, la dernière heure de trafic est déjà là, sans qu'aucune action préalable ait été nécessaire.

Le public est le product owner, le QA et le développeur qui débuggent leur propre application. Rien ne quitte la machine : pas de backend, pas de compte, pas de télémétrie.

Cette version existe pour prouver qu'un rapport porte de la valeur avant d'engager les surfaces coûteuses — le SDK, la vidéo, la couche de debug avancée.

## Problème

Trois coûts se cumulent aujourd'hui :

- **La preuve est perdue à l'instant où le bug survient.** Reproduire demande de savoir à l'avance qu'un bug arrive. Personne ne le sait.
- **Le rapport écrit à la main est incomplet.** Il décrit un symptôme, pas les requêtes, statuts, en-têtes et erreurs console qui l'entourent. Le développeur ouvre un aller-retour pour obtenir ce qui existait déjà.
- **Ce qui est collecté n'est pas consommable par une IA.** Captures d'écran, copiés-collés partiels, exports DevTools bruts : chaque destinataire reçoit un format différent, qu'un agent doit reformater avant de raisonner dessus.

## Objectifs

| Objectif | Preuve observable |
|---|---|
| Produire un rapport sans avoir rejoué le bug | L'export réussit sur un bug survenu avant toute action de l'utilisateur |
| Réduire l'export à un geste | Choix de la fenêtre puis clic : rien d'autre entre le bug et le presse-papier |
| Rendre le rapport directement exploitable par un agent IA | Un agent répond à « que s'est-il passé ? » à partir du seul bundle collé, sans reformatage |
| Cantonner strictement l'observation | Un domaine non désigné ne produit aucune donnée stockée ni exportable |
| Garder la donnée sur la machine | Aucune requête sortante émise par l'extension |
| Tenir une heure de capture sans dégrader la navigation | Volume stocké et impact perçu mesurés sur une session d'une heure d'usage réel |

## Hors périmètre

- **Le SDK `@vigie/sdk`** et tout contexte applicatif métier — environnement, utilisateur, version backend.
- **L'enregistrement vidéo**, sous toute forme. La promesse de cette version est textuelle.
- **La couche de capture avancée** apportant les corps de réponse hors SDK.
- **Toute rédaction humaine à l'export** : ni champ de description, ni formulaire, ni catégorisation.
- **Tout tri ou filtrage** à l'intérieur de la fenêtre choisie.
- **Plusieurs formats de sortie** selon le destinataire. Un seul format, pour tous.
- **La rédaction (masquage de secrets)** : l'export est brut. Risque accepté, dette v2, à revoir avant tout client en secteur régulé.
- **Toute capture hors domaines désignés.** La navigation personnelle n'est jamais observée.
- **Toute remontée d'export au-delà d'une heure.**

## User stories

- En tant que product owner, je veux désigner les domaines de mon application, afin que Vigie n'observe rien ailleurs.
- En tant que QA, je veux que le contexte technique soit déjà capturé quand un bug survient, afin de ne pas avoir à le reproduire pour le documenter.
- En tant que QA, je veux choisir jusqu'où le rapport remonte, afin d'inclure le déclencheur quand il précède le symptôme de plusieurs minutes.
- En tant que développeur, je veux un rapport limité à l'onglet où le bug s'est produit, afin de ne pas noyer le contexte utile dans le reste de ma navigation.
- En tant que développeur, je veux coller le rapport à un agent IA sans le retoucher, afin d'obtenir un diagnostic immédiat.
- En tant qu'utilisateur, je veux savoir exactement ce qui est capté avant que quoi que ce soit ne le soit, afin d'accepter en connaissance de cause.
- En tant qu'utilisateur, je veux pouvoir retirer un domaine et effacer ce qui a été capté, afin de reprendre la main sur ce qui est stocké.

## Critères d'acceptation

**Portée de la capture**

- Un domaine ajouté déclenche la capture sur ce domaine, et seulement lui.
- Un domaine jamais ajouté ne laisse aucune trace : rien de stocké, rien d'exportable.
- Retirer un domaine arrête la capture et supprime ce qui avait été capté pour lui.

**Fenêtre**

- Quatre profondeurs sont proposées — 5, 15, 30, 60 minutes — toutes accessibles depuis la même surface, sans écran intermédiaire.
- Aucun export ne remonte au-delà de 60 minutes.
- Ce qui date de plus d'une heure n'est plus disponible à l'export.

**Export**

- Un export porte sur l'onglet actif seul.
- Choisir une profondeur et cliquer suffit : aucun champ à remplir, aucune étape supplémentaire.
- Le bundle est figé au moment du clic ; ce qui arrive après n'y entre pas.
- Tout ce qui tombe dans la fenêtre est exporté, sans tri ni filtrage.
- Le rapport part au presse-papier, dans un format unique.

**Contenu du rapport**

- Trafic réseau, sorties console et erreurs JS de la fenêtre y figurent, chacun horodaté et ordonné.
- Un corps de réponse indisponible est signalé comme tel, jamais omis en silence.
- Le rapport indique la fenêtre couverte, le domaine et l'onglet concernés.

**Consentement et transparence**

- Un écran au premier lancement expose ce qui est capté — payloads réseau bruts, contenu console — avant toute capture.
- L'utilisateur peut voir ce qui est actuellement stocké et le purger.

**Sobriété**

- Une heure de capture sur une application réelle ne dégrade pas la navigation de façon perceptible.
- Le stockage ne croît pas sans borne : au-delà d'une heure, le plus ancien disparaît.

## Dépendances

- **Validation Chrome Web Store** : l'écran de consentement et la justification des permissions conditionnent la publication, ce n'est pas un choix d'ergonomie.
- **Mesure du volume d'une heure de trafic** avant de figer le plafond de 60 minutes. C'est le magasin qui tourne en permanence, donc celui qui décide si le produit est vivable.
- **Décision sur le mécanisme d'autorisation des domaines** — demande au moment de l'ajout ou autorisation large à l'installation. Elle change ce que l'écran de consentement doit annoncer.
- **Réécriture du positionnement commercial.** La formule « les 60 dernières secondes sont déjà capturées » promet de l'image ; elle doit ne plus rien promettre sur la vidéo.
- **Une application réelle et bugguée** pour recetter : sans cible, les critères de sobriété et d'exploitabilité par une IA ne sont pas vérifiables.

## Questions ouvertes

- **Structure du Markdown exporté** : ordre des sections, forme d'une requête, traitement d'un corps de réponse absent. Jamais abordée, et elle décide de l'exploitabilité par un agent.
- **Aucune profondeur privilégiée** : les quatre paliers sont côte à côte. À confirmer que l'absence de défaut ne rallonge pas le geste au moment où le bug vient d'apparaître.
- **Mécanisme d'autorisation des domaines** : demande à l'ajout du domaine, piste cohérente mais non vérifiée.
- **Volume d'une heure en stockage local** : non mesuré. Seconde mesure manquante à côté du profil vidéo, hors périmètre ici.
- **Plusieurs onglets sur un même domaine surveillé** : chacun tient-il son propre fil, et que voit un export lancé depuis l'un d'eux ?
- **Saturation du stockage avant l'heure** : si la limite du navigateur tombe avant les 60 minutes, l'utilisateur l'apprend-il, ou la fenêtre rétrécit-elle en silence ?
- **Capture démarrée en cours de vie de la page** : ce qui précède l'ajout du domaine ou le chargement de l'extension est perdu — faut-il le signaler dans le rapport ?
