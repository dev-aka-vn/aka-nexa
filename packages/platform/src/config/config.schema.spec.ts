import { describe, expect, it } from 'vitest';
import {
  APP_CONFIG_KEYS,
  AppConfigObjectSchema,
  validateConfig,
} from './config.schema.js';

/**
 * A complete, valid boot object. Values are strings because that is what the
 * process environment provides; PORT is deliberately a string to prove the
 * coercion path.
 */
const VALID_CONFIG: Record<string, unknown> = {
  NODE_ENV: 'test',
  PORT: '3000',
  SERVICE_NAME: 'api',
  MONGO_URL: 'mongodb://127.0.0.1:27017/akane',
  REDIS_CACHE_URL: 'redis://cache.internal:6379',
  REDIS_QUEUE_URL: 'redis://queue.internal:6379',
  CRYPTO_KEY_PROVIDER: 'local',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.internal:4318',
};

const omit = (
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));

describe('AppConfigSchema — full boot surface (FND-09)', () => {
  it('parses a fully valid configuration, applying coercion and returning data', () => {
    const parsed = validateConfig(VALID_CONFIG);

    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.PORT).toBe(3000);
    expect(parsed.SERVICE_NAME).toBe('api');
    expect(parsed.CRYPTO_KEY_PROVIDER).toBe('local');
  });

  it('defaults PORT and CRYPTO_KEY_PROVIDER when absent', () => {
    const parsed = validateConfig(
      omit(VALID_CONFIG, ['PORT', 'CRYPTO_KEY_PROVIDER']),
    );

    expect(parsed.PORT).toBe(3000);
    expect(parsed.CRYPTO_KEY_PROVIDER).toBe('local');
  });

  /**
   * CR-01. `NODE_ENV` used to carry `.default('development')`, which made a
   * process that never declared its environment indistinguishable from a
   * developer laptop — and the crypto guard keyed its refusal on that same
   * value, so a production container omitting `NODE_ENV` booted on a plaintext
   * key file with nothing refusing it. The first layer that closes it is here:
   * an absent `NODE_ENV` is a boot failure, not a silent assumption.
   */
  it('refuses to boot when NODE_ENV is absent rather than assuming development', () => {
    expect(() => validateConfig(omit(VALID_CONFIG, ['NODE_ENV']))).toThrowError(
      /^CONFIG_INVALID: NODE_ENV invalid_value$/,
    );
  });

  it('refuses to boot on a NODE_ENV outside the declared enum', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, NODE_ENV: 'prod' })).toThrowError(
      /^CONFIG_INVALID: NODE_ENV/,
    );
  });

  /**
   * FND-03. The port default follows the process, not the file: three processes
   * that all defaulted to 3000 would be one process with three names.
   */
  it('derives the port default from SERVICE_NAME, and an explicit PORT still wins', () => {
    for (const [service, port] of [
      ['api', 3000],
      ['worker', 3001],
      ['scheduler', 3002],
    ] as const) {
      const parsed = validateConfig(
        omit({ ...VALID_CONFIG, SERVICE_NAME: service }, ['PORT']),
      );
      expect(parsed.PORT).toBe(port);

      const overridden = validateConfig({
        ...VALID_CONFIG,
        SERVICE_NAME: service,
        PORT: '4100',
      });
      expect(overridden.PORT).toBe(4100);
    }
  });

  /**
   * WINDOWS.md entry 12. The OTel SDK reads `OTEL_EXPORTER_OTLP_ENDPOINT`
   * straight from the environment, so before this key existed a typo produced a
   * process with no traces and no error. Absent is legal (telemetry must never
   * stop a boot); malformed is not.
   */
  it('accepts an absent OTLP endpoint and rejects a malformed one (FND-09)', () => {
    expect(
      validateConfig(omit(VALID_CONFIG, ['OTEL_EXPORTER_OTLP_ENDPOINT']))
        .OTEL_EXPORTER_OTLP_ENDPOINT,
    ).toBeUndefined();
    expect(
      validateConfig({
        ...VALID_CONFIG,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      }).OTEL_EXPORTER_OTLP_ENDPOINT,
    ).toBe('http://collector:4318');

    expect(() =>
      validateConfig({ ...VALID_CONFIG, OTEL_EXPORTER_OTLP_ENDPOINT: 'collector:4318' }),
    ).toThrowError(/^CONFIG_INVALID: OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it('throws a named CONFIG_INVALID error naming a missing required Redis URL', () => {
    expect(() => validateConfig(omit(VALID_CONFIG, ['REDIS_QUEUE_URL']))).toThrowError(
      /^CONFIG_INVALID: REDIS_QUEUE_URL invalid_type$/,
    );
  });

  it('throws a named CONFIG_INVALID error with the invalid_type code for a non-numeric PORT', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, PORT: 'abc' })).toThrowError(
      /^CONFIG_INVALID: PORT invalid_type$/,
    );
  });

  it('rejects an unknown key via .strict()', () => {
    expect(() =>
      validateConfig({ ...VALID_CONFIG, UNKNOWN_KEY: 'x' }),
    ).toThrowError(/^CONFIG_INVALID: <root> unrecognized_keys$/);
  });

  it('treats an empty-string value as invalid rather than coercing to a default', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, NODE_ENV: '' })).toThrowError(
      /^CONFIG_INVALID: NODE_ENV/,
    );
    expect(() => validateConfig({ ...VALID_CONFIG, PORT: '' })).toThrowError(
      /^CONFIG_INVALID: PORT/,
    );
  });

  it('exposes exactly the declared key set to the boot hook', () => {
    expect([...APP_CONFIG_KEYS].sort()).toEqual(
      Object.keys(VALID_CONFIG).sort(),
    );
    expect(Object.keys(AppConfigObjectSchema.shape).sort()).toEqual(
      Object.keys(VALID_CONFIG).sort(),
    );
  });
});
