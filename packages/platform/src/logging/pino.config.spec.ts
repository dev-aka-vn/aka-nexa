import pino, { type Logger, type LoggerOptions } from 'pino';
import { describe, expect, it } from 'vitest';
import { LOG_FIELD_ALLOWLIST } from './log-allowlist.js';
import { ErrorCode } from './error-codes.js';
import { createChildLogger, createPinoOptions } from './pino.config.js';

/**
 * These tests run a **real** `pino@10.3.1` instance and assert on the bytes it
 * would write. That is the whole point: `formatters.log` exists because a
 * destination sees already-serialised output, so the only honest way to test the
 * control is to read the serialised line rather than the object handed to the
 * hook. A test that inspected only the hook's return value would pass even if
 * pino were configured to prepend an ungated `hostname` chunk — which it is, by
 * default.
 */

const EMAIL = 'anna.pino@example.com';

const capture = (options: LoggerOptions) => {
  const lines: string[] = [];
  const destination = {
    write: (line: string): void => {
      lines.push(line);
    },
  };
  const logger: Logger = pino(options, destination);
  const records = () =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, records };
};

const keySet = (record: Record<string, unknown>): string[] => Object.keys(record);

describe('createPinoOptions — wiring (D-15, D-16)', () => {
  it('installs the rebuild hook as formatters.log', () => {
    const options = createPinoOptions({ service: 'api', env: 'test' });

    expect(typeof options.formatters?.log).toBe('function');
    // It is the rebuild plus the factory's base fields — not a function that
    // returns its input unchanged.
    const rebuilt = options.formatters?.log?.({ msg: 'x', user_email: EMAIL });
    expect(rebuilt).toEqual({ msg: 'x', service: 'api', env: 'test', pid: process.pid });
    expect('user_email' in (rebuilt ?? {})).toBe(false);
  });

  it('gates the level key too, because pino emits it from a cached prefix', () => {
    const options = createPinoOptions({ service: 'api', env: 'test' });

    // Exactly `{ level }` — never `{}`, which would make pino's
    // `JSON.stringify(...).slice(0, -1)` emit a malformed `{`.
    expect(options.formatters?.level?.('info', 30)).toEqual({ level: 30 });
  });

  it('registers no formatters.bindings, which pino silently discards on a child', () => {
    // Dead configuration that reads as protective is worse than none: pino's
    // `child()` fast path replaces it with an identity function. The gate for
    // child bindings is `createChildLogger`, which rebuilds before pino sees
    // them. Asserted so a future "let me add it back" edit has to delete this.
    const options = createPinoOptions({ service: 'api', env: 'test' });

    expect(options.formatters?.bindings).toBeUndefined();
  });

  it('sets base: null, so pino does not prepend an ungated {pid, hostname} chunk', () => {
    const options = createPinoOptions({ service: 'api', env: 'test' });

    expect(options.base).toBeNull();
  });

  it('registers no path-based redaction list (D-15 rejects a denylist)', () => {
    const options = createPinoOptions({ service: 'api', env: 'test' });

    expect('redact' in options).toBe(false);
    expect(options.redact).toBeUndefined();
  });

  it('takes the level from config, with a per-env default', () => {
    expect(createPinoOptions({ service: 'api', env: 'test' }).level).toBe('debug');
    expect(createPinoOptions({ service: 'api', env: 'production' }).level).toBe(
      'info',
    );
    expect(
      createPinoOptions({ service: 'worker', env: 'production', level: 'warn' })
        .level,
    ).toBe('warn');
  });
});

