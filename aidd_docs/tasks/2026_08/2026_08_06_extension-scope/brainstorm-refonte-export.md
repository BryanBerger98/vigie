# Un geste d'export, un rapport qui se lit, une popup qu'on regarde

> Affinage du 2026-08-07, postérieur à la recette de phase 11. Il porte sur le produit livré, pas
> sur une intention neuve : ce document dit ce qui doit changer dans ce qui existe déjà.

La popup de Vigie fait aujourd'hui trois métiers : elle exporte, elle affiche une sonde de
développement, et elle sert de banc de mesure du stockage. Elle n'en garde qu'un. Le geste d'export
devient un bouton unique dont le corps rejoue la dernière profondeur utilisée et dont le caret ouvre
les quatre paliers. L'instrumentation disparaît sans être déplacée : les réglages tiennent déjà
l'état du stockage.

Le rapport cesse d'être un fil de texte indenté pour devenir un document Markdown structuré —
tableau de cadrage, sections par entrée, blocs de code typés, parties verbeuses repliées. Et la
surface elle-même cesse d'être grise : icônes Lucide, alerte de capture colorée selon l'état, marque
du produit à côté du titre, réglages en icône seule en haut à droite.

## Ce qui est clair

### Le geste d'export

- Split button. Le corps exporte la dernière profondeur utilisée, persistée localement. Le caret
  ouvre le menu des quatre paliers ; un clic sur un palier exporte.
- Les paliers que le stockage ne peut pas honorer restent grisés dans le menu et affichent leur
  raison en ligne, comme aujourd'hui (`state.ts:160-181`). Un menu ne peut pas se contenter d'une
  infobulle : un élément désactivé ne reçoit pas le survol.
- Profondeur initiale avant tout premier export : **5 minutes**.
- Si la profondeur mémorisée devient indisponible, le bouton retombe sur le palier le plus profond
  encore atteignable.

### Ce que la popup contient à la fin

Marque, titre, icône réglages en haut. Alerte d'état de capture. Bouton d'export. Ligne de contexte
de l'onglet. Accusé de copie. Bouton « Inspect live » avec icône, en pleine largeur puisqu'il reste
seul sur sa ligne.

- **Suppression, pas déplacement.** Les réglages affichent déjà entrées, octets, âge du plus ancien,
  ventilation par domaine et bouton de purge (`StoredData.tsx:73-148`). Le bloc de la popup en est
  un doublon.
- Les quatre chiffres de mesure partent avec lui — entrées/minute, octets par entrée, heure
  projetée, ratio de quota (`App.tsx:425-448`) — ainsi que les compteurs de la sonde phase 2 et la
  série de relevés de `storage/metrics.ts`, qui devient du code mort.

### La couche visuelle

- **lucide-react** entre comme dépendance. Elle n'existe pas encore (`apps/extension/package.json:16-24`).
- **Deux paires de tokens** `--success` et `--warning` dans `globals.css`, semées avec les valeurs
  Tailwind : `green-600` / `amber-500` en clair, `green-500` / `amber-400` en sombre. C'est le seul
  mécanisme qui fonctionne — voir la note sur le thème sombre plus bas.
- **Alerte encadrée** pour l'état de capture : `rounded-lg`, fond `bg-*/10`, bordure `border-*/30`,
  icône Lucide à gauche, titre, détail en dessous.
- **Couleurs par état** : `capturing` → success, `degraded` → warning, `out-of-scope` → destructive,
  `no-subject` → neutre. Aujourd'hui `degraded` et `out-of-scope` partagent le rouge
  (`ScopeStatus.tsx:31-36`) ; les séparer est un gain de lisibilité.
- **`design.md:28` est tenu** : libellé et icône restent présents. La couleur ne porte jamais l'état
  seule, ni pour un daltonien, ni sur une capture d'écran monochrome.
- **Marque** : `public/icon/32.png` rendu à 20 px, `rounded-md`. C'est le PNG livré au commit
  `2ea39df`, aucune source vectorielle n'existe.
- **Réglages** : `<Button variant="ghost" size="icon">` avec l'icône `Settings`. La variante `icon`
  existe déjà (`button.tsx:26`), rien à créer côté composant.
- **Angles arrondis partout**, via les tokens de rayon existants (`--radius: 0.5rem`,
  `globals.css:14`).
- Aucune primitive Tooltip dans le projet — pas de Radix — donc `aria-label` plus `title` natif sur
  le bouton en icône seule.

### Le rapport

- **Tableau de cadrage en tête** : domaine, onglet, fenêtre demandée et couverte, période, volumes
  par type dont le compte des anomalies. Aucun index ligne à ligne.
- **« Ce que ce rapport ne contient pas » reste juste après**, avant la timeline. Un lecteur doit
  savoir ce que le rapport ne peut pas montrer avant de conclure d'une absence.
