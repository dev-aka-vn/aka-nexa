/**
 * Day-1 boundary smoke test (FND-04, D-02, D-03, D-32).
 *
 * RESEARCH P1.4 requires this file rather than trusting the config by
 * inspection, because `boundaries/dependencies` has **two** silent
 * non-enforcement modes, and both produce exactly zero messages — the same
 * observable result as "the tree is compliant":
 *
 *  1. The rule gates its whole evaluation on the *target's* origin
 *     (`checkAllOrigins || isLocalDependency` in `Rules/Dependencies.js`), so a
 *     config that forgets `checkAllOrigins` has dead R2/R3 policies that still
 *     read correctly in review.
 *  2. `eslint-module-utils` returns `undefined` for any specifier the resolver
 *     cannot map. The default Node resolver does not map NodeNext's
 *     `./foo.js` onto `./foo.ts`, so without `tooling/import-resolver.cjs`
 *     **every** relative import in this repo is invisible to the rule.
 *
 * `tooling/boundaries.config.mjs` documents a third: the plan's
 * `from: { file: { categories: { noneOf: [...] } } }` selector never matches a
 * file that has *no* category, so R2/R3 as originally specified were inert.
 * The working form (origin-unconstrained disallow, then owner-category allow,
 * relying on last-match-wins) is what these cases pin.
 *
 * So every policy category gets one deliberately-violating source, every
 * compliant source has a sibling violation in the same originating directory
 * (which is what proves the compliant specifier actually resolved rather than
 * being silently skipped), and both are asserted.
 *
 * ## Why the fixture tree
 *
 * `lintText()` supplies the importing file virtually, but the *target* of an
 * import must resolve to a real path for the plugin to classify it as a local
 * element or file category. The fixtures under `tooling/boundaries-fixtures/`
 * mirror the real element paths, and the settings below are the exported ones
 * with every pattern re-rooted at that directory. `eslint.config.mjs` ignores
 * the directory, so the deliberate violations never reach `npm run build`.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import boundaries from 'eslint-plugin-boundaries';
import { describe, expect, it } from 'vitest';
import {
  boundariesSettings,
  boundariesDependenciesRule,
} from './boundaries.config.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_ROOT = 'tooling/boundaries-fixtures';
const RESOLVER_PATH = path.join(REPO_ROOT, 'tooling', 'import-resolver.cjs');

/** POSIX separators, so a path assertion reads the same on every platform. */
const toPosix = (value: string): string => value.split(path.sep).join('/');

/** The exported element types, re-rooted at the fixture tree. */
const FIXTURE_ELEMENTS = boundariesSettings['boundaries/elements'].map(
  (descriptor) => ({
    ...descriptor,
    pattern: `${FIXTURE_ROOT}/${descriptor.pattern}`,
  }),
);

/** The exported file categories, re-rooted at the fixture tree. */
const FIXTURE_FILES = boundariesSettings['boundaries/files'].map((descriptor) => ({
  ...descriptor,
  pattern: `${FIXTURE_ROOT}/${descriptor.pattern}`,
}));

/**
 * `apps/api` and `apps/scheduler` may not construct a BullMQ `Worker`.
 * Core ESLint, not `boundaries`: a boundaries module selector matches the
 * module *specifier* only and can never see a named binding (P1.2/P1.5).
 */
const NO_RESTRICTED_IMPORTS_RULE = [
  'error',
  {
    paths: [
      {
        name: 'bullmq',
        importNames: ['Worker'],
        message:
          'R1: BullMQ Worker may only be constructed in apps/worker — a Worker in the request path breaks the <200 ms ack budget.',
      },
    ],
  },
] as const;

/**
 * @param rule       the `boundaries/dependencies` rule body under test
 * @param useResolver whether `tooling/import-resolver.cjs` is installed. The
 *   backstop tests flip this to prove the resolver is load-bearing.
 */
