# Soumission Chrome Web Store — Vigie 0.1.0

> Ce que le formulaire de soumission attend, champ par champ, et la justification de chaque
> permission. Le document est en français ; **les blocs de code sont les chaînes à coller telles
> quelles** dans le tableau de bord, qui n'accepte que l'anglais.

## Ce que l'on soumet

| Champ | Valeur |
| --- | --- |
| Nom | `Vigie` |
| Version | `0.1.0` — lue depuis `apps/extension/package.json:3` par WXT |
| Paquet | `apps/extension/.output/vigieextension-0.1.0-chrome.zip`, 223 ko, produit par `pnpm turbo zip` |
| Catégorie | Developer Tools |
| Langue de la fiche | English |
| Visibilité | **Non répertoriée** — voir ci-dessous |

⚠️ **Le produit est en test, pas en sortie.** La version le dit — `0.1.0`, et rien ne passera à `1.0`
avant qu'une heure sur une application réelle et une lecture du rapport par un agent aient été
faites. Une fiche publique invite des utilisateurs qui n'ont pas signé pour de l'alpha, sur une
extension qui capte des jetons de session en clair (`spec.md:34`). La visibilité de la première
soumission est donc **non répertoriée** : l'extension s'installe par lien, par les seules personnes
à qui on l'a donné. Le passage en public est une décision distincte, prise après la recette.
| Politique de confidentialité | `docs/privacy-policy.md`, à publier sur GitHub Pages ⏳ |
| Compte développeur | frais unique de 5 USD, non réglé ⏳ (`deployment.md:31`) |

Le paquet a été chargé sur un profil Chrome neuf : le service worker démarre, les quatre surfaces
montent (`consent`, `popup`, `options`, `sidepanel`), et `chrome.permissions.getAll()` renvoie
`{"origins":[],"permissions":["activeTab","storage","webRequest","scripting","sidePanel"]}` — aucun
accès hôte détenu à l'installation.

## Objectif unique

Le Chrome Web Store exige une raison d'être unique, et refuse les extensions qui en cumulent
plusieurs. Celle de Vigie tient en une phrase : capturer le contexte technique d'un onglet pour le
remettre sous forme de rapport.

```text
Vigie records the technical context of the tab you are debugging — network traffic, console output
and JavaScript errors — on the domains you explicitly designate, and hands it back as a Markdown
report you can paste into a ticket or into an AI assistant. It exists so that a bug already observed
can be reported without being reproduced first.
```

## Justification des permissions

Deux permissions déclenchent l'examen manuel : `webRequest` et les permissions d'hôte. La clause
« Minimum Permission » attend, pour chacune, la démonstration qu'aucune permission plus étroite ne
suffirait.

### `webRequest`

```text
Vigie's core function is capturing the network activity of a tab so it can be reported after the
fact. webRequest is the only API that observes requests a page makes without modifying them. Vigie
registers observational listeners only — no blocking handler, no declarativeNetRequest rule, no
redirect. Events are filtered against the user's watched-domain list before anything is written, so
requests from any other site are discarded in the listener and never stored.
```

⚖️ **La contrepartie assumée** : `webRequest` livre les événements de tous les onglets, y compris
hors portée. Le filtrage est donc applicatif, sur le chemin d'écriture et nulle part ailleurs
(`storage/write.ts:121`). C'est ce que la seconde barrière — l'absence d'accès hôte — rend
inoffensif : sans hôte accordé, les en-têtes ne sont pas livrés.

### Permissions d'hôte, optionnelles et par domaine

```text
Vigie declares no static host permissions. Host access is requested one domain at a time, at the
moment the user adds that domain to the watched list, and is revocable from chrome://extensions.
This is what enforces the product's promise in the browser rather than in our code: a domain the
user never designated is a domain Chrome never grants access to, so its request headers are never
delivered to the extension in the first place.
```

