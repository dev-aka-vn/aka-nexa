import { z } from 'zod';

/**
 * Connector-request contracts (BLD-10, D-97..D-100).
 *
 * The self-service boundary a department admin drives: the request
 * carries the **full connector definition minus the secret** (D-99) —
 * exactly the `ConnectorSeed` interface without its `credential_ref`
 * value — and the operator's provision step is the only path a
 * credential ever enters the system (D-100).
 *
 * ## The response projection (T-06-23)
 *
 * `ConnectorRequestResponseSchema` is **strict and has no field that
 * could carry a secret by construction**: the credential exists on the
 * document only as the operator-set `credential_ref` opaque handle,
 * and this schema lists every field a builder read path may render.
 * A spec asserts the serialized response body contains no key matching
 * `/secret|credential_value|plaintext/i` — the allowlist is the
 * schema's key set, nothing else.
 */

/**
 * The admin-authored definition — the `ConnectorSeed` shape minus the
 * secret. `.strict()` so an unlisted field (a stray `password`, a
 * smuggled `credential`) is rejected inline with the field named
 * (BLD-07's never-generic discipline).
 */
export const ConnectorRequestDefinitionSchema = z
  .object({
    connector_id: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    base_url: z.string().min(1).max(2000),
    timeout_ms: z.number().int().positive().max(600_000).optional(),
    retries: z.number().int().min(0).max(10).optional(),
    rate_limit: z.record(z.string(), z.unknown()).optional(),
    mapping: z.record(z.string(), z.unknown()).optional(),
    taxonomy: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ConnectorRequestDefinition = z.infer<
  typeof ConnectorRequestDefinitionSchema
>;

/** The request lifecycle: `pending → provisioned | rejected` (D-98). */
export const ConnectorRequestStateSchema = z.enum([
  'pending',
  'provisioned',
  'rejected',
]);

export type ConnectorRequestState = z.infer<
  typeof ConnectorRequestStateSchema
>;

/**
 * The served projection — every field a builder read path renders, and
 * nothing else. `credential_ref` is an **opaque handle string** the
 * operator set; no field here can carry a plaintext value or an
 * encryption envelope (T-06-23, D-99).
 *
 * Dates accept the wire form (ISO string) and the in-process form
 * (`Date`) so the same schema validates a controller response and a
 * service return value.
 */
export const ConnectorRequestResponseSchema = z
  .object({
    request_id: z.string().min(1),
    app_id: z.string().min(1),
    requested_by: z.string().min(1),
    connector_id: z.string().min(1),
    name: z.string().min(1),
    base_url: z.string().min(1),
    timeout_ms: z.number().nullable().optional(),
    retries: z.number().nullable().optional(),
    rate_limit: z.record(z.string(), z.unknown()).nullable().optional(),
    mapping: z.record(z.string(), z.unknown()).nullable().optional(),
    taxonomy: z.record(z.string(), z.unknown()).nullable().optional(),
    state: ConnectorRequestStateSchema,
    reason: z.string().nullable().optional(),
    credential_ref: z.string().nullable().optional(),
    requestedAt: z.union([z.string(), z.date()]).optional(),
    resolvedAt: z.union([z.string(), z.date()]).nullable().optional(),
  })
  .strict();

export type ConnectorRequestResponse = z.infer<
  typeof ConnectorRequestResponseSchema
>;
