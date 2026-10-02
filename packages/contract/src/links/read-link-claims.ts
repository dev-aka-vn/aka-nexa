import { z } from 'zod';

/**
 * The read-link JWT claim set — **frozen** (D-21, LNK-07).
 *
 * ## Why this file is the most dangerous contract in the phase
 *
 * A read link is stateless and lives up to 90 days. Adding or removing a claim
 * invalidates **every link already in a user's clipboard**, silently, on deploy.
 * There is no "we'll add it later" — a claim added in month four is a `400` on
 * every link issued in months one through three. That is why the shape is
 * pinned here, in foundations, rather than in the read-path phase, and why
 * D-24's mechanical test exists: a comment cannot stop a schema edit, a frozen
 * key-set assertion can.
 *
 * ## The discriminant is `action`, not `typ` (D-21)
 *
 * `typ` is owned by the JOSE header. Using it as a domain discriminant in the
 * payload is a collision that costs more later than the shorter name saves.
 *
 * ## No version claim (D-21)
 *
 * The schema version is a code constant (`READ_LINK_CLAIMS_VERSION`) plus the
 * published JSON Schema `$id`. Spending a claim on self-description buys
 * nothing when a frozen test already governs the set — and it would be the
 * first addition to invalidate every outstanding link.
 */

/** The schema version as a code constant. Not a claim. */
export const READ_LINK_CLAIMS_VERSION = '1.0';

/** The registered-claim ceiling: NFR/AD-11's 90-day read-link lifetime. */
export const MAX_READ_LINK_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Named issue token. A custom Zod issue always carries `code: 'custom'`, so the machine-readable token rides in `message` — the pattern `redis.schema.ts` uses for the D-12 boot failure. */
export const READ_LINK_TTL_EXCEEDS_CEILING = 'READ_LINK_TTL_EXCEEDS_CEILING';

/**
 * The six D-21 actions.
 *
 * `draft` is **reserved, never emitted in v1** (D-22). It is here so that
 * enabling draft save later is a configuration row rather than a claim-set
 * change — and a claim-set change is precisely the operation that invalidates
 * every outstanding link. Building the state machine is deferred; reserving
 * the shape is what unblocks Phase 2's token model.
 */
export const ReadLinkActionSchema = z.enum([
  'create',
  'edit',
  'view',
  'query',
  'notification',
  'draft',
]);

export type ReadLinkAction = z.infer<typeof ReadLinkActionSchema>;

/** `action` → what `target_id` means, and whether `target_id` is present at all (D-21). */
export const READ_LINK_TARGET_RULES: Readonly<Record<ReadLinkAction, string>> =
  Object.freeze({
    create: 'absent — a create link opens a blank form',
    edit: 'submission_id',
    view: 'submission_id',
    query: 'query_id',
    notification: 'absent — the link is bound to the original submitter instead',
    draft: 'draft_id — reserved with the class (D-22); not emitted in v1',
  });

const opaqueId = z.string().min(1);

/** Form, app and query versions are monotonically increasing integers. */
const versionNumber = z.number().int().nonnegative();

/** `iat` / `nbf` / `exp` are NumericDate — seconds since the epoch, not milliseconds. */
const numericDate = z.number().int().nonnegative();

export const ReadLinkClaimsSchema = z
  .object({
    // ---- registered (RFC 7519) ------------------------------------- //
    /** Deployment identifier. Distinguishes a staging link from a production one. */
    iss: z.string().min(1),
    /** The form-renderer origin. The renderer is a static web app, so the audience is an origin, not an API. */
    aud: z.string().min(1),
    /** `real_user_id`, an opaque identifier. Never a name, an email or a chat handle. */
    sub: opaqueId,
    jti: opaqueId,
    iat: numericDate,
    nbf: numericDate,
    exp: numericDate,

    // ---- domain ------------------------------------------------------ //
    /** The discriminant. See the file header for why this is not `typ`. */
    action: ReadLinkActionSchema,
    app_id: opaqueId,
    form_id: opaqueId,
    form_version: versionNumber,
    app_version: versionNumber,
    /**
     * The ACL-07 per-user-per-app permission epoch, captured at issuance.
     *
     * **Read links only.** A write link consumes on submit and gets a fresh
     * permission check at the execution boundary (ACL-06's second check), so
     * embedding an issuance-time version there would imply a guarantee it does
     * not provide. It is a required claim on the frozen set because the set is
     * one schema; a write link simply does not need it to mean anything, and
     * making it optional would weaken the read guarantee it exists for.
     */
    perm_version: versionNumber,
    /**
     * A saved query is versioned the way a form is (FRM-02). Frozen now even
     * though the read path is Phase 3: a Phase 3 query link is otherwise
     * unrepresentable, and adding the claim then is the exact break this
     * phase exists to prevent.
     */
    query_version: versionNumber,
    /** `submission_id` for `view`/`edit`, `query_id` for `query`, absent otherwise. */
    target_id: opaqueId.optional(),
  })
  .strict()
  .refine(
    (claims) => claims.exp - claims.iat <= MAX_READ_LINK_TTL_SECONDS,
    { message: READ_LINK_TTL_EXCEEDS_CEILING, path: ['exp'] },
  );

export type ReadLinkClaims = z.infer<typeof ReadLinkClaimsSchema>;