`optional_host_permissions: ['*://*/*']` est large **en déclaration** parce que le domaine visé
n'est pas connu à la compilation ; ce qui est effectivement accordé, à tout instant, est la liste
que l'utilisateur a constituée. L'installation n'accorde rien — vérifié ci-dessus.

### Les trois autres

| Permission | Justification à coller |
| --- | --- |
| `storage` | `Holds the capture itself, the watched-domain list, and the record that the disclosure was agreed to. All of it stays in the local profile.` |
| `scripting` | `Registers the console and error capture as a main-world content script, and only on domains the user has designated and the browser has granted. It carries no warning of its own: it is bounded by the host permissions actually held.` |
| `activeTab` | `Lets the popup name the domain of the tab it was opened on. Without it the browser withholds tab.url for tabs the extension has no host access to — which is exactly the out-of-scope tab — and the offer to watch a site could not say which site. Strictly narrower than the tabs permission, which would disclose every tab's address at all times.` |
| `sidePanel` | `Opens the reading surface that shows what is currently being captured on the active tab.` |

## Déclarations d'usage des données

Le formulaire demande de cocher les catégories collectées, puis de signer trois engagements.

| Catégorie | Collectée ? | Note |
| --- | --- | --- |
| Informations personnelles identifiables | **Oui** | Les en-têtes captés peuvent porter des jetons de session et des identifiants |
| Contenu de site web | **Oui** | URL, en-têtes, sorties console et piles d'appel des domaines désignés |
| Activité utilisateur | Non | Aucun clic, aucune frappe, aucun mouvement n'est enregistré |
| Santé, finance, localisation, communications, historique de navigation | Non | — |

⚡ **Point d'attention pour l'examen** : cocher « informations personnelles identifiables » est
obligatoire ici et sera lu attentivement. La réponse est que rien ne quitte la machine — il n'y a
pas de transmission, donc pas de destinataire. Les trois engagements du formulaire sont tenus par
construction :

- **Pas de vente à des tiers** — aucune donnée ne sort du profil navigateur.
- **Pas d'usage étranger à la fonction annoncée** — la capture n'alimente que le rapport.
- **Pas d'usage pour la solvabilité ou le crédit** — sans objet.

## Ce que l'examinateur va chercher, et où c'est

| Question probable | Réponse, et sa preuve |
| --- | --- |
| « Où part la donnée ? » | Nulle part. Aucun `fetch` ni `XMLHttpRequest` vers un hôte tiers dans le code de l'extension ; la seule sortie est le presse-papier, à la demande. |
| « Le consentement précède-t-il la capture ? » | Oui, verrou sur le chemin d'écriture (`storage/write.ts:121`), pas sur la surface. Un domaine surveillé mais parcouru avant l'accord ne laisse rien (`consent-flow.spec.ts:121`). |
| « L'utilisateur peut-il tout effacer ? » | Oui, depuis les réglages, et le retrait d'un domaine efface ce qui le concernait (`watched-domains.ts:116`). |
| « Pourquoi `*://*/*` ? » | Déclaration optionnelle seulement ; rien n'est accordé à l'installation. |

## Ce qui reste avant de pouvoir soumettre

| # | Reste à faire | Qui |
| --- | --- | --- |
| 1 | Publier `docs/privacy-policy.md` sur GitHub Pages et vérifier l'URL publique | humain |
| 2 | Créer le compte développeur et régler les 5 USD | humain |
| 3 | Rédiger la fiche : captures d'écran, icône de la boutique, description longue | humain |
| 4 | Terminer la recette manuelle — `acceptance-report.md`, critères ⏳ | humain |
| 5 | **Accord explicite avant soumission** | humain |

🔒 **La soumission n'est pas réversible en pratique.** Le Chrome Web Store n'offre pas de retour
arrière immédiat, et une correction repasse par un examen de plusieurs jours (`deployment.md:38`).
Rien n'est soumis sans accord explicite, conformément à `phase-11.md:120`.
