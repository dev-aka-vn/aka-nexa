import type { OutboundMessage } from '@akane/contract';

/**
 * The Slack outbound delivery port (OUT-12).
 *
 * The interface is declared here, beside the Slack inbound adapter, because
 * OUT-12 places each platform's outbound seam under that platform's adapter
 * directory. The implementation belongs in
 * `apps/worker/src/adapters/slack/outbound/` — `outbound-adapter` is a boundary
 * category R1 reserves for `app-worker`, so the api receiver cannot import a
 * delivery implementation (T-10-06).
 *
 * ### Phase 10 scope
 *
 * Only the port ships in this phase. Slack has no bot-token configuration and
 * no Slack Web API client in the dependency graph yet — the inbound receiver
 * (10-05) and the conversation-reference write land first, and the delivery
 * implementation follows once a conversation reference for a Slack
 * `(channel_id, chat_user_id)` pair can actually exist. Shipping an
 * implementation with no writer for its addressing data would be a stub, which
 * is exactly what this port exists to prevent.
 *
 * Imports `@akane/contract` only — the `adapters` element's allowed edge set.
 */
export interface SlackOutboundPort {
  /**
   * Deliver `message` to its originating Slack conversation.
   *
   * Same contract as the Teams port: addressing comes from the envelope,
   * retryable transport failures are rethrown untouched, terminal failures are
   * wrapped non-retryable.
   */
  send(message: OutboundMessage): Promise<void>;
}
