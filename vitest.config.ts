import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror vite.config.ts: the app imports `@/...` for src.
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  test: {
    // Vendored reference repositories under _ref/ contain their own test suites;
    // RPNow only owns src/.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['_ref/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    testTimeout: 15000,
    pool: 'forks',
  },
});
