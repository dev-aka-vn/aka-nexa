/**
 * Component boundary model for `eslint-plugin-boundaries@7.2.0` (D-02, D-03, FND-04).
 *
 * This file is the single source of truth for the modular-monolith boundary
 * graph. `eslint.config.mjs` consumes both exports; nothing else may redefine
 * them, so the lint gate and the fixture smoke test exercise the same objects.
 *
 * Three shape facts about v7 that the v5 description in ARCHITECTURE.md gets
 * wrong, and that each make silent under-enforcement if missed (D-32):
 *
 *  1. `boundaries/files` is a **settings** block, not a rule. There is no
 *     `Rules/Files.js` in the 7.2.0 tarball — categories are declared under
 *     `settings["boundaries/files"]` and consumed by `boundaries/dependencies`
 *     policies through `to: { file: { categories } }` / `from: { file: … }`.
 *  2. Policies are evaluated **last-match-wins**, not first-match-wins
 *     (`evaluatePolicies` in `dist/Rules/Dependencies.js`). Within one policy,
 *     `disallow` beats `allow`. Therefore the permissive element edges MUST be
 *     declared first and R1/R2/R3 last, or the restrictions would be
 *     overwritten by the broad allow they were meant to narrow.
 *  3. `partialMatch: false` on every element descriptor. With the default
 *     (`true`) a pattern like `packages/platform/src/**` also suffix-matches
 *     `apps/api/src/platform/**`, which would silently promote an app-local
 *     directory to the `platform` element type.
 *
 * A fourth fact is not a plugin difference but a resolver one, and it is the
 * reason `tooling/import-resolver.cjs` exists: the default Node resolver does
 * not map NodeNext's `./foo.js` specifier onto `./foo.ts`, so without it every
 * relative import in this repo is unresolvable and the whole rule is inert.
 */

/**
 * The thirteen domain subdirectories, each its own element type (D-02 (ii):
 * the `domain` root is deliberately NOT an element type, so a new
 * subdirectory is an explicit config change rather than a silent inheritance).
 *
 * @type {readonly string[]}
 */
export const DOMAIN_ELEMENT_TYPES = Object.freeze([
  'identity',
  'authz',
  'registry',
  'forms',
  'links',
  'decision',
  'connectors',
  'submissions',
  'datarouter',
  'adapters',
  'pipeline',
  'builder',
  'audit',
]);

/**
 * The three composition roots. D-02 names a single `entrypoint` type; that is
 * split into three here so R1's `from: { element: { type: "!(app-api)" } }`
 * negation can distinguish them without needing `path` + `type` conjunction
 * semantics. Refinement of D-02, recorded in 01-ASSUMPTIONS.md — not an
 * overturn of it.
 *
 * @type {readonly string[]}
 */
export const APP_ELEMENT_TYPES = Object.freeze([
  'app-api',
  'app-worker',
  'app-scheduler',
]);

/** @param {string} type @param {string} pattern */
const element = (type, pattern) => ({
  type,
  pattern,
  partialMatch: false,
});

/**
 * Every element type in the graph, in declaration order.
 *
 * @type {ReadonlyArray<{ type: string, pattern: string, partialMatch: false }>}
 */
export const BOUNDARY_ELEMENTS = Object.freeze([
  element('kernel', 'packages/kernel/src/**'),
  element('platform', 'packages/platform/src/**'),
  element('contract', 'packages/contract/src/**'),
  ...DOMAIN_ELEMENT_TYPES.map((type) =>
    element(type, `packages/domain/src/${type}/**`),
  ),
  element('app-api', 'apps/api/src/**'),
  element('app-worker', 'apps/worker/src/**'),
  element('app-scheduler', 'apps/scheduler/src/**'),
]);

/**
 * File categories. These carry the R1/R2/R3 restrictions that are *not*
 * expressible as element-type edges (ARCHITECTURE.md §"Boundary rules").
 *
 * @type {ReadonlyArray<{ category: string, pattern: string }>}
 */
export const BOUNDARY_FILE_CATEGORIES = Object.freeze([
  { category: 'inbound-adapter', pattern: 'packages/domain/src/adapters/**/inbound/**' },
  { category: 'outbound-adapter', pattern: 'packages/domain/src/adapters/**/outbound/**' },
  { category: 'http', pattern: 'packages/**/http/**' },
  { category: 'bullmq-worker', pattern: 'packages/**/bullmq/workers/**' },
  { category: 'scheduler-job', pattern: 'packages/**/scheduler/**' },
  { category: 'crypto-owner', pattern: 'packages/platform/src/crypto/**' },
  { category: 'connector-owner', pattern: 'packages/domain/src/connectors/**' },
  { category: 'mongo-owner', pattern: 'packages/platform/src/mongo/**' },
  { category: 'data-access', pattern: 'packages/domain/src/**/data-access/**' },
]);

/**
 * The `settings` block consumed by `eslint.config.mjs`.
 *
 * Exported as a frozen object because the fixture smoke test re-uses it
 * verbatim with a fixture-scoped `rootPath`; a mutation here would make the
 * lint gate and the test disagree.
 */
