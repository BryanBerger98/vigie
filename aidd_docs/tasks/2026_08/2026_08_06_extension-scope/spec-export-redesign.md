# Vigie — refonte du geste d'export et du rapport

## Cible

Réduire la surface livrée de Vigie à ce qui sert son usage : exporter en un geste, et remettre un rapport qu'un lecteur exploite sans le parcourir en entier.

## Contraintes fermes

### Le geste d'export

- La popup ne porte plus que l'export et ce qui le conditionne : identité du produit, état de la capture, déclenchement de l'export, contexte de l'onglet, accusé de copie, accès aux réglages, accès à la lecture live.
- Les quatre paliers de profondeur — 5, 15, 30, 60 minutes — restent tous atteignables depuis la popup, mais plus tous au même coût : un geste unique exporte le palier courant, un geste supplémentaire suffit pour atteindre les trois autres. *Amende `spec.md:11` et `spec.md:13`.*
- Avant tout premier export, le palier courant est 5 minutes. *Referme `spec.md:21`.*
- Le palier du dernier export devient le palier courant et survit à la fermeture de la popup, sur la machine seule.
- Si le palier courant cesse d'être atteignable, le palier le plus profond encore atteignable le remplace, sans que l'utilisateur ait à le désigner.
- Un palier que le stockage ne peut pas honorer reste visible, non sélectionnable, et énonce sa raison sans exiger d'interaction — ni survol, ni clic. Un élément désactivé ne répond ni à l'un ni à l'autre.

### Ce que le rapport doit permettre

- Le rapport s'ouvre sur un cadrage : domaine, onglet, fenêtre demandée et fenêtre réellement couverte, période, et volume de chaque type de contenu dont le nombre d'anomalies.
- Ce que le rapport ne peut pas montrer est énoncé immédiatement après le cadrage, avant toute chronologie. Un lecteur doit connaître les limites du rapport avant de conclure d'une absence.
- Le nombre d'anomalies et leur emplacement se lisent sans parcourir la chronologie entière et sans index ligne à ligne des entrées.
- Chaque entrée porte son horodatage complet et un intitulé qui l'identifie sans avoir à lire son contenu.
- Un contenu structuré qui se laisse relire est remis mis en forme ; un contenu qui ne se laisse pas relire est remis tel quel et signalé comme malformé — jamais corrigé, jamais omis. Sa malformation est peut-être le défaut recherché.
- Les parties verbeuses — en-têtes de requête, piles d'appel longues — sont repliées à la lecture humaine sans quitter le rapport : un lecteur automatique y accède sans dépliage.
- Le rapport reste rédigé en anglais, comme tout artefact destiné au code et aux agents (`CLAUDE.md`, section Language).

### La surface

- L'état de la capture est porté par au moins deux signaux dont un non chromatique, et chacun des quatre états se distingue de tous les autres — y compris de celui avec lequel il partage aujourd'hui sa couleur. La couleur seule ne porte jamais l'état (`design.md:28`).
- La popup reste lisible quel que soit le thème du système : elle s'affiche dans le chrome du navigateur, dont le fond ne lui appartient pas (`design.md:16`).
- Toute surface qui affiche l'état de capture en donne la même lecture. Deux vérités concurrentes sur l'état de capture sont interdites.

## Hors périmètre

- Déplacer l'instrumentation de développement ailleurs. Elle est supprimée : mesure du stockage, débit d'entrées, projection d'occupation, ratio de quota, série de relevés. Les réglages portent déjà l'état du stockage et la purge.
- Reconstruire un instrument de mesure du stockage. Une future campagne de mesure devra le refaire, coût assumé.
- Toute nouvelle option de configuration de l'export : pas de choix de sections, pas de filtre, pas de tri, pas de saisie humaine. La contrainte V1 tient.
- Ce qui est capté. La refonte porte sur la restitution et sur la surface, pas sur la nature ni sur l'étendue de la capture.
- Un index ligne à ligne des entrées en tête de rapport.
- Un second format de sortie, ou un rendu destiné à autre chose qu'un collage direct.
- Toute extension du périmètre de capture, de la borne d'une heure, ou de la règle des domaines désignés. Les contraintes de `spec.md` non citées ici restent en vigueur telles quelles.

## Terminé quand

- Un utilisateur qui ouvre la popup n'y trouve que ce qui sert l'export ; aucun chiffre de stockage ni de mesure n'y figure, et les réglages continuent de les donner.
- Un premier export, sans réglage préalable, porte sur 5 minutes ; l'export suivant rejoue la même profondeur sans que l'utilisateur ait à la redésigner ; les trois autres paliers restent atteignables en un geste de plus.
- Un palier que le stockage ne peut honorer se voit, ne se sélectionne pas, et donne sa raison sans qu'on ait à le survoler ni à le cliquer.
- Un lecteur qui ouvre le rapport connaît, avant toute chronologie, la période couverte, le périmètre, le volume et le nombre d'anomalies, ainsi que ce que le rapport ne peut pas montrer.
- Un agent IA répond à « qu'est-ce qui a échoué ? » à partir du seul rapport collé, en atteignant les entrées en anomalie sans parcourir la chronologie entière.
- Un contenu malformé apparaît dans le rapport tel qu'il a été reçu, accompagné de la mention de sa malformation.
- Sur une capture d'écran en niveaux de gris, chacun des quatre états de capture reste distinguable des trois autres.
- La popup reste lisible sous les deux thèmes du système, sans réglage de la part de l'utilisateur.

## Parties prenantes

- Décideur : Bryan Berger, porteur du produit.
- Propriétaire : Bryan Berger.
- Consommateurs : le product owner, le QA et le développeur qui débuggent leur propre application ; en second lieu, l'agent IA qui reçoit le rapport.

## Contexte

- Origine : [brainstorm-refonte-export.md](./brainstorm-refonte-export.md), postérieur à la recette de la V1 ([acceptance-report.md](./acceptance-report.md)) et à la soumission store ([cws-submission.md](./cws-submission.md)).
- Cette spec amende [spec.md](./spec.md) sans la remplacer : elle rend caduques `spec.md:11` et `spec.md:13`, referme les questions ouvertes `spec.md:20` et `spec.md:21`. Toute autre contrainte de `spec.md` reste en vigueur, y compris ses questions encore ouvertes, hors périmètre ici.
- Une décision de rendu antérieure est révoquée : le rapport était volontairement plat pour survivre à une coupure au milieu, une heure de trafic pouvant dépasser la fenêtre de contexte de son lecteur. **Risque accepté** : un rapport tronqué au milieu d'une structure devient partiellement inexploitable.
- L'état de capture est une surface partagée entre la popup et le panneau latéral. Le changement porte les deux, volontairement.
- La recette existante vérifie les paliers comme des déclencheurs de premier niveau et couvre l'instrumentation supprimée. Ces vérifications sont à réécrire, pas à ajuster.
- La forme exacte du repérage des anomalies dans le rapport relève du plan : la spec n'exige que le résultat — les trouver sans lecture intégrale ni index.
