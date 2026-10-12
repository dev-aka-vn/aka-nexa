import { z } from 'zod';

import { AppIdSchema } from './app-definition.contract.js';

/**
 * Publish-gate contracts (APP-07, APP-08, BLD-06, OBS-05).
 *
 * The publish endpoint's request and response shapes, and the
 * `PublishGateResult` the gate returns — the decision the
 * endpoint renders inline (BLD-07) and the audit log retains
 * (T-06-20). `.strict()` throughout: an unlisted field is
 * rejected inline with the offending field named.
 */

/**
 * One existing app's routing-share drop, the APP-07 refusal's
 * named party. `points` is the drop in percentage points over
 * the rolling 24h window, rounded to two decimals — the 5.00 /
 * 5.01 boundary is the requirement's exact edge, so the
 * precision is part of the contract, not an implementation
 * detail.
 */
export const ShareDropSchema = z
  .object({
    app_id: AppIdSchema,
    points: z.number(),
  })
  .strict();

export type ShareDrop = z.infer<typeof ShareDropSchema>;

/**
 * One publish-modal row (BLD-06): the mockup's publish dialog
 * lists status, version, form versions, indexes and triggers,
 * and the confirmation payload must carry exactly the rows that
 * changed — a field that did not change is absent, never
 * rendered as a no-op row.
 */
export const ChangeSummaryRowSchema = z
  .object({
    field: z.string().min(1),
    from: z.string(),
    to: z.string(),
  })
  .strict();

export type ChangeSummaryRow = z.infer<typeof ChangeSummaryRowSchema>;

/**
 * The gate's decision. `allowed` is the conjunction the
 * endpoint enforces before any state change: every existing
 * app's share drop within the 5-point threshold (APP-07) and
 * no description collision (APP-08). `changeSummary` is the
 * BLD-06 confirmation payload — the same rows the admin saw
 * are the rows the AUD-01 entry retains.
 */
export const PublishGateResultSchema = z
  .object({
    allowed: z.boolean(),
    shareDrops: z.array(ShareDropSchema),
    descriptionCollisionWith: z.string().nullable(),
    changeSummary: z.array(ChangeSummaryRowSchema),
  })
  .strict();

export type PublishGateResult = z.infer<typeof PublishGateResultSchema>;

/**
 * The publish response: the committed definition projection
 * plus the change summary the confirmation rendered. A no-op
 * publish (an already-published app) names its zero-change
 * state inline via `zero_change` with an empty summary — never
 * a generic confirmation (BLD-06 boundary).
 */
export const PublishResponseSchema = z
  .object({
    app_id: AppIdSchema,
    name: z.string(),
    description: z.string(),
    data_mode: z.enum(['internal', 'external', 'hybrid']),
    lifecycle: z.enum(['draft', 'published', 'deprecated', 'archived']),
    version: z.number().int(),
    tags: z.array(z.string()),
    form_schema: z.record(z.string(), z.unknown()).nullable(),
    triggers: z.array(z.record(z.string(), z.unknown())),
    roles: z.record(z.string(), z.unknown()),
    routing_config: z.record(z.string(), z.unknown()).nullable(),
    field_mapping: z.record(z.string(), z.unknown()).nullable(),
    retention_policy: z.record(z.string(), z.unknown()).nullable(),
    deprecation_notice: z.string().nullable(),
    createdBy: z.string(),
    createdAt: z.date(),
    changeSummary: z.array(ChangeSummaryRowSchema),
    zero_change: z.boolean(),
  })
  .strict();

export type PublishResponse = z.infer<typeof PublishResponseSchema>;
