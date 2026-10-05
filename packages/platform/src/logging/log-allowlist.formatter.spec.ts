import { describe, expect, it } from 'vitest';
import { LOG_FIELD_ALLOWLIST } from './log-allowlist.js';
import { ErrorCode, isErrorCode } from './error-codes.js';
import { log } from './log-allowlist.formatter.js';

/**
 * D-17's three-level test — the assertion FND-06 stands or falls on.
 *
 * D-17: "emit an email at three levels — as a typed field, as a computed key,
 * and inside a nested `cause` — and assert none reaches the serialised output.
 * The conflict ruling is worthless without this test."
 *
 * The three levels are chosen so that no single mechanism catches all of them:
 * the TypeScript surface catches level 1, only a runtime rebuild catches level 2,
 * and only a rebuild (rather than a serializer) makes level 3 depth-independent.
 * Every assertion is made against `JSON.stringify(log(record))` — the string
 * that would be written to disk — not against the returned object's contents.
 * A test that only inspected the object could be satisfied by a downstream
 * filter, which is precisely the control that does not exist.
 */
const EMAIL_TYPED = 'anna.typed@example.com';
const EMAIL_COMPUTED = 'bob.computed@example.com';
const EMAIL_CAUSE = 'carol.cause@example.com';

const serialise = (record: Record<string, unknown>): string =>
  JSON.stringify(log(record));

describe('LOG_FIELD_ALLOWLIST (D-16)', () => {
  it('is exactly the twenty-one fields D-16 names, in that order', () => {
    expect(LOG_FIELD_ALLOWLIST).toEqual([
      'ts',
      'level',
      'msg',
      'service',
      'env',
      'pid',
      'trace_id',
      'span_id',
      'request_id',
      'jti',
      'app_id',
      'form_id',
      'action',
      'status',
      'duration_ms',
      'error_code',
      'provider',
      'queue',
      'attempt',
      'count',
      'reason',
    ]);
    expect(LOG_FIELD_ALLOWLIST).toHaveLength(21);
  });

  it('is frozen, so a runtime mutation cannot widen the gate', () => {
    expect(Object.isFrozen(LOG_FIELD_ALLOWLIST)).toBe(true);
  });

  it('names no field that could carry free user text', () => {
    for (const forbidden of [
      'email',
      'name',
      'message',
      'text',
      'body',
      'content',
      'data',
      'meta',
      'payload',
      'submission',
    ]) {
      expect(LOG_FIELD_ALLOWLIST).not.toContain(forbidden);
    }
  });
});

describe('formatters.log rebuild hook — D-17 three-level PII test (FND-06)', () => {
  it('level 1: a PII-shaped field whose key is not allowlisted is dropped', () => {
    const record = {
      level: 30,
      msg: 'submission received',
      app_id: 'app-1',
      user_email: EMAIL_TYPED,
      user_name: 'Anna Typed',
    };

    const out = serialise(record);

    expect(out).not.toContain(EMAIL_TYPED);
    expect(out).not.toContain('user_email');
    expect(out).not.toContain('user_name');
    // the allowlisted siblings survive — the hook is not just emptying records
    expect(out).toContain('"app_id":"app-1"');
  });

  it('level 2: a key computed from user input is dropped', () => {
    // Built the way a compromised or careless call site would build it: the key
    // does not exist in any source literal, so no type and no reviewer sees it.
    const userInput = ['contact', 'detail'].join('_');
    const record: Record<string, unknown> = {
      level: 30,
      msg: 'submission received',
    };
    record[userInput] = EMAIL_COMPUTED;

    const out = serialise(record);

    expect(out).not.toContain(EMAIL_COMPUTED);
    expect(out).not.toContain(userInput);
    expect(Object.keys(log(record))).toEqual(['level', 'msg']);
  });

  it('level 3: an email inside a nested err.cause chain never serialises', () => {
    const cause = new Error('upstream rejected the request', {
      cause: {
        status: 400,
        body: { customer: { email: EMAIL_CAUSE } },
      },
    });
    const record = {
      level: 50,
      msg: 'connector call failed',
      provider: 'redmine',
      err: cause,
    };

    const out = serialise(record);

    expect(out).not.toContain(EMAIL_CAUSE);
    // Quoted-key form: a bare 'err' substring would also match "error_code".
    expect(out).not.toContain('"err"');
    expect(out).not.toContain('"cause"');
    expect(out).not.toContain('"body"');
    expect(out).not.toContain('rejected the request');
    // …and the error is still *reported*, as a closed-enum code.
    expect(out).toContain(`"error_code":"${ErrorCode.UNKNOWN}"`);
    expect(isErrorCode(log(record).error_code)).toBe(true);
  });

  it('finds none of the three seeded emails when they are combined in one record', () => {
    const record: Record<string, unknown> = {
      level: 50,
      msg: 'submission received',
      app_id: 'app-1',
      user_email: EMAIL_TYPED,
      err: new Error('rejected', { cause: { email: EMAIL_CAUSE } }),
    };
    record[['contact', 'detail'].join('_')] = EMAIL_COMPUTED;

    const out = serialise(record);

    for (const email of [EMAIL_TYPED, EMAIL_COMPUTED, EMAIL_CAUSE]) {
      expect(out).not.toContain(email);
    }
    expect(Object.keys(log(record)).sort()).toEqual([
      'app_id',
      'error_code',
      'level',
      'msg',
    ]);
  });
});

