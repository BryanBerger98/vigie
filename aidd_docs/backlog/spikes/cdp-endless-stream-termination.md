---
type: spike
status: open
source: cdp-terminal-event-gap
related_to:
  - contract-response-body-state
---

# Spike: cdp-endless-stream-termination

## Question

Comment se terminent, des deux côtés, les flux sans fin — `EventSource` et `WebSocket` — que le filtre de corps retient, et que devient l'entrée d'une requête qui ne se conclut jamais ?

## Decision

La présence de `EventSource` et `WebSocket` dans le filtre de corps, et le sort de leur entrée dans le chemin d'écriture.

Le choix décide de trois choses. Si ces deux types de ressource restent dans la liste des six pour lesquels un corps est lu, ou s'ils rejoignent les treize qui ne gardent que des métadonnées. Ce que le chemin d'écriture fait d'une requête que ni couche ne conclut, alors qu'il est déclenché par un événement terminal et qu'un flux ouvert n'en produit aucun. Et si la file d'attente de 50 ms retient indéfiniment ce qui ne se résout jamais, ce qui en ferait une fuite mémoire dans le service worker.

Ouvert par le cinquième point de suivi de [[cdp-terminal-event-gap]], qui note que les deux types sont dans le filtre retenu et qu'aucune mesure ne dit comment ils se terminent.

## Bounds

- Evidence needed :
  - Événements CDP émis par un `EventSource` ouvert, pendant sa vie et à sa fermeture, côté page comme côté serveur. [[cdp-session-boundaries]] a déjà observé qu'un flux SSE ouvert au moment de l'attachement produit `dataReceived` et rien d'autre ; ce qui manque est le comportement d'un flux annoncé pendant la session.
  - Ce que `webRequest` rapporte du même flux, et quand. C'est la couche qui déclenche l'écriture, donc c'est son silence ou son signal qui décide du sort de l'entrée.
  - Ce que `getResponseBody` rend sur un flux encore ouvert. Le message `No data found for resource with given identifier` signifie « encore en vol » selon `aidd_docs/memory/architecture.md` — un flux sans fin est le cas où cet état ne se résout jamais.
  - Comportement d'un `WebSocket`, dont le cycle de vie CDP passe par un domaine d'événements distinct de celui d'une requête HTTP, et dont le corps n'a pas la même forme qu'une réponse.
  - Ce que pèse un flux long dans le tampon de ressources et dans l'entrée écrite, aux tailles retenues par [[cdp-body-capture-calibration]].
  - Sort de l'entrée à la fermeture de la session, de l'onglet, et à la fin de la fenêtre glissante d'une heure — un flux peut vivre plus longtemps que la fenêtre qui devrait le contenir.
- Stop when : le comportement terminal des deux types est observé des deux côtés, et le filtre de corps est confirmé ou corrigé pour chacun.
- Hors périmètre :
  - Le contenu applicatif des messages, qui relève du rapport d'incident et non de la capture.
  - Les autres causes d'absence de corps, chiffrées ailleurs.
  - Le long poll, qui se conclut : il est déjà couvert par la lecture du message `No data found for resource with given identifier`.
