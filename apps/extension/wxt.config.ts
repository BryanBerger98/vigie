import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    // The two strings the browser itself renders — the extension list, the store listing — come
    // from `public/_locales/`, not from the runtime catalog the four surfaces read. `chrome.i18n`
    // resolves these placeholders once, at load, against the *browser's* language, and accepts no
    // override afterwards: that is what makes it the only way to localise a store listing, and
    // what makes it unusable for a surface whose language the user picks in the settings.
    //
    // The consequence is worth knowing before it is reported as a bug: a browser in English with
    // Vigie set to French shows a French interface and an English description in
    // `chrome://extensions`. Nothing on our side can reconcile the two.
    //
    // `default_locale` is mandatory as soon as a `_locales` directory exists, and it is what an
    // unlisted language falls back to — a German browser reads the English pair.
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // No `version` here on purpose: WXT reads it from `package.json` and only falls back to this
    // field (`wxt/dist/core/utils/manifest.mjs:33`). Declaring it twice is how a store listing ends
    // up announcing a version the workspace never built.
    homepage_url: 'https://github.com/BryanBerger98/vigie',
    author: { email: 'contact@bryanberger.dev' },
    // The side panel is a Chrome 114 API and the product's reading surface depends on it. Stated
    // rather than left to chance: without it the store offers the extension to browsers where
    // `sidePanel.open` does not exist, and the failure would land on the user as a dead button.
    minimum_chrome_version: '114',
    // Required at install time. `webRequest` is observational only under MV3, and `scripting`
    // carries no warning of its own — it is bounded by the host permissions actually granted,
    // which is what lets the console capture be registered domain by domain at runtime.
    //
    // `activeTab` is what lets the popup name the domain it is offering to watch. Without it the
    // browser withholds `tab.url` for every tab the extension has no host access to — which is
    // exactly the out-of-scope tab — and the offer would read "add this site" without saying
    // which. It is granted only for the tab the user invoked the extension on, only until they
    // navigate away, and Chrome shows no permission warning for it: strictly less than `tabs`,
    // which would disclose every tab's address at all times (`spec.md:11`).
    //
    // `sidePanel` opens the live thread. WXT infers it from the entrypoint alone
    // (`wxt/dist/core/utils/manifest.mjs:176`) and dedupes what it adds, so declaring it here
    // changes nothing in the output — it is written down because this list is where someone
    // auditing what Vigie asks the browser for comes to read, and an invisible permission is one
    // they would have to reverse-engineer from a build. It shows no warning at install.
    //
    // This array does not grow once a version is published. Chrome disables an extension until
    // the user accepts a newly added permission that carries a warning, and a disabled extension
    // is a capture the user has to restart by hand — the one thing the resume path is meant to
    // spare them. New capabilities go to `optional_permissions` instead, granted at use time:
    // `offscreen` and `tabCapture` arrive that way.
    //
    // `debugger` cannot, and that is the browser's rule rather than a preference. It shipped here
    // under `optional_permissions` until Chrome was asked for it inside a real click: Chromium
    // 151.0.7922.34 answers "Only permissions specified in the manifest may be requested", and
    // `permissions.getAll()` never lists it — the key is dropped at load while
    // `runtime.getManifest()` goes on reporting it, so nothing signals the gap. A control
    // permission declared in the same array, `downloads`, opens its confirmation bubble on the
    // same click. The earlier measurement that let the optional declaration stand asked without a
    // user gesture and never reached the manifest check.
    //
    // The price is paid at install: the deep layer's warning is shown to every user, including
    // those who never arm it, and the layer is armed by an explicit gesture in the popup rather
    // than by the permission prompt Chrome will not open.
    permissions: ['storage', 'webRequest', 'scripting', 'activeTab', 'sidePanel', 'debugger'],
    // No static `host_permissions`: capture scope is granted domain by domain, at the moment
    // the user adds one. The browser then enforces the scope the product claims, instead of
    // our code alone — and the Chrome Web Store "Minimum Permission" clause asks for the same.
    optional_host_permissions: ['*://*/*'],
    // No `web_accessible_resources`: the page-side patch is registered by the browser as a
    // main-world content script, not fetched by the page, so nothing of ours has to be readable
    // from a site — see `capture/console/registration.ts`.
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
