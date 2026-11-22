/**
 * Vitest configuration for `@votion/sync-client`.
 *
 * The Dexie persistence + outbox layers run against `fake-indexeddb`, so the
 * full offline → reconnect → replay lifecycle is exercised in CI without a
 * browser. `setupFiles` installs the in-memory IndexedDB polyfill and the
 * minimal `window` surface the sync manager listens on.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
