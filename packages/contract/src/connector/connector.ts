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

export const ConnectorExecuteContextSchema = z
  .object({
    /** Optional correlation id for tracing. */
    correlationId: z.string().min(1).optional(),
    /** The idempotency key, or `null` when the connector descriptor declares
     * `supports_idempotency_key: false`. */
    idempotencyKey: z.string().nullable(),
    /** Additional metadata that may be useful to the connector. */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ConnectorExecuteContext = z.infer<typeof ConnectorExecuteContextSchema>;

export const ConnectorExecutePayloadSchema = z
  .object({
    /** Opaque submission id. The connector must not synthesise a PII-bearing natural key from it. */
    submissionId: z.string().min(1),
    appId: z.string().min(1),
    formId: z.string().min(1),
    /** The submitted form data. Shape is the form's business, not the connector's. */
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ConnectorExecutePayload = z.infer<typeof ConnectorExecutePayloadSchema>;

export const ConnectorTestResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().optional(),
  })
  .strict();

export type ConnectorTestResult = z.infer<typeof ConnectorTestResultSchema>;

export const ConnectorCapabilitySchema = z
  .object({
    name: z.string().min(1),
    supportsIdempotency: z.boolean().optional(),
    operations: z.array(z.string()).optional(),
  })
  .strict();

export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>;

export type ConnectorErrorCode =
  | 'credential_rejected'
  | 'endpoint_unreachable'
  | 'failed_permanent'
  | 'mapping_error'
  | 'unknown';

export interface ConnectorExecuteOutcome {
  /** The downstream's own identifier for the created/updated record, when it returns one. */
  readonly externalId: string | null;
  /** A closed enumeration the platform can map to an ErrorCode and a retry decision. */
  readonly status: 'succeeded' | 'rejected' | 'failed_transient' | 'failed_permanent';
  /** Distinct taxonomy code for alerting/separation. */
  readonly code?: ConnectorErrorCode;
}

export interface Connector {
  readonly descriptor: ConnectorDescriptor;
  /**
   * Test the connection/configuration of this connector.
   */
  testConnection(): Promise<ConnectorTestResult>;
  /**
   * Get capabilities of this connector.
   */
  getCapabilities(): Promise<ConnectorCapability[]>;
  /**
   * Exactly one attempt. Retry, backoff and dead-lettering belong to the queue
   * (BullMQ, Phase 5) and the idempotency key, not to the connector — a
   * connector that retries internally defeats both.
   */
  execute(operation: string, payload: ConnectorExecutePayload, context: ConnectorExecuteContext): Promise<ConnectorExecuteOutcome>;
}
