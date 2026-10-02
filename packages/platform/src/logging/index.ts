/**
 * The logging surface (FND-06).
 *
 * Plan 10 wires this into the three entrypoints and `nestjs-pino`. It is a
 * separate barrel rather than a line in `packages/platform/src/index.ts` so that
 * wiring the logger into a composition root does not require editing the
 * platform package's public barrel — and so a consumer that only wants the
 * types (`LoggerPort`, `AllowlistedField`, `ErrorCode`) does not pull pino in.
 *
 * The runtime rebuild hook is deliberately exported: `createPinoOptions` needs
 * it, and a test that asserts a specific record was dropped needs to call it
 * directly rather than through a logger it does not control.
 */
export { LOG_FIELD_ALLOWLIST, LOG_FIELD_ALLOWLIST_SET } from './log-allowlist.js';
export type { AllowlistedField } from './log-allowlist.js';

export { ErrorCode, ERROR_CODES, isErrorCode, toErrorCode } from './error-codes.js';

export { log as rebuildLogObject } from './log-allowlist.formatter.js';

export type {
  CallerLogField,
  LogFields,
  LoggerBaseField,
  LoggerPort,
} from './logger.port.js';

export { createPinoOptions } from './pino.config.js';
export type {
  CreatePinoOptionsInput,
  LogLevel,
  ProcessName,
} from './pino.config.js';
