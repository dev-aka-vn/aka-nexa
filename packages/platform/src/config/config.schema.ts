import { z } from 'zod';
import { REDIS_URL_FIELDS, refineRedisInstancesDistinct } from './redis.schema.js';

/**
 * The three process names (D-01). Declared as a value, not restated inline, so
 * `SERVICE_NAME`'s enum and the per-process port table cannot disagree.
 */
export const SERVICE_NAMES = Object.freeze(['api', 'worker', 'scheduler'] as const);

export type ServiceName = (typeof SERVICE_NAMES)[number];

/**
 * The port each process listens on when `PORT` is not set (FND-03, D-09).
 *
 * ## Why the default lives in the schema
 *
 * FND-03 is "three independently runnable processes", and 3000/3001/3002 is
 * part of that contract: three processes that all default to one port are not
 * three processes, they are one process with a name. So the default has to be
 * **derived from something that identifies the process**, and the only such
 * value in the environment is `SERVICE_NAME`.
 *
 * The alternative — three literal `app.listen(3001)` calls — is what this table
 * exists to avoid. It would put the port next to `listen()`, where it is
 * invisible to config validation, un-overridable without editing code, and
 * impossible to assert in a test that does not boot a process. Here it is
 * overridable with one env var and assertable with `validateConfig`.
 *
 * Three distinct ports is also what lets all three run on one host during
 * development, which is the only way an operator can see the three-process
 * topology behave like three processes before it is deployed.
 */
export const DEFAULT_PORT_BY_SERVICE: Readonly<Record<ServiceName, number>> =
  Object.freeze({
    api: 3000,
    worker: 3001,
    scheduler: 3002,
  });

/**
 * Boot configuration schema (FND-09).
 *
 * `.strict()` is deliberate: when the schema is parsed directly, any field not
 * named here is a schema error. The Nest boot hook (`namedValidate` in
 * `config.module.ts`) narrows the process environment to these declared keys
 * first, because `process.env` legitimately carries hundreds of unrelated keys.
 *
 * The shape is named separately so `APP_CONFIG_KEYS` can be derived without
 * depending on the runtime type of a schema that later gains refinements.
 */
const AppConfigShape = {
  /**
   * Required, with **no default** (CR-01).
   *
   * `.default('development')` made "this process never declared its environment"
   * the same value as "this is a developer laptop", so a production container
   * that simply omitted `NODE_ENV` booted on a plaintext key file with nothing
   * refusing it — the one state the KMS guard exists to make unreachable.
   * Requiring the key closes it at the first layer: such a container now aborts
   * with `CONFIG_INVALID: NODE_ENV` before a single module resolves, and the
   * crypto guard's fail-closed rule (which refuses an absent value too) is the
   * second layer for anything that reaches it by another route.
   */
  NODE_ENV: z.enum(['development', 'test', 'production']),
  // `.optional()` rather than `.default(3000)`: the default is per-process, and
  // only `SERVICE_NAME` knows which process this is (see the transform below).
  PORT: z.coerce.number().int().positive().optional(),
  SERVICE_NAME: z.enum(SERVICE_NAMES),
  MONGO_URL: z.string().url(),
  ...REDIS_URL_FIELDS,
  CRYPTO_KEY_PROVIDER: z.enum(['local', 'kms']).default('local'),
  /**
   * Base OTLP/HTTP collector endpoint (OBS-01, D-20).
   *
   * Optional on purpose: telemetry failing to export must never be the reason a
   * pod does not start, so an absent collector is a legal configuration. What
   * is not legal is a *malformed* one — a typo'd endpoint that silently exports
   * nothing is how a platform ends up with no traces and no error. The OTel SDK
   * reads this variable straight from `process.env` when no exporter `url` is
   * given, so it was previously unvalidated at every level (WINDOWS.md entry 12).
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url()
    // `z.string().url()` is not enough on its own: `new URL('collector:4318')`
    // parses successfully — `collector` is a scheme, `4318` is a path — so a
    // missing `http://` would pass validation and then be silently ignored by
    // the exporters. An OTLP endpoint has to be reachable over HTTP.
    .refine((value) => /^https?:\/\//i.test(value), 'expected an http(s) OTLP endpoint')
    .optional(),
};

/**
 * The object half of the boot contract: `.strict()` unknown-key rejection and
 * D-12's distinct-instance cross-field rule, before the per-process port default
 * is applied.
 *
 * Split out so the declared key set is assertable (`AppConfigSchema` is a
 * `ZodPipe` once `.transform` is chained onto it, and a pipe has no `.shape`).
 * Exported for that assertion and nothing else — **do not parse configuration
 * with it**, which is precisely why its one visible defect (an unresolved
 * `PORT`) is a trap.
 */
export const AppConfigObjectSchema = z
  .object(AppConfigShape)
  .strict()
  .superRefine(refineRedisInstancesDistinct);

/**
 * The boot contract, plus the per-process port default.
 *
 * The transform is the last stage deliberately: it must see a `SERVICE_NAME`
 * that already passed the enum, and it must not be able to mask a refinement
 * failure — a boot that collapses both Redis deployments onto one instance has
 * to fail with `CONFIG_INVALID`, not come back with a filled-in `PORT`.
 */
export const AppConfigSchema = AppConfigObjectSchema.transform((config) => ({
  ...config,
  PORT: config.PORT ?? DEFAULT_PORT_BY_SERVICE[config.SERVICE_NAME],
}));

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** The declared config keys — the only keys the boot hook forwards to Zod. */
export const APP_CONFIG_KEYS = Object.keys(AppConfigShape) as Array<
  keyof AppConfig
>;

/**
 * A Zod issue, structurally typed so this module never reaches into Zod's
 * internal issue union.
 */
export interface ConfigIssue {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly code: string;
  readonly message: string;
}

/**
 * Named boot failure (FND-09).
 *
 * Custom refinement issues carry their machine-readable token in `message`
 * (Zod's `code` is always `"custom"` for those); built-in issues use the Zod
 * code (`invalid_type`, `unrecognized_keys`, …). Either way the result is a
 * greppable, stable `CONFIG_INVALID: <path> <code>` line.
 */
export function formatConfigError(issue: ConfigIssue): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>';
  const code = issue.code === 'custom' ? issue.message : issue.code;
  return `CONFIG_INVALID: ${path} ${code}`;
}

/**
 * Parse a candidate config object, throwing the named boot error on failure.
 * Direct callers (tests, tooling) get the same failure text as the Nest hook.
 */
export function validateConfig(raw: Record<string, unknown>): AppConfig {
  const result = AppConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatConfigError(result.error.issues[0]));
  }
  return result.data;
}
