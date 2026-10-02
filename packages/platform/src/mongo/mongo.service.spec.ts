import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startThreeContainers,
  type ThreeContainers,
} from '../../../../tooling/containers.js';
import { MongoService } from './mongo.service.js';

/**
 * `MongoService` against a real MongoDB 8.0 (D-07, FND-05).
 *
 * A fake driver would prove nothing here: the behaviour under test is that the
 * native driver actually issues `ping` and actually *rejects* when the server
 * goes away — the second half being the property the readiness indicator
 * depends on. A stub that always resolves would satisfy the first assertion and
 * silently break the second.
 *
 * **Test order matters.** The three tests share one container set, and the last
 * one tears MongoDB down. Vitest runs `it` blocks in declaration order within a
 * file, so the "container stopped" case must stay last; moving it up would
 * cascade the failure into the tests above it for the wrong reason.
 */
describe('MongoService over the native driver (FND-05)', () => {
  let containers: ThreeContainers;
  let mongo: MongoService;

  beforeAll(async () => {
    containers = await startThreeContainers();
    mongo = new MongoService(containers.urls.mongo);
  }, 300_000);

  afterAll(async () => {
    await mongo?.onModuleDestroy();
    await containers?.stop();
  }, 300_000);

  it('starts MongoDB, a cache Redis and a queue Redis, each addressable', async () => {
    expect(containers.mongo).toBeDefined();
    expect(containers.cache).toBeDefined();
    expect(containers.queue).toBeDefined();

    expect(containers.urls.mongo).toMatch(/^mongodb:\/\//);
    expect(containers.urls.cache).toMatch(/^redis:\/\//);
    expect(containers.urls.queue).toMatch(/^redis:\/\//);
  });

  it('resolves ping() while the server is up', async () => {
    await expect(mongo.ping()).resolves.toBeUndefined();
  });

  it('rejects ping() within the selection timeout once the server is gone', async () => {
    await containers.mongo.stop();

    // The *reason* is asserted, not merely that something threw: a `ping()`
    // that failed for an unrelated reason (a bug, a closed client) would also
    // reject, and the readiness indicator would report a healthy MongoDB as
    // down for the wrong reason — or, worse, a real outage would look like a
    // pass because the error was swallowed somewhere.
    await expect(mongo.ping()).rejects.toThrow(/server selection|ECONNREFUSED/i);
  }, 30_000);
});
