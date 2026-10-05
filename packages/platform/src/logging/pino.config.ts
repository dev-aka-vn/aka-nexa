import type { Logger, LoggerOptions } from 'pino';
import { log as rebuildLog } from './log-allowlist.formatter.js';

/**
 * `createPinoOptions` — the single logging configuration every process is built
 * from (D-15, D-16, FND-06).
 *
 * ## pino emits four key sources; this config gates three of them
 *
 * Read from the installed `pino@10.3.1` rather than from the docs, because the
 * distinction decides whether the allowlist is total or partial:
 *
 * | source | emitted by | passes through `formatters.log`? | handled here |
 * |--------|-------------|----------------------------------|--------------|
 * | `level` | `formatters.level`, cached into a `{"level":30` string prefix | **no** | routed through the same rebuild hook |
 * | `ts` | the `timestamp` function, concatenated as a raw prefix | **no** | custom `TimeFn` that emits the allowlisted name `ts` |
 * | child bindings | `asChindings`, concatenated as a raw prefix | **no** | pre-rebuilt by `createChildLogger` — see below |
 * | the log object | `formatters.log` | **yes** | the rebuild hook |
 * | `msg` | appended under `messageKey` after the formatter ran | **no** | see the honesty note below |
 *
 * `_asJson` in `node_modules/pino/lib/tools.js` builds the line as
 * `lsCache[level] + time + chindings + <serialised formatter output> + msg`.
 * Only the fourth term is a serialised object, which is why `formatters.log` is
 * the correct PII control (RESEARCH B-1) **and** why the other three have to be
 * configured deliberately rather than left to pino's defaults.
 *
 * ### `base: null` is load-bearing
 *
 * Left at its default, pino prepends a pre-serialised `{"pid":…,"hostname":…}`
 * bindings chunk to every line. That chunk never reaches `formatters.log`, so
 * `hostname` — which is not on D-16's list — would be emitted on every record
 * regardless of the allowlist. `base: null` suppresses the chunk; `pid` is then
 * stamped by the gated hook instead, where it is a value the allowlist can see.
 *
 * ### Why there is no `formatters.bindings` here, and a `createChildLogger` instead
 *
 * `formatters.bindings` looks like the obvious place to gate a child logger's
 * bindings. It does not work. `child()` in `node_modules/pino/lib/proto.js`
 * takes a deliberate fast path that **discards** it:
 *
 * ```js
 * if (options == null) {
 *   if (instance[formattersSym].bindings !== resetChildingsFormatter) {
 *     instance[formattersSym] = buildFormatters(
 *       formatters.level, resetChildingsFormatter, formatters.log)  // ← identity
 *   }
 *   instance[chindingsSym] = asChindings(instance, bindings)
 * ```
 *
 * A `formatters.bindings` set on the root is therefore honoured for the root's
 * own `base` chunk only — and we set `base: null` — so it would be dead
 * configuration that reads as protective. `logger.child({ user_email })` emits
 * that key verbatim, verified by a failing test before this was written.
 * `createChildLogger` rebuilds the bindings itself *before* handing them to
 * pino, so the child never holds a non-allowlisted key. That relies on no pino
 * internal at all, which is the property worth having: it survives a pino bump.
 * **`createChildLogger` is the only supported way to make a child logger.**
 *
 * ### `msg` is the one channel the allowlist cannot filter
 *
 * pino emits the message string verbatim under the allowlisted key `msg`. The
 * control for it is layer 1 plus convention: `LoggerPort` takes the message as a
 * fixed first argument, so interpolating a user value into it is visible at the
 * call site. This is stated rather than papered over — a claim that the allowlist
 * covers `msg` contents would be false.
 *
 * ## Deliberately absent
 *
 * - **`redact`** — a path-based denylist. D-15 rejects it outright, and a
 *   denylist regex misses a computed key by construction. Its absence is
 *   asserted in the spec so a future "just in case" edit fails.
 * - **`pino.multistream` / a `Writable` destination** — both operate on
 *   already-serialised bytes, so neither can be the PII control. A multistream
 *   remains legitimate later for level-based fan-out (OBS-07 hot/cold sinks),
 *   where the point is routing rather than filtering.
 */

/** The three process entrypoints (D-01). Each gets its own `service` binding. */
export type ProcessName = 'api' | 'worker' | 'scheduler';

/** pino's stock levels plus `silent`. */
export type LogLevel =
  | 'fatal'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace'
  | 'silent';

export interface CreatePinoOptionsInput {
  /** Which entrypoint this is. Stamped on every record; never call-settable. */
  readonly service: ProcessName;
  /** `NODE_ENV`. Stamped on every record; never call-settable. */
  readonly env: string;
  /**
   * Log level, supplied by the call site from validated config (FND-09). Omitted
   * falls back to a per-`env` default rather than pino's unconditional `info`,
   * so a misconfigured production process cannot silently run at `debug`.
   */
  readonly level?: LogLevel;
}

/** `production` runs at `info`; everything else is a developer machine. */
const defaultLevel = (env: string): LogLevel =>
  env === 'production' ? 'info' : 'debug';

/**
 * Emits the timestamp as `ts` — the name on D-16's list. pino's own default
 * (`epochTime`) writes the key `time`, which is *not* allowlisted, and a raw
 * prefix string never passes through the rebuild hook, so the key has to be
 * chosen correctly here rather than renamed later.
 */
const tsTimestamp = (): string => `,"ts":${Date.now()}`;

/**
 * Build the pino options for one process.
 *
 * Base fields are spread **after** the caller's object inside the hook, so a
 * call site cannot overwrite `service`, `env`, or `pid` even if it reaches this
 * seam through a child logger.
 */
export const createPinoOptions = ({
  service,
  env,
  level,
}: CreatePinoOptionsInput): LoggerOptions => {
  const base = { service, env, pid: process.pid } as const;

  return {
    level: level ?? defaultLevel(env),
    // See "base: null is load-bearing" above.
    base: null,
    timestamp: tsTimestamp,
    formatters: {
      /**
       * The level key is emitted from a cached string prefix, not from the log
       * object, so it would otherwise be the one ungated key in the line.
       * Routing it through the same hook makes the allowlist total. If `level`
       * ever left the allowlist this would return `{}` and pino's
       * `JSON.stringify(...).slice(0, -1)` would emit a malformed `{` — which
       * is why the spec asserts this returns exactly `{ level }`.
       */
      level: (_label, value) => rebuildLog({ level: value }),
      /** The D-15 control: this return value is what gets serialised. */
      log: (object) => rebuildLog({ ...object, ...base }),
    },
  };
};

/**
 * Create a child logger — **the only supported way to do so**.
 *
 * pino's own `logger.child(bindings)` serialises the bindings into a
 * pre-serialised chunk on a fast path that discards `formatters.bindings`
 * (quoted above in `child()` in `lib/proto.js`), so a child is the one place
 * where a non-allowlisted key reaches the output with nothing in the way. This
 * helper rebuilds the bindings with the allowlist gate *before* pino sees them,
 * which is why it does not depend on any pino option and why the guarantee
 * survives a version bump.
 *
 * Nesting is safe for the same reason: every child is built here, so a
 * grandchild's bindings are rebuilt too.
 *
 * @param logger a logger created from {@link createPinoOptions}
 * @param bindings fields to carry on every record from this child
 */
export const createChildLogger = (
  logger: Logger,
  bindings: Record<string, unknown>,
): Logger => logger.child(rebuildLog(bindings));
