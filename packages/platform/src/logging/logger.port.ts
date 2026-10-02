import type { AllowlistedField } from './log-allowlist.js';
import type { ErrorCode } from './error-codes.js';

/**
 * `LoggerPort` — layer 1 of D-15's two-layer PII control, and the surface every
 * module in the codebase is meant to log through.
 *
 * ## What layer 1 buys that layer 2 cannot
 *
 * `log-allowlist.formatter.ts` is the security control: it rebuilds the record
 * at runtime, so a computed key and a nested `err.cause` cannot survive. But a
 * silently-dropped field is a bad failure mode — a developer writes
 * `logger.info({ user_email })`, sees no PII in production, and concludes the
 * field is being logged. The types make the mistake loud *at compile time*
 * instead, so the control is discovered where the bug is written.
 *
 * ## The type is the allowlist
 *
 * `CallerLogField` is derived from `LOG_FIELD_ALLOWLIST` rather than restated,
 * so widening the allowlist widens this surface in the same commit and the two
 * cannot drift. There is deliberately **no** `data` / `meta` / `context` bag:
 * D-16 calls such a bag "a denylist with extra steps", and one bag parameter
 * would undo the entire type-level guarantee while still compiling.
 *
 * ## `error_code`, not `Error`
 *
 * `error()` takes an `error_code` typed as the closed `ErrorCode` enum. Passing
 * a raw `Error` is not offered and would not compile: an error's message and
 * `cause` chain are exactly the untrusted, user-influenced text this whole
 * package exists to keep out of logs. The formatter still *replaces* an `err`
 * defensively, because a direct pino call or a child logger can carry one — but
 * the port gives no way to create that situation.
 */
export type LoggerBaseField = Extract<AllowlistedField, 'service' | 'env' | 'pid'>;

/**
 * The fields a call site may name: the allowlist minus the trio the factory
 * supplies. `Exclude` rather than a hand-written list so the two stay in step.
 */
export type CallerLogField = Exclude<AllowlistedField, LoggerBaseField>;

/**
 * The `fields` argument of every level method.
 *
 * `Partial` because most calls carry one or two fields; the record is validated
 * for shape by the rebuild hook, not here. Values are `unknown` rather than
 * `string` so the type constrains *names*, which is the part that leaks — a
 * value is free-text by definition for fields like `reason`.
 */
export type LogFields = Partial<Record<CallerLogField, unknown>>;

/**
 * The typed logging surface. Implementations must be constructed from
 * `createPinoOptions` (see `pino.config.ts`) so that the base fields and the
 * rebuild hook are wired together; there is no constructor a caller can use to
 * build a logger that bypasses the allowlist.
 */
export interface LoggerPort {
  /**
   * @param message a fixed, developer-written sentence. Never interpolated user
   *   input — `msg` is emitted by pino outside the rebuild hook, so a message
   *   containing an email is the one channel this package cannot filter.
   * @param fields allowlisted field names only.
   */
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(
    message: string,
    fields?: LogFields & { error_code: ErrorCode },
  ): void;
  debug(message: string, fields?: LogFields): void;
}