function createFixtureEslint(
  rule: unknown = boundariesDependenciesRule,
  useResolver = true,
): ESLint {
  return new ESLint({
    // `ignore: false` so the deliberately-violating fixtures are linted here
    // even though `eslint.config.mjs` excludes them from the real build gate.
    ignore: false,
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        plugins: { boundaries },
        settings: {
          'boundaries/elements': FIXTURE_ELEMENTS,
          'boundaries/files': FIXTURE_FILES,
          ...(useResolver ? { 'import/resolver': { [RESOLVER_PATH]: null } } : {}),
        },
        rules: { 'boundaries/dependencies': rule },
      },
      // Mirrors the real config's scoping: `Worker` is restricted in `api` and
      // `scheduler` only, so `apps/worker` stays allowed.
      {
        files: [
          `${FIXTURE_ROOT}/apps/api/src/**/*.ts`,
          `${FIXTURE_ROOT}/apps/scheduler/src/**/*.ts`,
        ],
        rules: { 'no-restricted-imports': NO_RESTRICTED_IMPORTS_RULE },
      },
    ],
  });
}

/** The two entries that must exist on disk as import targets. */
const CASES: ReadonlyArray<{
  readonly name: string;
  readonly file: string;
  readonly code: string;
  readonly ruleIds: readonly string[];
}> = [
  // ---- R1: entrypoint exclusivity, by file category ---- //
  {
    name: 'R1 inbound-adapter imported from app-worker is rejected',
    file: 'apps/worker/src/index.ts',
    code: "import { receiver } from '../../../packages/domain/src/adapters/slack/inbound/receiver.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'R1 http imported from app-scheduler is rejected',
    file: 'apps/scheduler/src/index.ts',
    code: "import { server } from '../../../packages/platform/src/http/server.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'R1 outbound-adapter imported from app-api is rejected',
    file: 'apps/api/src/index.ts',
    code: "import { client } from '../../../packages/domain/src/adapters/slack/outbound/client.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'R1 bullmq-worker imported from app-api is rejected',
    file: 'apps/api/src/index.ts',
    code: "import { processor } from '../../../packages/domain/src/submissions/bullmq/workers/processor.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'R1 scheduler-job imported from app-api is rejected',
    file: 'apps/api/src/index.ts',
    code: "import { rotate } from '../../../packages/platform/src/scheduler/jobs/rotate.js';",
    ruleIds: ['boundaries/dependencies'],
  },

  // ---- R2: secret containment, external module targets ---- //
  {
    name: 'R2 jose imported outside the owning categories is rejected',
    file: 'packages/domain/src/links/index.ts',
    code: "import { SignJWT } from 'jose';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'R2 @aws-sdk/client-kms imported outside the owning categories is rejected',
    file: 'packages/domain/src/links/index.ts',
    code: "import { KMSClient } from '@aws-sdk/client-kms';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'R2 @google-cloud/kms imported outside the owning categories is rejected',
    file: 'packages/domain/src/links/index.ts',
    code: "import { KeyManagementServiceClient } from '@google-cloud/kms';",
    ruleIds: ['boundaries/dependencies'],
  },

  // ---- R3: no direct Mongo outside the data-access layer ---- //
  {
    name: 'R3 mongodb imported outside the owning categories is rejected',
    file: 'packages/domain/src/registry/index.ts',
    code: "import { MongoClient } from 'mongodb';",
    ruleIds: ['boundaries/dependencies'],
  },

  // ---- element-type edges (default: disallow) ---- //
  {
    name: 'a kernel file importing a platform file is rejected',
    file: 'packages/kernel/src/index.ts',
    code: "import { REDIS } from '../../platform/src/index.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'a forms file importing authz (not an allowed edge) is rejected',
    file: 'packages/domain/src/forms/index.ts',
    code: "import { a } from '../authz/index.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'an adapters file importing authz (inbound + outbound only) is rejected',
    file: 'packages/domain/src/adapters/index.ts',
    code: "import { a } from '../authz/index.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'an app importing another app is rejected',
    file: 'apps/api/src/index.ts',
    code: "import { main } from '../../worker/src/index.js';",
    ruleIds: ['boundaries/dependencies'],
  },

  // ---- Resolution canaries ----
  // Each of these shares its originating directory with a COMPLIANT case.
  // An unresolvable specifier yields zero messages, so without a sibling
  // violation the compliant case would pass vacuously — the exact silent
  // non-enforcement this file exists to catch.
  {
    name: 'a platform file importing a domain type (not an allowed edge) is rejected',
    file: 'packages/platform/src/index.ts',
    code: "import { l } from '../../domain/src/links/index.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'an authz file importing forms (not an allowed edge) is rejected',
    file: 'packages/domain/src/authz/index.ts',
    code: "import { f } from '../forms/index.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'a links file importing submissions (not an allowed edge) is rejected',
    file: 'packages/domain/src/links/index.ts',
    code: "import { s } from '../submissions/index.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  {
    name: 'a registry file importing submissions (not an allowed edge) is rejected',
    file: 'packages/domain/src/registry/index.ts',
    code: "import { s } from '../submissions/index.js';",
    ruleIds: ['boundaries/dependencies'],
  },
  // ---- R1 named binding: ESLint core, because boundaries cannot see it ---- //
  {
    name: 'a bullmq Worker import in apps/api is rejected by no-restricted-imports',
    file: 'apps/api/src/index.ts',
    code: "import { Worker } from 'bullmq';",
    ruleIds: ['no-restricted-imports'],
  },
];

