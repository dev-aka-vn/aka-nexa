import { z } from 'zod';

/**
 * The inbound IM envelope — the **only** shape an adapter may hand the
 * platform (D-01/D-02: adapters reach `contract` for event shapes and nothing
 * else).
 *
 * ## Identifiers are opaque and platform-scoped
 *
 * `chat_user_id` is the IM platform's identifier for the speaker. It becomes a
 * `real_user_id` only after identity resolution, and it is never a name, an
 * email or a handle. Nothing on this envelope is a PII attribute: there is no
 * `user_email`, no `display_name`, no `phone`, no `avatar`, and `.strict()`
 * means adding one is a rejected document rather than a silent field.
 *
 * `text` is the user's own message. That is user-authored content, not a PII
 * attribute, and it is required — an event without it cannot be routed to
 * anything. It inherits the submission's retention window.
 *
 * ## Field names are log-allowlist-safe on purpose (D-16)
 *
 * `action`, `app_id`, `form_id`, `queue` and `attempt` are drawn from the
 * frozen log-field vocabulary, so an envelope field is never simultaneously a
 * candidate for a serialised log record. `event_id` and `channel_id` are not
 * on the log allowlist and are not logged.
 */
export const ImPlatformSchema = z.enum(['slack', 'teams', 'zalo', 'telegram']);

export type ImPlatform = z.infer<typeof ImPlatformSchema>;

/** What the user did on the IM side. */
export const InboundActionSchema = z.enum([
  'message',
  'slash_command',
  'interaction',
  'event',
]);

export type InboundAction = z.infer<typeof InboundActionSchema>;

const opaqueId = z.string().min(1);

export const InboundEventSchema = z
  .object({
    /** Adapter-assigned, unique per delivery attempt chain. */
    event_id: opaqueId,
    platform: ImPlatformSchema,
    /** The IM-side conversation identifier. Opaque. */
    channel_id: opaqueId,
    /** The IM-side user identifier. Resolved to `real_user_id` downstream. */
    chat_user_id: opaqueId,
    text: z.string(),
    action: InboundActionSchema,
    /** Present when the user addressed or interacted with a specific app. */
    app_id: opaqueId.optional(),
    form_id: opaqueId.optional(),
    /** The ingest queue this event is bound to. The receiver enqueues and returns in <200 ms. */
    queue: z.string().min(1),
    /** Delivery attempt number, zero-based. Never negative. */
    attempt: z.number().int().nonnegative(),
    /** When the platform received the event, ISO-8601 UTC. */
    occurred_at: z.string().datetime(),
  })
  .strict();

export type InboundEvent = z.infer<typeof InboundEventSchema>;
