import { NestFactory } from '@nestjs/core';

/**
 * `apps/worker` composition root — shell only (D-09).
 *
 * Completed in plan 07. This shell deliberately does NOT start an HTTP server;
 * it exists so the workspace resolves and so a later plan has exactly one place
 * to add the BullMQ consumer bootstrap. Exiting non-zero keeps an accidental
 * `node dist/main.js` from masquerading as a running worker.
 */
async function main(): Promise<void> {
  // Assert the framework entrypoint is importable through the pinned stack.
  if (typeof NestFactory.create !== 'function') {
    throw new Error('NOT_IMPLEMENTED: @nestjs/core NestFactory.create unavailable');
  }

  console.error(
    'NOT_IMPLEMENTED: apps/worker is a Phase 1 shell; the consumer lands in plan 07',
  );
  process.exitCode = 1;
}

void main();