const COMPLIANT_CASES: ReadonlyArray<{
  readonly name: string;
  readonly file: string;
  readonly code: string;
}> = [
  {
    name: 'app-api importing an inbound adapter is the one allowed origin',
    file: 'apps/api/src/index.ts',
    code: "import { receiver } from '../../../packages/domain/src/adapters/slack/inbound/receiver.js';",
  },
  {
    name: 'app-worker importing a bullmq worker is allowed',
    file: 'apps/worker/src/index.ts',
    code: "import { processor } from '../../../packages/domain/src/submissions/bullmq/workers/processor.js';",
  },
  {
    name: 'app-scheduler importing a scheduler job is allowed',
    file: 'apps/scheduler/src/index.ts',
    code: "import { rotate } from '../../../packages/platform/src/scheduler/jobs/rotate.js';",
  },
  {
    name: 'crypto-owner may import jose',
    file: 'packages/platform/src/crypto/keyring.ts',
    code: "import { SignJWT } from 'jose';",
  },
  {
    name: 'connector-owner may import jose',
    file: 'packages/domain/src/connectors/index.ts',
    code: "import { SignJWT } from 'jose';",
  },
  {
    name: 'mongo-owner may import mongodb',
    file: 'packages/platform/src/mongo/client.ts',
    code: "import { MongoClient } from 'mongodb';",
  },
  {
    name: 'a data-access file may import mongodb',
    file: 'packages/domain/src/registry/data-access/repo.ts',
    code: "import { MongoClient } from 'mongodb';",
  },
  {
    name: 'platform importing kernel is an allowed edge',
    file: 'packages/platform/src/index.ts',
    code: "import { brand } from '../../kernel/src/index.js';",
  },
  {
    name: 'adapters importing contract is an allowed edge',
    file: 'packages/domain/src/adapters/index.ts',
    code: "import { c } from '../../../contract/src/index.js';",
  },
  {
    name: 'authz importing identity is an allowed edge',
    file: 'packages/domain/src/authz/index.ts',
    code: "import { i } from '../identity/index.js';",
  },
  {
    name: 'app-worker may construct a bullmq Worker (not a restricted origin)',
    file: 'apps/worker/src/index.ts',
    code: "import { Worker } from 'bullmq';",
  },
];

/**
 * The **real** settings, against the **real** repo paths.
 *
 * The fixture block above re-roots every pattern at `tooling/boundaries-fixtures/`,
 * which means it cannot cover the one mapping that only exists in the real tree:
 * `@akane/<pkg>` resolves through `tooling/import-resolver.cjs` to the workspace's
 * `src/index.ts`. If that mapping regressed, a cross-package import would fall
 * back to the `exports` map, land in `node_modules/dist`, be classified
 * `external`, and pass unexamined — while every fixture case still passed. So
 * these two assertions run the real `boundariesSettings` against real paths.
 */
/**
 * @param rule        the `boundaries/dependencies` rule body under test
 * @param useResolver whether `tooling/import-resolver.cjs` is installed. The
 *   backstop tests flip this to prove the resolver is load-bearing.
 */
function createRepoEslint(
  rule: unknown = boundariesDependenciesRule,
  useResolver = true,
): ESLint {
  return new ESLint({
    ignore: false,
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        plugins: { boundaries },
        settings: {
          ...boundariesSettings,
          ...(useResolver ? { 'import/resolver': { [RESOLVER_PATH]: null } } : {}),
        },
        rules: { 'boundaries/dependencies': rule },
      },
    ],
  });
}

