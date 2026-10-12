import { z } from 'zod';

/**
 * Submissions-viewer contracts (BLD-08, D-111).
 *
 * The owner-scoped viewer over an app's submissions:
 * the list/detail query filters, and the **projected
 * row** the view renders and the export serializes.
 *
 * ## The projection discipline (D-111, Pitfall 10)
 *
 * `SubmissionViewerRowSchema` is the field allowlist:
 * exactly the viewer's visible columns — projected
 * status, app/form, timestamps, downstream ref, safe
 * reason. The export projects through this set
 * **before** serialization, so a field outside it
 * (a PII key in the submission payload) is unreachable
 * in any row by construction.
 */

/** The submission lifecycle statuses the viewer filters on. */
export const SubmissionStatusSchema = z.enum([
  'completed',
  'partial',
  'failed',
  'pending_external',
]);

export type SubmissionStatus = z.infer<
  typeof SubmissionStatusSchema
>;

/** An ISO 8601 instant — the wire form of a date filter. */
const IsoDateString = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  { message: 'invalid ISO 8601 date' },
);

/**
 * The viewer's filter set — the query parameters
 * `GET /submissions` and `GET /submissions/export`
 * accept. `app_id` is required: the viewer is
 * per-app, and the owner-scoping check happens
 * against it. `.strict()` so an unlisted parameter
 * is refused inline rather than silently dropped.
 */
export const SubmissionsFilterSchema = z
  .object({
    app_id: z.string().min(1).max(128),
    status: SubmissionStatusSchema.optional(),
    from: IsoDateString.optional(),
    to: IsoDateString.optional(),
    /** The `form_id` the view filters on (query name: `form`). */
    form: z.string().min(1).max(128).optional(),
  })
  .strict();

export type SubmissionsFilter = z.infer<
  typeof SubmissionsFilterSchema
>;

/**
 * One projected row — the viewer's visible columns
 * and nothing else. `submitted_at` is the ISO wire
 * form of the submission's timestamp; the downstream
 * reference and the safe reason are nullable
 * because a live internal row carries neither.
 */
export const SubmissionViewerRowSchema = z
  .object({
    submission_id: z.string().min(1),
    app_id: z.string().min(1),
    form_id: z.string().min(1),
    status: SubmissionStatusSchema,
    submitted_at: z.string().min(1),
    downstream_reference: z.string().nullable().optional(),
    /**
     * The **safe** reason: the curated, human-readable
     * delivery message — never raw submission content
     * (D-111, the D-43/W-22 discipline).
     */
    reason: z.string().nullable().optional(),
  })
  .strict();

export type SubmissionViewerRow = z.infer<
  typeof SubmissionViewerRowSchema
>;
