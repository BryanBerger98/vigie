# Vigie — périmètre fonctionnel de l'extension

Vigie capture en continu le contexte technique du navigateur sur les domaines que l'utilisateur a lui-même désignés, et le restitue en un clic sous forme de rapport Markdown qu'un agent IA consomme directement. La promesse tient sur le texte : quand le bug apparaît, la dernière heure de trafic réseau, de console et d'erreurs est déjà là, sans qu'aucune action préalable ait été nécessaire. La vidéo existe, mais comme outil séparé et volontaire — on la démarre, on rejoue le problème, on l'arrête, on la télécharge — et elle ne s'adresse qu'à un lecteur humain.

Le public visé reste le product owner, le QA et le développeur qui débuggent leur propre application. Rien ne quitte la machine : pas de backend, pas de compte, pas de télémétrie.

## Ce qui est clair

- La capture de contexte ne tourne que sur les domaines ajoutés explicitement par l'utilisateur. Ailleurs, Vigie n'écoute rien.
- L'export porte sur l'onglet actif seul, jamais sur le domaine entier ni sur le navigateur.
- L'utilisateur choisit sa profondeur parmi quatre paliers — 5, 15, 30 ou 60 minutes — et ne peut pas remonter au-delà d'une heure.
- Aucune saisie humaine à l'export. Un clic fige le bundle et le copie. Pas de champ de description, pas de formulaire.
- À l'intérieur de la fenêtre choisie, tout part sans tri ni filtrage.
- Un seul format de sortie pour tous les destinataires. Le texte va au presse-papier, la vidéo se télécharge séparément.
- La vidéo est une action manuelle en deux temps, sans ring buffer ni buffer roulant. Elle n'accompagne pas automatiquement l'export.
- Conséquence assumée : un bug non anticipé n'aura jamais de vidéo. Le contexte technique, lui, sera toujours là.
- La première version se limite au contexte navigateur : `chrome.webRequest`, console, stockage roulant, export Markdown. Ni SDK, ni vidéo, ni `chrome.debugger`.

## Ce qui reste ouvert

- Six passages de la mémoire projet contredisent désormais ces décisions : `project-brief.md:13,22,23,32`, `architecture.md:63`, `database.md:39`. Le ring buffer vidéo et le rewind 60 secondes y sont encore présentés comme le cœur du produit.
- La fenêtre par défaut sur le bouton principal n'est pas tranchée. Hypothèse retenue faute de mieux : 5 minutes, les autres paliers accessibles à côté sans écran intermédiaire.
- Le mécanisme de permission pour les domaines désignés n'est pas décidé. Les permissions d'hôte optionnelles, demandées au moment où l'utilisateur ajoute un domaine, sont une piste cohérente avec ce choix — non vérifiée.
- La structure du Markdown exporté n'a jamais été abordée : ordre des sections, format des requêtes, traitement des corps de réponse absents.
- Le volume d'une heure de trafic réseau en IndexedDB n'est pas mesuré. C'est la seconde mesure manquante, à côté du profil vidéo déjà signalé en `architecture.md:78`.
- Aucun critère ne dit ce qui prouve que la première version fonctionne.
- Le positionnement commercial « les 60 dernières secondes sont déjà capturées » doit être réécrit pour ne plus rien promettre sur l'image.

## Prochain pas

Corriger la mémoire projet avant toute autre chose. Elle décrit aujourd'hui un produit différent de celui qui vient d'être défini, et tout ce qui s'appuiera dessus héritera de l'erreur.
