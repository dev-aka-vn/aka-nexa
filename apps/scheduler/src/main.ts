import { NestFactory } from '@nestjs/core';

/**
 * `apps/scheduler` composition root — shell only (D-09).
 *
 * Completed in plan 10. This shell deliberately does NOT start an HTTP server;
 * it exists so the workspace resolves and so a later plan has exactly one place
 * to register the durable BullMQ Job Schedulers (never `@nestjs/schedule` for
 * durable jobs). Exiting non-zero keeps an accidental `node dist/main.js` from
 * masquerading as a running scheduler.
 */
async function main(): Promise<void> {
  // Assert the framework entrypoint is importable through the pinned stack.
  if (typeof NestFactory.create !== 'function') {
    throw new Error('NOT_IMPLEMENTED: @nestjs/core NestFactory.create unavailable');
  }

  console.error(
    'NOT_IMPLEMENTED: apps/scheduler is a Phase 1 shell; Job Schedulers land in plan 10',
  );
  process.exitCode = 1;
}

void main();
