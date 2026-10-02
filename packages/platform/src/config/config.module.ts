import { ConfigModule as NestConfigModule } from '@nestjs/config';
import {
  APP_CONFIG_KEYS,
  AppConfigSchema,
  formatConfigError,
  type AppConfig,
} from './config.schema.js';

/**
 * Named boot validation (FND-09).
 *
 * `@nestjs/config` calls this with the merged configuration object (in practice
 * `process.env`). We narrow to the declared keys first so `.strict()` rejects
 * unknown keys only when the schema is parsed directly — otherwise every boot
 * would fail on the unrelated keys the OS and toolchain place in `process.env`.
 *
 * On failure the thrown message is prefixed with `CONFIG_INVALID: ` followed by
 * the first offending path and the Zod issue code, so boot failures are greppable
 * and actionable. A named error is why we use `validate:` rather than
 * `validationSchema:`, which cannot supply one of our own.
 */
export function namedValidate(raw: Record<string, unknown>): AppConfig {
  const candidate: Record<string, unknown> = {};
  for (const key of APP_CONFIG_KEYS) {
    if (key in raw) {
      candidate[key] = raw[key];
    }
  }

  const result = AppConfigSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(formatConfigError(result.error.issues[0]));
  }

  return result.data;
}

/**
 * The Zod-validated, globally-available config module consumed by every
 * entrypoint. `isGlobal: true` so `ConfigService` resolves without re-importing.
 */
export const ConfigModule = NestConfigModule.forRoot({
  isGlobal: true,
  validate: namedValidate,
});
