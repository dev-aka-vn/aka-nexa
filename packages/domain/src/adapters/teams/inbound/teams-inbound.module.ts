import { Module } from '@nestjs/common';

import { PlatformEventRepository } from '../../../platform-events/platform-event.repository.js';
import { TeamsEventRepository } from './data-access/teams-event.repository.js';

/**
 * The Teams inbound adapter.
 *
 * `PlatformEventRepository` is provided here because `TeamsEventRepository` is
 * now a facade over the neutral ledger. It is NOT exported: the ledger belongs
 * to `platform-events`, and exporting it from a platform-specific module would
 * make the worker's reconciler import the Teams adapter to reach it — exactly
 * the coupling OUT-09's neutral location exists to break.
 */
@Module({
  providers: [PlatformEventRepository, TeamsEventRepository],
  exports: [TeamsEventRepository],
})
export class TeamsInboundModule {}
