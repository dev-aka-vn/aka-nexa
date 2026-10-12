import path from 'node:path';
import { fileURLToPath } from 'node:url';

import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

import {
  boundariesDependenciesRule,
  boundariesSettings,
} from './tooling/boundaries.config.mjs';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));
const IMPORT_RESOLVER_PATH = path.join(REPO_ROOT, 'tooling', 'import-resolver.cjs');

/**
 * Phase 1 lint gate (D-05).
 *
 * Only `typescript-eslint` recommended is enabled here. Plan 03 extends this
 * file with `eslint-plugin-boundaries` edges and the scoped
 * `no-restricted-imports` rule (PD-11). `npm run build` depends on
 * `npm run lint`, so any violation fails the build locally and in CI
 * identically — this dependency must not be removed.
 *
 * ## Two things here are load-bearing and easy to "simplify" away
 *
 * 1. `import/resolver` points at the in-repo `tooling/import-resolver.cjs`.
 *    `eslint-plugin-boundaries` classifies an import through
 *    `eslint-module-utils`, which returns `undefined` for any specifier the
 *    resolver cannot map. The default `eslint-import-resolver-node` does not
 *    map NodeNext's `./foo.js` specifier onto `./foo.ts`, so without this the
 *    **entire** rule is inert on a TypeScript/NodeNext tree — and an inert
 *    boundary rule reports zero problems, which is indistinguishable from a
 *    compliant tree.
 * 2. The `from` selectors on the R1/R2/R3 policies use the plugin's
 *    free-form negation and array-query grammars. Both are undocumented in the
 *    plugin README, so `tooling/boundaries.fixture.spec.ts` asserts each one
 *    fires rather than trusting the config by inspection.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.tsbuildinfo',
      'coverage/**',
      // Deliberately-violating fixtures. They exist so the boundary policies
      // can be proven to fire; they must never reach the real build gate.
      'tooling/boundaries-fixtures/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // `_`-prefixed bindings are this repo's marker for a deliberately-unused
    // one: a destructured-away rest sibling (`const { real_user_id, ...rest }`),
    // an argument a handler must accept for its position, a caught error the
    // code intentionally ignores. typescript-eslint's default options do not
    // honour that convention, so every `_x` was reported as a dead variable —
    // the config was missing the pattern, not the code the pattern describes.
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Tests, fixtures and tooling scaffolding. A mocked collaborator is
    // legitimately `any` — typing it precisely describes the mock, not the
    // contract under test — and a test may hold an intentionally-unused binding
    // without that being a defect. Only these two rules are relaxed here; R1's
    // `no-restricted-imports` (below) still applies to `apps/api` and
    // `apps/scheduler`, so a spec cannot construct a BullMQ `Worker` in the
    // request path.
    files: [
      '**/*.spec.ts',
      '**/*.spec.mts',
      '**/__tests__/**/*.ts',
      'tooling/**/*.ts',
      'tooling/**/*.mts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    // FND-04 governs the **deployable** module graph. A test deliberately
    // reaches across element types to construct a fixture — a DSL test builds a
    // `submissions` repository to query, an integration test seeds Mongo with
    // the raw driver — and none of that ships. The proof that the policies fire
    // is `boundaries.fixture.spec.ts`, which runs the real rule against
    // non-test fixtures; excluding `*.spec.ts` here leaves that proof untouched.
    // `*.stub.ts` joins the exclusion for the same reason the entrypoint-drift
    // walk already classifies it as a test artifact, not process code: a stub
    // is a fixture's collaborator (the OIDC issuer stub signs test tokens with
    // an ephemeral in-memory key — no secret, no env, no KMS), and R2's
    // secret-containment target is the deployable signing surface.
    ignores: [
      '**/*.spec.ts',
      '**/*.spec.mts',
      '**/__tests__/**',
      '**/*.stub.ts',
    ],
    plugins: { boundaries },
    settings: {
      ...boundariesSettings,
      'import/resolver': { [IMPORT_RESOLVER_PATH]: null },
    },
    rules: {
      'boundaries/dependencies': boundariesDependenciesRule,
    },
  },
  {
    // R1's named-binding half. `boundaries/dependencies` selects on the module
    // *specifier* and can never see which binding was requested, so the
    // BullMQ `Worker` restriction has to be core ESLint (P1.2/P1.5).
    //
    // Scoped to `api` and `scheduler` only — `apps/worker` is the one process
    // that is supposed to construct a `Worker`.
    files: ['apps/api/src/**/*.ts', 'apps/scheduler/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'bullmq',
              importNames: ['Worker'],
              message:
                'R1: the BullMQ Worker may only be constructed in apps/worker — a Worker in the request path breaks the <200 ms ack budget.',
            },
          ],
        },
      ],
    },
  },
);
