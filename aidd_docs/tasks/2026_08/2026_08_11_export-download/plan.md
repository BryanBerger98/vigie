---
title: L'export devient un fichier téléchargé
status: implemented
updated: 2026-08-11
owner: bryan
---

# L'export devient un fichier téléchargé

## 🎯 Ce qui change

Le clic sur **Export** écrit un fichier `.md` dans le dossier de téléchargement du navigateur.
Le presse-papier disparaît entièrement : plus de `copyToClipboard`, plus de bouton « Copy again ».
Le rendu Markdown, lui, ne bouge pas d'un caractère.

## ⚖️ Décisions déjà tranchées

| Question | Retenu | Écarté |
| --- | --- | --- |
| Le presse-papier survit-il ? | Non, sortie unique | Action secondaire |
| Quel mécanisme ? | `Blob` + `<a download>` | `chrome.downloads` |

Coller le rapport dans un agent IA — second destinataire nommé par `spec-export-redesign.md:59` — demande désormais d'ouvrir le fichier.
Coût assumé.

`chrome.downloads` aurait apporté le dialogue « Enregistrer sous », le contrôle des collisions et un vrai accusé de réception.
Son prix est une permission de plus et son avertissement à l'installation.
Le manifest reste donc intact (`wxt.config.ts:36`).

## ⚡ Ce que le changement libère

### La contrainte d'activation transitoire

`navigator.clipboard.writeText` n'est honoré que sur l'activation que le clic vient d'accorder, et le premier `await` qui lui survit la dépense.
C'est ce qui force aujourd'hui l'écriture à être la dernière instruction du gestionnaire (`App.tsx:163-169`), ce qui fait échouer un export quand le service worker traîne, et ce que le bouton « Copy again » existait pour rattraper (`CopyFeedback.tsx:10-14`).
Un téléchargement ne connaît rien de tout cela : `createObjectURL` puis `click()` ne dépendent d'aucune activation.

### L'angle mort du test de bout en bout

Le presse-papier n'est jamais relu : CDP refuse la permission presse-papier à une origine `chrome-extension://` (`acceptance-report.md:35`).
Ce que le clic produit réellement n'a donc jamais été vérifié, seul l'accusé affiché l'était.
Un téléchargement est observable : `page.waitForEvent('download')` rend le nom proposé **et** le contenu du fichier.
Le rapport lui-même devient assertable de bout en bout.

## ⚠️ Le risque, et comment on le tranche

> [!WARNING]
> Un popup Chrome se ferme dès qu'il perd le focus, et le blob meurt avec son document.

Si Chrome n'a pas fini de lire le blob quand la popup se referme, le fichier n'arrive jamais.
En pratique le processus de téléchargement s'empare des données au clic, et un blob sans `saveAs` n'ouvre aucun dialogue qui volerait le focus.
C'est une affirmation à vérifier, pas à supposer.

Le test de bout en bout attend l'événement `download` et lit le fichier : il tranche.
S'il ne vient pas, le repli est `chrome.downloads`, c'est-à-dire la permission écartée plus haut — donc un retour vers l'utilisateur, pas une décision prise seul.
Dans le code, la révocation du blob URL reste différée, jamais synchrone après le clic.

> [!NOTE]
> **Tranché le 2026-08-11 : le blob tient.** L'événement `download` arrive, le fichier est écrit, son contenu est relu et confronté au rapport attendu — suite complète verte, 74 tests.
> L'ancre n'a même pas besoin d'être attachée au document. `chrome.downloads` n'est pas sollicité, le manifest ne bouge pas.

## 📄 Le nom du fichier

```text
vigie-intranet.twimm.xyz-2026-08-11-153922.md
```

Format : `vigie-<domaine>-<AAAA-MM-JJ>-<HHMMSS>.md`.

| Choix | Raison |
| --- | --- |
| Domaine en tête | Ce qu'on reconnaît dans une liste |
| Instant en UTC | Même référentiel que le rapport |
| Pas de `:` | Interdit sous macOS et Windows |

