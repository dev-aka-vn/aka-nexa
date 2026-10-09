/**
 * The seven LNK-08 denial reasons plus internal view/query reasons (D-70).
 *
 * LNK-08 (REQUIREMENTS.md §"Links & Token Security") requires that a read-link
 * denial is counted per reason across all seven revocation events — expired,
 * consumed, revoked, wrong_app, wrong_version, deactivated_user, bad_signature —
 * not as a single aggregate counter. The D-70 dead-link copy contract adds three
 * internal reasons (not_found, not_owned, denied) and invalid_action for a token
 * whose `action` discriminant is not one the read path handles.
 *
 * "consumed" is structurally impossible for read links — `TOKEN_CLASSES.view`
 * and `TOKEN_CLASSES.query` both set `consume: false` (D-42) — but it is
 * retained here so the reason set matches the shared link-error surface. The
 * verifier never emits it for view/query actions; if a stale issuer ever
 * produces one, it is counted and mapped to a generic actionable message.
 */
export enum ReadDenyReason {
  /** The link's `exp` claim has passed. */
  expired = 'expired',
  /**
   * The link was already redeemed. Unreachable for read links (`consume: false`)
   * but kept for the shared error model (D-42 / CONTEXT.md "the agent's Discretion").
   */
  consumed = 'consumed',
  /** The link was explicitly revoked before its natural expiry. */
  revoked = 'revoked',
  /** The `app_id` in the claims does not match the form/app context. */
  wrong_app = 'wrong_app',
  /** The `app_version` or `form_version` in the claims is stale. */
  wrong_version = 'wrong_version',
  /** The `sub` (real_user_id) belongs to a deactivated account. */
  deactivated_user = 'deactivated_user',
  /** The JWT failed signature verification, algorithm check, or claim-shape parsing. */
  bad_signature = 'bad_signature',
  /** The target submission was not found. */
  not_found = 'not_found',
  /** The target submission exists but does not belong to `sub` (D-79). */
  not_owned = 'not_owned',
  /** The fresh permission check failed (LNK-06). */
  denied = 'denied',
  /** The `action` claim is not one the read verifier branches on. */
  invalid_action = 'invalid_action',
}

/**
 * The seven LNK-08 reasons that share a single OTel counter label value
 * (D-71). `consumed` is included so the counter's label cardinality matches
 * the requirement even though it is unreachable on the read path.
 */
export const ALL_DENY_REASONS = Object.freeze([
  ReadDenyReason.expired,
  ReadDenyReason.consumed,
  ReadDenyReason.revoked,
  ReadDenyReason.wrong_app,
  ReadDenyReason.wrong_version,
  ReadDenyReason.deactivated_user,
  ReadDenyReason.bad_signature,
] as const);

/**
 * Reasons that can actually be emitted by the read verifier (view/query).
 * `consumed` is excluded per D-42; `invalid_action` is a structural error, not a
 * revocation event, and is not counted on the LNK-08 counter — it is logged
 * as a parse failure instead.
 */
export const READ_DENY_REASONS = Object.freeze([
  ReadDenyReason.expired,
  ReadDenyReason.revoked,
  ReadDenyReason.wrong_app,
  ReadDenyReason.wrong_version,
  ReadDenyReason.deactivated_user,
  ReadDenyReason.bad_signature,
  ReadDenyReason.not_found,
  ReadDenyReason.not_owned,
  ReadDenyReason.denied,
] as const);

/**
 * Whether this reason corresponds to one of the seven LNK-08 revocation events
 * that must each have a distinct OTel counter label.
 */
export function isCountedReason(reason: ReadDenyReason): boolean {
  return ALL_DENY_REASONS.includes(reason as (typeof ALL_DENY_REASONS)[number]);
}
