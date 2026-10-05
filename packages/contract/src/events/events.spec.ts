import { describe, expect, it } from 'vitest';

import { InboundEventSchema } from './inbound-event.js';
import { OutboundMessageSchema } from './outbound-message.js';

/**
 * The internal IM envelopes.
 *
 * These are the only shape an adapter may hand the platform, and the only
 * shape the platform may hand an adapter. Every identifier on them is
 * **opaque and platform-scoped** — `chat_user_id` becomes a `real_user_id` only
 * after identity resolution, and nothing here is a name, an email, a phone
 * number or a display handle. The field names are drawn from the same
 * allowlist-safe vocabulary the log allowlist uses (`action`, `app_id`,
 * `form_id`, `queue`, `attempt`) so an envelope field is never also a
 * candidate for a log record.
 *
 * `text` carries the user's own message, which is user-authored content rather
 * than a PII attribute; it is required because an event without it cannot be
 * routed to anything. It is subject to the submission's own retention window.
 */
const INBOUND = {
  event_id: 'evt_01',
  platform: 'slack',
  channel_id: 'C0123',
  chat_user_id: 'U0456',
  text: '/leave next week',
  action: 'slash_command',
  app_id: 'hr-leave-request',
  form_id: 'leave_form',
  queue: 'akane:im:ingest',
  attempt: 0,
  occurred_at: '2026-10-02T09:00:00.000Z',
} as const;

const OUTBOUND = {
  message_id: 'msg_01',
  platform: 'slack',
  channel_id: 'C0123',
  chat_user_id: 'U0456',
  text: 'Here is your leave request form: https://forms.akane.example/l/abc',
  action: 'form_link',
  app_id: 'hr-leave-request',
  form_id: 'leave_form',
  queue: 'akane:im:outbound',
  attempt: 1,
  scheduled_for: '2026-10-02T09:00:05.000Z',
} as const;

describe('InboundEventSchema', () => {
  it('parses the documented envelope', () => {
    const result = InboundEventSchema.safeParse(INBOUND);

    expect(result.success).toBe(true);
  });

  it('rejects an unlisted field rather than stripping it', () => {
    expect(InboundEventSchema.safeParse({ ...INBOUND, user_email: 'a@b.example' }).success).toBe(
      false,
    );
  });

  it('keeps a negative retry count out of the envelope', () => {
    expect(InboundEventSchema.safeParse({ ...INBOUND, attempt: -1 }).success).toBe(false);
  });
});

describe('OutboundMessageSchema', () => {
  it('parses the documented envelope', () => {
    const result = OutboundMessageSchema.safeParse(OUTBOUND);

    expect(result.success).toBe(true);
  });

  it('rejects an unlisted field rather than stripping it', () => {
    expect(OutboundMessageSchema.safeParse({ ...OUTBOUND, display_name: 'Anna' }).success).toBe(
      false,
    );
  });

  it('requires text — an outbound message with no body is not sendable', () => {
    const bodyless = { ...OUTBOUND } as Record<string, unknown>;
    delete bodyless.text;

    expect(OutboundMessageSchema.safeParse(bodyless).success).toBe(false);
  });
});