describe('formatters.log rebuild hook — depth, purity, and passthrough', () => {
  it('strips a forbidden field nested two and three levels deep (rebuild, not prune)', () => {
    const record = {
      level: 30,
      msg: 'link issued',
      context: { user: { email: EMAIL_TYPED } }, // 3 levels under a closed key
      meta: { email: EMAIL_CAUSE }, // 2 levels under a closed key
    };

    const out = serialise(record);

    expect(out).not.toContain(EMAIL_TYPED);
    expect(out).not.toContain(EMAIL_CAUSE);
    expect(Object.keys(log(record))).toEqual(['level', 'msg']);
  });

  it('drops an object value even on an allowlisted key', () => {
    // The depth guarantee has to hold through the allowlist too, or
    // `reason: { detail: { email } }` is a bypass.
    const out = serialise({ level: 30, reason: { detail: { email: EMAIL_TYPED } } });

    expect(out).not.toContain(EMAIL_TYPED);
    expect('reason' in log({ level: 30, reason: { detail: { email: EMAIL_TYPED } } })).toBe(
      false,
    );
  });

  it('drops a non-finite number rather than letting JSON invent a null', () => {
    const rebuilt = log({ level: 30, duration_ms: Number.NaN });

    expect('duration_ms' in rebuilt).toBe(false);
  });

  it('round-trips a fully allowlisted record unchanged', () => {
    const record = {
      ts: 1758000000000,
      level: 30,
      msg: 'link issued',
      service: 'api',
      env: 'test',
      pid: 4242,
      trace_id: 'a'.repeat(32),
      span_id: 'b'.repeat(16),
      request_id: 'req-9',
      jti: 'jti-9',
      app_id: 'app-1',
      form_id: 'form-2',
      action: 'submit',
      status: 200,
      duration_ms: 12,
      error_code: ErrorCode.UPSTREAM_ERROR,
      provider: 'slack',
      queue: '{akane-q}:submissions',
      attempt: 1,
      count: 20,
      reason: 'rate_limited',
    };

    expect(log(record)).toEqual(record);
  });

  it('does not invent an allowlisted key for an empty or message-only record', () => {
    expect(log({})).toEqual({});
    expect(log({ msg: 'heartbeat' })).toEqual({ msg: 'heartbeat' });
  });

  it('is pure — same input, same output, and the input is never mutated', () => {
    const err = new Error('boom', { cause: { email: EMAIL_CAUSE } });
    const record: Record<string, unknown> = {
      level: 50,
      msg: 'connector call failed',
      err,
      user_email: EMAIL_TYPED,
    };
    // Identity snapshots: the hook must leave the exact same objects in place.
    const causeBefore = (err as Error & { cause?: unknown }).cause;
    const keysBefore = Object.keys(record).sort();

    const first = log(record);
    const second = log(record);

    expect(second).toEqual(first);
    // `err` is still there, untouched: the hook reads, it does not prune.
    expect(record.err).toBe(err);
    expect('err' in record).toBe(true);
    expect(Object.keys(record).sort()).toEqual(keysBefore);
    expect(record.user_email).toBe(EMAIL_TYPED);
    expect(record.level).toBe(50);
    expect(record.msg).toBe('connector call failed');
    expect((record.err as Error & { cause?: unknown }).cause).toBe(causeBefore);
    // the returned object is a fresh allocation, not the input
    expect(first).not.toBe(record);
  });

  it('normalises an allowlisted error_code that is not a member of the enum', () => {
    // `error_code` is allowlisted by key, so without normalisation a caller
    // could pass any string through it — including an email.
    const rebuilt = log({ level: 50, error_code: EMAIL_TYPED });

    expect(JSON.stringify(rebuilt)).not.toContain(EMAIL_TYPED);
    expect(rebuilt.error_code).toBe(ErrorCode.UNKNOWN);
  });

  it('honours a downstream error that already speaks the enum vocabulary', () => {
    const rebuilt = log({
      level: 50,
      err: Object.assign(new Error('nope'), { code: ErrorCode.TIMEOUT }),
    });

    expect(rebuilt.error_code).toBe(ErrorCode.TIMEOUT);
  });

  it('prefers the err-derived code over a caller-supplied one', () => {
    const rebuilt = log({
      level: 50,
      error_code: ErrorCode.INTERNAL,
      err: Object.assign(new Error('nope'), { code: ErrorCode.RATE_LIMITED }),
    });

    expect(rebuilt.error_code).toBe(ErrorCode.RATE_LIMITED);
  });
});
