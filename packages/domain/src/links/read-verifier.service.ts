import {
  ReadDenyReason,
  ReadLinkActionSchema,
  ReadLinkClaimsSchema,
  type ReadLinkAction,
  type ReadLinkClaims,
} from '@akane/contract';
import { PermissionCheckService } from '../authz/permission-check.service.js';

export type { ReadDenyReason };

/**
 * A submission the verifier can check ownership for (D-79).
 *
 * Defined locally rather than imported from `domain/src/submissions/` because
 * the `links` boundary element cannot import from `submissions`
 * (tooling/boundaries.config.mjs ALLOWED_EDGES). The controller in `app-api`
 * provides the concrete `SubmissionRepository` that satisfies this interface.
 */
export interface SubmissionRecord {
  readonly _id: string;
  readonly real_user_id: string;
  readonly app_id: string;
  readonly form_id: string;
  readonly form_version: number;
  readonly data: Record<string, unknown>;
}

/**
 * Minimal seam the verifier needs from the data layer: fetch a single
 * submission and confirm it belongs to `realUserId`.
 */
export interface SubmissionLookup {
  findByIdOwned(submissionId: string, realUserId: string): Promise<SubmissionRecord | null>;
}

/**
 * A seeded saved-query record (D-73): `{query_id, query_version, dsl, intents,
 * app_id}`.
 *
 * `dsl` is `unknown` on purpose — the execution path validates it through
 * `DslService.parse` (DAT-10) before anything compiles, so a stored DSL that
 * drifted out of contract fails at load rather than being trusted here. This
 * type is the *stored contract* shape, not an assertion that the payload is
 * valid.
 */
export interface SavedQueryRecord {
  readonly query_id: string;
  readonly query_version: number;
  readonly dsl: unknown;
  readonly intents: readonly string[];
  readonly app_id: string;
}

/**
 * The D-73 seam: load a saved query scoped by `query_id` **and** `app_id`.
 *
 * Defined here rather than imported from `submissions` because the `links`
 * boundary element may not import `submissions`
 * (tooling/boundaries.config.mjs ALLOWED_EDGES) — the same reason
 * {@link SubmissionLookup} exists. The API module provides the concrete
 * store.
 */
export interface SavedQueryLookup {
  findSavedQuery(queryId: string, appId: string): Promise<SavedQueryRecord | null>;
}

/**
 * A stateless JWT verification function.
 *
 * Injected rather than called directly so the `links` element never imports
 * `jose` (R2 boundary — only `crypto-owner` may). The platform crypto module
 * (`packages/platform/src/crypto/jwt-verifier.ts`) is the sole implementation.
 */
export interface ReadLinkJwtVerifier {
  verify(token: string): Promise<Record<string, unknown>>;
}

export interface ReadVerifySuccess {
  readonly ok: true;
  readonly claims: ReadLinkClaims;
  /** Present for `view` action; absent for `query`. */
  readonly submission?: SubmissionRecord;
  /** Present for `query` action; absent for `view`. */
  readonly savedQuery?: SavedQueryRecord;
}

export interface ReadVerifyFailure {
  readonly ok: false;
  readonly reason: ReadDenyReason;
}

export type ReadVerifyResult = ReadVerifySuccess | ReadVerifyFailure;

/**
 * Stateless read-link verifier (LNK-05, LNK-06, D-40, D-79).
 *
 * ## Security invariants
 *
 * 1. **Public-key verification only** (LNK-05): the token is verified by the
 *    platform crypto layer with the deployed public key. No Redis round-trip,
 *    no state — the verifier is O(1) crypto regardless of traffic.
 * 2. **Fresh permission check** (LNK-06): every access re-runs
 *    `PermissionCheckService.check` against the live `perm_version` epoch
 *    captured in the claim. A permission change invalidates the outstanding
 *    link without any server-side token state.
 * 3. **Action branching** (D-40): the `action` claim discriminates the path.
 *    `view` resolves to a single owned submission (D-79); `query` resolves the
 *    saved query and enforces `query_version` (D-73/D-75) before checking
 *    `query:run`.
 * 4. **Never consumes** (D-42): `TOKEN_CLASSES.view.consume = false` and
 *    `TOKEN_CLASSES.query.consume = false`. This verifier performs no Redis
 *    write, so a link opened twice is verified twice — both succeed or both
 *    fail identically.
 */
export class ReadVerifierService {
  constructor(
    private readonly jwt: ReadLinkJwtVerifier,
    private readonly permissionCheck: PermissionCheckService,
    private readonly submissions: SubmissionLookup,
    /**
     * D-73 seam. Optional only so the `view` path can be constructed without a
     * saved-query store; a `query` link with no seam **fails closed** with
     * `wrong_version` rather than skipping the D-75 check.
     */
    private readonly savedQueries?: SavedQueryLookup,
  ) {}