describe('createPinoOptions — a real pino instance emits only allowlisted keys', () => {
  it('serialises a PII-bearing record down to the allowlist', () => {
    const { logger, lines, records } = capture(
      createPinoOptions({ service: 'api', env: 'test' }),
    );

    logger.info(
      {
        app_id: 'app-1',
        duration_ms: 12,
        user_email: EMAIL,
        // A computed key is exactly the case the type layer cannot help with —
        // it exists in no source literal — so the runtime gate is the only thing
        // standing between it and the serialised output.
        [EMAIL.split('@')[0] ?? 'contact']: EMAIL,
        err: new Error('upstream rejected', {
          cause: { body: { customer: { email: EMAIL } } },
        }),
      },
      'submission received',
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(EMAIL);
    expect(lines[0]).not.toContain('rejected');

    const [record] = records();
    for (const key of keySet(record ?? {})) {
      expect(LOG_FIELD_ALLOWLIST).toContain(key);
    }
    expect(record).toMatchObject({
      service: 'api',
      env: 'test',
      pid: process.pid,
      app_id: 'app-1',
      duration_ms: 12,
      msg: 'submission received',
      error_code: ErrorCode.UNKNOWN,
    });
  });

  it('emits ts (allowlisted) and never pino’s default time key', () => {
    const { logger, records } = capture(
      createPinoOptions({ service: 'api', env: 'test' }),
    );

    logger.info('link issued');

    const [record] = records();
    expect(typeof record?.ts).toBe('number');
    expect('time' in (record ?? {})).toBe(false);
    // the pre-serialised prefix is gated by the same hook as the log object
    expect(keySet(record ?? {})).toContain('level');
    expect(LOG_FIELD_ALLOWLIST).toContain('level');
  });

  it('stamps exactly the three base fields and never hostname', () => {
    const { logger, records } = capture(
      createPinoOptions({ service: 'scheduler', env: 'production', level: 'info' }),
    );

    logger.warn({ queue: '{akane-q}:submissions', attempt: 1 }, 'job enqueued');

    const [record] = records();
    const base = keySet(record ?? {}).filter((key) =>
      ['service', 'env', 'pid'].includes(key),
    );
    expect(base.sort()).toEqual(['env', 'pid', 'service']);
    expect(record?.service).toBe('scheduler');
    expect(record?.env).toBe('production');
    // `hostname` is not on D-16's list; it is suppressed, not allowlisted.
    expect('hostname' in (record ?? {})).toBe(false);
  });

  it('lets a call site overwrite a base field only by going around the port', () => {
    const { logger, records } = capture(
      createPinoOptions({ service: 'api', env: 'test' }),
    );

    // Even reaching the seam directly, the factory's base wins: it is spread
    // after the caller's object inside the hook.
    logger.info(
      { service: 'worker', app_id: 'app-1' } as Record<string, unknown>,
      'link issued',
    );

    expect(records()[0]?.service).toBe('api');
  });

  it('gates a child logger’s bindings through createChildLogger', () => {
    const { logger, lines } = capture(
      createPinoOptions({ service: 'worker', env: 'test' }),
    );

    const child = createChildLogger(logger, {
      app_id: 'app-1',
      user_email: EMAIL,
    });
    child.info('submission received');

    expect(lines[0]).not.toContain(EMAIL);
    expect(lines[0]).not.toContain('user_email');
    expect(lines[0]).toContain('"app_id":"app-1"');
  });

  it('keeps the gate for a grandchild, since every level is built here', () => {
    const { logger, lines } = capture(
      createPinoOptions({ service: 'worker', env: 'test' }),
    );

    createChildLogger(
      createChildLogger(logger, { app_id: 'app-1' }),
      { user_email: EMAIL },
    ).info('submission received');

    expect(lines[0]).not.toContain(EMAIL);
    expect(lines[0]).toContain('"app_id":"app-1"');
  });

  it('replaces err with an enum error_code and drops the cause chain', () => {
    const { logger, lines, records } = capture(
      createPinoOptions({ service: 'worker', env: 'test' }),
    );

    logger.error(
      { err: Object.assign(new Error('nope'), { code: ErrorCode.TIMEOUT }) },
      'connector call failed',
    );

    expect(lines[0]).not.toContain('nope');
    expect(records()[0]?.error_code).toBe(ErrorCode.TIMEOUT);
    expect('err' in (records()[0] ?? {})).toBe(false);
  });

  it('emits no non-allowlisted key across every level', () => {
    const { logger, records } = capture(
      // trace, so all five levels are actually emitted rather than silently
      // dropped below the threshold.
      createPinoOptions({ service: 'api', env: 'test', level: 'trace' }),
    );

    logger.trace({ count: 1 }, 't');
    logger.debug({ request_id: 'req-1' }, 'd');
    logger.info({ jti: 'jti-1', span_id: 's'.repeat(16) }, 'i');
    logger.warn({ status: 429, reason: 'rate_limited' }, 'w');
    logger.error({ error_code: ErrorCode.RATE_LIMITED, provider: 'slack' }, 'e');

    const records_ = records();
    expect(records_).toHaveLength(5);
    for (const record of records_) {
      for (const key of keySet(record)) {
        expect(LOG_FIELD_ALLOWLIST).toContain(key);
      }
    }
  });
});
