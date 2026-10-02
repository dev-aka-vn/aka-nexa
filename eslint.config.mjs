import tseslint from 'typescript-eslint';

/**
 * Phase 1 lint gate (D-05).
 *
 * Only `typescript-eslint` recommended is enabled here. Plan 03 extends this
 * file with `eslint-plugin-boundaries` edges and the scoped
 * `no-restricted-imports` rule (PD-11). `npm run build` depends on
 * `npm run lint`, so any violation fails the build locally and in CI
 * identically — this dependency must not be removed.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.tsbuildinfo',
      'coverage/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    rules: {
      // Plan 03 adds boundaries/dependencies and no-restricted-imports here.
    },
  },
);
