# Forms

How forms are built and validated across the UI.

> **State:** no form library is chosen and no form exists. This file records the surface and the constraint, so the choice is made once rather than per panel.

## Approach

- One form surface only: the options page (`apps/extension/src/entrypoints/options/`), holding capture settings — video profile, layer toggles, retention.
- No form library selected. With a single settings panel of a handful of controls, shadcn/ui form primitives over local React state may be enough; a form library is a decision to justify, not a default.

## Conventions

- Settings persist to `chrome.storage`, not to Dexie. Dexie holds capture data; configuration is extension state and must be readable by the service worker at startup.
- Settings apply to the next capture, never retroactively. Changing the video profile mid-session does not re-encode the buffer, and the UI says so.
- The video profile is the one setting with a measured constraint: 1080p/24fps is the default, 720p the documented fallback, and the choice is pending a benchmark — see `architecture.md`.
- The consent screen is not a form. It is a one-way acknowledgement with no editable state.
