import { fileURLToPath } from 'node:url';
import { defaultExclude, defineConfig } from 'vitest/config';

const fromRoot = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // A subpath must be listed BEFORE its package root: the object form
      // prefix-matches, so `'@akane/platform'` would otherwise swallow
      // `@akane/platform/otel` and rewrite it to `.../index.ts/otel`, which
      // resolves to nothing. That is a trap because the subpath works at runtime
      // — Node resolves it through the package's `exports` map into `dist` — so a
      // spec would fail where the process it is testing succeeds. The trailing
      // `'@akane/x/'` entries that used to sit here were dead for the same
      // reason. Each entry points at the same directory `exports` points at, so a
      // spec imports the source a `main.ts` compiles from.
      '@akane/kernel': fromRoot('./packages/kernel/src/index.ts'),
      '@akane/platform/otel': fromRoot('./packages/platform/src/otel/index.ts'),
      '@akane/platform/crypto': fromRoot('./packages/platform/src/crypto/index.ts'),
      '@akane/platform': fromRoot('./packages/platform/src/index.ts'),
      '@akane/contract': fromRoot('./packages/contract/src/index.ts'),
      '@akane/domain/adapters/teams/inbound/teams-inbound.module.js': fromRoot('./packages/domain/src/adapters/teams/inbound/teams-inbound.module.ts'),
      '@akane/domain/adapters/teams/inbound/data-access/teams-event.repository.js': fromRoot('./packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts'),
      '@akane/domain': fromRoot('./packages/domain/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/*.spec.ts',
      'apps/**/*.spec.ts',
      'tooling/**/*.spec.ts',
      'observability/**/*.spec.ts',
    ],
    // Playwright e2e specs (apps/app-builder/e2e/**) match
    // the include glob but are not vitest specs — they
    // drive a real browser through @playwright/test.
    // Excluding them keeps `npm test` (vitest run) green
    // alongside the Playwright suite.
    exclude: [...defaultExclude, '**/e2e/**'],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
