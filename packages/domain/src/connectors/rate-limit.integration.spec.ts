import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createRedisClient } from '@akane/platform';

import { ConnectorRegistry, ConnectorNotFoundError } from './connector.registry.js';
import {
  ConnectorRateLimiter,
  DEFAULT_CONNECTOR_LIMIT,
  parseConnectorLimit,
} from './connector-rate-limiter.js';
import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

/**
 * CON-05 — the connector rate limiter, keyed on the connector INSTANCE.
 *
 * These run against a **real Redis** (Testcontainers), because the requirement's
 * load-bearing word is *shared*: a limiter that passed only within one process
 * would not stop two worker replicas from each sending the full budget. The two
 * `ConnectorRateLimiter` instances below stand in for two processes — they share
 * one Redis and therefore one budget, which is the whole claim.
 *
 * ## Why the previous version of this file was skipped
 *
 * It previously asserted `expect(true).toBe(true)`, reporting green against an
 * unimplemented requirement. It is now a real test of real behaviour.
 */
describe('Connector rate limiting (CON-05)', () => {
  let containers: ThreeContainers;
  let redis1: ReturnType<typeof createRedisClient>;
  let redis2: ReturnType<typeof createRedisClient>;

  beforeAll(async () => {
    containers = await startThreeContainers();
    redis1 = createRedisClient({ url: containers.urls.cache, profile: 'producer' });
    redis2 = createRedisClient({ url: containers.urls.cache, profile: 'producer' });
    await redis1.connect();
    await redis2.connect();
    await redis1.flushall();
  }, 120000);

  afterAll(async () => {
    await redis1?.quit();
    await redis2?.quit();
    await containers?.stop();
  });

  it('shared connector budget — two apps, two processes, one budget', async () => {
    // Two limiter instances = two worker replicas / two apps referencing the same
    // connector instance. The key carries the connector ref and nothing else.
    const replicaA = new ConnectorRateLimiter(redis1);
    const replicaB = new ConnectorRateLimiter(redis2);
    const budget = { max: 2, windowMs: 60_000 };

    const first = await replicaA.consume('conn-shared', budget);
    expect(first.allowed).toBe(true);
    expect(first.count).toBe(1);

    const second = await replicaB.consume('conn-shared', budget);
    expect(second.allowed).toBe(true);
    expect(second.count).toBe(2); // sees replica A's hit — the budget is shared

    const third = await replicaB.consume('conn-shared', budget);
    expect(third.allowed).toBe(false); // the budget is exhausted, whichever replica asks
    expect(third.count).toBe(3);
    expect(third.resetInMs).toBeGreaterThan(0);
  });

  it('keeps distinct connector instances independent', async () => {
    const limiter = new ConnectorRateLimiter(redis1);
    const budget = { max: 1, windowMs: 60_000 };

    const alpha = await limiter.consume('conn-alpha', budget);
    expect(alpha.allowed).toBe(true);
    expect(alpha.count).toBe(1);

    // A second connector instance has its own counter, even with an identical config.
    const beta = await limiter.consume('conn-beta', budget);
    expect(beta.allowed).toBe(true);
    expect(beta.count).toBe(1);

    // And the first connector is still exhausted at its own limit.
    const alphaAgain = await limiter.consume('conn-alpha', budget);
    expect(alphaAgain.allowed).toBe(false);
    expect(alphaAgain.count).toBe(2);
  });

  it('rejects an unknown connector_ref before the limiter (fail-closed)', async () => {
    const registry = new ConnectorRegistry();

    // Unknown ref → the registry throws; `limiterConfig` never returns a value,
    // so no default can be silently applied to a connector that does not exist.
    expect(() => registry.limiterConfig('does-not-exist')).toThrow(ConnectorNotFoundError);
  });

  it('gives a connector with no declared limit the conservative default, never unlimited', () => {
    const registry = new ConnectorRegistry();
    registry.register({
      connectorRef: 'conn-no-config',
      adapter: {} as never,
    });
    expect(registry.limiterConfig('conn-no-config')).toEqual(DEFAULT_CONNECTOR_LIMIT);

    // And a declared limit is honoured.
    registry.register({
      connectorRef: 'conn-configured',
      adapter: {} as never,
      limit: { max: 10, windowMs: 60_000 },
    });
    expect(registry.limiterConfig('conn-configured')).toEqual({ max: 10, windowMs: 60_000 });
  });

  it('parses the seed rate_limit shape and refuses an absent or invalid one', () => {
    expect(parseConnectorLimit({ requests_per_minute: 30 })).toEqual({
      max: 30,
      windowMs: 60_000,
    });
    // Absent / non-object / non-numeric / below one → unconfigured (default applies).
    expect(parseConnectorLimit(undefined)).toBeUndefined();
    expect(parseConnectorLimit({})).toBeUndefined();
    expect(parseConnectorLimit({ requests_per_minute: '60' })).toBeUndefined();
    expect(parseConnectorLimit({ requests_per_minute: 0 })).toBeUndefined();
  });
});