Le domaine est assaini : tout ce qui sort de `[a-z0-9.-]` devient `-`, ce qui couvre les IDN et les adresses IP.
L'instant vient de `bundle.window.frozenAt` (`report.ts:92`), pas de l'heure locale : le rapport horodate tout son contenu en ISO UTC, et deux référentiels dans un même document se contrediraient à la lecture.
Deux exports dans la même seconde produisent le même nom et Chrome suffixe `(1)` — sans la permission `downloads`, la résolution des collisions ne nous appartient pas.

## 🔧 Les étapes

| # | Fichier | Action |
| --- | --- | --- |
| 1 | `export/filename.ts` | Créer `reportFilename(bundle)` |
| 2 | `export/clipboard.ts` | Remplacer par `download.ts` |
| 3 | `popup/state.ts` | Renommer et reformuler l'accusé |
| 4 | `popup/CopyFeedback.tsx` | Devient `ExportFeedback.tsx` |
| 5 | `popup/App.tsx` | Appeler `downloadReport` |
| 6 | `packages/contract/src/report.ts` | Corriger le commentaire ligne 146 |
| 7 | `state.test.ts`, `filename.test.ts` | Suivre les nouvelles phrases |
| 8 | `e2e/specs/*.spec.ts` | Asserter sur le téléchargement |
| 9 | Documents de référence | Retirer le presse-papier |

### Étape 2 — `downloadReport`

Signature : `downloadReport(markdown, filename): DownloadOutcome`.
Un contexte sans `document` ni `URL.createObjectURL` retourne un échec plutôt que de lever.

### Étape 3 — le vocabulaire de l'accusé

`CopyOutcome` devient `DownloadOutcome`, `copyAcknowledgement` devient `downloadAcknowledgement`, `CopyFeedbackView` devient `ExportFeedbackView`.
Ce qui est parti n'est plus dans un presse-papier invisible : c'est un fichier qui porte un nom, et ce nom est la première chose que l'accusé doit dire.

### Étape 4 — le bouton qui disparaît

Icônes `FileDown`, `LoaderCircle`, `FileCheck2`, `FileX2`.
Le bouton « Copy again » et la prop `retryDepth` sont supprimés : leur raison d'être était l'activation transitoire perdue, qui n'existe plus.
Un nouvel essai, désormais, c'est le bouton Export.

### Étape 8 — ce que les tests gagnent

Le test de refus presse-papier devient un test de téléchargement.
S'y ajoute une assertion neuve : le contenu du fichier téléchargé est lu et confronté au rapport attendu.

### Étape 9 — les documents à amender

`spec.md:5`, `:15`, `:41` · `prd.md:26`, `:74` · `cws-submission.md:113` · `memory/codebase-map.md:36` · `memory/project-brief.md:30` · `INSTALL.md:32`, `:76`, `:128`.

`cws-submission.md:113` affirme que « la seule sortie est le presse-papier ».
La phrase devient fausse, et c'est une déclaration faite au Chrome Web Store.

S'y ajoute `docs/privacy-policy.md:40` et `:68`, absent de la liste ci-dessus : la politique de confidentialité publiée sur GitHub Pages annonce elle aussi le presse-papier comme seule sortie.
C'est le document que l'examinateur du Chrome Web Store lit en premier.

Les documents de phase déjà exécutés (`phase-7.md`, `phase-8.md`, `phase-11.md`) ne sont pas réécrits : ce sont des archives de ce qui a été fait.
L'amendement est consigné ici.

## 🔒 Ce qui ne bouge pas

- Le rendu Markdown : `renderReport` produit exactement le même texte.
- Le geste : une profondeur, un clic, rien entre les deux (`spec.md:41`).
- Le manifest : aucune permission ajoutée.
- Le service worker : il rend toujours le rapport et le renvoie à la popup.

## ✅ Validation

```bash
turbo typecheck lint test build
playwright test
```

Le test qui décide : un clic sur Export produit un événement `download` dont le fichier, une fois lu, contient l'en-tête du rapport.
