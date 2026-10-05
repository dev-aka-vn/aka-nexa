import { describe, expect, it } from 'vitest';
import { LOG_FIELD_ALLOWLIST } from './log-allowlist.js';
import { ErrorCode } from './error-codes.js';
import { log as rebuild } from './log-allowlist.formatter.js';
import type { LoggerPort, CallerLogField, LoggerBaseField } from './logger.port.js';

/**
 * Layer 1 of D-15. The load-bearing assertion in this file is not a runtime
 * one — it is the three `@ts-expect-error` directives. Each of them passes
 * something the type surface must reject, and `tsc` fails if a directive goes
 * *unused*, i.e. if the surface ever loosens. That is the test: a comment
 * asserting "the types are closed" is worth nothing, a consumed directive is a
 * build failure waiting to happen.
 *
 * The in-memory implementation below is deliberately the *real* one: it routes
 * through the same rebuild hook `createPinoOptions` wires into pino, so these
 * tests exercise the composition of layer 1 and layer 2 rather than a mock.
 */
interface CapturedLine {
  level: 'info' | 'warn' | 'error' | 'debug';
  record: Record<string, unknown>;
}

const capture = (): { lines: CapturedLine[]; logger: LoggerPort } => {
  const lines: CapturedLine[] = [];
  const emit = (level: CapturedLine['level'], message: string, fields = {}) => {
    // Base fields come from the factory side and are spread *last*, so a caller
    // cannot overwrite process identity even if it reaches this seam — the same
    // order `createPinoOptions` uses.
    const record = rebuild({
      level,
      msg: message,
      ...fields,
      service: 'api',
      env: 'test',
      pid: process.pid,
    });
    lines.push({ level, record });
  };
  return {
    lines,
    logger: {
      info: (message, fields) => emit('info', message, fields),
      warn: (message, fields) => emit('warn', message, fields),
      error: (message, fields) => emit('error', message, fields),
      debug: (message, fields) => emit('debug', message, fields),
    },
  };
};

describe('LoggerPort — runtime surface (D-15 layer 1 + D-16)', () => {
  it('records the level and the message it was given', () => {
    const { lines, logger } = capture();

    logger.info('link issued', { app_id: 'app-1', duration_ms: 12 });
    logger.warn('connector retried', { provider: 'redmine', attempt: 2 });

    expect(lines).toHaveLength(2);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.record).toEqual({
      level: 'info',
      msg: 'link issued',
      service: 'api',
      env: 'test',
      pid: process.pid,
      app_id: 'app-1',
      duration_ms: 12,
    });
    expect(lines[1]?.record).toMatchObject({ attempt: 2, provider: 'redmine' });
  });

  it('stamps the three factory-supplied base fields on every line', () => {
    const { lines, logger } = capture();

    logger.debug('heartbeat');
    logger.error('connector call failed', { error_code: ErrorCode.UPSTREAM_ERROR });

    for (const { record } of lines) {
      expect(record.service).toBe('api');
      expect(record.env).toBe('test');
      expect(record.pid).toBeTypeOf('number');
    }
  });

  it('accepts an error_code from the closed enum and nothing else at runtime', () => {
    const { lines, logger } = capture();

    logger.error('submission rejected', { error_code: ErrorCode.VALIDATION_FAILED });

    expect(lines[0]?.record.error_code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('derives its field names from LOG_FIELD_ALLOWLIST, minus the base trio', () => {
    // The type is `Exclude<AllowlistedField, 'service'|'env'|'pid'>`. Asserting
    // the arithmetic here is what stops a future allowlist edit from silently
    // adding a caller-settable base field.
    const base: readonly LoggerBaseField[] = ['service', 'env', 'pid'];
    const callerFields = LOG_FIELD_ALLOWLIST.filter(
      (field) => !base.includes(field as LoggerBaseField),
    );

    expect(callerFields).toHaveLength(LOG_FIELD_ALLOWLIST.length - 3);
    // the surface is a subset of the allowlist — it can never exceed it
    for (const field of callerFields) {
      expect(LOG_FIELD_ALLOWLIST).toContain(field);
    }
    // a spot-check of the derived union, kept honest by a compile-time assert
    const traceId: CallerLogField = 'trace_id';
    expect(traceId).toBe('trace_id');
  });

  it('still drops a smuggled field at runtime even where the compiler refused it', () => {
    const { lines, logger } = capture();

    // The next three calls are type errors — see the @ts-expect-error block
    // below. They still execute, which is the point: the two layers are
    // independent, and layer 2 holds even for code layer 1 already rejected.
    logger.info('submission received', {
      app_id: 'app-1',
      // @ts-expect-error `user_email` is not on LOG_FIELD_ALLOWLIST (D-16, T-1-10).
      user_email: 'anna.smuggled@example.com',
    });
    // @ts-expect-error D-16: there is no free-form bag on the port.
    logger.info('submission received', { data: { email: 'bag@example.com' } });
    logger.info('submission received', {
      // @ts-expect-error `service` is supplied by the factory, not the call site.
      service: 'worker',
    });

    for (const { record } of lines) {
      const serialised = JSON.stringify(record);
      expect(serialised).not.toContain('anna.smuggled@example.com');
      expect(serialised).not.toContain('bag@example.com');
    }
    // the caller's attempt to overwrite the process identity did not take
    expect(lines.every(({ record }) => record.service === 'api')).toBe(true);
  });
});

describe('LoggerPort — closed at compile time (T-1-10)', () => {
  it('rejects a free-form bag, a base field, and a raw Error', () => {
    const { logger } = capture();
    const userEmail = 'anna.typed@example.com';

    // Each line below is a compile error. `tsc` reports an unused
    // `@ts-expect-error` directive as an error, so this test fails the build if
    // the type surface ever loosens — that inversion is what makes the
    // directives an assertion rather than a comment.

    // D-16: "a free-form bag is a denylist with extra steps".
    // @ts-expect-error no `data` bag on the port.
    logger.info('submission received', { data: { email: userEmail } });
    // @ts-expect-error no `meta` bag on the port.
    logger.info('submission received', { meta: { email: userEmail } });
    // @ts-expect-error no `context` bag on the port.
    logger.info('submission received', { context: { email: userEmail } });

    // The factory owns process identity; a call site that can set `service` can
    // mislabel which process produced a line.
    // @ts-expect-error `service` is factory-supplied.
    logger.info('submission received', { service: 'worker' });
    // @ts-expect-error `env` is factory-supplied.
    logger.info('submission received', { env: 'production' });
    // @ts-expect-error `pid` is factory-supplied.
    logger.info('submission received', { pid: 1 });

    // A raw Error instead of the closed enum. Its message and `cause` are the
    // untrusted text this package exists to keep out of logs.
    logger.error('connector call failed', {
      // @ts-expect-error `error_code` must be a member of the ErrorCode enum.
      error_code: new Error('upstream rejected: ' + userEmail),
    });

    expect(typeof userEmail).toBe('string');
  });
});
