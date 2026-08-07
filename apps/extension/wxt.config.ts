import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Vigie',
    description:
      'Captures network traffic, console output and JS errors on the domains you designate, and hands you a Markdown report of the active tab.',
    // Required at install time. `webRequest` is observational only under MV3.
    permissions: ['storage', 'webRequest'],
    // No static `host_permissions`: capture scope is granted domain by domain, at the moment
    // the user adds one. The browser then enforces the scope the product claims, instead of
    // our code alone — and the Chrome Web Store "Minimum Permission" clause asks for the same.
    optional_host_permissions: ['*://*/*'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