- **Une section par entrée**, titre lisible, horodatage complet conservé sur chaque entrée.
- **Fences typées** : `json`, `http`, `js`, `text`.
- **Un corps JSON qui parse est réindenté** ; un corps qui ne parse pas est rendu tel quel dans une
  fence `text` et le rapport le signale. Sa malformation est peut-être le bug recherché.
- **`<details>`** autour des en-têtes HTTP et des piles d'appel longues. Un agent lit quand même le
  contenu, c'est du texte ; un humain dans un rendu Markdown voit un rapport compact.

Squelette visé :

```markdown
# Vigie — app.example.com

|  |  |
|---|---|
| Tab | 4 — Checkout |
| Window | 30 min requested, 28.4 covered |
| Period | 2026-08-07T10:12:03Z → 10:40:27Z |
| Network | 284 (3 failed, 5 with status ≥ 400) |
| Console | 31 (2 error) |
| JS errors | 3 |

## What this report does not contain

- No response bodies: Chrome does not expose them without the SDK.

## Timeline

### 10:12:03 · POST /api/orders → 500
```

## Décisions révoquées

Deux décisions écrites tombent. Elles ne sont pas des oublis, elles sont remplacées en connaissance
de leur raison d'être.

**`markdown.ts:22` — « pas de tables, pas d'imbrication profonde ».** Le rendu était conçu pour
survivre à une coupure n'importe où, une heure de trafic pouvant dépasser la fenêtre de contexte de
son lecteur : un bloc coupé en deux perd un bloc, une table coupée en deux perd son en-tête et
devient illisible. Cette contrainte est levée. Risque accepté : un rapport tronqué au milieu d'un
tableau ou d'un `<details>` devient partiellement inexploitable.

**`spec.md:20` — la structure du rapport était un TBD.** Il se referme ici.

## Le thème sombre, et pourquoi les tokens

Le projet a un thème sombre que personne n'a décidé récemment : il est venu avec le bloc de tokens
shadcn. Deux mécanismes coexistent dans `globals.css`, un seul fonctionne.

| Mécanisme | Ligne | Actif |
|---|---|---|
| Tokens redéfinis par media query `prefers-color-scheme: dark` | `globals.css:85-107` | Oui, automatique |
| Variante utilitaire `dark:` | `globals.css:11` | Non — elle cible `.dark *`, aucune ligne du code ne pose cette classe |

Conséquence directe : écrire `bg-green-50 dark:bg-green-950` ne déclencherait jamais la variante
sombre, et `bg-green-50` seul donnerait une tache pâle sur fond `#171717` dès que l'OS est en thème
sombre. La popup s'affiche dans le chrome du navigateur, pas dans une page dont on maîtrise le fond
(`design.md:14`). D'où les tokens : ce sont les mêmes valeurs Tailwind, nommées une fois au lieu
d'être recopiées à chaque usage.

## Conséquences vérifiées sur l'existant

| Constat | Évidence | Effet |
|---|---|---|
| `ScopeStatus` est partagé avec le panneau latéral | `sidepanel/App.tsx:8` importe le composant depuis le dossier popup | L'alerte encadrée change les deux surfaces. C'est voulu : deux vérités sur l'état de capture est le défaut que `state.ts:133` interdit. |
| La recette clique `export-5` et `export-60` comme boutons de premier niveau | `popup-export.spec.ts:145,196`, `acceptance.spec.ts:230` | Le split button casse ces specs. Elles sont à réécrire, pas à rafistoler. |
| `storage-metrics.spec.ts` teste entièrement l'instrumentation | `storage-metrics.spec.ts:99-100` | Ce fichier disparaît avec le bloc. |
| `spec.md:11` fige quatre paliers atteignables depuis la même surface | — | Devient faux. À amender. |
| `spec.md:13` fige « choisir une profondeur, cliquer, rien d'autre » | — | Tenu pour le palier mémorisé seulement, deux clics pour les autres. À amender. |

## Ce qui reste ouvert

- **Trouver les anomalies sans index.** Trois échecs noyés dans 318 entrées, et `spec.md:43` demande
  qu'un agent réponde à « que s'est-il passé ? » à partir du seul rapport collé. Inclination : un
  marqueur visible dans le titre de chaque section en anomalie, le compte dans le tableau de tête,
  pas d'index ligne à ligne. À trancher au plan si l'inclination ne convainc pas.
- **Hypothèse — icônes par état** : `Radio` pour capturing, `TriangleAlert` pour degraded, `EyeOff`
  pour out-of-scope, `Minus` pour no-subject. À figer au plan.
- **Hypothèse — le rapport reste en anglais**, artefact de code au sens de `CLAUDE.md`.
- **Réinstrumenter aura un coût** si une nouvelle campagne de mesure du stockage devient nécessaire.
  Le protocole de `measure-storage.md` perd son instrument.

## Prochain pas

Amender la spécification sur les deux points devenus faux, puis découper un plan d'exécution en
commençant par le rendu du rapport — c'est là qu'est la difficulté réelle, le reste étant du
remplacement de composant.
