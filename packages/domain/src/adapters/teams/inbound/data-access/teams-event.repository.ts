import { Injectable } from '@nestjs/common';

import {
  PlatformEventRepository,
  type PlatformEventInsertResult,
} from '../../../../platform-events/platform-event.repository.js';

/** Retained for the existing Teams receiver; the values are platform-wide now. */
export type TeamsEventInsertResult = PlatformEventInsertResult;

/**
 * Teams-scoped facade over {@link PlatformEventRepository}.
 *
 * ## Why this still exists
 *
 * The ledger was generalized because a Teams-shaped one could not serve Slack,
 * Telegram or Zalo (CONTEXT: "Ledger location"). But the Teams receiver
 * (`apps/api/src/adapters/teams/teams-activity.service.ts`) and
 * `TeamsInboundModule` are wired against this class, and the class name is part
 * of the `@akane/domain/adapters/teams/inbound/data-access/teams-event.repository.js`
 * subpath API. Keeping a thin adapter instead of rewriting the receiver in the
 * same commit keeps each commit atomic: the ledger move (this plan) and the
 * receiver seam (10-04/10-05) land separately.
 *
 * The adapter holds **no state of its own** — no client, no timeouts, no index
 * promise. Two independent clients on the same collection would mean two
 * copies of the ack-path timeout budget, and the second one would be the one
 * that silently drifts.
 *
 * @deprecated New receivers should depend on `PlatformEventRepository` directly;
 * this exists for the Teams wiring that predates the generalization.
 */
@Injectable()
export class TeamsEventRepository {
  constructor(private readonly ledger: PlatformEventRepository) {}

  insert(platformEventId: string, payload: unknown): Promise<TeamsEventInsertResult> {
    return this.ledger.record({ platform: 'teams', platformEventId, payload });
  }
}
