import { defineConfig } from 'vitest/config';

/**
 * Vitest config. Pure-module unit tests only — DOM and Worker code is covered
 * end-to-end by Playwright (`npm run test:e2e`). Keep this surface small so
 * the test loop stays sub-second.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lyrics.ts', 'src/tags.ts', 'src/web-share.ts', 'worker/web-push.ts']
    }
  }
});
