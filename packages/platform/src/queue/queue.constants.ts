/**
 * BullMQ key prefix (D-14).
 *
 * The `{...}` hash tag forces every BullMQ key into one Redis Cluster slot, so
 * queue commands that touch several keys stay co-located. Accepted knowingly:
 * queue throughput therefore does not shard, and that slot is a documented
 * throughput and memory ceiling. Never pair this with ioredis `keyPrefix` —
 * BullMQ's Lua scripts embed literal key names that `keyPrefix` does not
 * rewrite, producing two prefixing layers that disagree about where keys live.
 */
export const BULLMQ_PREFIX = '{akane-q}';

/**
 * The inbound IM event queue — the ingest seam between the receivers and the
 * routing pipeline (IM-10).
 *
 * Producer: `apps/api` — `TeamsController` (and every later IM receiver)
 * enqueues one `InboundEvent` per activity and returns inside the <200 ms ack
 * budget (D-13).
 * Consumer: `apps/worker` — `InboundEventProcessor` is the only `@Processor`
 * bound to this name.
 *
 * Both ends reference **this constant**. A literal on either side is exactly how
 * the `'im:inbound'` (api) vs `'inbound-events'` (worker) mismatch shipped and
 * left every Teams activity enqueued to a queue nothing consumed.
 */
export const INBOUND_EVENTS_QUEUE = 'inbound-events';

/**
 * The notification-send queue — the outbound chat notification seam (NOT-04).
 *
 * Producer: `apps/api` — `ExternalWebhookService.enqueueNotification` enqueues
 * one job per verified external webhook, with `attempts: 3` and the
 * `notification-jitter` backoff strategy (D-13).
 * Consumer: `apps/worker` — the notification processor registers the matching
 * `notification-jitter` `BackoffStrategy` against this name (08-08).
 */
export const NOTIFICATION_SEND_QUEUE = 'notification-send';
