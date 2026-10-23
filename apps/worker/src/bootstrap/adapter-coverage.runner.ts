import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';

import { OUTBOUND_DELIVERY_REGISTRATIONS } from '@akane/platform';
import { assertRegistrations } from '@akane/domain';
import type { ImPlatform } from '@akane/contract';

/**
 * OUT-03's worker half: assert this build's outbound registrations match the
 * shared adapter-coverage declaration.
 *
 * The registration list is the `OUTBOUND_DELIVERY_REGISTRATIONS` capability
 * token — the same value the api manifest forbids and this manifest names as
 * allowed. Reading the assertion off that token means a port registered in
 * code but missing from the declaration cannot pass boot.
 *
 * Runs in `onApplicationBootstrap`, the instant `ProviderBoundaryGuardRunner`
 * uses, for its reason: Nest has instantiated every non-lazy provider, and the
 * hook fires inside `app.listen()` before the queue connections accept work.
 * A misconfigured platform therefore aborts a worker that never consumed an
 * event, rather than dropping the first reply silently.
 */
@Injectable()
export class AdapterCoverageRunner implements OnApplicationBootstrap {
  constructor(
    @Inject(OUTBOUND_DELIVERY_REGISTRATIONS)
    private readonly platforms: readonly ImPlatform[],
  ) {}

  onApplicationBootstrap(): void {
    assertRegistrations(
      {
        direction: 'outbound',
        entries: this.platforms.map((platform) => ({
          platform,
          adapter: `outbound delivery port (${platform})`,
        })),
      },
      'worker',
    );
  }
}
