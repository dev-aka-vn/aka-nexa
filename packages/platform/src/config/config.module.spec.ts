import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConfigModule, namedValidate } from './config.module.js';

/**
 * The keys the boot contract requires in addition to the two that carry
 * defaults. `test/setup-env.ts` supplies these for specs that compile the
 * module; the direct `namedValidate` assertions below pass them explicitly so
 * each test isolates the behaviour it names.
 */
const REQUIRED_ENV = {
  NODE_ENV: 'test',
  SERVICE_NAME: 'api',
  MONGO_URL: 'mongodb://127.0.0.1:27017/akane',
  REDIS_CACHE_URL: 'redis://127.0.0.1:6379',
  REDIS_QUEUE_URL: 'redis://127.0.0.1:6380',
};

describe('ConfigModule — Zod-validated boot config (FND-09)', () => {
  it('boots and resolves a valid configuration', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
    }).compile();

    const config = moduleRef.get(ConfigService);
    const port = config.get<number>('PORT');
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
    expect(['development', 'test', 'production']).toContain(
      config.get<string>('NODE_ENV'),
    );
    expect(['local', 'kms']).toContain(config.get<string>('CRYPTO_KEY_PROVIDER'));

    await moduleRef.close();
  });

  it('throws a named CONFIG_INVALID error when PORT is non-numeric', () => {
    expect(() =>
      namedValidate({ ...REQUIRED_ENV, NODE_ENV: 'test', PORT: 'abc' }),
    ).toThrowError(/^CONFIG_INVALID: PORT invalid_type$/);
  });

  it('throws a named CONFIG_INVALID error when a required Redis URL is missing', () => {
    const withoutQueue = Object.fromEntries(
      Object.entries(REQUIRED_ENV).filter(([key]) => key !== 'REDIS_QUEUE_URL'),
    );
    expect(() => namedValidate(withoutQueue)).toThrowError(
      /^CONFIG_INVALID: REDIS_QUEUE_URL/,
    );
  });

  it('defaults PORT when it is absent, and requires NODE_ENV rather than assuming it', () => {
    // CR-01: `NODE_ENV` is the one declared key with no default. The schema
    // refuses an absent one so a container that forgets to declare its
    // environment fails here instead of inheriting developer behaviour all the
    // way into the crypto guard.
    const withoutNodeEnv = { ...REQUIRED_ENV };
    delete (withoutNodeEnv as Record<string, unknown>)['NODE_ENV'];
    expect(() => namedValidate(withoutNodeEnv)).toThrowError(
      /^CONFIG_INVALID: NODE_ENV invalid_value$/,
    );

    const parsed = namedValidate({ ...REQUIRED_ENV, NODE_ENV: 'development' });
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(3000);
  });

  /**
   * WINDOWS.md entry 6. `ConfigModule.forRoot()` is async and was called at
   * module scope, so `ConfigService` served a snapshot taken at **import** time
   * and preferred it over the live environment. This test is the regression
   * guard: the value is set after this file's imports have already run, which is
   * exactly the window in which the old implementation answered `test`.
   */
  it('reads the environment at DI time, not at module-import time (WINDOWS.md 6)', async () => {
    const restore = swapEnv('NODE_ENV', 'production');
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule],
      }).compile();

      expect(moduleRef.get(ConfigService).get<string>('NODE_ENV')).toBe('production');

      await moduleRef.close();
    } finally {
      restore();
    }
  });

  it('still fails boot with a named CONFIG_INVALID error (FND-09)', async () => {
    const restore = swapEnv('MONGO_URL', undefined);
    try {
      await expect(
        Test.createTestingModule({ imports: [ConfigModule] }).compile(),
      ).rejects.toThrowError(/^CONFIG_INVALID: MONGO_URL/);
    } finally {
      restore();
    }
  });
});

/**
 * Set a boot key for the duration of one test and put it back exactly as it was.
 *
 * `test/setup-env.ts` seeds these globally and vitest reuses worker processes
 * across spec files, so "set it and forget it" would leak into whichever file
 * runs next — including the assertion that a *missing* key is a boot failure.
 * Deleting rather than writing `undefined` matters: `process.env.X = undefined`
 * stores the **string** `'undefined'`, which Zod would happily accept as a URL
 * scheme-relative string and fail on for a reason that is not the one under test.
 */
function swapEnv(key: string, value: string | undefined): () => void {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  };
}
