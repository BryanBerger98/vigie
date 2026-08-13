import type { MessageKey } from '../registry';

/**
 * The French catalog.
 *
 * `Partial` is the whole point of the annotation: a missing key has to be a hole the fallback
 * fills, not a compilation error that would force a placeholder sentence to be written. A hole
 * shows English; a placeholder shows a lie in French.
 *
 * The wording comes from the glossary frozen before the first translated string
 * (`aidd_docs/tasks/2026_08/2026_08_13_ui-language/glossaire.md`). One term, one equivalent, on
 * every surface — two translations of one term read as two notions.
 */

export const code = 'fr';

export const label = 'Français';

export const messages: Partial<Record<MessageKey, string>> = {
  'common.loading': 'Chargement…',

  'language.title': 'Langue',
  'language.description': "Vigie suit le navigateur tant qu'aucune langue n'est choisie ici.",
  'language.automatic': 'Automatique',
  'language.automatic.detected': 'Automatique — {language}',

  'consent.heading': 'Ce que Vigie enregistre',
  'consent.promise':
    "Vigie conserve la dernière heure de ce que fait votre navigateur sur les domaines que vous désignez, pour que vous puissiez transmettre le contexte d'un bug déjà survenu au lieu d'essayer de le reproduire.",
  'consent.captured.title': 'Ce que Vigie capte',
  'consent.captured.network.title': 'Trafic réseau',
  'consent.captured.network.body':
    "Chaque requête émise par un onglet surveillé : son url, sa méthode, son code de statut, ses temps, et ses en-têtes de requête et de réponse bruts. Ces en-têtes portent des jetons d'authentification, des cookies de session et des clés d'API. Les corps de réponse ne sont captés que lorsque la capture profonde est active : elle reste éteinte tant que vous ne la démarrez pas depuis le popup, et elle enregistre alors le texte des réponses reçues par un onglet surveillé, jusqu'à 256 kB chacune.",
  'consent.captured.console.title': 'Sortie console',
  'consent.captured.console.body':
    "Tout ce que la page écrit dans la console — log, info, warn, error et debug — avec ses arguments sérialisés en texte. Ce qu'une application journalise, y compris des données sur les personnes qui l'utilisent, est enregistré exactement tel qu'il a été journalisé.",
  'consent.captured.error.title': 'Erreurs JavaScript',
  'consent.captured.error.body':
    'Exceptions non rattrapées et rejets de promesse non traités, avec leur message et leur trace de pile.',
  'consent.limits.title': 'Ce qui la borne',
  'consent.limit.local.title': 'Rien ne quitte cette machine',
  'consent.limit.local.body':
    "Vigie n'a ni serveur, ni compte, ni télémétrie. Ce qu'elle enregistre reste dans ce profil de navigateur jusqu'à ce que vous exportiez un rapport vous-même.",
  'consent.limit.scope.title': 'Rien en dehors des domaines que vous désignez',
  'consent.limit.scope.body':
    "La capture n'a lieu que sur les domaines que vous ajoutez, et seulement tant que le navigateur en accorde l'accès à Vigie. Tout autre site n'est jamais observé ni stocké.",
  'consent.limit.hour.title': "Rien de plus vieux d'une heure",
  'consent.limit.hour.body':
    "Tout ce qui a été capté il y a plus d'une heure est supprimé. Vous pouvez aussi tout effacer en une fois depuis les paramètres, à tout moment.",
  'consent.policy': 'Politique de confidentialité',
  'consent.accept': "J'accepte — démarrer la capture",
  'consent.accept.until': "D'ici là Vigie ne capte rien, sur aucun site.",
  'consent.accepted': 'Accepté le {date}. Vigie capte sur les domaines que vous désignez.',
  'consent.accepted.options': 'Choisir les domaines à surveiller',
  'consent.stale':
    "Ce que Vigie capte a changé depuis votre dernier accord. La capture est arrêtée tant que vous n'avez pas lu le texte mis à jour ci-dessous.",

  'consent.gate.title': "Vigie n'a pas commencé à capter",
  'consent.gate.body':
    "Rien n'est capté tant que vous n'avez pas lu ce que Vigie enregistre et ne l'avez pas accepté.",
  'consent.gate.stale.title': 'Ce que Vigie capte a changé',
  'consent.gate.stale.body':
    "Rien n'est capté tant que vous n'avez pas lu la divulgation mise à jour et ne l'avez pas acceptée.",
  'consent.gate.open': 'Lire ce que Vigie enregistre',

  'options.intro':
    "Vigie ne capte que sur les domaines listés ci-dessous, et seulement tant que le navigateur lui en accorde l'accès.",
  'options.disclosure.open': 'Ouvrir la divulgation complète',

  'domains.title': 'Domaines surveillés',
  'domains.empty': "Aucun domaine n'est surveillé pour l'instant. Rien n'est capté.",
  'domains.access.granted': 'Accès accordé',
  'domains.access.missing': 'Accès manquant — accordez-le à nouveau pour capter',
  'domains.remove': 'Retirer {domain}',
  'domains.remove.warning':
    "Retirer {domain} révoque son accès et efface tout ce qui a été capté pour lui. C'est irréversible.",
  'domains.remove.confirm': 'Retirer et effacer',
  'domains.remove.cancel': 'Annuler',
  'domains.add.label': 'Domaine à surveiller',
  'domains.add.submit': 'Ajouter',
  'domains.add.invalid': "« {value} » n'est pas un domaine. Essayez example.com, ou collez une URL.",
  'domains.add.refused': "Chrome n'a pas accordé l'accès à {domain}, il n'a donc pas été ajouté.",
  'domains.add.failed': 'Une erreur est survenue en ajoutant « {value} ».',

  'store.title': 'Ce qui est stocké en ce moment',
  'store.count': 'Entrées conservées',
  'store.bytes': 'Espace occupé',
  'store.oldest': 'Entrée la plus ancienne',
  'store.oldest.none': 'rien de stocké',
  'store.oldest.recent': "il y a moins d'une minute",
  'store.oldest.minutes': 'il y a {count} min',
  'store.oldest.hours': 'il y a {count} h',
  'store.empty': "Rien n'a encore été capté. Vigie n'écrit que lorsqu'un domaine surveillé est ouvert.",
  'store.retention':
    "Tout ce qui a été capté il y a plus de {minutes} minutes est supprimé de lui-même. Tout effacer ci-dessous n'arrête pas la capture : les domaines surveillés le restent, et l'heure suivante repart de zéro.",
  'store.purge': 'Tout effacer',
  'store.purge.failed': "Impossible d'effacer la capture : {reason}",
  'store.refresh': 'Actualiser',
  'store.entries.one': '{count} entrée',
  'store.entries.other': '{count} entrées',

  'scope.loading': 'Lecture du périmètre de cet onglet…',
  'scope.none.label': 'Aucune page à rapporter',
  'scope.none.detail':
    "Cette fenêtre n'a aucune page web ouverte, il n'y a donc aucune capture à exporter.",
  'scope.out.label': 'Hors périmètre',
  'scope.out.detail':
    "{host} n'est pas surveillé. Rien sur cet onglet n'est capté, et rien d'avant sa mise sous surveillance ne pourra jamais être exporté.",
  'scope.out.watch': 'Surveiller {domain}',
  'scope.revoked.label': 'Dégradé — accès révoqué',
  'scope.revoked.detail':
    "{domain} est toujours dans la liste surveillée, mais Chrome ne lui accorde plus l'accès, donc rien n'est capté. Accordez-le à nouveau depuis les paramètres.",
  'scope.shrunk.label': 'Dégradé — fenêtre raccourcie',
  'scope.shrunk.detail':
    '{domain} est capté, mais la pression de stockage a évincé les entrées les plus anciennes : {minutes} min sont conservées au lieu de 60.',
  'scope.capturing.label': 'Capture en cours',
  'scope.capturing.detail.one': '{domain} est surveillé. {count} entrée captée sur cet onglet.',
  'scope.capturing.detail.other': '{domain} est surveillé. {count} entrées captées sur cet onglet.',

  'popup.settings': 'Ouvrir les paramètres',
  'popup.sidepanel': 'Inspecter en direct',
  'popup.context.none': 'Aucun onglet sélectionné.',
  'popup.context.empty':
    "{domain} · onglet {tabId} · rien n'a encore été capté sur cet onglet, un rapport sortirait vide.",
  'popup.context.held.one':
    '{domain} · onglet {tabId} · {minutes} min disponibles, {count} entrée sur cet onglet.',
  'popup.context.held.other':
    '{domain} · onglet {tabId} · {minutes} min disponibles, {count} entrées sur cet onglet.',

  'interruption.label': 'Capture interrompue',
  'interruption.detail': 'Vigie a été mise à jour, et la mise à jour a arrêté la capture en cours.',

  'export.title': "Profondeur d'export",
  'export.run': 'Exporter {minutes} min',
  'export.menu': 'Choisir une autre profondeur',
  'export.depth': '{minutes} min',
  'export.depth.locked': 'exige {previous} min de capture, {held} min conservées',
  'export.no-subject': "Cette fenêtre n'a aucune page web à rapporter.",
  'export.idle.headline': "Aucun export pour l'instant",
  'export.idle.detail':
    'Un clic, et le rapport arrive dans vos téléchargements sous forme de fichier Markdown.',
  'export.working.headline': 'Découpe des {minutes} dernières min…',
  'export.failed.headline': "Échec de l'export",
  'export.refused.headline': 'Non enregistré',
  'export.refused.detail':
    "Le rapport est prêt, mais le navigateur a refusé de l'écrire : {reason}",
  'export.saved.headline': '{filename} enregistré',
  'export.saved.empty':
    "Rien n'a été capté sur cet onglet durant les {minutes} dernières min, le rapport est donc vide.",
  'export.saved.entries.one': '{count} entrée.',
  'export.saved.entries.other': '{count} entrées.',
  'export.saved.shorter':
    'Il couvre {covered} min, pas les {requested} min demandées : la capture ne remonte pas plus loin.',
  'export.saved.gaps': 'Déclaré dans le rapport : {gaps}.',

  'export.gap.response-bodies-unavailable': 'aucun corps de réponse sans la capture profonde',
  'export.gap.browser-messages-out-of-reach': 'aucun message généré par le navigateur',
  'export.gap.capture-started-after-page-load': 'rien avant le chargement de la page',
  'export.gap.window-shrunk-by-quota': 'fenêtre raccourcie par la pression de stockage',

  'deep.unavailable.label': 'Capture profonde indisponible',
  'deep.unavailable.version':
    'Chrome {version} ne peut pas maintenir la capture en arrière-plan. Les corps de réponse exigent Chrome {required} ou plus récent.',
  'deep.unavailable.browser':
    "Ce navigateur n'est pas un Chrome, la capture des corps de réponse ne peut donc pas y fonctionner. Tout le reste continue de fonctionner.",
  'deep.canceled.label': 'Capture profonde arrêtée depuis le bandeau',
  'deep.canceled.detail':
    "Vous avez annulé depuis le bandeau Chrome, ce qui a mis fin à toutes les sessions d'un coup. Rien ne se rattachera de soi-même — redémarrez-la quand vous la voudrez de nouveau.",
  'deep.active.label': 'Capture profonde active',
  'deep.active.detail.one':
    "Les corps de réponse sont captés sur {count} onglet surveillé. Le bandeau Chrome reste affiché jusqu'à ce que vous l'arrêtiez.",
  'deep.active.detail.other':
    "Les corps de réponse sont captés sur {count} onglets surveillés. Le bandeau Chrome reste affiché jusqu'à ce que vous l'arrêtiez.",
  'deep.stopped.label': 'Capture profonde éteinte',
  'deep.stopped.detail':
    "Les requêtes sont captées, pas leurs corps de réponse. L'activer attache le débogueur Chrome à chaque onglet surveillé, et Chrome affiche un bandeau dessus jusqu'à ce que vous l'arrêtiez.",
  'deep.start': 'Démarrer la capture profonde',
  'deep.stop': 'Arrêter la capture profonde',
  'deep.start.failed': 'Impossible de la démarrer : {reason}',
  'deep.stop.failed': "Impossible de l'arrêter : {reason}",

  'thread.empty':
    "Rien de capté sur cet onglet depuis une heure. La suite apparaîtra ici d'elle-même.",
  'thread.older.one': 'Afficher les plus anciennes — {count} autre entrée dans cette fenêtre',
  'thread.older.other': 'Afficher les plus anciennes — {count} autres entrées dans cette fenêtre',
  'thread.edge.kept': 'Début de la fenêtre — une heure',
  'thread.edge.kept.detail':
    'Vigie conserve une heure. Tout ce que cet onglet a fait avant ce point a été purgé — une suppression, pas un trou dans la capture.',
  'thread.edge.shortened': 'Début de la fenêtre — raccourcie',
  'thread.edge.shortened.detail':
    "La pression de stockage a évacué les plus anciennes entrées en avance : ce fil ne remonte qu'à {minutes} min au lieu de {floor}. Ce qui précédait a été purgé.",

  // Les formes courtes du glossaire, pas les formes longues : la colonne des termes est figée à
  // 7.5rem, et « en-têtes de requête » y passe à la ligne.
  'entry.term.outcome': 'issue',
  'entry.term.url': 'url',
  'entry.term.request-headers': 'en-têtes requête',
  'entry.term.request-body': 'corps requête',
  'entry.term.response-headers': 'en-têtes réponse',
  'entry.term.response-body': 'corps réponse',
  'entry.term.level': 'niveau',
  'entry.term.text': 'texte',
  'entry.term.note': 'note',
  'entry.term.source': 'source',
  'entry.term.message': 'message',
  'entry.term.stack': 'pile',

  'entry.label.failed': 'échec',
  'entry.label.pending': 'en cours',
  'entry.label.no-status': 'sans statut',

  'entry.outcome.failed': 'échec{duration} : {error}{type}',
  'entry.outcome.pending': 'toujours ouverte{type}',
  'entry.outcome.completed': 'terminée {status}{duration}{type}',
  'entry.outcome.duration': ' en {ms} ms',
  'entry.outcome.unknown-error': '(inconnue)',
  'entry.outcome.no-status': '(sans statut)',

  'entry.body.captured': 'capté, entier',
  'entry.body.truncated': 'capté, coupé au plafond de capture',
  'entry.body.evicted': 'évincé du tampon de capture avant sa lecture',
  'entry.body.unavailable': "non capté — la capture profonde ne tournait pas sur cet onglet",
  'entry.body.filtered': "non demandé — hors de ce qu'un rapport peut porter",
  'entry.body.out-of-session':
    'hors de portée — la requête a chevauché la session de capture profonde',
  'entry.body.unfinished': "jamais livré — la requête ne s'est pas conclue",
  'entry.body.empty': 'capté, vide',
  'entry.no-body': 'sans corps',

  'entry.note.text-truncated': 'texte tronqué par la capture',
  'entry.note.truncated': 'tronquée par la capture',
};
