/**
 * `LOG_FIELD_ALLOWLIST` — the closed field set of every structured log line
 * (D-16, FND-06). This file is the *only* definition; the `LoggerPort` surface,
 * the `formatters.log` rebuild hook, and the pino options factory all derive
 * from it, so widening the allowlist is a one-line change that review can see.
 *
 * ## Why an allowlist and not a denylist
 *
 * A denylist has to enumerate every way PII can be named, and a computed key
 * (`record[userInput]`) defeats it by construction. An allowlist inverts the
 * problem: a key that is not on this list does not reach the serialiser, whether
 * it was written literally, computed at runtime, or nested three levels deep.
 *
 * ## Why this is one-way
 *
 * Once a record has been through `JSON.stringify` its bytes are on a disk or in
 * a collector, and nothing in this codebase can recall them. PROJECT §15.4's
 * narrowed erasure promise is only true while cold log retention is bounded by
 * the erasure SLA — which is only enforceable if no PII was ever written. That
 * is what this list guarantees.
 *
 * ## Changing this list
 *
 * D-16 makes the friction deliberate: "Adding a field requires a written
 * justification in the same commit; that friction is the control." The pino
 * `hostname` binding is the worked example — pino emits it by default, it is not
 * on this list, and `createPinoOptions` sets `base: null` to suppress it rather
 * than adding it here.
 */
export const LOG_FIELD_ALLOWLIST = Object.freeze([
  // ── envelope ──────────────────────────────────────────────────────────
  'ts', // timestamp (allowlisted name; pino's own default key is `time`)
  'level', // pino's numeric level, emitted from the level string cache
  'msg', // the log message itself
  // ── process identity: supplied by createPinoOptions, not by call sites ──
  'service', // 'api' | 'worker' | 'scheduler'
  'env', // NODE_ENV
  'pid',
  // ── correlation: opaque identifiers only, never PII (PRD AD-11) ─────────
  'trace_id',
  'span_id',
  'request_id',
  'jti', // the read-link token id
  // ── tenant/app scope: opaque ids, never names ─────────────────────────
  'app_id',
  'form_id',
  // ── event shape ──────────────────────────────────────────────────────
  'action', // D-22: "draft" is reserved and never emitted
  'status',
  'duration_ms',
  'error_code', // closed enum — see error-codes.ts
  // ── integration surface ───────────────────────────────────────────────
  'provider', // IM provider or JEV provider
  'queue', // BullMQ queue name
  'attempt', // BullMQ attempt number
  'count', // aggregate size (e.g. a page or a batch)
  'reason', // short enum-ish token, not prose and never a user-supplied string
] as const);

/** The union of field names a log record is allowed to carry. */
export type AllowlistedField = (typeof LOG_FIELD_ALLOWLIST)[number];

/**
 * O(1) membership test used by the rebuild hook.
 *
 * Built once at module load from the frozen list, so the gate and the exported
 * list cannot drift apart. `ReadonlySet` — the set is internal, but the type
 * keeps a future refactor from adding a `delete`.
 */
export const LOG_FIELD_ALLOWLIST_SET: ReadonlySet<string> = new Set<string>(
  LOG_FIELD_ALLOWLIST,
);
