import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConfigModule, namedValidate } from './config.module.js';

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

    await moduleRef.close();
  });

  it('throws a named CONFIG_INVALID error when PORT is non-numeric', () => {
    expect(() =>
      namedValidate({ NODE_ENV: 'test', PORT: 'abc' }),
    ).toThrowError(/^CONFIG_INVALID: /);
  });

  it('defaults NODE_ENV and PORT when they are absent', () => {
    const parsed = namedValidate({});
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(3000);
  });
});
