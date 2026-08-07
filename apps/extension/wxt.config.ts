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
    permissions: ['storage', 'webRequest', 'scripting'],
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
