import { z } from 'zod';

/**
 * Boot configuration schema (FND-09).
 *
 * `.strict()` is deliberate: when the schema is parsed directly, any field not
 * named here is a schema error. The Nest boot hook (`namedValidate` in
 * `config.module.ts`) narrows the process environment to these declared keys
 * first, because `process.env` legitimately carries hundreds of unrelated keys.
 */
export const AppConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
  })
  .strict();

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** The declared config keys — the only keys the boot hook forwards to Zod. */
export const APP_CONFIG_KEYS = Object.keys(AppConfigSchema.shape) as Array<
  keyof AppConfig
>;
