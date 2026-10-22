import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';

import { INBOUND_ADAPTER_REGISTRATIONS } from '@akane/platform';
import { assertRegistrations } from '@akane/domain';
import type { ImPlatform } from '@akane/contract';

/**
 * Which platforms this api composition root mounts an inbound receiver for.
 *
 * Deliberately a declaration rather than a derivation: Nest gives no way to
 * ask "which controllers are in the graph" that does not read like this list
 * rewritten, and the *value* of the list is that adding a platform means
 * editing one line here — which is also exactly what OUT-03's assertion
 * checks, so a stale list fails boot instead of drifting.
 *
 * `slack` and `teams` are wired (SlackWebhookController/SlackCommandsController
 * and TeamsController, both mounted in `app.module.ts`). Zalo and Telegram
 * land in Phases 12 and 13 and add a line each.
 */
export const API_INBOUND_ADAPTERS: readonly ImPlatform[] = Object.freeze([
  'slack',
  'teams',
]);

/**
 * OUT-03's api half: assert this build's inbound registrations match the
 * shared adapter-coverage declaration.
 *
 * The mirror of `apps/worker/src/bootstrap/adapter-coverage.runner.ts`. Each
 * process asserts only the direction it owns, because the split between them
 * is the boundary: a receiver must never hold a delivery port (T-10-06), so
 * asserting one direction per process is the only honest reading of "every
 * platform has exactly one of each" here.
 */
@Injectable()
export class ApiAdapterCoverageRunner implements OnApplicationBootstrap {
  constructor(
    @Inject(INBOUND_ADAPTER_REGISTRATIONS)
    private readonly platforms: readonly ImPlatform[],
  ) {}

  onApplicationBootstrap(): void {
    assertRegistrations(
      {
        direction: 'inbound',
        entries: this.platforms.map((platform) => ({
          platform,
          adapter: `inbound receiver (${platform})`,
        })),
      },
      'api',
    );
  }
}
