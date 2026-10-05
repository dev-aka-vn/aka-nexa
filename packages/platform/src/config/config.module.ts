import { Global, Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
 * entrypoint (FND-09).
 *
 * ## Why this is not `ConfigModule.forRoot()`
 *
 * `@nestjs/config@12`'s `ConfigModule.forRoot()` is **`async`**, and every way of
 * calling it from a `@Module({ imports: [...] })` decorator evaluates it at
 * **import time** — the decorator argument is built when the module file is
 * loaded, long before `NestFactory.create()` runs. The validated result is
 * captured in a closure and installed as `ConfigService`'s internal config, and
 * `ConfigService.get()` consults that snapshot **before** the live environment
 * (`config.service.js`: internal config → validated env → `process.env`).
 *
 * Measured, not assumed (WINDOWS.md entry 6): with
 * `process.env.NODE_ENV = 'production'` set *after* this module was imported but
 * *before* `Test.createTestingModule(...).compile()`, `ConfigService.get('NODE_ENV')`
 * returned `'test'` — the value present at import time. Awaiting `forRoot()`
 * does not fix this; the snapshot is taken when the promise is created, not when
 * it settles. Plan 05 hit exactly this and worked around it by reading
 * `process.env` directly inside the crypto factory, which left every *other*
 * `ConfigService` consumer inheriting a possibly-stale value.
 *
 * ## What replaces it
 *
 * The same validation, run inside a `useFactory` — which Nest invokes while it
 * creates instances, i.e. during `NestFactory.create()`. The snapshot is
 * therefore taken at **boot**, after the process environment is fully populated,
 * and a `CONFIG_INVALID:` failure still aborts boot with the same named error
 * (FND-09).
 *
 * ## What is given up, deliberately
 *
 * `forRoot()` also reads a `.env` file from the working directory. That is
 * dropped: a deployment supplies its configuration through the environment (that
 * is what `npm ci --omit=dev` + an orchestrator means), and NFR-SEC-3 treats a
 * config file carrying credentials as a thing to avoid rather than a feature
 * (D-15/D-17). Nothing in this repository reads one, so the capability had no
 * consumer and its absence is recorded here rather than left implicit.
 *
 * The narrowed `process.env` is also **not** written back into `process.env`.
 * `forRoot()` did that, so schema *defaults* (`PORT`, `CRYPTO_KEY_PROVIDER`)
 * became visible to raw `process.env` readers as a side effect. Two sources of
 * truth for one value is how a process ends up with a port the config module
 * never validated, so the validated object is the only copy.
 */
const validatedConfigProvider: Provider = {
  provide: ConfigService,
  useFactory: (): ConfigService => {
    // Read at DI time, not at import time. See the docblock above.
    const validated = namedValidate(process.env);
    return new ConfigService({ ...validated });
  },
};

/**
 * `isGlobal: true` in the old call is `@Global()` here, so `ConfigService`
 * resolves without every composition root re-importing it — and, as before,
 * without the whole Zod validation running twice per process.
 */
@Global()
@Module({
  providers: [validatedConfigProvider],
  exports: [ConfigService],
})
export class ConfigModule {}