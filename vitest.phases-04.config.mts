import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const fromRoot = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

/**
 * Plugin: transpile .ts files with the TypeScript compiler instead of oxc.
 *
 * oxc (bundled with vite 8.3.2) cannot parse TypeScript 6.0's `readonly Array<T>`
 * syntax. This plugin transpiles .ts files using `tsc` before oxc sees them.
 */
function tsTranspiler() {
  const fileRegex = /\.ts$/;
  return {
    name: 'ts-transpiler',
    enforce: 'pre' as const,
    test: {
      include: ['**/*.ts'],
    },
    transform(code: string, id: string) {
      if (!fileRegex.test(id)) return null;

      const result = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
          allowJs: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
        fileName: id,
      });

      return {
        code: result.outputText,
        map: null,
      };
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      // Subpaths before their package root — see vitest.config.mts for why the
      // object form would otherwise rewrite `@akane/platform/otel` into
      // `.../index.ts/otel`.
      '@akane/kernel': fromRoot('./packages/kernel/src/index.ts'),
      '@akane/platform/otel': fromRoot('./packages/platform/src/otel/index.ts'),
      '@akane/platform/crypto': fromRoot('./packages/platform/src/crypto/index.ts'),
      '@akane/platform': fromRoot('./packages/platform/src/index.ts'),
      '@akane/contract': fromRoot('./packages/contract/src/index.ts'),
      '@akane/domain': fromRoot('./packages/domain/src/index.ts'),
    },
  },
  plugins: [tsTranspiler()],
  test: {
    environment: 'node',
    include: [
      'packages/**/links/**/*.spec.ts',
      'packages/**/dsl/**/*.spec.ts',
      'apps/api/src/read/**/*.spec.ts',
      'apps/api/src/common/metrics/**/*.spec.ts',
      'apps/api/src/common/filters/**/*.spec.ts',
      'apps/renderer/src/read/**/*.spec.ts',
      'packages/contract/src/links/**/*.spec.ts',
      'packages/**/__tests__/**/*.spec.ts',
    ],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
