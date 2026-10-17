/**
 * The connectors page's served projection
 * (BLD-10, D-97..D-100) — the SPA-side
 * structural schema for the app's
 * connector-request queue.
 *
 * The API serves the queue through the
 * frozen `ConnectorRequestResponseSchema`
 * (the strict, secret-free projection of
 * `packages/contract`): every field a
 * builder read path renders, and nothing
 * else. This module validates that served
 * shape at the SPA boundary — an
 * unvalidated payload never reaches a
 * component (BLD-07's discipline, the
 * same shape `api/submissions.ts` enforces
 * for the viewer projection).
 *
 * The schema is structural (not a Zod
 * import) for the same reason the other
 * SPA schemas are: the served shape is the
 * projection's own, and the SPA compiles
 * against it without a second frozen copy.
 *
 * ## The credential posture (T-06-23)
 *
 * `credential_ref` is an **opaque handle**
 * the operator set through the provision
 * seam (D-100). No field in this schema can
 * carry a plaintext secret — the allowlist
 * is the key set, nothing else.
 */

/** The request lifecycle (D-98): `pending → provisioned | rejected`. */
export const CONNECTOR_REQUEST_STATES = [
  'pending',
  'provisioned',
  'rejected',
] as const;

export type ConnectorRequestState =
  (typeof CONNECTOR_REQUEST_STATES)[number];

/**
 * One served connector request. The
 * operational policy fields (`timeout_ms`,
 * `retries`, `rate_limit`, `mapping`,
 * `taxonomy`) are the admin-authored
 * definition's optional policy — absent or
 * null until the requester set them.
 * `reason` is the operator's curated
 * refusal/cancellation note; `resolvedAt`
 * is present only once the request reached
 * a terminal state.
 */
export interface ConnectorRequestView {
  readonly request_id: string;
  readonly app_id: string;
  readonly requested_by: string;
  readonly connector_id: string;
  readonly name: string;
  readonly base_url: string;
  readonly timeout_ms?: number | null;
  readonly retries?: number | null;
  readonly rate_limit?: Record<string, unknown> | null;
  readonly mapping?: Record<string, unknown> | null;
  readonly taxonomy?: Record<string, unknown> | null;
  readonly state: ConnectorRequestState;
  readonly reason?: string | null;
  /** Opaque operator-set handle — never a secret value (T-06-23). */
  readonly credential_ref?: string | null;
  /** The ISO wire form of the request timestamp. */
  readonly requestedAt?: string;
  /** The ISO wire form of the resolution timestamp (terminal states). */
  readonly resolvedAt?: string | null;
}

/** The list response (`GET /apps/:id/connector-requests`). */
export interface ConnectorRequestListResponse {
  readonly requests: readonly ConnectorRequestView[];
}

/**
 * The structural request schema. A malformed
 * request throws at the boundary; a state
 * outside the lifecycle's vocabulary is
 * refused rather than silently re-labelled.
 */
export const ConnectorRequestViewSchema = {
  parse: (data: unknown): ConnectorRequestView => {
    const request = data as Partial<ConnectorRequestView> | null;
    if (
      typeof request !== 'object' ||
      request === null ||
      typeof request.request_id !== 'string' ||
      typeof request.app_id !== 'string' ||
      typeof request.requested_by !== 'string' ||
      typeof request.connector_id !== 'string' ||
      typeof request.name !== 'string' ||
      typeof request.base_url !== 'string' ||
      !(
        CONNECTOR_REQUEST_STATES as readonly string[]
      ).includes(request.state as string)
    ) {
      throw new Error('malformed connector request');
    }
    return {
      request_id: request.request_id,
      app_id: request.app_id,
      requested_by: request.requested_by,
      connector_id: request.connector_id,
      name: request.name,
      base_url: request.base_url,
      ...(typeof request.timeout_ms === 'number'
        ? { timeout_ms: request.timeout_ms }
        : {}),
      ...(typeof request.retries === 'number'
        ? { retries: request.retries }
        : {}),
      ...(typeof request.rate_limit === 'object' &&
      request.rate_limit !== null
        ? { rate_limit: request.rate_limit }
        : {}),
      ...(typeof request.mapping === 'object' &&
      request.mapping !== null
        ? { mapping: request.mapping }
        : {}),
      ...(typeof request.taxonomy === 'object' &&
      request.taxonomy !== null
        ? { taxonomy: request.taxonomy }
        : {}),
      state: request.state,
      ...(typeof request.reason === 'string'
        ? { reason: request.reason }
        : {}),
      ...(typeof request.credential_ref === 'string'
        ? { credential_ref: request.credential_ref }
        : {}),
      ...(typeof request.requestedAt === 'string'
        ? { requestedAt: request.requestedAt }
        : {}),
      ...(typeof request.resolvedAt === 'string'
        ? { resolvedAt: request.resolvedAt }
        : {}),
    };
  },
};

/**
 * The list response's structural schema —
 * every request is validated, so a single
 * malformed request fails the read rather
 * than reaching the table.
 */
export const ConnectorRequestListSchema = {
  parse: (data: unknown): ConnectorRequestListResponse => {
    const payload = data as { requests?: unknown };
    if (!Array.isArray(payload.requests)) {
      throw new Error('malformed connector request list');
    }
    return {
      requests: payload.requests.map((request) =>
        ConnectorRequestViewSchema.parse(request),
      ),
    };
  },
};