const WORKSPACE_CASES: ReadonlyArray<{
  readonly name: string;
  readonly file: string;
  readonly code: string;
  readonly expectViolation: boolean;
  /**
   * Whether this case depends on the **subpath** branch of
   * `tooling/import-resolver.cjs` rather than on the bare-specifier branch.
   * The resolver backstop below keys off this: with the default Node resolver
   * every one of them goes silent.
   */
  readonly subpathOnly?: boolean;
}> = [
  {
    name: 'kernel importing @akane/platform is rejected (workspace edge)',
    file: 'packages/kernel/src/index.ts',
    code: "import { REDIS } from '@akane/platform';",
    expectViolation: true,
  },
  {
    name: 'app-api importing @akane/platform is an allowed workspace edge',
    file: 'apps/api/src/index.ts',
    code: "import { REDIS } from '@akane/platform';",
    expectViolation: false,
  },

  // ---- The SUBPATH form, which is the form the tree actually uses ----
  //
  // Gap G-1 (`01-VERIFICATION.md`): the resolver mapped only the bare
  // `@akane/<pkg>` specifier. A subpath fell through to Node's `exports` map,
  // resolved into `node_modules/<pkg>/dist/…js`, was classified `external`, and
  // policy 0 allows `external` unconditionally — so `packages/contract` (whose
  // only allowed edge is `['kernel']`) importing `@akane/platform/crypto` passed
  // both `eslint` and `tsc`, and `npm run build` went green on a real
  // cross-boundary import. All three entrypoints use the subpath form
  // (`@akane/platform/otel`, D-20), so the compliant cases below are not
  // hypothetical either: they are the tree as it stands.
  {
    name: 'contract importing @akane/platform/crypto is rejected (subpath workspace edge)',
    file: 'packages/contract/src/index.ts',
    code: "import { encryptSecret } from '@akane/platform/crypto';",
    expectViolation: true,
    subpathOnly: true,
  },
  {
    name: 'kernel importing @akane/platform/crypto is rejected (subpath workspace edge)',
    file: 'packages/kernel/src/index.ts',
    code: "import { encryptSecret } from '@akane/platform/crypto';",
    expectViolation: true,
    subpathOnly: true,
  },
  {
    name: 'platform importing a domain type through a subpath is rejected',
    file: 'packages/platform/src/index.ts',
    code: "import { l } from '@akane/contract/links/read-link-claims.js';",
    expectViolation: true,
    subpathOnly: true,
  },
  {
    name: 'app-api importing @akane/platform/otel is an allowed subpath workspace edge',
    file: 'apps/api/src/index.ts',
    code: "import { startOtel } from '@akane/platform/otel';",
    expectViolation: false,
    subpathOnly: true,
  },
  {
    name: 'a NodeNext ".js" subpath is the same edge as the bare subpath',
    file: 'apps/api/src/index.ts',
    code: "import { startOtel } from '@akane/platform/otel.js';",
    expectViolation: false,
    subpathOnly: true,
  },
];

async function lint(
  eslint: ESLint,
  file: string,
  code: string,
): Promise<ReadonlyArray<{ ruleId: string | null; message: string }>> {
  return lintAt(eslint, `${FIXTURE_ROOT}/${file}`, code);
}

async function lintAt(
  eslint: ESLint,
  filePath: string,
  code: string,
): Promise<ReadonlyArray<{ ruleId: string | null; message: string }>> {
  const [result] = await eslint.lintText(code, {
    filePath,
    warnIgnored: false,
  });
  return result.messages.map((message) => ({
    ruleId: message.ruleId ?? null,
    message: message.message,
  }));
}

