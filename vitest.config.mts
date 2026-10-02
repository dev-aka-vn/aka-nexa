import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@akane/kernel': fromRoot('./packages/kernel/src/index.ts'),
      '@akane/platform': fromRoot('./packages/platform/src/index.ts'),
      '@akane/contract': fromRoot('./packages/contract/src/index.ts'),
      '@akane/domain': fromRoot('./packages/domain/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.spec.ts', 'apps/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
