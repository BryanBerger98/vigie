# Project Brief

What this project is, the problem it solves, and its domain language. The non-derivable "why", not the "how".

## What it is

- A Chrome extension that continuously captures a browser session's technical context — network traffic, console output, JS errors, application state — and turns it into a bug report a developer or an AI can act on directly.
- Capture runs only on the domains the user has explicitly designated. Everywhere else, Vigie observes nothing.
- Ships alongside an embeddable JS SDK (`@vigie/sdk`) that host applications install to enrich the capture with business context.
- Screen recording is a separate, deliberate action — start, reproduce, stop, download — and is not part of the export.
- Audience: B2B product owners, QA engineers, and developers debugging their own applications.

## Why it exists

- A bug report is normally written after the fact, from memory, and is missing exactly the evidence needed to reproduce it. Vigie removes the "reproduce it while recording" step for technical context: up to the last hour is already there when the bug appears.
- An unanticipated bug will never have video, and that is accepted. Video requires knowing in advance that the bug is coming; technical context does not.
- No browser API can infer what environment, user, or backend version the application was running under. That is why the SDK exists — it is the only source for business context.

## Domain language

The terms a contributor must know to read the code.

| Term | Meaning |
| ---- | ------- |
| rewind | The core promise: the past hour of technical context is already captured, with no prior user action. It covers text only, never video. |
| watched domain | A domain the user added in the options. Context capture runs there and nowhere else. |
| export window | How far back a single export reaches — 5, 15, 30, or 60 minutes. One hour is a hard ceiling. |
| recording | A screen recording bounded by the user: start, stop, download. Not a buffer, and not attached to the export. |
| capture layer | One of the three observation sources: SDK, `chrome.webRequest`, `chrome.debugger`. Each has blind spots the others cover. |
| bundle | The assembled report — context, network log, console log — rendered as Markdown and downloaded as a file. |
| schema version | The version of the event contract shared between SDK and extension. An SDK newer or older than the extension is detected through it. |

## Key features

- Always-on context capture on watched domains: network traffic, console output, JS errors, and application state.
- One-click export, scoped to the active tab, over the chosen window. No description field, no form, no triage.
- Everything inside the window is exported, unsorted and unfiltered.
- Screen recording as a separate manual action, downloaded as a file for a human viewer. Never sent to an AI.
- Three-layer capture strategy so no single API's blind spot loses data.
- Export in a Markdown shape an AI can consume directly.
- First-run consent screen disclosing screen video, raw network payloads, and console content.

## First slice

The initial version is browser context only: `chrome.webRequest`, console capture, rolling storage, Markdown export. No SDK, no video, no `chrome.debugger`. It proves the report carries value before any of the expensive surfaces are built.

## Deliberate non-goals

- No backend, no accounts, no telemetry. Everything stays on the machine.
- No capture outside watched domains. Personal browsing is never observed.
- No redaction in the MVP. Export is raw — an accepted risk, tracked as v2 debt, to revisit before any regulated-industry customer.
- No "always-on invisible recorder". Video never starts without an explicit user action, and Chrome shows its own indicator throughout.
- No human input at export time. The intent behind a bug is written wherever the report lands, not inside Vigie.
