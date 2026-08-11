---
title: Vigie — Privacy policy
description: What the Vigie browser extension records, where it stays, and how long it is kept.
---

# Vigie — Privacy policy

**Last updated: 2026-08-11 · Applies to the disclosure wording shipped as version 1.**

Vigie keeps the last hour of what your browser does on the domains you designate, so you can hand
over the context of a bug that already happened instead of trying to reproduce it.

This page states the same thing the extension states before it captures anything. The words below
are the words on the consent screen; if the two ever disagree, the extension is the one that is
wrong and it should be reported as a bug.

## What Vigie captures

### Network traffic

Every request a watched tab makes: its URL, its method, its status code, its timing, and its raw
request and response headers. Those headers carry authentication tokens, session cookies and API
keys. Response bodies are never captured.

### Console output

Everything the page writes to the console — log, info, warn, error and debug — with its arguments
serialised as text. Whatever an application logs, including data about the people using it, is
recorded exactly as it was logged.

### JavaScript errors

Uncaught exceptions and unhandled promise rejections, with their message and their stack trace.

## What bounds it

### Nothing leaves this machine

Vigie has no server, no account and no telemetry. What it records stays in this browser profile
until you export a report yourself.

### Nothing outside the domains you designate

Capture happens only on the domains you add, and only while the browser grants Vigie access to
them. Every other site is never observed and never stored.

### Nothing older than one hour

Anything captured more than an hour ago is deleted. You can also erase everything at once from the
settings, at any time.

## Where the data lives

In the browser profile that runs the extension, in its IndexedDB store, and nowhere else. Vigie
operates no server and contacts none: it has no network permission beyond observing the requests
the watched tabs make on their own.

Two consequences follow, and they are the honest ones:

- **A browser profile that syncs does not sync this.** The capture store is local to the device.
- **Whoever can read your browser profile can read the capture.** Vigie adds no encryption layer of
  its own; it inherits exactly the protection the operating system account and the browser profile
  already provide.

## What leaves, and only when you ask

One thing, one way: the report. Choosing a depth in the popup assembles the matching slice of the
capture into a Markdown document and writes it to your downloads folder, as
`vigie-<domain>-<date>-<time>.md`. Where it goes next is your doing — a ticket, a chat message, a
colleague. The file stays on disk until you delete it.

That report carries what the capture carries, request and response headers included. **Authentication
tokens, session cookies and API keys are therefore in it.** Read a report before sending it
somewhere you would not send a session cookie.

## How long it is kept

One hour, enforced on every write: anything older is deleted as new entries arrive, without waiting
for the browser to be idle or for the extension to be opened.

Three other things erase capture earlier:

| Action | What it erases |
| --- | --- |
| Removing a domain from the watched list | Everything captured on that domain |
| **Erase everything captured**, in the settings | The whole store, immediately |
| Uninstalling the extension | The whole store, with the extension's profile data |

The settings screen shows what is held at any moment: the number of entries, the space they occupy,
the age of the oldest one, and the split per domain. Nothing there is a claim you have to take on
faith — it is read straight off the store.

## Consent

Vigie captures nothing until the disclosure has been read and agreed to. Before that, the write path
refuses every entry, and the popup and settings show the disclosure instead of themselves.

The agreement is tied to the wording, not to the extension. If a future version captures something
this page does not describe, the wording changes, capture stops, and Vigie asks again.

## Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| `webRequest` | Observing the requests a watched tab makes — the network capture itself |
| `storage` | Holding the capture, the watched domain list and your agreement |
| `scripting` | Injecting the console and error capture into watched tabs only |
| `activeTab` | Naming the one tab you opened the popup on, so the report and the offer to watch a site can say which site |
| `sidePanel` | Opening the panel that shows what is being captured on the tab you are looking at |
| Host access, per domain, optional | Granted by you one domain at a time, and revocable from `chrome://extensions` at any time |

Host access is deliberately not requested for all sites. A domain you have not designated is a
domain the browser never hands to Vigie in the first place.

## Third parties

None. No analytics, no crash reporting, no advertising, no data broker, no sale or transfer of any
kind. There is no recipient because there is no transmission.

## Children

Vigie is a developer tool and is not directed at children.

## Contact

Questions, or a discrepancy between this page and what the extension does:
[contact@bryanberger.dev](mailto:contact@bryanberger.dev), or an issue on
[the repository](https://github.com/BryanBerger98/vigie).
