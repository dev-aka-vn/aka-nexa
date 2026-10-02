/**
 * `ErrorCode` — the closed enum behind the allowlisted `error_code` field
 * (D-16, FND-06).
 *
 * ## Why an enum and not a message
 *
 * A log record must be able to say *what class of thing went wrong* without
 * saying anything that came from the thing that went wrong. An error's
 * `message` is attacker- and user-influenced free text: a downstream HTTP body,
 * a validation message echoing a submitted form value, or a connector's own
 * error string can each carry PII straight into a log line. `toErrorCode` is
 * the boundary that refuses to do that — it returns a member of this enum or
 * `UNKNOWN`, and there is no path through it that returns a raw string.
 *
 * Frozen object + same-named type rather than a TypeScript `enum`: an `enum`
 * gives a runtime object too, but the frozen form is a plain data literal, so
 * `isErrorCode` is an honest `Set.has` and this module has no emit-time
 * behaviour to audit.
 */

/**
 * A closed set of failure classes. The `UNKNOWN` member is the default, which
 * is what makes the set safe to grow: a new failure path that nobody classified
 * degrades to `UNKNOWN` rather than inventing a code.
 */
export const ErrorCode = Object.freeze({
  /** Nothing classifiable was supplied. The safe default. */
  UNKNOWN: 'UNKNOWN',
  /** Boot configuration rejected by the Zod schema (FND-09, 01-02). */
  CONFIG_INVALID: 'CONFIG_INVALID',
  /** The process could not reach a dependency it declared required (D-10). */
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  /** A component boundary or provider contract was violated at boot (FND-04). */
  BOUNDARY_VIOLATION: 'BOUNDARY_VIOLATION',
  /** Input failed schema validation. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** The caller is authenticated but not permitted. */
  FORBIDDEN: 'FORBIDDEN',
  /** The addressed resource does not exist or is not visible to the caller. */
  NOT_FOUND: 'NOT_FOUND',
  /** A uniqueness or state-transition precondition failed. */
  CONFLICT: 'CONFLICT',
  /** A rate limit was exceeded (NFR-SEC-6). */
  RATE_LIMITED: 'RATE_LIMITED',
  /** A downstream system or connector returned an error. */
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  /** A downstream call exceeded its deadline. */
  TIMEOUT: 'TIMEOUT',
  /** An unhandled defect in this service. */
  INTERNAL: 'INTERNAL',
} as const);

/** The union of every legal `error_code` value. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The enum members as an array, for iteration in tests and registries. */
export const ERROR_CODES: readonly ErrorCode[] = Object.freeze(
  Object.values(ErrorCode),
);

const ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(ERROR_CODES);

/**
 * Closed-membership test. The rebuild hook calls this on every `error_code`
 * value it sees, so a caller cannot smuggle a string into the field even though
 * the key is allowlisted.
 */
export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && ERROR_CODE_SET.has(value);

/**
 * Map an arbitrary value to an `ErrorCode`. **Never returns a raw string.**
 *
 * The `err` object is read for structure only — a `code`/`error_code`/`name`
 * property that is *already* a member of the enum is honoured, because a
 * connector that speaks this vocabulary should not be flattened to `UNKNOWN`.
 * Anything else, including any `message` and any `cause` chain, is discarded.
 * The one exception worth naming: a caller that already holds a valid
 * `ErrorCode` may pass it straight through, so `toErrorCode` is also the
 * normaliser the formatter applies to an allowlisted `error_code` value.
 */
export const toErrorCode = (err: unknown): ErrorCode => {
  if (isErrorCode(err)) return err;

  if (typeof err === 'object' && err !== null) {
    const candidate = err as {
      code?: unknown;
      error_code?: unknown;
      name?: unknown;
    };
    for (const key of ['code', 'error_code', 'name'] as const) {
      if (isErrorCode(candidate[key])) return candidate[key];
    }
  }

  return ErrorCode.UNKNOWN;
};
