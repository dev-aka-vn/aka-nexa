import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { INBOUND_ADAPTER_REGISTRATIONS } from '@akane/platform';

import { ApiAdapterCoverageRunner } from './adapter-coverage.runner.js';

/** The registration list that matches `IM_ADAPTER_WIRING`'s inbound half. */
const API_OK = ['slack', 'teams'] as const;

/**
 * OUT-03's boot assertion, exercised for real.
 *
 * The runner is driven through Nest's lifecycle rather than called directly,
 * because the property under test is "a violation aborts startup" — and that
 * is a property of `onApplicationBootstrap` firing against a container, not of
 * a pure function. The api runner is the one under test because it is the half
 * whose registration list is a hand-maintained declaration, which is the half
 * that can drift.
 */

/** Boot a module with the given registration list and return the app. */
async function boot(registrations: readonly string[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      {
        module: class Holder {},
        providers: [
          { provide: INBOUND_ADAPTER_REGISTRATIONS, useValue: registrations },
        ],
        exports: [INBOUND_ADAPTER_REGISTRATIONS],
      },
    ],
    providers: [ApiAdapterCoverageRunner],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('ApiAdapterCoverageRunner (OUT-03)', () => {
  it('boots when the registrations match the declaration', async () => {
    const app = await boot([...API_OK]);
    await app.close();
    expect(app).toBeDefined();
  });

  it('aborts boot when a declared platform has no receiver', async () => {
    // teams is declared inbound in IM_ADAPTER_WIRING; removing it leaves the
    // receiver for a wired platform missing — every event it sends is dropped.
    await expect(boot(['slack'])).rejects.toThrow(/inbound adapter declared for teams/);
  });

  it('aborts boot when a platform is registered twice', async () => {
    await expect(boot([...API_OK, 'slack'])).rejects.toThrow(/has 2 inbound adapters/);
  });

  it('aborts boot when a registration names an undeclared platform', async () => {
    // Telegram has no receiver until Phase 13. A registration for it means
    // either the declaration is stale or a receiver is mounted early — either
    // way the operator must say which, not discover it in production.
    await expect(boot([...API_OK, 'telegram'])).rejects.toThrow(
      /inbound adapter registered for undeclared platform telegram/,
    );
  });
});
