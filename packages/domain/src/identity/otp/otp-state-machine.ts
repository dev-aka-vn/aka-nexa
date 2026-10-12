/**
 * The OTP state machine (IDN-05).
 *
 * Redis-backed by requirement (AD-9): attempt
 * counters and lockouts must survive restarts and
 * apply across instances — no in-memory counters,
 * no sticky sessions. The state is the JSON record
 * `akane:otp:{chatUserId}` carrying
 * `{ codeHash, attempts, expiresAt, lockoutUntil,
 * status }` plus a per-identity attempts counter
 * `akane:otp:{chatUserId}:attempts`, with a Redis
 * TTL equal to the 10-minute expiry so expiry is
 * structural — the key disappears on expiry, there
 * is no poll.
 *
 * Every transition runs as one Lua script, so the
 * read-check-INCR-write that arms an attempt or a
 * lockout is atomic across instances: concurrent
 * verifications can never lose an attempt (T-06-10).
 * The attempt count itself is a Redis INCR — an
 * integer, never fractional. The third failed
 * attempt arms the 30-minute lockout measured
 * from that failure; a successful verify leaves a
 * consumed tombstone for the original remaining
 * window, so a replay is refused as consumed
 * while a never-requested code is expired.
 *
 * Only the SHA-256 hash of the 6-digit code is
 * stored; the plaintext exists solely in the
 * `OtpRequestDecision` the caller hands straight
 * to the delivery port (T-06-13). The `now`
 * parameter is injectable so the 10-minute
 * boundary is spec-assertable without waiting
 * ten minutes.
 */