  /**
   * Verify a read-link token end-to-end.
   *
   * @param token the raw JWT from the `token` query parameter
   * @returns a {@link ReadVerifyResult} — success with claims (and submission
   *   for `view`), or failure with a {@link ReadDenyReason}
   */
  async verify(token: string): Promise<ReadVerifyResult> {
    // 1 — Signature + expiry + audience (LNK-05). The platform crypto layer
    //     maps jose errors; anything that fails here is a bad_signature,
    //     because a token that fails jwtVerify cannot be trusted to carry a
    //     meaningful `exp` claim to distinguish "expired" from "tampered".
    const payload = await this.tryVerify(token);
    if (payload === null) {
      return { ok: false, reason: ReadDenyReason.bad_signature };
    }

    // 2 — Claim-shape validation against the frozen schema (D-21). Unknown keys
    //     are rejected by `.strict()`, so a tampered claim set never reaches the
    //     branching logic.
    const claimsResult = ReadLinkClaimsSchema.safeParse(payload);
    if (!claimsResult.success) {
      return { ok: false, reason: ReadDenyReason.bad_signature };
    }
    const claims = claimsResult.data;

    // 3 — Branch on the action discriminant (D-40).
    switch (claims.action) {
      case 'view':
        return this.verifyView(claims);
      case 'query':
        return this.verifyQuery(claims);
      default:
        return { ok: false, reason: ReadDenyReason.invalid_action };
    }
  }

  /**
   * The `view` path: resolve the target submission, confirm ownership (D-79),
   * then re-check permissions with the live `perm_version` (LNK-06).
   */
  private async verifyView(claims: ReadLinkClaims): Promise<ReadVerifyResult> {
    const targetId = claims.target_id;
    if (targetId === undefined) {
      // A view claim with no target_id is structurally malformed — the frozen
      // schema permits `target_id` as optional, but `view` requires it
      // (READ_LINK_TARGET_RULES). This is a bad_signature because the token
      // does not represent a valid view link.
      return { ok: false, reason: ReadDenyReason.bad_signature };
    }

    // D-79: the submission must belong to the real_user_id in the claim.
    const submission = await this.submissions.findByIdOwned(targetId, claims.sub);
    if (submission === null) {
      return { ok: false, reason: ReadDenyReason.not_found };
    }

    // LNK-06: fresh permission check against the live perm_version epoch.
    const hasPermission = await this.permissionCheck.check(
      claims.app_id,
      claims.sub,
      buildViewPermission(claims),
      claims.perm_version,
    );
    if (!hasPermission) {
      return { ok: false, reason: ReadDenyReason.denied };
    }

    return { ok: true, claims, submission };
  }

  /**
   * The `query` path (D-73, D-75, LNK-06):
   *
   * 1. Load the saved query by `query_id` (= `target_id`) + `app_id`.
   * 2. Missing record **or** stale `query_version` → `wrong_version` (D-75):
   *    a DSL edit invalidates outstanding query links, and the denial is
   *    recorded and displayed like any other.
   * 3. Fresh `query:run` permission check against the live `perm_version`
   *    (LNK-06).
   *
   * The version check runs *before* the permission check so a stale link
   * reports the reason it actually exists for; neither check can be reached
   * without a structurally valid, signature-verified claim set.
   */
  private async verifyQuery(claims: ReadLinkClaims): Promise<ReadVerifyResult> {
    const queryId = claims.target_id;
    const saved =
      queryId === undefined || this.savedQueries === undefined
        ? null
        : await this.savedQueries.findSavedQuery(queryId, claims.app_id);

    if (saved === null || saved.query_version !== claims.query_version) {
      return { ok: false, reason: ReadDenyReason.wrong_version };
    }

    const hasPermission = await this.permissionCheck.check(
      claims.app_id,
      claims.sub,
      'query:run',
      claims.perm_version,
    );
    if (!hasPermission) {
      return { ok: false, reason: ReadDenyReason.denied };
    }

    return { ok: true, claims, savedQuery: saved };
  }

  /**
   * Attempt JWT verification, mapping all jose errors to null.
   *
   * `jose.jwtVerify` throws distinct error classes (`JWTExpired`,
   * `JWSSignatureVerificationFailed`, etc.). For the read path we only need to
   * know "this token is not validly signed for this deployment" — the
   * distinction is preserved at the OTel/metric layer by the caller if needed,
   * but the verifier collapses all failures to `bad_signature` for the
   * deny-reason enum.
   */
  private async tryVerify(token: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.jwt.verify(token);
    } catch {
      return null;
    }
  }
}

/**
 * The permission checked for a view link is namespaced by app (D-66:
 * action-scoped permissions). The convention from the mockup is
 * `<app_id>:view`, paralleling `leave:view_own` / `leave:view_team` under the
 * app's permission namespace.
 */
function buildViewPermission(claims: ReadLinkClaims): string {
  return `${claims.app_id}:view`;
}

/**
 * Validate that a raw string is one of the six D-21 actions. Exported so the
 * controller can reject unknown actions at the routing layer before constructing
 * a full token.
 */
export function isValidReadAction(action: unknown): action is ReadLinkAction {
  return ReadLinkActionSchema.options.includes(action as ReadLinkAction);
}