describe('boundaries fixture smoke test (FND-04)', () => {
  it('reports a violation for every policy category', async () => {
    const eslint = createFixtureEslint();

    for (const testCase of CASES) {
      const messages = await lint(eslint, testCase.file, testCase.code);
      const actual = messages.map((message) => message.ruleId);
      expect(
        testCase.ruleIds.filter((ruleId) => actual.includes(ruleId)),
        `${testCase.name} — expected one of ${testCase.ruleIds.join(', ')}, got ${
          messages.length === 0 ? 'no messages at all' : actual.join(', ')
        }`,
      ).toHaveLength(testCase.ruleIds.length);
    }
  });

  it('reports nothing for the compliant sources', async () => {
    const eslint = createFixtureEslint();

    for (const testCase of COMPLIANT_CASES) {
      const messages = await lint(eslint, testCase.file, testCase.code);
      expect(
        messages,
        `${testCase.name} — expected no diagnostics, got ${messages
          .map((message) => `${message.ruleId}: ${message.message}`)
          .join(' | ')}`,
      ).toEqual([]);
    }
  });

  it('enforces the cross-workspace element graph on real repo paths', async () => {
    const eslint = createRepoEslint();

    for (const testCase of WORKSPACE_CASES) {
      const messages = await lintAt(eslint, testCase.file, testCase.code);
      const fired = messages.some((message) => message.ruleId === 'boundaries/dependencies');
      const want = testCase.expectViolation ? 'a' : 'no';
      const got = messages.length === 0
        ? 'no messages at all'
        : messages.map((message) => String(message.ruleId)).join(', ');
      expect(fired, testCase.name + ' - expected ' + want + ' violation, got ' + got).toBe(
        testCase.expectViolation,
      );
    }
  });

  /**
   * G-1 backstop: the subpath mapping is the *fix*, so the fix gets the same
   * treatment as the `./foo.js` mapping above it — asserted directly against the
   * resolver, then asserted to be the only reason those cases are visible.
   *
   * The second half matters more than the first. A resolver that maps the bare
   * form and declines the subpath form is not "partially enforcing": the plugin
   * reads a declined workspace specifier as `external`, policy 0 allows
   * `external` unconditionally, and the tree reports zero problems while holding
   * a real violation. Removing the subpath branch reproduces G-1 exactly, and
   * this test goes red rather than green.
   */
  describe('workspace subpath resolution (G-1)', () => {
    it('maps @akane/<pkg>/<subpath> onto the workspace source, not onto dist/', () => {
      const resolver = createRequire(import.meta.url)(RESOLVER_PATH) as {
        resolve: (source: string, file: string) => { found: boolean; path: string | null };
      };
      const from = path.join(REPO_ROOT, 'apps', 'api', 'src', 'main.ts');

      for (const [specifier, expected] of [
        ['@akane/platform', 'packages/platform/src/index.ts'],
        ['@akane/platform/otel', 'packages/platform/src/otel/index.ts'],
        ['@akane/platform/crypto', 'packages/platform/src/crypto/index.ts'],
        ['@akane/platform/otel.js', 'packages/platform/src/otel/index.ts'],
        ['@akane/kernel', 'packages/kernel/src/index.ts'],
        ['@akane/contract', 'packages/contract/src/index.ts'],
        // A subpath may name a module directly as well as a barrel directory.
        ['@akane/platform/redis/redis.provider.js', 'packages/platform/src/redis/redis.provider.ts'],
      ] as const) {
        const resolved = resolver.resolve(specifier, from);
        expect(resolved.found, `${specifier} must resolve`).toBe(true);
        expect(toPosix(resolved.path ?? '')).toBe(path.posix.join(toPosix(REPO_ROOT), expected));
        expect(resolved.path, `${specifier} must not resolve into dist/`).not.toContain('/dist/');
        expect(resolved.path, `${specifier} must not resolve into node_modules`).not.toContain(
          '/node_modules/',
        );
      }

      // And the shapes it must decline rather than guess at. Declining is not
      // free — the plugin reads `found: false` as `external`, which policy 0
      // allows — but an unresolvable specifier is a `tsc` error, and inventing
      // a path for it would put a file the compiler never named into the
      // element graph.
      expect(resolver.resolve('@akane/platform/does-not-exist', from).found).toBe(false);
      expect(resolver.resolve('@akane/platform/../kernel', from).found).toBe(false);
      expect(resolver.resolve('@akane/nosuchpkg', from).found).toBe(false);
    });

    it('every violating subpath case is invisible without the subpath mapping', async () => {
      const withoutSubpathMapping = createRepoEslint(boundariesDependenciesRule, false);
      const violatingSubpathCases = WORKSPACE_CASES.filter(
        (testCase) => testCase.subpathOnly === true && testCase.expectViolation,
      );
      expect(
        violatingSubpathCases.length,
        'the subpath backstop needs at least one violating case to be a backstop',
      ).toBeGreaterThan(0);

      for (const testCase of violatingSubpathCases) {
        // Control: with the shipped resolver, the violation is reported.
        const enforced = await lintAt(createRepoEslint(), testCase.file, testCase.code);
        expect(
          enforced.map((message) => message.ruleId),
          `${testCase.name} — control run must observe the shipped resolver`,
        ).toContain('boundaries/dependencies');

        // Without the subpath mapping the same source is reported as clean. This
        // is the tree G-1 shipped: `npm run build` green, cross-boundary import
        // in it, and the two are indistinguishable from the outside.
        const silent = await lintAt(withoutSubpathMapping, testCase.file, testCase.code);
        expect(
          silent.map((message) => message.ruleId),
          `${testCase.name} — a resolver that declines the subpath form must produce no diagnostics`,
        ).toEqual([]);
      }
    });

    /**
     * The other half, and the half a "make it stricter everywhere" fix would
     * fail: `@akane/platform/otel` from `apps/api` is allowed **and examined**.
     *
     * An allowed edge and an unexamined edge are the same observation — zero
     * diagnostics — so the compliant subpath cases above prove nothing on their
     * own. This one removes `app-api`'s allowed-edge policy from the shipped
     * rule and asserts the *same* import then fails. It can only fail-then-pass
     * if the subpath resolved to a real local `platform` element that the
     * policies actually reached — i.e. the resolver fix did not achieve its
     * result by making the rule complain about everything.
     */
    it('a compliant subpath edge is evaluated, not silently skipped', async () => {
      const compliant = WORKSPACE_CASES.find(
        (testCase) => testCase.name ===
          'app-api importing @akane/platform/otel is an allowed subpath workspace edge',
      );
      if (!compliant) throw new Error('compliant subpath case not found');

      const shipped = await lintAt(createRepoEslint(), compliant.file, compliant.code);
      expect(shipped, 'the shipped rule must allow the subpath edge the tree uses').toEqual([]);

      const [, options] = boundariesDependenciesRule as [
        string,
        { policies: ReadonlyArray<Record<string, unknown>> },
      ];
      // Drop only the `app-api` element-edge policy. R1's `!(app-api)` selector
      // and the third-party allow keep their own `from`, and neither is the
      // literal string `app-api`, so nothing else is disturbed.
      const tightened = createRepoEslint([
        'error',
        {
          ...options,
          policies: options.policies.filter(
            (policy) =>
              (policy['from'] as { element?: { type?: string } } | undefined)?.element?.type !==
              'app-api',
          ),
        },
      ]);

      const tightenedResult = await lintAt(tightened, compliant.file, compliant.code);
      expect(
        tightenedResult.map((message) => message.ruleId),
        'an allowed subpath edge that no policy reaches would report nothing here, ' +
          'which means the rule never examined it',
      ).toContain('boundaries/dependencies');
    });
  });

  // ========================================================================= //
  // Backstops. Each one turns a claim that lives in a code comment into a
  // failing test, so a future "simplification" cannot quietly reintroduce the
  // inert-rule failure mode these three were written to disprove.
  // ========================================================================= //

  describe('non-inertness backstops', () => {
    /**
     * THE most important assertion in this file.
     *
     * 01-03-PLAN.md's prohibition says `checkAllOrigins` must NOT be set,
     * on the stated grounds that it "widens every policy to external sources
     * that the R1/R2/R3 designs do not need". The installed 7.2.0 source
     * says the opposite — `Rules/Dependencies.js` gates the whole
     * evaluation on the **target's** origin:
     *
     *   const isLocalDependency = dependency.to.module.origin === ORIGINS.LOCAL;
     *   if (... && (checkAllOrigins || isLocalDependency) && ...) { evaluate… }
     *
     * `jose` and `mongodb` resolve into node_modules, so with the default the
     * rule returns without evaluating a single policy and R2/R3 are dead
     * config that still reads correctly in review.
     *
     * This test therefore does two things at once: it pins `checkAllOrigins:
     * true` (the deviation, so it cannot be removed on a later "cleanup"), and
     * it proves the deviation is load-bearing rather than arbitrary — strip the
     * flag and every R2/R3 case goes silent.
     */
    it('checkAllOrigins is set, and stripping it silently disables R2 and R3', async () => {
      const [, options] = boundariesDependenciesRule as [
        string,
        Record<string, unknown>,
      ];
      expect(options.checkAllOrigins).toBe(true);

      // Rebuild the options without the flag. Copied explicitly rather than
      // rest-destructured so the omission does not trip `no-unused-vars`.
      const withoutFlag: Record<string, unknown> = { ...options };
      delete withoutFlag.checkAllOrigins;
      const inert = createFixtureEslint(['error', withoutFlag]);

      const EXTERNAL_ONLY_CASES = [
        'R2 jose imported outside the owning categories is rejected',
        'R2 @aws-sdk/client-kms imported outside the owning categories is rejected',
        'R2 @google-cloud/kms imported outside the owning categories is rejected',
        'R3 mongodb imported outside the owning categories is rejected',
      ];

      for (const name of EXTERNAL_ONLY_CASES) {
        const testCase = CASES.find((candidate) => candidate.name === name);
        if (!testCase) throw new Error(`fixture case not found: ${name}`);

        // Control: with the shipped rule the violation is reported.
        const enforced = await lint(createFixtureEslint(), testCase.file, testCase.code);
        expect(
          enforced.map((message) => message.ruleId),
          `${name} — control run must report a violation`,
        ).toContain('boundaries/dependencies');

        // Without checkAllOrigins the same source is reported as clean. This is
        // the failure the prohibition would have shipped.
        const silent = await lint(inert, testCase.file, testCase.code);
        expect(
          silent.map((message) => message.ruleId),
          `${name} — expected the plugin to skip external targets entirely`,
        ).toEqual([]);
      }
    });

    /**
     * 01-03-PLAN.md specifies R2/R3 as
     * `from: { file: { categories: { noneOf: [...] } } }`. That selector never
     * matches a file with **no** category: the array query runs against an
     * empty candidate list, so a non-owner file satisfies neither the disallow
     * nor anything else, and the broad third-party allow stands. Pinned here so
     * nobody "simplifies" the shipped inverted form back to `noneOf`.
     */
    it('a noneOf file-category from-selector never matches a categoryless file', async () => {
      const [, options] = boundariesDependenciesRule as [
        string,
        { policies: ReadonlyArray<Record<string, unknown>> },
      ];

      const noneOfRule = [
        'error',
        {
          ...options,
          policies: [
            { allow: { to: { module: { origin: ['external', 'core'] } } } },
            {
              from: { file: { categories: { noneOf: ['crypto-owner', 'connector-owner'] } } },
              disallow: { to: { module: { origin: 'external', source: 'jose' } } },
              message: 'R2-noneOf',
            },
          ],
        },
      ];

      const eslint = createFixtureEslint(noneOfRule);
      const testCase = CASES.find(
        (candidate) => candidate.name === 'R2 jose imported outside the owning categories is rejected',
      );
      if (!testCase) throw new Error('R2 jose fixture case not found');

      const messages = await lint(eslint, testCase.file, testCase.code);
      expect(
        messages,
        'noneOf from-selector is expected to be inert for a categoryless file',
      ).toEqual([]);
    });

    /**
     * The default Node resolver does not map NodeNext's `./foo.js` onto the
     * `./foo.ts` it names, so every relative import in this repo is unresolvable
     * without `tooling/import-resolver.cjs`. When that happens the rule reports
     * nothing on a tree full of violations — byte-identical to a compliant tree.
     * This is the exact "silent under-enforcement" the plan's objective names,
     * so it gets an executable assertion rather than a comment.
     */
    it('the custom import resolver is load-bearing for every relative import', async () => {
      const eslint = createFixtureEslint(boundariesDependenciesRule, false);

      // These four all rely on a relative `./foo.js` -> `./foo.ts` mapping.
      const RELATIVE_CASES = [
        'a kernel file importing a platform file is rejected',
        'a forms file importing authz (not an allowed edge) is rejected',
        'an authz file importing forms (not an allowed edge) is rejected',
        'R1 http imported from app-scheduler is rejected',
      ];

      for (const name of RELATIVE_CASES) {
        const testCase = CASES.find((candidate) => candidate.name === name);
        if (!testCase) throw new Error(`fixture case not found: ${name}`);

        const messages = await lint(eslint, testCase.file, testCase.code);
        expect(
          messages.map((message) => message.ruleId),
          `${name} — an unresolvable specifier must produce no diagnostics at all`,
        ).toEqual([]);
      }
    });
  });
});
