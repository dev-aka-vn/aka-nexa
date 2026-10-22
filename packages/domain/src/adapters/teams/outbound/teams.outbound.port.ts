import type { OutboundMessage } from '@akane/contract';

/**
 * The Teams outbound delivery port (OUT-12).
 *
 * ## Why the interface lives here and the implementation does not
 *
 * `outbound-adapter` is a boundary **file category**
 * (`tooling/boundaries.config.mjs`), and R1 restricts it to `app-worker`:
 *
 * > `from: { element: { type: '!(app-worker)' } }` disallows
 * > `to: { file: { categories: ['outbound-adapter'] } }`
 *
 * The api receiver must never reach a delivery implementation — delivery is a
 * worker capability, and a receiver that imported it could send inside the
 * <200 ms ack path (T-10-06, elevation of privilege). Putting the *interface*
 * under this path satisfies OUT-12's "outbound delivery for each platform lives
 * in the platform's adapter directory" without dragging the SDK, the
 * conversation-reference lookup or credentials into the request path. The
 * concrete class lives in `apps/worker/src/adapters/teams/outbound/`.
 *
 * ## The one permitted import
 *
 * `@akane/contract` only. The `adapters` element may import `platform`,
 * `kernel`, `contract` and `platform-events` — a port that needed a repository
 * would be an implementation, not a port.
 */
export interface TeamsOutboundPort {
  /**
   * Deliver `message` to its originating Teams conversation.
   *
   * Implementations resolve the conversation reference from
   * `(platform, channel_id, chat_user_id)` — the envelope carries addressing,
   * never the continuation payload — and rethrow retryable transport failures
   * (429 / 5xx / resets) so BullMQ's jittered backoff applies, while wrapping a
   * terminal failure in a non-retryable error.
   */
  send(message: OutboundMessage): Promise<void>;
}
