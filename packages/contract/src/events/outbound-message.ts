import { z } from 'zod';

import { ImPlatformSchema } from './inbound-event.js';

/**
 * The outbound IM envelope — the only shape the platform may hand an adapter
 * for delivery.
 *
 * Mirrors `InboundEvent` deliberately: one vocabulary of opaque identifiers in
 * both directions is what lets an adapter be written once and reused, and it
 * means the fields that must never carry PII are named identically on both
 * sides, so a review of one is a review of the other.
 *
 * The `action` union is the reason the platform's replies are inspectable: it
 * distinguishes a rendered form link from a confirmation, an error, or a status
 * update, so an operator can tell "the bot broke" from "the form was rejected"
 * without reading the message body.
 */
export const OutboundActionSchema = z.enum([
  'reply',
  'form_link',
  'confirmation',
  'error',
  'status',
]);

export type OutboundAction = z.infer<typeof OutboundActionSchema>;

const opaqueId = z.string().min(1);

const platformMetadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

export const OutboundMessageSchema = z
  .object({
    /** Producer-generated, unique per outbound message, stable across delivery retries. */
    message_id: opaqueId,
    platform: ImPlatformSchema,
    channel_id: opaqueId,
    chat_user_id: opaqueId,
    /** Required: an outbound message with no body is not sendable. */
    text: z.string().min(1),
    action: OutboundActionSchema,
    app_id: opaqueId.optional(),
    form_id: opaqueId.optional(),
    queue: z.string().min(1),
    /** Send attempt number, zero-based. Never negative. */
    attempt: z.number().int().nonnegative(),
    /** Deferred delivery. Absent means send now. */
    scheduled_for: z.string().datetime().optional(),
    /** Thread identifier for threading context. */
    thread_id: opaqueId.optional(),
    /** Message id to reply to. */
    reply_to_message_id: opaqueId.optional(),
    /** Platform-native event/message id for ledger correlation. */
    native_event_id: opaqueId.optional(),
    /** Adapter-scoped, non-PII only; depth-1 primitives. Never log/span attributes. */
    platform_metadata: platformMetadataSchema.optional(),
  })
  .strict();

export type OutboundMessage = z.infer<typeof OutboundMessageSchema>;
