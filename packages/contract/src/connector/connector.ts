import { z } from 'zod';

/**
 * The connector seam, and DAT-13's amendment of `FR-D-12`.
 *
 * The PRD's `FR-D-12` promised write-once against the downstream system. The
 * amendment keeps what the platform can actually guarantee — **a single send
 * per submission** — and states the rest honestly: write-once against the
 * downstream additionally requires either downstream idempotency-key support
 * or a natural-key pre-check.
 *
 * Which of the two applies is a **property of the downstream system**, so it
 * has to be declared per connector, at authoring time, and surfaced in the
 * App Builder at publish time. `supports_idempotency_key` is therefore a
 * required field of the descriptor rather than an optional hint:
 *
 *  - if it were optional, "absent" would have to be read as `false`, and a
 *    connector that *does* support the key would silently get the weaker
 *    strategy;
 *  - if it were a string or a `'auto'`, the ambiguity would come back through
 *    the front door.
 *
 * The App Builder UI that renders this flag is a later phase (Phase 6). What
 * lands here is the contract the UI reads, so the decision is made once.
 */

const opaqueId = z.string().min(1);

export const ConnectorDescriptorSchema = z
  .object({
    /** Stable connector identifier, e.g. `hr-leave-request`. */
    id: opaqueId,
    /** Display name for the App Builder's connector list. */
    name: z.string().min(1),
    /**
     * DAT-13. Required, boolean, never absent.
     *
     * `true`  → the platform sends an idempotency key and the downstream
     *           deduplicates, so a retry after an ambiguous timeout is safe.
     * `false` → the platform must pre-check a natural key before re-sending,
     *           which is a read the connector owns.
     */
    supports_idempotency_key: z.boolean(),
  })
  .strict();

export type ConnectorDescriptor = z.infer<typeof ConnectorDescriptorSchema>;

/**
 * What the data router hands a connector for one submission. Deliberately
 * minimal: Phase 1 publishes the seam, and every field added here is a field
 * the integration phase has to honour.
 */
export interface ConnectorExecuteInput {
  /** Opaque submission id. The connector must not synthesise a PII-bearing natural key from it. */
  readonly submissionId: string;
  readonly appId: string;
  readonly formId: string;
  /**
   * The idempotency key, or `null` when the connector descriptor declares
   * `supports_idempotency_key: false`. A connector that declares `true` and is
   * handed `null` is a platform bug, and the integration phase's conformance
   * test is where that gets caught.
   */
  readonly idempotencyKey: string | null;
  /** The submitted form data. Shape is the form's business, not the connector's. */
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ConnectorExecuteOutcome {
  /** The downstream's own identifier for the created/updated record, when it returns one. */
  readonly externalId: string | null;
  /** A closed enumeration the platform can map to an ErrorCode and a retry decision. */
  readonly status: 'succeeded' | 'rejected' | 'failed_transient' | 'failed_permanent';
}

export interface Connector {
  readonly descriptor: ConnectorDescriptor;
  /**
   * Exactly one attempt. Retry, backoff and dead-lettering belong to the queue
   * (BullMQ, Phase 5) and the idempotency key, not to the connector — a
   * connector that retries internally defeats both.
   */
  execute(input: ConnectorExecuteInput): Promise<ConnectorExecuteOutcome>;
}