import { createHash, randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

/** The OTP validity window: a code presented at 9:59 verifies, at 10:01 it does not. */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** The attempt budget: the third failed attempt is the last allowed. */
export const OTP_MAX_ATTEMPTS = 3;

/** The lockout window, measured from the third failed attempt. */
export const OTP_LOCKOUT_MS = 30 * 60 * 1000;

/** Redis key prefix. The state is namespaced per chat identity (T-06-11). */
const KEY_PREFIX = 'akane:otp:';

/** The OTP state record — the JSON value under `akane:otp:{chatUserId}`. */
export interface OtpRecord {
  readonly codeHash: string;
  readonly attempts: number;
  readonly expiresAt: number;
  readonly lockoutUntil: number | null;
  readonly status: 'pending' | 'locked' | 'consumed';
  /** Every state transition, recorded with the attempt count (IDN-05). */
  readonly transitions: readonly OtpTransition[];
}

/** One recorded state transition. `status` is the transition kind. */
export interface OtpTransition {
  readonly status: string;
  readonly attempts: number;
  readonly at: number;
}

/** The outcome of `request`: the fresh code, or the active lockout. */
export type OtpRequestDecision =
  | { readonly status: 'delivered'; readonly code: string }
  | {
      readonly status: 'locked';
      readonly lockoutUntil: number;
      readonly remainingMinutes: number;
    };

/** The outcome of `verify`: success, or the specific refusal (BLD-07). */
export type OtpVerifyDecision =
  | { readonly status: 'verified' }
  | { readonly status: 'invalid'; readonly attemptsRemaining: number }
  | {
      readonly status: 'locked';
      readonly lockoutUntil: number;
      readonly remainingMinutes: number;
    }
  | { readonly status: 'expired' }
  | { readonly status: 'consumed' };

/**
 * Create a fresh OTP record. Refuses while a lockout
 * is active — the check and the create are one atomic
 * script, so a concurrent third failure cannot be
 * clobbered by a request racing it.
 */
const REQUEST_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if raw then
  local record = cjson.decode(raw)
  if record.status == 'locked' and record.lockoutUntil ~= cjson.null
      and tonumber(record.lockoutUntil) > tonumber(ARGV[1]) then
    return { 'locked', tonumber(record.lockoutUntil) }
  end
end
local record = {
  codeHash = ARGV[2],
  attempts = 0,
  expiresAt = tonumber(ARGV[1]) + tonumber(ARGV[3]),
  lockoutUntil = cjson.null,
  status = 'pending',
  transitions = { { status = 'requested', attempts = 0, at = tonumber(ARGV[1]) } },
}
redis.call('SET', KEYS[1], cjson.encode(record), 'PX', tonumber(ARGV[3]))
redis.call('DEL', KEYS[2])
return { 'ok' }
`;

/**
 * Verify a presented code. The whole transition —
 * expiry check, lockout check, hash comparison,
 * atomic attempt increment — runs in one script, so
 * two concurrent verifications of the same wrong
 * code count exactly two attempts.
 *
 * The third failed attempt is the last allowed: it
 * arms the 30-minute lockout measured from that
 * failure (not the first), and the fourth attempt
 * is refused with the lockout active. A successful
 * verify replaces the pending record with a short-
 * lived consumed tombstone, so a replay is refused
 * as consumed while a code that was never requested
 * (or whose TTL elapsed) is refused as expired.
 */
const VERIFY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  -- No record at all: never requested, or the structural
  -- TTL already elapsed — either way the OTP is expired.
  return { 'expired' }
end
local record = cjson.decode(raw)
if record.status == 'consumed' then
  return { 'consumed' }
end
if tonumber(record.expiresAt) <= tonumber(ARGV[1]) then
  -- Defense in depth: a read that raced the key TTL still refuses.
  table.insert(record.transitions, { status = 'expired', attempts = tonumber(record.attempts), at = tonumber(ARGV[1]) })
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return { 'expired' }
end
if record.status == 'locked' and record.lockoutUntil ~= cjson.null
    and tonumber(record.lockoutUntil) > tonumber(ARGV[1]) then
  return { 'locked', tonumber(record.lockoutUntil) }
end
if record.codeHash == ARGV[2] then
  -- Single-use: the pending record becomes a consumed tombstone
  -- that outlives the verify by exactly the original remaining
  -- window, so a replay is distinguished from a never-requested code.
  local remaining = tonumber(record.expiresAt) - tonumber(ARGV[1])
  if remaining < 1 then remaining = 1 end
  record.status = 'consumed'
  table.insert(record.transitions, { status = 'verified', attempts = tonumber(record.attempts), at = tonumber(ARGV[1]) })
  redis.call('SET', KEYS[1], cjson.encode(record), 'PX', remaining)
  redis.call('DEL', KEYS[2])
  return { 'verified' }
end
local attempts = redis.call('INCR', KEYS[2])
record.attempts = attempts
table.insert(record.transitions, { status = 'invalid', attempts = attempts, at = tonumber(ARGV[1]) })
local locked = attempts >= tonumber(ARGV[5])
local ttl = locked and tonumber(ARGV[4]) or (tonumber(record.expiresAt) - tonumber(ARGV[1]))
if locked then
  -- The third failed attempt is the last allowed: it arms the
  -- lockout, measured from THIS failure, not the first.
  record.status = 'locked'
  record.lockoutUntil = tonumber(ARGV[1]) + tonumber(ARGV[4])
  table.insert(record.transitions, { status = 'locked', attempts = attempts, at = tonumber(ARGV[1]) })
end
redis.call('PEXPIRE', KEYS[2], ttl)
redis.call('SET', KEYS[1], cjson.encode(record), 'PX', ttl)
return { 'invalid', attempts }
`;

/** A 6-digit numeric code, from the stdlib CSPRNG. */
function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** SHA-256 hex — the only form of the code that ever persists. */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** The lockout remaining, in whole minutes, always at least 1. */
function remainingMinutes(lockoutUntil: number, now: number): number {
  return Math.max(1, Math.ceil((lockoutUntil - now) / 60_000));
}

@Injectable()
export class OtpStateMachine {
  /**
   * `now` is injectable so the 10-minute expiry
   * boundary is spec-assertable: the tests pin the
   * clock and step it across the TTL without
   * waiting ten minutes.
   */
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private recordKey(chatUserId: string): string {
    return `${KEY_PREFIX}${chatUserId}`;
  }

  private counterKey(chatUserId: string): string {
    return `${KEY_PREFIX}${chatUserId}:attempts`;
  }

  /**
   * Create a fresh OTP for the chat identity and
   * return its plaintext code — for the delivery
   * port call only. A re-request rotates the code
   * and resets the attempt budget (a fresh code, a
   * fresh budget), unless a lockout is active.
   */
  async request(chatUserId: string): Promise<OtpRequestDecision> {
    const code = generateCode();
    const reply = await this.runScript(REQUEST_SCRIPT, chatUserId, [
      this.now(),
      hashCode(code),
      OTP_TTL_MS,
    ]);
    if (reply[0] === 'locked') {
      const lockoutUntil = Number(reply[1]);
      return {
        status: 'locked',
        lockoutUntil,
        remainingMinutes: remainingMinutes(lockoutUntil, this.now()),
      };
    }
    return { status: 'delivered', code };
  }

  /**
   * Verify a presented code against the identity's
   * OTP. Refuses an expired record (`OTP_EXPIRED`),
   * a consumed one (`OTP_CONSUMED`), a mismatched
   * one (`OTP_INVALID` naming the remaining count),
   * and consumes the code on success — single-use.
   */
  async verify(chatUserId: string, code: string): Promise<OtpVerifyDecision> {
    const reply = await this.runScript(VERIFY_SCRIPT, chatUserId, [
      this.now(),
      hashCode(code),
      OTP_TTL_MS,
      OTP_LOCKOUT_MS,
      OTP_MAX_ATTEMPTS,
    ]);
    switch (reply[0]) {
      case 'verified':
        return { status: 'verified' };
      case 'consumed':
        return { status: 'consumed' };
      case 'expired':
        return { status: 'expired' };
      case 'invalid':
        return {
          status: 'invalid',
          attemptsRemaining: OTP_MAX_ATTEMPTS - Number(reply[1]),
        };
      case 'locked': {
        const lockoutUntil = Number(reply[1]);
        return {
          status: 'locked',
          lockoutUntil,
          remainingMinutes: remainingMinutes(lockoutUntil, this.now()),
        };
      }
      default:
        return { status: 'expired' };
    }
  }

  private async runScript(
    script: string,
    chatUserId: string,
    argv: readonly (string | number)[],
  ): Promise<Array<string | number>> {
    const reply = (await this.redis.eval(
      script,
      2,
      this.recordKey(chatUserId),
      this.counterKey(chatUserId),
      ...argv,
    )) as Array<string | number>;
    return reply;
  }
}