export const boundariesSettings = Object.freeze({
  'boundaries/elements': BOUNDARY_ELEMENTS,
  'boundaries/files': BOUNDARY_FILE_CATEGORIES,
});

/**
 * Allowed edges, copied from ARCHITECTURE.md's allowed-edges table.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ALLOWED_EDGES = Object.freeze({
  // kernel: pure types. ZERO I/O, ZERO deps — it may import nothing.
  kernel: Object.freeze([]),
  platform: Object.freeze(['kernel']),
  contract: Object.freeze(['kernel']),
  identity: Object.freeze(['platform', 'kernel']),
  authz: Object.freeze(['platform', 'kernel', 'identity']),
  registry: Object.freeze(['platform', 'kernel', 'authz', 'forms']),
  forms: Object.freeze(['platform', 'kernel']),
  links: Object.freeze(['platform', 'kernel', 'registry', 'authz']),
  decision: Object.freeze(['platform', 'kernel', 'contract']),
  connectors: Object.freeze(['platform', 'kernel']),
  submissions: Object.freeze([
    'platform',
    'kernel',
    'identity',
    'authz',
    'forms',
    'links',
    'registry',
    'audit',
  ]),
  datarouter: Object.freeze([
    'platform',
    'kernel',
    'registry',
    'connectors',
    'audit',
  ]),
  // adapters → contract: inbound + outbound event shapes only. NOTHING else.
  adapters: Object.freeze(['platform', 'kernel', 'contract']),
  pipeline: Object.freeze([
    'platform',
    'kernel',
    'identity',
    'authz',
    'registry',
    'forms',
    'links',
    'decision',
    'adapters',
    'audit',
  ]),
  builder: Object.freeze([
    'platform',
    'kernel',
    'registry',
    'forms',
    'authz',
    'connectors',
    'audit',
  ]),
  // Composition roots are the only leaves: an app may reach every type.
  'app-api': Object.freeze([
    'kernel',
    'platform',
    'contract',
    ...DOMAIN_ELEMENT_TYPES,
  ]),
  'app-worker': Object.freeze([
    'kernel',
    'platform',
    'contract',
    ...DOMAIN_ELEMENT_TYPES,
  ]),
  'app-scheduler': Object.freeze([
    'kernel',
    'platform',
    'contract',
    ...DOMAIN_ELEMENT_TYPES,
  ]),
});

/** @param {string} type @param {readonly string[]} targets */
const edge = (type, targets) =>
  targets.length === 0
    ? null
    : {
        from: { element: { type } },
        allow: { to: { element: { types: { anyOf: [...targets] } } } },
      };

const R1_MESSAGE =
  'R1 entrypoint exclusivity: only apps/api may import inbound adapters and http controllers. ' +
  'A Worker or a controller in the wrong process breaks the <200 ms ack budget.';

const R2_MESSAGE =
  'R2 secret containment: only packages/platform/src/crypto/** and packages/domain/src/connectors/** ' +
  'may reach the KMS/ signing surface. NFR-SEC-3: no plaintext env secrets, no ad-hoc crypto.';

const R3_MESSAGE =
  'R3 no direct Mongo: only packages/platform/src/mongo/** and packages/domain/src/**/data-access/** ' +
  'may import the mongodb driver. Go through a repository so transaction-scoped sessions are threaded.';

/**
 * `boundaries/dependencies` rule body.
 *
 * `default: "disallow"` is the FND-04 guarantee: an edge that is not listed
 * below is a build failure, not a convention.
 *
 * ## `checkAllOrigins: true` — RESEARCH P1.1 was wrong, and this is the correction
 *
 * P1.1 concluded that `checkAllOrigins` must stay at its default because R2/R3
 * "select external modules as their *target*, which the default supports". The
 * installed 7.2.0 source says the opposite. `Rules/Dependencies.js` gates the
 * whole evaluation on the **target's** origin:
 *
 * ```js
 * const isLocalDependency = dependency.to.module.origin === ORIGINS.LOCAL;
 * if (... && (checkAllOrigins || isLocalDependency) && ...) { evaluatePoliciesAndReport(...) }
 * ```
 *
 * A `jose` or `mongodb` import resolves into `node_modules`, so
 * `isLocalDependency` is `false` and **the rule returns without evaluating any
 * policy at all**. With the default, R2 and R3 are dead configuration that
 * looks correct in review. `checkAllOrigins: true` is therefore required for
 * R2/R3 to fire at all.
 *
 * The stated worry — "widens every policy to external sources" — is neutralised
 * by the two properties the evaluator actually has (both read from
 * `Rules/Dependencies.js`, both covered by `boundaries.fixture.spec.ts`):
 *
 *  * policies are **last-match-wins**, so the broad third-party allow listed
 *    first is overridden by the R2/R3 disallows listed last; and
 *  * a policy with no `from` selector is unconstrained on the origin side, so
 *    the third-party allow cannot accidentally widen R2/R3.
 *
 * ### This deliberately contradicts 01-03-PLAN.md
 *
 * The plan carries `MUST NOT enable checkAllOrigins — it widens every policy to
 * external sources that the R1/R2/R3 designs do not need` as a `resolved`
 * prohibition, sourced from RESEARCH P1.1. The plan's own security truths
 * ("a `jose` import outside the owning categories **is reported**", T-1-07
 * `high`/`mitigate`) require the opposite. The premise is false — R2/R3 need
 * exactly the external sources the prohibition says they do not — so the
 * prohibition is overridden here under deviation **Rule 1 (auto-fix bug)**: an
 * instruction whose factual basis the installed source refutes.
 *
 * This is not an unverified judgement call. `boundaries.fixture.spec.ts` asserts
 * both halves of it: that `checkAllOrigins` is `true`, and that stripping it
 * makes all four R2/R3 cases report **zero** diagnostics — a tree full of
 * violations that looks byte-identical to a compliant one. Removing the flag is
 * a red test, not a cleanup.
 */
