import type { ReadLinkAction } from './read-link-claims.js';

/**
 * Token classes as a **config table** (D-22), not a schema.
 *
 * Research flagged the draft-save token as a structural blocker on Phase 2's
 * token model, and the whole of the blocker is this shape: if a token's
 * lifetime and consumption are expressed as code branches, adding a class is a
 * refactor of the issuing path. Expressed as a table row, adding a class is a
 * configuration entry. That is the entire reason this file exists — and it is
 * why the table is keyed by the frozen `ReadLinkAction` union: `satisfies`
 * makes a missing row a **compile error**, so widening the frozen claim enum
 * cannot leave a class unconfigured.
 *
 * ## TTLs
 *
 * `ttl` is a **configuration token, not a parsed duration**: `'30m'`, `'4h'`,
 * `'90d'`, plus the two non-durations `'configurable'` and `'reserved'`. The
 * values come from PRD §6.6. Keeping them as opaque tokens is deliberate — the
 * resolver that turns `'90d'` into seconds is the link-issuing phase's, and
 * hardcoding it here would put a second source of truth for time in the
 * contract package.
 */

export interface TokenClass {
  /** Echoes the key, so a row is self-describing when it is read out of a list. */
  readonly action: ReadLinkAction;
  readonly ttl: string;
  /**
   * Whether redeeming the token destroys it.
   *
   * `true` → single-use, consumed atomically (Redis `GETDEL`, NFR-SEC-1).
   * `false` → the token is a bearer of a *read* and is re-checked on every
   * access against the live `perm_version` epoch; consuming it would break the
   * second and subsequent opens of a view link for no security gain, since the
   * fresh permission check is what actually authorises the read.
   */
  readonly consume: boolean;
  /**
   * Whether the issuing path may emit this class **in v1** (D-22).
   *
   * `draft` is `false`. The enum value and this row are the entire Phase 1
   * investment: they reserve the shape so Phase 2's token model is not blocked,
   * without building the resumable-form store or the second token lifetime
   * that D-22 defers. The flag is what makes the reservation visible to code
   * review rather than living only in a comment.
   */
  readonly emittedInV1: boolean;
}

export const TOKEN_CLASSES = Object.freeze({
  /** PRD §6.6 — 30 min, consumed atomically on submit. */
  create: Object.freeze({
    action: 'create',
    ttl: '30m',
    consume: true,
    emittedInV1: true,
  }),
  /** PRD §6.6 — 4 h, loadable repeatedly before submit, consumed on submit. */
  edit: Object.freeze({
    action: 'edit',
    ttl: '4h',
    consume: true,
    emittedInV1: true,
  }),
  /** PRD §6.6 — up to 90 days, no Redis, fresh permission check on every access. */
  view: Object.freeze({
    action: 'view',
    ttl: '90d',
    consume: false,
    emittedInV1: true,
  }),
  /** PRD §6.6 — up to 90 days, fresh permission + query execution on access. */
  query: Object.freeze({
    action: 'query',
    ttl: '90d',
    consume: false,
    emittedInV1: true,
  }),
  /**
   * PRD §6.6 — TTL configurable; "single-use or multi-use per config". The
   * table carries the **default** (multi-use). A per-config single-use variant
   * is a store-level decision in the link-issuing phase, because it changes
   * whether a Redis row exists at all — and PRD §6.6 also describes this class
   * as *signed, bound to the original submitter*, which is a stateless path.
   */
  notification: Object.freeze({
    action: 'notification',
    ttl: 'configurable',
    consume: false,
    emittedInV1: true,
  }),
  /**
   * RESERVED, NOT EMITTED (D-22). `consume: true` mirrors `create` — a save
   * token is redeemed by the save and a fresh one is issued. `ttl: 'reserved'`
   * is deliberately not a duration: D-22 defers the second token lifetime, and
   * inventing a number here would be a guess dressed as a decision.
   */
  draft: Object.freeze({
    action: 'draft',
    ttl: 'reserved',
    consume: true,
    emittedInV1: false,
  }),
}) satisfies Readonly<Record<ReadLinkAction, TokenClass>>;

/** Redis key namespace reserved for the draft class (D-22). Reserved, not used. */
export const DRAFT_TOKEN_KEY_PREFIX = 'ak:tok:draft:';

/**
 * The one gate a Phase 2 issuer has to go through. D-22's rule is "must not be
 * emitted in v1", and a rule that lives only in a comment is a rule the next
 * author will not see.
 */
export function isEmittableInV1(action: ReadLinkAction): boolean {
  return TOKEN_CLASSES[action].emittedInV1;
}
