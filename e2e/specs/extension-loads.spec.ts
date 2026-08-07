import { expect, test } from '../fixtures/extension';

test('the unpacked build loads and its service worker starts', async ({
  context,
  extensionId,
}) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  expect(context.serviceWorkers()).toHaveLength(1);
});

test('the popup mounts', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(popup.getByTestId('popup-root')).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'Vigie' })).toBeVisible();
});

test('the manifest declares no static host permission', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/manifest.json`);
  const manifest = JSON.parse(await page.locator('body').innerText()) as {
    permissions?: string[];
    host_permissions?: string[];
    optional_host_permissions?: string[];
  };

  // The product claims capture happens only on designated domains. A static host permission
  // would hand the extension every site at install time and break that claim at its root.
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toEqual(['*://*/*']);
  expect(manifest.permissions).toEqual(expect.arrayContaining(['storage', 'webRequest']));
});