export const boundariesDependenciesRule = Object.freeze([
  'error',
  Object.freeze({
    default: 'disallow',
    checkAllOrigins: true,
    policies: Object.freeze([
      // ---------------------------------------------------------------- //
      // 0. Third-party packages and Node builtins are allowed by default.
      //    FIRST, so every later policy can narrow it. Declared without a
      //    `from` selector, which `buildEntrySelector` reads as
      //    origin-unconstrained — that is what keeps this from shadowing the
      //    R2/R3 file-category origins below.
      // ---------------------------------------------------------------- //
      {
        allow: { to: { module: { origin: ['external', 'core'] } } },
      },

      // ---------------------------------------------------------------- //
      // 1. Permissive element edges. FIRST among the graph policies,
      //    because policies are last-match-wins: anything listed after
      //    this would override it.
      // ---------------------------------------------------------------- //
      ...Object.entries(ALLOWED_EDGES)
        .map(([type, targets]) => edge(type, targets))
        .filter((policy) => policy !== null),

      // ---------------------------------------------------------------- //
      // 2. Composition roots are leaves: nothing except an app may import
      //    an app. The `!(a|b)` free-form negation is exercised by the
      //    fixture smoke test because the plugin README never demonstrates
      //    it together with a file-category array query — the negation form
      //    the plan originally paired with it is inert (see R2 below), so the
      //    smoke test pins the two shapes that actually work.
      // ---------------------------------------------------------------- //
      {
        from: { element: { type: `!(${APP_ELEMENT_TYPES.join('|')})` } },
        disallow: {
          to: { element: { types: { anyOf: [...APP_ELEMENT_TYPES] } } },
        },
      },

      // ---------------------------------------------------------------- //
      // 3. R1 — entrypoint exclusivity, by file category (D-03).
      // ---------------------------------------------------------------- //
      {
        from: { element: { type: '!(app-api)' } },
        disallow: {
          to: {
            file: {
              categories: { anyOf: ['inbound-adapter', 'http'] },
            },
          },
        },
        message: R1_MESSAGE,
      },
      {
        from: { element: { type: '!(app-worker)' } },
        disallow: {
          to: {
            file: {
              categories: { anyOf: ['outbound-adapter', 'bullmq-worker'] },
            },
          },
        },
        message: R1_MESSAGE,
      },
      {
        from: { element: { type: '!(app-scheduler)' } },
        disallow: {
          to: { file: { categories: { anyOf: ['scheduler-job'] } } },
        },
        message: R1_MESSAGE,
      },

      // ---------------------------------------------------------------- //
      // 4. R2 — secret containment. External module targets.
      //
      //    The plan's selector `from: { file: { categories: { noneOf: [...] } } }`
      //    is **silently inert** for every file that has no category: the
      //    plugin's array query never matches an empty candidate list, so a
      //    non-owner file matches neither the disallow nor anything else and
      //    the broad third-party allow at position 0 stands. Empirically
      //    verified (a categoryless file produced only the generic default-deny
      //    report, never the R2 message) and pinned by the fixture smoke test.
      //    The same inverted shape is used for R3.
      //
      //    Working form — last-match-wins makes the pair order significant:
      //    an origin-unconstrained DISALLOW first, then the owner-category
      //    ALLOW, which overrides it for the owning categories only.
      // ---------------------------------------------------------------- //
      ...['jose', '@aws-sdk/client-kms', '@google-cloud/kms'].flatMap((source) => [
        {
          disallow: { to: { module: { origin: 'external', source } } },
          message: R2_MESSAGE,
        },
        {
          from: {
            file: { categories: { anyOf: ['crypto-owner', 'connector-owner'] } },
          },
          allow: { to: { module: { origin: 'external', source } } },
        },
      ]),

      // ---------------------------------------------------------------- //
      // 5. R3 — no direct Mongo outside the data-access layer.
      // ---------------------------------------------------------------- //
      {
        disallow: {
          to: { module: { origin: 'external', source: 'mongodb' } },
        },
        message: R3_MESSAGE,
      },
      {
        from: {
          file: { categories: { anyOf: ['mongo-owner', 'data-access'] } },
        },
        allow: { to: { module: { origin: 'external', source: 'mongodb' } } },
      },
    ]),
  }),
]);
