/**
 * A stored form submission (DAT-02/DAT-04).
 *
 * The shape is intentionally minimal for the read-path tracer: the fields the
 * view page and the verifier need to render a read-only FormIO form. Additional
 * fields (status, external tracking, etc.) are added by later phases.
 */
export interface Submission {
  /** MongoDB document `_id`. This is the `target_id` in a view link claim. */
  readonly _id: string;
  /** The opaque `real_user_id` who owns this submission (D-79). */
  readonly real_user_id: string;
  readonly app_id: string;
  readonly form_id: string;
  readonly form_version: number;
  /** The FormIO JSON schema used to render the form. */
  readonly form_schema: Record<string, unknown>;
  /** The submitted field values. */
  readonly data: Record<string, unknown>;
  readonly created_at: Date;
  readonly status: 'completed' | 'partial' | 'failed' | 'pending_external';
}

/**
 * Submission data access (DAT-10, DAT-11).
 *
 * ## Why this is not a MongoDB direct import
 *
 * R3 (tooling/boundaries.config.mjs) restricts the mongodb driver specifier to
 * only packages/platform/src/mongo and packages/domain/src/data-access
 * (the data-access subdirectory pattern). This file lives at
 * packages/domain/src/submissions, so it cannot import the mongodb driver
 * directly. In production the repository receives a MongoService handle
 * injected by the platform module and calls db.collection().findOne() through
 * it. For the tracer - where no MongoDB instance is guaranteed at test time -
 * the methods are defined against a minimal SubmissionStore interface, with
 * the real driver adapter wired by the NestJS module in a later phase.
 *
 * ## The ownership invariant (D-79)
 *
 * `findByIdOwned` does not look up by _id and then check ownership in a
 * second step. It queries on { _id, real_user_id } in one filter, so a
 * user who does not own the submission receives null — indistinguishable
 * from 'the ID does not exist' — and no cross-user record is ever materialised
 * in the domain layer.
 */
export class SubmissionRepository {
  /**
   * In-memory backing store for the tracer.
   *
   * The existing `IdentityMappingRepository` pattern (identity-mapping.repository.ts)
   * uses the same in-memory approach so the tracer is testable without a live
   * MongoDB. A production adapter replaces this with a Mongo-backed `SubmissionLookup`.
   */
  private readonly submissions = new Map<string, Submission>();

  /**
   * Insert or replace a submission. Used by fixtures and tests.
   */
  upsert(submission: Submission): void {
    this.submissions.set(submission._id, submission);
  }

  /**
   * Fetch a submission by ID, returning it only if it belongs to
   * `realUserId` (D-79 — view is own-record only, full stop).
   *
 * The filter ANDs _id and real_user_id together at the data-access layer
 * so the ownership check is structural, not an application-level if that can
 * be bypassed by a bug in the calling code.
   */
  async findByIdOwned(submissionId: string, realUserId: string): Promise<Submission | null> {
    const submission = this.submissions.get(submissionId);
    if (submission === undefined) {
      return null;
    }
    if (submission.real_user_id !== realUserId) {
      return null;
    }
    return submission;
  }
}
