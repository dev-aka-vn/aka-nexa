import { describe, expect, it } from 'vitest';

import { ConnectorDescriptorSchema } from './connector.js';

/**
 * DAT-13. The PRD's `FR-D-12` promised write-once against the downstream
 * system; the amendment is that the platform guarantees a single **send** per
 * submission, and write-once against the downstream additionally requires
 * either downstream idempotency-key support or a natural-key pre-check.
 *
 * So the flag is not documentation. It is the input to a decision the App
 * Builder surfaces at publish time, which is why it is a **required** field of
 * the descriptor: a connector that omits it is not "unspecified", it is
 * rejected, because an omitted flag read as `false` would silently select the
 * pre-check strategy for a connector that might have supported the key.
 */
describe('ConnectorDescriptorSchema (DAT-13)', () => {
  const base = { id: 'hr-leave-request', name: 'HR Leave Request' } as const;

  it('accepts a connector that supports an idempotency key', () => {
    const result = ConnectorDescriptorSchema.safeParse({
      ...base,
      supports_idempotency_key: true,
    });

    expect(result.success).toBe(true);
  });

  it('accepts a connector that does not, and records the fact explicitly', () => {
    const result = ConnectorDescriptorSchema.safeParse({
      ...base,
      supports_idempotency_key: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supports_idempotency_key).toBe(false);
    }
  });

  it('rejects a descriptor that omits supports_idempotency_key', () => {
    const result = ConnectorDescriptorSchema.safeParse(base);

    expect(result.success).toBe(false);
  });

  it('rejects a non-boolean flag, so a string "false" cannot read as truthy', () => {
    expect(
      ConnectorDescriptorSchema.safeParse({ ...base, supports_idempotency_key: 'false' })
        .success,
    ).toBe(false);
  });
});
