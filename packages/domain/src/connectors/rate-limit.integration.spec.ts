import { describe, it } from 'vitest';

/**
 * CON-05 / CON-06 — the connector rate limiter, keyed on the connector INSTANCE.
 *
 * ## Why these are skipped rather than passing
 *
 * Phase 05 plan 05-05 delivered the *storage* primitive
 * (`apps/api/src/common/throttler/throttler-storage-redis.ts`) but nothing
 * consumes it: the connector delivery path never consults a budget, no
 * `ThrottlerModule` is registered, and `@nestjs/throttler` is not a dependency of
 * this repo. The plan's `<action>` says to "keep the existing interface shape so
 * it drops into the existing throttler wiring" — that wiring has never existed.
 * The file also sits in `apps/api` while its only plausible consumer is the
 * worker's delivery processor, so the placement is wrong for its purpose.
 *
 * These cases previously asserted `expect(true).toBe(true)`, so they reported
 * green against an unimplemented requirement. Skipping them makes the gap
 * visible instead of disguising it.
 *
 * Closing them needs a product decision the plan does not make — the per-connector
 * budget, the window, and what an over-budget call does to the submission (retry
 * as transient, or fail the submission for that app). Inventing those numbers here
 * would be inventing product policy, so they are recorded in `05-GAPS.md` instead.
 */
describe('Connector rate limiting (CON-05, CON-06)', () => {
  it.skip('is keyed on connector instance (not app_id/user)', () => {
    // Blocked: no limiter exists to key, and the storage is never consulted.
  });

  it.skip('separates credential_rejected from endpoint_unreachable in metrics', () => {
    // Blocked: the CON-06 metric split needs a real delivery run to observe.
  });

  it.skip('rejects unknown connector_ref before the limiter (fail-closed)', () => {
    // Blocked: the fail-closed ruling is unimplemented.
  });
});
