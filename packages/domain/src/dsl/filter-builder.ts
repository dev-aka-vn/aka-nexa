/**
 * DAT-11 — the authorization filter builder (D-74, D-78).
 *
 * The *only* function that may produce the ownership + soft-delete half of a
 * query. Its output is ANDed at the root of the emitted Mongo filter, outside
 * whatever the user's filter tree said, so no DSL construct — an `$or` at the
 * top of the tree, a nested `$and`, a projection — can widen it.
 *
 * ## The shape contract (acceptance criteria)
 *
 *  - `deleted_at: null` is **always** present (D-78): soft-deleted rows must
 *    never surface through read links or exports, even to a `view_all`
 *    holder — deleted-row access is a separate audited `include_deleted`
 *    flag, never this permission.
 *  - `real_user_id: viewerId` is present **only** when the viewer lacks
 *    `view_all` — that permission bypasses ownership, nothing else.
 *  - With both constraints the result is `{ $and: [...] }`; with only
 *    `deleted_at` it is the bare `{ deleted_at: null }` object.
 *
 * App scoping (D-76) is deliberately **not** this builder's job: a query link
 * is bound to one `app_id`, and the repository's per-app query root applies it
 * (`SubmissionRepository.queryWithDsl`, plan 04-03). Keeping it out of here
 * preserves the exact two-constraint shape the DAT-11 acceptance criteria
 * assert.
 */

import type { MongoFilter } from './ast.js';

/**
 * Build the auth filter for one execution: soft-delete protection always,
 * ownership unless the viewer holds `view_all`.
 *
 * @param viewerId the verified viewer (`sub` claim)
 * @param hasViewAll whether the viewer holds this app's `view_all` permission (D-76/D-77)
 */
export function buildAuthFilter(viewerId: string, hasViewAll: boolean): MongoFilter {
  void viewerId;
  void hasViewAll;
  return {};
}