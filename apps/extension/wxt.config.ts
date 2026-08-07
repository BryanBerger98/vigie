import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Vigie',
    description:
      'Captures network traffic, console output and JS errors on the domains you designate, and hands you a Markdown report of the active tab.',
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
    permissions: ['storage', 'webRequest', 'scripting', 'activeTab'],
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
