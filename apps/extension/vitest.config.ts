import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

/**
 * Unit tests run against WXT's fake browser: `browser` resolves to an in-memory implementation
 * instead of being undefined outside an extension. It also brings the auto-imports and the `@`
 * alias in, so a test imports the module under test exactly as the extension does.
 *
 * Only the storage surfaces are actually implemented by the fake. Anything else — `permissions`
 * above all — throws unless the test spies on it, which is the intended way to state what the
 * browser is supposed to answer.
 */
export default defineConfig({
  plugins: [WxtVitest()],
});
