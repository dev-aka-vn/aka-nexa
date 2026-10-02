import { z } from 'zod';

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
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  SERVICE_NAME: z.enum(['api', 'worker', 'scheduler']),
  MONGO_URL: z.string().url(),
  REDIS_CACHE_URL: z.string().url(),
  REDIS_QUEUE_URL: z.string().url(),
  CRYPTO_KEY_PROVIDER: z.enum(['local', 'kms']).default('local'),
};

export const AppConfigSchema = z.object(AppConfigShape).strict();

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
