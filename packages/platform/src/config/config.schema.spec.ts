import { describe, expect, it } from 'vitest';
import { APP_CONFIG_KEYS, AppConfigSchema, validateConfig } from './config.schema.js';

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

  it('defaults NODE_ENV, PORT and CRYPTO_KEY_PROVIDER when absent', () => {
    const parsed = validateConfig(
      omit(VALID_CONFIG, ['NODE_ENV', 'PORT', 'CRYPTO_KEY_PROVIDER']),
    );

    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(3000);
    expect(parsed.CRYPTO_KEY_PROVIDER).toBe('local');
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
    expect(Object.keys(AppConfigSchema.shape).sort()).toEqual(
      Object.keys(VALID_CONFIG).sort(),
    );
  });
});
