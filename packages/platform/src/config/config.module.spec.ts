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

  it('defaults NODE_ENV and PORT when they are absent', () => {
    const parsed = namedValidate({ ...REQUIRED_ENV });
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(3000);
  });
});
